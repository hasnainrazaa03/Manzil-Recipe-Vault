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

### 7 — a cleared numeric metadata field is coerced to `0` instead of `null`

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
