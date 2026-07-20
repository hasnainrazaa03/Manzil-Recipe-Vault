# Wave 5 test findings

Findings from the collections / social / shopping-list / versioning test pass.
Kept separate from `FINDINGS.md`, which another pass owns.

**Open:** none.

---

# Resolved

## W5-1 — Concurrent follow toggles deleted the row twice and drove the follow counters negative  `[FIXED]`

**Severity:** high — persistent data corruption, reachable from an ordinary
double-tap on a mobile button.

**Where:** `src/routes/social.ts`, `PUT /api/social/follow/:userId`.

**Status:** fixed in `src/routes/social.ts`. The regression tests are live and
unskipped in `tests/social.test.ts`:

- `'five parallel follows of the same pair leave exactly one row and a count of 1'`
- `'five parallel UNfollows leave the counters agreeing with the rows'`
- `'never lets a counter go negative, however a burst of toggles interleaves'`
- `'works when the followed user has never saved a profile'`

### Cause

The handler was a read-then-write toggle with no guard between the two steps:

```ts
const existing = await Follow.findOne({ follower: user.uid, following: userId }).lean();

if (existing) {
  await Follow.deleteOne({ _id: existing._id });
  await Promise.all([
    Profile.updateOne({ user: userId },   { $inc: { followerCount: -1 } }),
    Profile.updateOne({ user: user.uid }, { $inc: { followingCount: -1 } }),
  ]);
  res.json({ following: false });
  return;
}
```

Two requests could read the *same* `existing` row. Both then ran `deleteOne` —
the second matching nothing — but **both decremented the counters
unconditionally**. The decrement was never gated on the delete having actually
removed anything.

Five parallel `PUT /api/social/follow/:userId` for one pair (a double-tap, or a
client retry) produced this on 13 of 15 measured runs against the in-memory
Mongo the suite uses:

```
bodies=TTTFF  rows=0  followerCount=-1  followingCount=-1
```

Three responses told the client "you are now following", no follow row
survived, and both profiles' counters sat at `-1`.

Two distinct defects fell out of the one race:

1. **The counters went negative and stayed there.** `followerCount` is declared
   `{ type: Number, default: 0, min: 0 }` in `src/models/Profile.ts`, but
   `updateOne` with `$inc` does not run Mongoose validators, so `min: 0` never
   applied. Nothing recomputed the counters from `Follow`, so the drift was
   permanent for a user who never gained another follower.

2. **The end state matched none of the responses.** A majority of requests
   returned `{ following: true }` for a relationship that had been removed, so
   the UI showed a filled "Following" button for a follow that did not exist.

The unique index on `(follower, following)` was doing its job throughout —
`Follow.countDocuments` never exceeded 1 in any run. It could not help here,
because it constrains inserts, not deletes. The route's own comment claimed
safety on exactly that basis, which was the right argument about the wrong half
of the problem.

### Fix

`PUT /api/social/follow/:userId` no longer reads before it writes. It attempts
the delete first and lets that write's own result decide what happened:

- `deleteOne(...)` returning `deletedCount === 1` means we *were* following, so
  decrement and return `{ following: false }`.
- Otherwise we were not following, so create the row. An `11000` from the unique
  index means a concurrent request created it and has already counted it, so
  that path returns success and adjusts nothing.
- Both counter changes moved into an `adjustCounts()` helper that **upserts** the
  profile, since a user can be followed before they have ever saved one and a
  counter with nowhere to live would diverge from the rows.

Every counter change is now gated on a write that actually took effect.

### Verification

15 runs of 5 parallel follows and 15 runs of 5 parallel unfollows: `rows`,
`followerCount` and `followingCount` agreed on every run, no counter went
negative, and the surviving row count was 1 every time.

A caveat worth recording, because it nearly produced a false pass during the
fix: a run in which every request quietly 401s leaves rows and counters
trivially at 0 and satisfies every invariant. The regression tests therefore
assert `status === 200` on all five responses before looking at any counter, and
only mean anything with `admin.auth().verifyIdToken` stubbed as `tests/setup.ts`
does it.

Note that the individual responses are *not* all `{ following: true }` — the
outcome of any one request still depends on arrival order, which is inherent to
a toggle rather than a defect. The tests assert the invariant that matters (the
stored state is self-consistent) rather than pinning a per-response value that
concurrency does not define.

---

