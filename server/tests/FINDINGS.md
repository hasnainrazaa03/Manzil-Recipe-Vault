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

None. All six findings are resolved and guarded by regression tests; the
suite has no skipped tests.

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
