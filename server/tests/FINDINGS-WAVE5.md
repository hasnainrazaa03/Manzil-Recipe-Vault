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
