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

# Wave 6 test findings

From the recipe-import test pass: `tests/safe-fetch.test.ts` (68),
`tests/parse-recipe.test.ts` (110), `tests/import.test.ts` (36).

**Open:** none.

**The SSRF guard held.** Nothing reached a private address. Every documented
bypass was tried and refused with the right code: cloud metadata by address and
as `::ffff:169.254.169.254`, loopback in ten spellings (including
`[0:0:0:0:0:ffff:7f00:1]`, `[::127.0.0.1]` and the decimal `2130706433`),
private and reserved v4, IPv6 ULA/link-local/multicast/NAT64, a public host
whose A record is loopback, a public host answering with one public *and* one
private address, and every redirect case — 302 to loopback, 302 to metadata,
redirect to `file:`, a protocol-relative `//127.0.0.1`, and a second hop whose
DNS answer is private. In each redirect case the stub recorded exactly one
outbound request, so the block happened before the second hop, not after it.

---

# Resolved

## W6-1 — A Recipe inside a top-level JSON-LD array was never found  `[FIXED]`

**Severity:** medium — nothing unsafe and no data loss, but a common real-world
page shape imported as "no recipe found" and the user retyped it by hand, which
is the exact outcome the feature exists to prevent.

**Where:** `src/lib/parseRecipe.ts`, `findRecipeNode`.

**Status:** fixed in `src/lib/parseRecipe.ts`; the tests are live and unskipped
in `tests/parse-recipe.test.ts`:

- `'finds a Recipe inside a bare array'`
- `'finds a Recipe in a single-element array, the shape most sites ship'`
- `'finds a Recipe nested two arrays deep'`
- `'finds a Recipe in an array nested inside @graph'`
- `'still returns null for an array that contains no Recipe'`

### Cause

Plenty of sites ship a single block containing an array:

```html
<script type="application/ld+json">
[{"@type":"Organization", ...}, {"@type":"Recipe", ...}]
</script>
```

`jsonLdBlocks` parsed that into one element — an array — and handed the list of
blocks to `findRecipeNode`, whose loop began `if (!isObject(entry)) continue;`.
`isObject` excludes arrays, so a block that *was* an array was discarded before
anything inside it was looked at, and the `@graph`/`mainEntity` recursion never
fired either because those are read off the entry that had already been skipped.

The same recipe split across two separate `<script>` blocks *was* found, which
is why this was easy to miss: only the single-block-array shape failed.

### Fix

`findRecipeNode` now recurses into an entry that is itself an array, before the
`isObject` guard. The existing depth cap of 6 still bounds it, and the
no-Recipe-anywhere case still returns null rather than a false positive.

---

## W6-2 — Numeric `recipeYield` silently dropped the servings  `[FIXED]`

**Severity:** low — one optional field, but on more sites than the original
write-up suggested.

**Where:** `src/lib/parseRecipe.ts`, `firstString`.

**Status:** fixed. Live tests in `tests/parse-recipe.test.ts`:

- `'reads a QuantitativeValue wrapper'`
- `'reads a QuantitativeValue whose value is a number, not a string'`
- `'reads a bare numeric recipeYield'`
- `'reads a number inside an array'`
- `'still returns null for a non-finite number'` / `'... for a boolean'`
- `'reads a bare numeric recipeYield end to end'` and the QuantitativeValue
  equivalent, through `parseRecipeFromHtml`

### Cause

Reported as "`firstString` does not unwrap `QuantitativeValue.value`", which was
true but one layer short of the real problem. `value` is normally the *number*
`6`, and `firstString` returned `''` for every non-string input — so adding
`value` to the unwrap chain alone would have changed nothing. The same gap ate
the far more common `"recipeYield": 4`, a bare JSON number, on any site that
emits one.

Worth remembering as a shape: a fix aimed at the reported symptom would have
left the bigger case broken and looked correct while doing it.

### Fix