## W5-2 — `DESIGN.md` §5.4 described a different merge rule than the code implements  `[DOC FIXED]`

`DESIGN.md` said of the shopping list:

> On sign-in the local list is merged into the server's by item id, **server wins
> on conflict**

`mergeItems` in `src/routes/shopping-list.ts` does not do that. It resolves per
field, as its own doc comment describes:

- `checked` — **either** side wins if it is `true` (not the server)
- `amount` — the side with the **later** `addedAt` wins (so the client wins a tie)
- `addedAt` — the **earlier** of the two

The implemented rule is the better one and its reasoning is written down
("un-ticking something you already bought is a smaller annoyance than buying it
twice"). `tests/shopping-list.test.ts` tests the implementation, and no code
change was wanted. `DESIGN.md` is being updated to describe the per-field
resolution.

---

# Wave 6

Findings from the recipe-import test pass (`tests/safe-fetch.test.ts`,
`tests/parse-recipe.test.ts`, `tests/import.test.ts`).

**Open:** W6-1, W6-2. Neither is a security issue — the SSRF guard in
`src/lib/safeFetch.ts` refused every bypass attempted against it, including all
the mapped-IPv6 and redirect cases. Both are parsing gaps that make the importer
quietly give up on pages it could read.

## W6-1 — A Recipe inside a top-level JSON-LD array is never found  `[OPEN]`

**Severity:** medium — no data loss and nothing unsafe, but a common real-world
page shape imports as "no recipe found" and the user retypes it by hand, which
is the exact outcome the feature exists to prevent.

**Where:** `src/lib/parseRecipe.ts`, `findRecipeNode`.

**Test:** `tests/parse-recipe.test.ts`, `'finds a Recipe inside a bare array'`
(`.skip`ped). The test immediately after it pins the current behaviour, so when
this is fixed that one fails and points here.

### Cause

Plenty of sites ship a single block containing an array:

```html
<script type="application/ld+json">
[{"@type":"Organization", ...}, {"@type":"Recipe", ...}]
</script>
```

`jsonLdBlocks` parses that into one element — an array — and hands the list of
blocks to `findRecipeNode`. The loop there does:

```ts
for (const entry of toArray(value)) {
  if (!isObject(entry)) continue;   // <-- an array is not an object here
  ...
}
```

`isObject` explicitly excludes arrays (`!Array.isArray(value)`), so a block that
*is* an array is skipped before anything inside it is looked at. The `@graph`
and `mainEntity` recursion never fires either, because those are read off
`entry`, which was already discarded.

The same recipe split across two separate `<script>` blocks *is* found, which is
why this is easy to miss: only the single-block-array shape fails.

### Suggested fix

Recurse into arrays rather than skipping them — e.g. in the loop, when
`Array.isArray(entry)`, call `findRecipeNode(entry, depth + 1)` before the
`isObject` guard. The existing depth cap of 6 still bounds it.

## W6-2 — `QuantitativeValue.value` is not read  `[OPEN]`

**Severity:** low — one optional field (`servings`) is dropped on the minority of
sites that use this shape. Nothing else is affected.

**Where:** `src/lib/parseRecipe.ts`, `firstString`.

**Test:** `tests/parse-recipe.test.ts`, `'reads a QuantitativeValue wrapper'`
(`.skip`ped).

### Cause

`firstString` unwraps objects by trying `@value`, `name`, `url` and `text`.
schema.org's `QuantitativeValue` — a legal `recipeYield` — carries the number in
`value`:

```json
"recipeYield": { "@type": "QuantitativeValue", "value": "12", "unitText": "servings" }
```

so `parseServings` sees an empty string and returns `null`. Adding `value` to
the chain in `firstString` would cover it.

## Not a bug, but worth writing down

`POST /api/import` normalises anything without an `http(s)://` prefix by
prepending `https://`. A `file:` or `gopher:` URL therefore never reaches the
`bad_protocol` check in `fetchPublicPage` — `file:///etc/passwd` becomes
`https://file:///etc/passwd` and is refused as `dns_failed` instead. The refusal
is correct and the normalisation is not bypassable (`localhost:27017`,
`169.254.169.254/latest/meta-data/` and `https://host@127.0.0.1/` all still land
on `blocked_address`), but the code the client sees is not the one the URL
suggests. `tests/import.test.ts` asserts the actual codes so a change here is
visible.
