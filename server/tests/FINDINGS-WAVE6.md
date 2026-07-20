# Wave 6 findings — meal planner

Found while writing `tests/weeks.test.ts` and `tests/meal-plan.test.ts`. Nothing
under `src/` was changed from here. Findings 1 and 2 are fixed and their tests
now run; finding 3 is open, with a `.skip`ped failing case in
`tests/shopping-list.test.ts` and another in `tests/meal-plan.test.ts`.

`src/lib/weeks.ts` came out clean — including the timezone property the whole
string-date design exists to guarantee. `startOfWeek`, `weekDates` and
`shiftWeek` return identical results under `Pacific/Kiritimati` (UTC+14) and
`Pacific/Niue` (UTC-11), Sunday belongs to the week that started the previous
Monday, and month, year and leap-day boundaries are all correct.

---

## Open

### 3. The shopping-list cap is breached whenever the unticked items alone fill it

**Where:** `mergeItems` in `src/routes/shopping-list.ts`, in the truncation
added for finding 2:

```ts
const kept = unchecked.slice(-LIMITS.shoppingItems);
const room = LIMITS.shoppingItems - kept.length;
return { items: [...checked.slice(-room), ...kept]..., dropped: all.length - LIMITS.shoppingItems };
```

**Tests:** `tests/shopping-list.test.ts` →
`it.skip('never returns more than the cap, however many items are ticked')`, and
`tests/meal-plan.test.ts` →
`it.skip('still respects the cap when the unticked items alone fill it')`.

When the unticked items already fill the cap, `room` is `0` — and
`checked.slice(-0)` is `checked.slice(0)`, which is the **entire** array rather
than none of it. Every ticked item is then kept on top of a list that is already
full, and `dropped` reports a truncation that did not happen.

Reproduction (direct, no HTTP):

```
stored:   300 unticked + 2 ticked
incoming: 2 freshly generated lines
mergeItems(...)  ->  { items: 302, dropped: 2 }
```

Nothing was dropped; the count is a fiction, and `items` exceeds
`LIMITS.shoppingItems`. It is not bounded by a couple of items either — the
overflow is exactly the number of ticked items:

```
stored:   300 unticked + 2,000 ticked
incoming: 1 line
mergeItems(...)  ->  { items: 2,300, dropped: 2,001 }
```

The cap is what bounds the document, so this is the same class of problem
`LIMITS.commentsPerRecipe` exists to prevent: a list nobody ever clears grows
without limit as long as its owner keeps ticking things off.

`-0` is the whole of the trap. `checked.slice(checked.length - room)` — or
guarding `room === 0` explicitly — behaves for every value of `room`.

---

## Fixed

### 1. A recipe planned twice in a week at different servings lost one meal's quantities *(fixed)*

**Was:** item ids are `${recipeId}-${index}`, deliberately, so that "the same
recipe planned twice in a week contributes one line, not two". But the two
contributions were also scaled *differently* — once per entry — and `mergeItems`
resolves an id collision by keeping the more recently added `amount`, not by
adding the two together. A recipe for 4 planned Monday for 4 and Tuesday for 8
produced `400 g` of rice where 600 g is needed: a confident `200` with
`meals: 2` and no signal at all that a meal's worth had gone. Someone cooking
the dish twice in a week went home with two thirds of the food.

**Now:** `POST /api/meal-plan/shopping-list` sums the scale factors per recipe
*before* building any line, so one line carries the true total. Covered by
`tests/meal-plan.test.ts`:

- `sums the quantities when the same recipe is planned at two servings counts` — 200 g + 400 g = `600 g`.
- `adds a third helping rather than merely taking the largest` — factors 1 + 2 + ½ = 3.5, so `700 g`. Anything taking a maximum or a last value lands on 400 g.
- `counts an unscalable recipe once per meal instead of dividing by zero` — a recipe with no stated yield contributes a factor of 1 per meal.
- `contributes one line for a recipe planned on two days` — still two lines for two ingredients, now reading `400 g`.
- `does not duplicate items when run twice for the same week` — re-running re-states the same total rather than compounding it.

`recipes` in the response (distinct recipes, alongside `meals`) is what makes
"one line per recipe" checkable, and is asserted throughout.

### 2. Generating a week's list was a silent no-op once the list was full *(fixed)*

**Was:** the merged list was sorted oldest-first and then truncated, so the
items cut were always the newest — always exactly the ones the caller had just
asked to add. With 300 stored items, generating a week returned
`200 { added: 1, meals: 1 }` and the ingredient was not in `items`; the client
showed success and the user walked into a shop without it. Re-running never
helped, because the generated ids are stable.

**Now:** `mergeItems` returns `{ items, dropped }` and gives up ticked items
first, then the oldest still-needed ones, and both `POST /api/shopping-list/merge`
and `POST /api/meal-plan/shopping-list` return `dropped` so the UI can say so.
`added` now counts lines actually written. Covered by:

- `tests/meal-plan.test.ts` → `does not silently discard the week's ingredients when the list is full` (both new lines survive, the two oldest manual items give way, `dropped: 2`).
- `tests/meal-plan.test.ts` → `sacrifices ticked items before anything still needed when the list is full`.
- `tests/shopping-list.test.ts` → the `mergeItems` cap cases: ticked items go first, newly added items survive even when every stored item is ticked, and `dropped` reports the true count.

Note finding 3 above: the ticked-first rule has an edge that undoes the cap.

---

## #3 — `slice(-0)` breached the shopping-list cap  · **FIXED**

**Introduced by the fix for #2**, which is the part worth remembering.

`checked.slice(-room)` reads as "the last `room` ticked items" and is correct
until `room` is 0 — because `-0 === 0`, and `slice(0)` returns the *entire*
array. With the unticked items alone filling the cap, every ticked item was
kept: the list exceeded the limit by exactly the number of ticked items, without
bound, so a list whose owner kept ticking things off grew forever. `dropped`
meanwhile reported a truncation that had not happened.

**Fix** — `checked.slice(checked.length - room)`, indexed from the front, which
behaves for every value of `room`. And `dropped` is now derived from what
actually survived (`all.length - items.length`) rather than computed
independently; that independent calculation is what allowed it to disagree with
its own array.

**Guarded by** — `tests/meal-plan.test.ts` → "still respects the cap when the
unticked items alone fill it", and the three-way
"reports a dropped count that matches what actually survived", which asserts
`dropped === uniqueInputs - items.length` as an invariant across ticked / partly
ticked / fully ticked lists. A fixed expected number would have passed for one
mix and missed the other.

### The pattern this belongs to

Three of the last four bugs in this project were introduced by the fix for the
previous one: an image allow-list that made recipes uneditable, vendor chunking
that blanked the deployed site, and this. All three passed typecheck, lint and
the existing suite, because each changed an invariant the surrounding code
quietly relied on and no existing test named that invariant.

The thing that caught all three was testing the *new* behaviour rather than
re-running the old tests — and, where possible, asserting a property that holds
for every input instead of a number that holds for one.