`firstString` now stringifies finite numbers, and `value` joined the unwrap
chain. Non-finite numbers and booleans still yield null.

---

## W6-3 — A bare `host:port` with no scheme was refused as `bad_protocol`  `[FIXED]`

**Severity:** cosmetic — nothing unsafe; an ordinary input got a confusing and
actively wrong message.

**Where:** `src/routes/import.ts`, the bare-domain normalisation.

**Status:** fixed in `src/routes/import.ts`. Live tests in
`tests/import.test.ts`:

- `'imports a bare domain carrying an explicit port (W6-3)'`
- `'normalises a bare host:port and then blocks it on the address, not the scheme'`
- `'blocks a bare metadata address carrying a port'`
- `'still imports the same host:port when the scheme is written out'`
- `'leaves an http:// URL with a port alone rather than re-prefixing it'`
- the `bad_protocol` loop over `file://`, `gopher://`, `data:`, `mailto:` and
  `javascript:`

### Cause

Found while pinning the fix for the earlier `file://` behaviour, which had
replaced "prepend `https://` unless it starts with `http(s)://`" with "prepend
unless it has a scheme". The scheme test was `/^[a-z][a-z0-9+.-]*:/i`, and a
scheme may legally contain dots — so `cooking.example.net:8080/recipe` matched
it, was left alone, and `new URL` read the protocol as
`cooking.example.net:`. The user was told "only http and https links can be
imported" about a perfectly ordinary https link.

### Fix

A negative lookahead: `/^[a-z][a-z0-9+.-]*:(?!\d)/i`. A colon followed by digits
is a port, anything else is a scheme.

The case that ties the two halves of the import guard together is
`localhost:27017`. Read as a scheme it is refused as `bad_protocol` and the
address rules never run — a refusal that is right by accident and proves nothing
about the SSRF guard, which is exactly the failure mode this file keeps finding.
Read as a host and port it normalises to `https://localhost:27017` and is
refused as `blocked_address`, for the reason that is supposed to refuse it. The
test asserts that specific code for that reason.

---

# A pattern worth naming: the test that passes while testing nothing

The coordinator's count puts this pass's near-miss at the third time in this
project that a test has passed while testing nothing. It is worth naming as a
pattern rather than filed as one more mistake.

The XSS fixture in `tests/parse-recipe.test.ts` originally embedded its payload
with `JSON.stringify`, which does not escape `<`. The literal `</script>` inside
the JSON-LD closed the `<script>` block early, the extraction regex captured
truncated JSON, `JSON.parse` threw, the block was discarded, and
`parseRecipeFromHtml` returned null. The assertion "the output contains no
`<script>`" passed — against a parser that had never seen the payload.

It was caught only because a *different* assertion in the same block ("the title
is `Cake`") failed on a null result. Had the file asserted only the negative, it
would have been green and worthless. The helper now escapes `<` as `\u003c`,
which is what any serialiser emitting JSON into a `<script>` does.

`tests/safe-fetch.test.ts` had the same failure mode waiting in it, and it is
the more dangerous one because the subject is a security control. A redirect
test that starts from a hostname needing real DNS "passes" when DNS is simply
unavailable, because every request then fails for an unrelated reason. Four
things keep that file honest:

- DNS is mocked **only** for the public hostnames the tests invent; `localhost`
  and the decimal `2130706433` go to the real resolver, so those cases exercise
  the guard rather than the stub.
- `globalThis.fetch` is replaced by a stub that **throws** by default, so an
  outbound request during a should-be-blocked case fails loudly instead of
  quietly returning something plausible.
- Every refusal asserts the specific `AppError.code`, never just "it threw".
- Positive controls sit in the same file — a stubbed public URL that returns
  HTML and succeeds, and addresses just outside each blocked range — so a guard
  that refused *everything* could not satisfy the suite.

The rule that generalises: **a negative assertion needs a positive control next
to it.** If a test proves something is absent, something nearby has to prove the
thing that would have contained it was really there.
