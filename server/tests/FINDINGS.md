# Findings

Bugs found while writing the integration suite. Nothing under `src/` has been
modified by the test author. Resolved entries are kept as a record of what the
regression tests are guarding.

---

## RESOLVED

| # | Finding | Fixed in | Guarded by |
|---|---------|----------|------------|
| 1 | `?limit`/`?page` were validated (`.max()`) rather than clamped, so `?limit=100000` returned `400` instead of the documented maximum page | `src/schemas/common.ts` — `.catch()` + `.transform(Math.min/Math.max)` | `tests/recipes.test.ts` → "clamps an absurd limit to 50", "clamps a limit below the minimum up to 1", "clamps an absurd page number", "falls back to the defaults for a non-numeric page or limit", "clamping applies to the other paginated endpoints too" |
| 2 | `DELETE /api/recipes/:id/rating` left `averageRating`/`ratingCount` describing the pre-delete state while Mongo's `$pull` emptied the array — an internally inconsistent stored document | `src/routes/recipes.ts` — `pull(existing)` instead of `pull({ userId })` | `tests/ratings.test.ts` → "removes the caller's rating and recalculates", "resets the average to 0 when the last rating goes", "leaves the stored document internally consistent after a delete", "deleting the only rating zeroes both counters in storage", "re-rating after a delete starts from a clean slate" |
| 3 | `RECIPE_LIST_PROJECTION` carried `authorEmail`, so any anonymous caller could walk uid → email through the recipe list, the public profile and saved recipes | `src/models/Recipe.ts` (`select: false`, new `authorName`) + `publicRecipe()`/`publicComment()` in `src/routes/recipes.ts` | `tests/email-privacy.test.ts` (whole file — nine response paths swept) and `tests/users.test.ts` → "an anonymous caller sees no email even when the user has recipes" |
| 4 | Rate-limit `keyGenerator` used a raw `req.ip`, letting an IPv6 client rotate through its /64 (`ERR_ERL_KEY_GEN_IPV6` on every import) | `src/middleware/rateLimit.ts` — `ipKeyGenerator(req.ip ?? '')` | Not directly assertable (limiters are skipped in test mode); confirmed by the disappearance of the construction-time `ValidationError` from the test output |
| 5 | `POST /:id/comments` fell back to the raw `user.email` for `authorDisplayName`, republishing the address of any commenter without a profile (and, with `authorId` alongside, restoring the uid → email mapping #3 closed) | `src/routes/recipes.ts` — new `displayNameFrom()`, used by both `resolveAuthorName()` and the comment handler | `tests/email-privacy.test.ts` → "a commenter with no profile does not get their address as a display name", "a commenter WITH a profile still gets their profile display name", "the profile-less comment stays email-free on every read path", "the recipe list and public profile stay email-free for a profile-less author", and the `displayNameFrom` unit tests |
| 6 | `Recipe.authorEmail` and the comment subdocument's `authorEmail` were `required: true` while both routes set them from `user.email ?? ''` — and `''` does not satisfy `required`, so any caller whose token has no email claim (phone, anonymous, or custom-token sign-in) was rejected from both write paths with a validation error naming a field they never sent and could not set | `src/models/Recipe.ts` — `default: ''` instead of `required: true` on both. Nothing renders the field any more now that `authorName`/`authorDisplayName` are denormalised | `tests/email-privacy.test.ts` → "such a caller can create a recipe and a comment", "a comment from such a caller falls back to 'Anonymous cook'", "but reading, rating and the profile endpoints work for such a caller" |
| 7 | `optionalCount()` and the `difficulty` schema listed `z.coerce.number()` / `z.enum()` before their `null` and `''` branches. Zod takes the first branch that succeeds and `Number('') === Number(null) === 0`, so the null branches were unreachable: clearing a numeric field stored `0` rather than `null`, collapsing the "not stated" versus "zero minutes" distinction. A cleared recipe then topped `?sort=quickest` and matched every `?maxMinutes` — the exact case the `$ne: null` filter exists to prevent | `src/schemas/recipe.ts` — union reordered to put `null` and `''` first | `tests/metadata.test.ts` → "treats an empty string / null as 'not stated' for the optional numbers", "goes back to null when both inputs are cleared" |
| 8 | `GET /api/recipes/:id/comments` was registered **twice**: the rewrite added a handler in the `=== COMMENTS ===` section, but an older one reading `recipe.comments` survived further up in `=== PUBLIC READS ===`. Express answers with the first matching registration and never looks at the rest, so the stale handler won and served the embedded array — empty for every comment written through the new path. `POST` returned `201`, the `Comment` document existed, the detail endpoint showed it, and the list said `[]` forever | `src/routes/recipes.ts` — the stale handler in `=== PUBLIC READS ===` deleted, leaving one registration per method | `tests/comments.test.ts` → "reflects, field for field, what POST said it created", "reflects an edit and a delete just as promptly", "ignores an embedded array a legacy recipe still carries", "is paginated and newest-first", "paginates top-level comments and does not count replies as items", "is readable anonymously"; `tests/app.test.ts` → "no route is registered twice for the same method" (recipes, users, collections) |

| 9 | `PUT /api/users/me` fanned the new display name out to `Recipe.comments.$[entry].authorDisplayName` — the embedded subdocuments comments had been moved out of. Nothing writes that array any more, so the filter matched nothing and `Comment.authorName`, the field every thread renders, was never touched. The update reported success, so the failure was silent: a renamed user's recipes showed the new name while every comment they had ever written kept the old one, permanently, because a comment's denormalised name is only re-derived when it is written | `src/routes/users.ts` — `Comment.updateMany({ authorId }, { $set: { authorName } })`, plus `authorPictureUrl` fanned out only when `profilePictureUrl` was actually supplied | `tests/users.test.ts` → "PUT /api/users/me updates authorName on the user's existing comments", "the rename reaches replies as well as top-level comments", "the rename touches nobody else's comments", "a body without profilePictureUrl leaves the avatar on the user's comments alone", "but a body that does supply profilePictureUrl fans it out", "a rename does not disturb the comment documents' other fields" |

Fix #8 is guarded twice over on purpose. The behavioural tests compare the two
sides of the same comment — what `POST` reported and what `GET` serves — because
every assertion that looked at only one side passed throughout the bug's life.
The structural test walks each router's own `stack` and fails on any repeated
`METHOD path`, which catches the next stale duplicate before it can shadow
anything, and asserts it saw a non-empty table so it cannot pass vacuously if
Express's internals change shape. It covers every mounted router — recipes,
users, collections, social, shopping-list and upload — so a router added later
is not quietly exempt.

Fixes #8 and #9 are the same species: a schema move leaves behind code that
still addresses the old shape, keeps reporting success, and is invisible to any
test that checks only the half that still works. Both are now pinned by an
assertion that spans the two halves — read against write for #8, the stored
document against the response for #9.

Fix #5 was verified not to have re-broken #3: the profile-less commenter case —
the one that slipped through the first time — is now swept end to end by the
recursive leak detector on the comment create, comment list, recipe detail and
comment edit paths.

Fix #3 was verified to be complete rather than partial: `authorEmail` is absent
from the create, update, list, detail, comment-create, comment-edit,
comment-list, saved-recipes and public-profile responses, while still being
present in storage (`Recipe.findById(...).select('+authorEmail')`) and still
returned to the caller themselves by `GET /api/users/me`.

---

## OPEN

Nothing is open. Every finding above is fixed and guarded; the write-ups below
are kept as the record of what those regression tests exist to catch.

---

## CLOSED — full write-ups

### 7 — a cleared numeric metadata field is coerced to `0` instead of `null`

> **No longer open.** The union has since been reordered — see row 7 of the
> RESOLVED table — and all three `tests/metadata.test.ts` cases are un-skipped
> and passing. The write-up is kept below as the record of what they guard.

`optionalCount` in `src/schemas/recipe.ts` is a union whose **first** member is
`z.coerce.number()`:

```ts
z.union([z.coerce.number(), z.null(), z.literal('')])
```

Zod takes the first branch that succeeds, and `Number('') === 0` and
`Number(null) === 0`, so `''` and `null` both parse as `0` and the `z.null()` /
`z.literal('')` branches are unreachable. The `.transform()` that maps them to
`null` therefore never fires. The comment above the helper — "a cleared form
field arrives as one or the other, and both mean 'not stated'" — describes
behaviour the code does not have.

Failing cases (all against `POST`/`PUT /api/recipes`):

| Request | Expected | Actual |
|---|---|---|
| `{ servings: '' }` or `{ servings: null }` | `201`, `servings: null` | `400` "Servings must be at least 1" (`0` fails the `>= 1` refinement) |
| `{ prepMinutes: '' }` or `{ prepMinutes: null }` | `201`, `prepMinutes: null` | `201`, `prepMinutes: 0` |
| `PUT { prepMinutes: null, cookMinutes: null }` on a 10+20 recipe | `totalMinutes: null` | `totalMinutes: 0` |

The last row is the damaging one: it defeats the whole point of the
`pre('validate')` hook keeping `null` distinct from `0`. A user who clears the
timing fields on an existing recipe turns it into a "0 minute" recipe, which
then sorts to the very top of `?sort=quickest` and matches every `?maxMinutes`
filter — precisely the outcome `buildFilter`'s `$ne: null` was written to
prevent. Clearing servings is simply impossible: the form rejects itself.

**Suggested fix** — put the sentinel branches ahead of the coercion, so the
union only reaches `z.coerce.number()` for values that are not "cleared":

```ts
z.union([z.null(), z.literal(''), z.coerce.number()])
```

Verified against the same case table: `''`/`null`/omitted → `null`; `0` → `0`;
`'10'` → `10`; `-1`, `1441`, `2.5` and `'abc'` still rejected. Nothing else in
the helper needs to change.

**Marked `.skip` in** `tests/metadata.test.ts` → "treats %s as 'not stated' for
the optional numbers (FINDINGS #7)" (two cases) and "goes back to null when both
inputs are cleared (FINDINGS #7)". Un-skip all three when the union is
reordered; they were confirmed to fail for exactly the reasons above.

---

### 9 — renaming yourself no longer renamed your comments

> **Fixed.** See row 9 of the RESOLVED table. `tests/users.test.ts` → "PUT
> /api/users/me updates authorName on the user's existing comments" is
> un-skipped and passing, alongside the reply, other-users and avatar-merge
> cases added with the fix.

`PUT /api/users/me` fans the new display name out to every place it is
denormalised. The comment half of that fan-out still writes to the embedded
subdocuments that comments were moved out of:

```ts
Recipe.updateMany(
  { 'comments.authorId': user.uid },
  { $set: { 'comments.$[entry].authorDisplayName': body.displayName } },
  { arrayFilters: [{ 'entry.authorId': user.uid }] },
)
```

Nothing writes `Recipe.comments` any more, so the filter matches nothing on any
recipe written since the move, and `Comment.authorName` — the field every thread
actually renders — is never touched. The update reports success, so the failure
is silent.

Failing case:

| Step | Expected | Actual |
|---|---|---|
| profile `displayName: 'Old Name'`, then `POST /api/recipes/:id/comments` | comment `authorName: 'Old Name'` | as expected |
| `PUT /api/users/me { displayName: 'New Name' }` | `200` | `200` |
| `Comment.findById(id).authorName` | `'New Name'` | `'Old Name'` |
| `GET /api/recipes/:id` → `comments[0].authorName` | `'New Name'` | `'Old Name'` |

The recipe half of the same `Promise.all` works, so a renamed user's *recipes*
show the new name while their *comments* on those very recipes show the old one
— which reads as two different people. It also outlives the rename: the stale
name is what every future reader sees, because the comment is only re-derived
when it is written.

**Fix as applied** — the embedded update was swapped for the collection, and the
avatar was fanned out alongside the name:

```ts
await Promise.all([
  Recipe.updateMany({ author: user.uid }, { $set: { authorName: body.displayName } }),
  Comment.updateMany({ authorId: user.uid }, { $set: { authorName: body.displayName } }),
  ...(body.profilePictureUrl !== undefined
    ? [Comment.updateMany({ authorId: user.uid }, { $set: { authorPictureUrl: body.profilePictureUrl } })]
    : []),
]);
```

`Comment` has an `{ authorId: 1, createdAt: -1 }` index, so the filter is
covered, and `authorId` is the only scope — replies are swept with roots because
they are the same kind of document, and nobody else's comments match. The
`body.profilePictureUrl !== undefined` guard is what keeps the endpoint a merge:
this route writes only the keys the caller actually supplied, so a rename that
never mentions the picture must not blank it on every comment the user has
written. Both halves of that distinction are asserted rather than assumed.

**Guarded by** `tests/users.test.ts` → "PUT /api/users/me updates authorName on
the user's existing comments", "the rename reaches replies as well as top-level
comments", "the rename touches nobody else's comments", "a body without
profilePictureUrl leaves the avatar on the user's comments alone", "but a body
that does supply profilePictureUrl fans it out", and "a rename does not disturb
the comment documents' other fields".

---

## Note on `migrate-comments.ts` (why there is no direct test of the script)

`src/scripts/migrate-comments.ts` cannot be exercised from a test as written,
and `tests/migrate-comments.test.ts` says so at the top rather than pretending
otherwise. Precisely:

1. **It exports nothing.** `copyComments`, `dropEmbedded` and `displayName` are
   all module-private, so there is no unit to call.
2. **It runs on import.** The last statement is `run().catch(...)` at module
   scope, so merely importing it executes the migration.
3. **`run()` owns the connection.** It calls `mongoose.connect(env.MONGO_URI)`
   and, on the way out, `mongoose.connection.close()`. Importing it from a test
   would point at whatever `MONGO_URI` names rather than the in-memory server
   the suite is connected to, and would then close the suite's own connection
   out from under every remaining test in the file.
4. **It exits the process on failure.** `process.exit(1)` in the `.catch` takes
   the vitest worker with it, so a failure surfaces as a dead worker rather than
   as a failed assertion.

Spawning it as a subprocess against the in-memory server would clear (2)–(4),
but it would test the script's plumbing rather than the property that matters,
and it would need the harness to leak its `MONGO_URI` and database name into a
child environment — more moving parts than the thing under test.

`tests/migrate-comments.test.ts` therefore asserts the **properties the copy
must establish**, each arranged with the raw driver plus the collection
documents the copy would produce, and checked through the read path that has to
serve them: the embedded array survives the copy untouched (the rollback story),
the original `_id` is reused (links keep working), `commentCount` comes from the
collection, no address crosses over, a recipe holding *both* an embedded array
and migrated documents serves only the migrated ones, migrated comments behave
like any other under reply/edit/delete, a second copy cannot double the thread,
and `--drop` changes nothing a client can see.

Making the script itself testable would be a two-line change — export
`copyComments` and `dropEmbedded`, and guard the bootstrap with
`if (import.meta.url === pathToFileURL(process.argv[1]).href) run()` — but it is
deliberately **not** being made. For a script that runs twice in its life, the
property-based coverage above is the better trade: it pins what the migration
must leave true, which is what a future reader needs, without adding a seam to
production code purely so a test can hold it.

---

## Note on test infrastructure (not a `src/` bug)

Roughly one run in eight failed with an impossible status — a bare `400` on
`GET /health`, a `404` on `GET /api/recipes` — that no route could produce. The
cause was in the test setup, not the server: `request(app)` has supertest call
`app.listen(0)`, which binds the wildcard address, while supertest then dials
`127.0.0.1` unconditionally. The OS can hand out a port that is free on `::` but
already held by an unrelated process on `127.0.0.1`, and that process answers
instead — one captured response was literally
`Client sent an HTTP request to an HTTPS server.`

`tests/helpers.ts` now starts one server per worker bound explicitly to
`127.0.0.1` (`startApi()`/`api()`), and `tests/setup.ts` gives each worker a
uniquely named database so a mongod port race cannot let one file's cleanup wipe
another's data. 25 consecutive full runs are green.
