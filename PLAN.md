# Manzil Recipe Vault — Production Readiness Plan

**Audit date:** 2026-07-19
**Baseline commit:** `f348010` (XSS Protection and Image Security bug fix)
**Auditor:** Claude (Opus 4.8)

---

## 1. What this application is

A recipe-sharing web app in two deployables:

| Part | Path | Stack | Hosting |
|---|---|---|---|
| Frontend | `family-recipe-book/` | React 19 + Vite 7 + React Router 7, Firebase Auth (client SDK), Tiptap rich-text, Cloudinary uploads | Vercel |
| API | `server/` | Express 5 + Mongoose 8, `firebase-admin` for token verification, Cloudinary signing | (Render/Railway, inferred) |

Data model is two Mongoose collections: `Recipe` (title, image, overview, ingredients[], instructions HTML, tags[], embedded `ratings[]` and `comments[]`) and `Profile` (user uid, displayName, bio, profilePictureUrl, savedRecipes[]).

Auth is Firebase-issued ID tokens sent as `Authorization: Bearer`. The server verifies them with `firebase-admin` and trusts `req.user.uid`. There is no session, no cookie, no CSRF surface. That part of the design is sound.

### Architectural observations

- **The `Recipe` document is unbounded.** `comments` and `ratings` are embedded arrays with no cap. A popular recipe grows without limit toward MongoDB's 16 MB document ceiling, and *every* recipe list query returns the full comment history of every recipe even though the card only renders a title. This is the single biggest scaling flaw in the design.
- **No recipe has a URL.** Recipes only exist inside a modal keyed by React state. Nothing is linkable, shareable, or indexable.
- **All application state lives in `App.jsx`** and is drilled through props 18 levels wide. Adding any feature means touching the root component.
- **There is no server-side validation layer.** Every route trusts `req.body` shape.

---

## 2. Findings

Severity: **S1** = exploitable or data-destroying · **S2** = user-visible breakage · **S3** = production-readiness gap · **S4** = quality/polish

### 2.1 Deployment blockers

| # | Sev | Finding |
|---|---|---|
| D1 | S1 | **`node_modules/` is committed to git** — 1,112 files tracked at the repo root. There is no root `.gitignore`. |
| D2 | S1 | **`cloudinary` is not in `server/package.json`.** `server/routes/upload.js:2` requires it; it resolves only through the committed root `node_modules`. Deploying `server/` in isolation crashes on boot. The root `package.json` containing `cloudinary` is an artifact of an `npm install` run in the wrong directory. |
| D3 | S2 | **No SPA rewrite config.** `BrowserRouter` + no `vercel.json` means a hard load of `/profile/:id` or `/saved-recipes` can 404 depending on Vercel's framework detection. |
| D4 | S3 | `serviceAccountKey.json` is loaded via `require()` from disk only. No env-var fallback, so the standard "paste JSON into an env var" deploy path fails. |
| D5 | S3 | `mongoose.connect()` failure logs and leaves the process alive but not listening — the platform health check sees a zombie. No `process.exit(1)`. |
| D6 | S3 | No health-check endpoint, no graceful shutdown on `SIGTERM`. |

### 2.2 Security

| # | Sev | Finding |
|---|---|---|
| S1 | **S1** | **Mass assignment in recipe update.** `routes/recipes.js:149` — `const updateData = { ...req.body }` is passed straight to `findByIdAndUpdate`. After the ownership check, an authenticated user may set *any* schema field: `author` (transfer or steal ownership), `authorEmail` (impersonate), `averageRating` / `ratingCount` (game the "Highest Rated" sort), `ratings`, `comments` (forge or erase other users' comments). This is being exercised accidentally already — `AddRecipeForm.jsx:23` spreads the entire fetched recipe document back into form state and re-submits it. |
| S2 | **S1** | **Unsigned Cloudinary upload preset.** `EditProfilePage.jsx:46` uploads directly to Cloudinary with only `upload_preset`, no signature. The preset name ships in the client bundle. Anyone who reads the bundle can upload arbitrary files to the account's storage indefinitely. |
| S3 | **S1** | **Over-permissive upload signature.** `routes/upload.js` signs `{timestamp, upload_preset}` with no constraint on resource type, size, or folder, and the client posts to `/auto/upload` — which accepts video and raw files. Any logged-in user can push arbitrary binaries into the Cloudinary account under a valid signature. |
| S4 | **S1** | **Regex injection / ReDoS.** `routes/recipes.js:17` and `:76` — `filter.title = { $regex: search }` with the raw user string. `?search=(a+)+$` causes catastrophic backtracking and pins a CPU core; `?search=.*` forces a full collection scan. Unauthenticated, on a public route. |
| S5 | S1 | **Unbounded pagination.** `limit` is `parseInt`'d from the query with no ceiling. `?limit=1000000` returns the entire collection — including every embedded comment on every recipe — in one response. |
| S6 | S1 | **Email enumeration.** `GET /api/users/profile/:userId` is unauthenticated and returns `userRecord.email` from Firebase Admin, plus the user's entire `savedRecipes` list. Any uid discloses a real email address. uids are exposed in every recipe payload as `author`. |
| S7 | S1 | **No stored-HTML sanitization.** `instructions` is stored as raw Tiptap HTML. Sanitization happens *only* client-side in `RecipeModal.jsx:110`. A direct API call stores arbitrary HTML — including `<script>` and `onerror=` payloads — which is then served to every consumer. The client DOMPurify call is defence-in-depth, not a control. |
| S8 | S2 | **No rate limiting anywhere.** Comment posting, rating, recipe creation, and signature minting are all unthrottled. |
| S9 | S2 | **No `helmet`**, no security headers, no CSP. |
| S10 | S2 | **Self-rating permitted.** Nothing stops an author rating their own recipe 5 stars, repeatedly across accounts, to dominate the default sort. |
| S11 | S2 | **Weak rating validation.** `if (!score \|\| score < 1 \|\| score > 5)` accepts `4.7`, and accepts the *string* `"5"` (neither comparison coerces to a failing branch). Non-integer scores corrupt the average. |
| S12 | S2 | **No length limits** on `title`, `overview`, `instructions`, `tags`, or comment `text`. A single request can store megabytes. |
| S13 | S3 | CORS origins are hardcoded in source rather than configured by environment. |
| S14 | S3 | Firebase web config was committed in plaintext before `69a764e`. Web API keys are not secrets, so impact is low — but the Firebase Console **security rules and authorized domains** should be confirmed to be locked down, since the config is public regardless. |

### 2.3 Correctness bugs

| # | Sev | Finding |
|---|---|---|
| B1 | S2 | **Editing a recipe silently deletes its image.** `AddRecipeForm.jsx:100-104` — if `uploadMethod === 'file'` and no new file was chosen, the `else` branch sets `imageUrl = ''`. Opening an existing recipe, switching to the "Upload File" tab, and saving wipes the image with no warning. |
| B2 | S2 | **Guests always see "0.0 (0 reviews)".** `RecipeModal.jsx:16` returns early when `!user`, so `ratingData` stays at its zero initial value for logged-out visitors — despite `recipe.averageRating` being present in the payload the component already has. Every public visitor sees an unrated site. |
| B3 | S2 | **White screen on API error.** `ProfilePage.jsx:24` and `SavedRecipesPage.jsx:23` do `setRecipes(data.recipes)`. On any error response the body is `{message}`, so `recipes` becomes `undefined` and the next line's `recipes.length` throws. There is no error boundary, so the entire app unmounts to a blank page. |
| B4 | S2 | **Saved-recipes pagination is wrong.** `routes/users.js:107` computes `totalRecipes` from `profile.savedRecipes.length`, but the query filters on recipes that still exist. Every deleted-but-still-saved recipe inflates `totalPages`, producing empty trailing pages. |
| B5 | S2 | **Deleting a recipe orphans it in every user's saved list.** `DELETE /api/recipes/:id` never cleans up `Profile.savedRecipes`. Dangling ObjectIds accumulate forever and drive B4. |
| B6 | S2 | **Filtering doesn't reset pagination.** `App.jsx:106` resets `currentPage` on view/search change but not on `selectedTag` or `sortBy` change. Sitting on page 3 and clicking a tag with one page of results yields an empty grid and no explanation. |
| B7 | S2 | **Unsaving from the Saved Recipes page leaves the card on screen.** `SavedRecipesPage` refetches on `[user, currentPage]` only; `onToggleSave` updates `savedRecipeIds` in the parent but never triggers a refetch. |
| B8 | S2 | **Invalid ids return 500.** Every `findById(req.params.id)` throws a Mongoose `CastError` on a malformed id, surfacing as a 500 with the raw error message rather than a 400/404. |
| B9 | S2 | **"No comments yet" is invisible to logged-in users.** `RecipeModal.jsx:217` guards the empty state with `!user`, so signed-in visitors see an unexplained blank area. |
| B10 | S3 | **Rich-text editor fights its own state.** `RichTextEditor.jsx:87` calls `setContent` whenever the `content` prop differs from the editor's HTML, but `onUpdate` pushes every keystroke up to that same prop — a feedback loop that causes cursor jumps. `MenuBar` is force-remounted via `updateKey` on every selection change as a workaround for stale active-state. |
| B11 | S3 | **Redundant effects.** `RecipeModal` clears `newComment` in two separate effects (`:38` and `:76`). The ratings effect depends on the `recipe` *object identity*, which changes on every parent update, so posting a comment triggers a ratings refetch. |
| B12 | S3 | `AddRecipeForm.jsx:23` spreads the full recipe document (`_id`, `author`, `ratings`, `comments`, `__v`) into form state and submits all of it back. Harmless only because S1 lets it through. |
| B13 | S3 | `AddRecipeForm.jsx:45` mutates the ingredient object in place (`newIngredients[index][field] = value`) — the shallow copy doesn't protect the nested object. Works today; breaks under `React.memo` or concurrent features. |
| B14 | S3 | `GET /api/recipes/tags` returns every distinct tag with no limit or usage count; the UI renders all of them as buttons. |
| B15 | S3 | Ratings are refetched per-recipe on modal open even though `averageRating` and `ratingCount` are already in the list payload. Only `userScore` actually needs a round-trip. |

### 2.4 Data & performance

| # | Sev | Finding |
|---|---|---|
| P1 | S2 | **No indexes at all.** `author`, `tags`, `createdAt`, `averageRating`, `ratingCount` are all queried or sorted without an index. Every list view is a collection scan plus an in-memory sort. `Profile.user` gets an implicit unique index; nothing else does. |
| P2 | S2 | **Regex search cannot use an index** even if one existed (unanchored, case-insensitive). Needs a proper text index. |
| P3 | S2 | **List endpoints return whole documents**, including every embedded comment and rating, to render a card that shows title/image/overview/tags. Payload grows with engagement. |
| P4 | S3 | `countDocuments` + `find` run sequentially on every list request; they are independent and should be concurrent. |
| P5 | S3 | Unbounded embedded `comments[]` arrays trend toward the 16 MB document limit. |

### 2.5 Quality, testing, and operations

| # | Sev | Finding |
|---|---|---|
| Q1 | S3 | **Zero tests.** `server/package.json`'s test script is the npm default `exit 1`. |
| Q2 | S3 | **No CI.** |
| Q3 | S3 | **No error boundary** in the React tree. |
| Q4 | S3 | **No structured logging** — `console.log`/`console.error` only. Errors leak raw messages to clients via `res.json({message: error.message})`. |
| Q5 | S3 | **No global Express error handler and no 404 handler.** |
| Q6 | S3 | **No `.env.example`** for either package; onboarding requires reading source to discover the eight required variables. |
| Q7 | S3 | README is the unmodified Vite template. |
| Q8 | S3 | No ESLint config for `server/`. |
| Q9 | S4 | **Accessibility:** modals have no focus trap, no Escape handler, and no `role="dialog"`; images carry `onClick` with no keyboard equivalent; icon-only buttons (save, delete, editor toolbar) have no accessible name; `<i className="fa">` icons are used as interactive targets. |
| Q10 | S4 | **SEO:** favicon is still `vite.svg`, there are no meta description or Open Graph tags, and no content has a URL to share. |
| Q11 | S4 | Font Awesome 4.7 is loaded from a CDN in `index.html` — a render-blocking third-party request and a supply-chain dependency for icons. |
| Q12 | S4 | `App.css` is 1,441 unscoped global lines with no design tokens. |
| Q13 | S4 | No loading skeletons; every async view flashes a spinner then content. |

---

## 3. Plan of execution

Ordered so that each phase leaves the tree in a working state.

### Phase 0 — Repository hygiene
- Add root `.gitignore`; untrack `node_modules` (`git rm -r --cached`).
- Delete the stray root `package.json` / `package-lock.json`; move `cloudinary` into `server/package.json`. **[D1, D2]**
- Add `.env.example` to both packages; write a real README with setup, env vars, and deploy steps. **[Q6, Q7]**
- Add `vercel.json` with the SPA rewrite. **[D3]**

> **Note on git history:** `node_modules` is removed going forward. Purging it from *history* requires a `filter-repo` rewrite and a force-push, which is destructive to any existing clone. Not doing that unilaterally — flagged for a separate decision.

### Phase 1 — Security & correctness on the API
The highest-value phase; nothing here is cosmetic.

- **Zod validation layer** on every route — body, params, and query. Fixes mass assignment by construction: the update handler receives a whitelist, never `req.body`. **[S1, S11, S12, B8]**
- **Server-side HTML sanitization** of `instructions` with `isomorphic-dompurify`, on write. **[S7]**
- **Escape the regex** / replace title-regex search with a MongoDB text index. **[S4, P2]**
- **Clamp `limit`** to a maximum, coerce and validate `page`. **[S5]**
- **Stop leaking email** from the public profile route; return a display name only, and gate email behind ownership. **[S6]**
- **Tighten the Cloudinary signature** — pin `folder`, `resource_type: image`, allowed formats, and max size into the signed params; move profile-picture upload onto the signed path. **[S2, S3]**
- **Rate limiting** (`express-rate-limit`) with tiers: strict on writes and signature minting, loose on reads. **[S8]**
- **`helmet`**, explicit CORS from env, JSON body size limit. **[S9, S13]**
- **Reject self-rating.** **[S10]**
- **Global error handler + 404 handler**; stop returning raw `error.message`; structured logging with `pino`. **[Q4, Q5]**
- **Health endpoint, `process.exit(1)` on DB failure, `SIGTERM` graceful shutdown.** **[D5, D6]**
- **Service-account credentials from env var** with a file fallback. **[D4]**
- **Indexes** on `author`, `tags`, `createdAt`, `averageRating`, `ratingCount`, plus a compound text index on title/overview/tags. **[P1]**
- **Projections** on list endpoints — exclude `comments` and `ratings`, return counts instead. **[P3]**
- **Parallelize** `countDocuments` and `find`. **[P4]**
- **Clean up `savedRecipes`** on recipe delete. **[B5, B4]**

### Phase 2 — TypeScript migration
- Server → TypeScript (`tsc` build, `tsx` for dev), with shared Zod schemas as the single source of truth for request/response types.
- Frontend → TypeScript, strict mode, typed API client.
- A shared `types/` module so the API contract is checked at compile time on both sides.

### Phase 3 — Frontend correctness & architecture
- Fix **B1** (image wipe), **B2** (guest ratings), **B3** (undefined crash), **B6** (page reset), **B7** (stale saved list), **B9** (empty state), **B10/B11** (editor and effect churn), **B12/B13** (form state).
- Add an **error boundary**. **[Q3]**
- Extract a **typed API client** with consistent error handling — replacing 14 scattered `fetch` calls and their four different `API_BASE_URL` definitions.
- Move server state to **TanStack Query**: kills the `refetchTrigger` counter pattern, the prop drilling, and the manual cache juggling in one move.

### Phase 4 — Features
- **Recipe detail pages** at `/recipe/:id` with a new `GET /api/recipes/:id` endpoint, share button, and OG tags. The modal stays for in-grid preview but is no longer the only way to view a recipe. **[Q10]**
- **Comment edit/delete**, ownership-checked (author of the comment, or owner of the recipe), plus comment pagination to bound the document. **[P5]**
- **Discovery**: text search across title + overview + ingredients + tags, multi-tag filter (AND/OR), tag usage counts, sort by relevance. **[B14]**
- **Dark mode** via CSS custom properties with a persisted toggle and `prefers-color-scheme` default; **a11y** pass (focus trap, Escape, `role="dialog"`, accessible names, keyboard-operable cards); **mobile** audit. Replace the Font Awesome CDN with inline SVG icons. **[Q9, Q11, Q12]**

### Phase 5 — Tests & CI
- **API:** Vitest + Supertest + `mongodb-memory-server`, with the auth middleware stubbed. Cover every route, and specifically write regression tests for S1 (mass assignment), S4 (regex), S6 (email leak), S10 (self-rating), B4/B5 (saved-recipe integrity).
- **Frontend:** Vitest + React Testing Library + MSW. Cover the form (including the B1 image case), the modal, auth-gated rendering, and the error boundary.
- **GitHub Actions:** typecheck, lint, test, build on push and PR.

---

## 4. Execution log

All phases were carried out. Notes on what changed relative to the plan above.

### Bugs found *during* execution, in the new code

Writing the API test suite surfaced four defects in the rewritten server. All four are fixed; the suite covers each as a regression.

| # | Sev | Finding |
|---|---|---|
| N1 | **S1** | **The email-leak fix was only half done.** The public profile route was scrubbed of `userRecord.email`, but `RECIPE_LIST_PROJECTION` still carried `authorEmail` on every recipe — so the uid → email walk stayed open through `GET /api/recipes`, the profile route's own embedded recipe list, and saved recipes. Comment subdocuments carried a second copy. Fixed by making `authorEmail` `select: false`, adding a denormalised `authorName`, and routing every response through `publicRecipe()` / `publicComment()` serialisers. This changed the client contract (`authorEmail` → `authorName`) and needed a backfill script for existing rows. |
| N2 | S2 | **Rating deletion corrupted the document.** `recipe.ratings.pull({ userId })` looks correct but is a no-op: the rating subdocument is declared `{ _id: false }`, so Mongoose matches on deep equality of the whole element and a partial object never matches. The in-memory array was untouched, so `recalculateRating` wrote back the pre-delete counters — while `save()` still emitted a `$pull` that Mongo *did* honour. The stored result was `ratings: []` alongside `ratingCount: 1`. Fixed by finding the element first and pulling it by identity. |
| N3 | S3 | `limit` and `page` were documented as clamped but implemented with `.max()`, which rejects. `?limit=100000` returned 400 instead of serving the maximum page. Now genuinely clamped. |
| N4 | S3 | The rate-limit `keyGenerator` returned a raw `req.ip`, which `express-rate-limit` v8 rejects: an IPv6 client can rotate through its own /64 to bypass the limit. Now uses the library's `ipKeyGenerator`. |
| N5 | S3 | The modal focus trap filtered candidates on `element.offsetParent !== null`, which is null for any `position: fixed` element — silently dropping real controls from the trap. Now filters on `hidden` / `aria-hidden` instead. |
| N6 | **S1** | **The email leak survived in the comment path.** After N1, `POST /:id/comments` still set `authorDisplayName: profile?.displayName ?? user.email`, publishing the commenter's full address as their public display name whenever they had no saved profile — which is every new account. Since the comment also carries `authorId`, this reopened the uid → email walk N1 closed, for precisely the users most likely to be affected. Fixed with a shared `displayNameFrom()` helper that only ever emits the local part; the backfill script repairs existing rows. |
| N7 | S2 | **A caller with no email claim could not write at all.** `authorEmail` was `required: true` on both the recipe and the comment subdocument, while both handlers set it from `user.email ?? ''` — and an empty string does not satisfy Mongoose's `required`. Any account authenticated by phone, anonymous, or custom token was rejected from recipe and comment creation with a validation error naming a field it never sent and could not set. Latent today (both enabled sign-in methods supply an email) but a trap for any future auth method. Now `default: ''`; nothing renders the field since `authorName` was introduced. |
| N8 | S3 | *(test harness, not shipped code)* Intermittent impossible responses in the suite — a `404` from a route that cannot 404, once literally `Client sent an HTTP request to an HTTPS server.` `request(app)` makes supertest bind the wildcard address via `app.listen(0)` while dialling `127.0.0.1`, so the OS could hand back a port free on `::` but held on IPv4 by an unrelated process, which then answered. Fixed by binding explicitly to `127.0.0.1` per worker, with a uniquely named database per worker. |

### Deviations from the plan

- **The stylesheet was evolved, not replaced.** `App.css` already had a token system, so dark mode was implemented by adding a `[data-theme='dark']` palette against the same variable names rather than rewriting 1,441 lines of layout.
- **`react-simple-star-rating` was dropped** in favour of a local accessible `StarRating` — the library rendered non-focusable divs with no exposed value, which no amount of CSS would fix.
- **The `/public` and `/` recipe list endpoints were merged** into one `GET /api/recipes` with an `author` filter. They were the same thirty lines with one clause different.
- **Filter state moved into the URL.** This fixes the pagination-reset bug structurally rather than by adding another effect, and makes a filtered view shareable.
- **A `RecipeEditorContext` replaced prop drilling** for the create/edit/delete dialogs, which were previously threaded through every page from the root component.
- **Comment text is now rendered as plain text**, not through `dangerouslySetInnerHTML`. The server strips markup on write, so there is nothing to render as HTML.

### Not done

- **Comments remain embedded** in the recipe document. They are now bounded, paginated, and excluded from list projections, which addresses the practical cost — but the 16 MB ceiling is still theoretically reachable. Moving them to their own collection needs a migration against live data.

---

## 5. Risks and things I am explicitly not doing

- **Not rewriting git history.** Removing `node_modules` from all 14 commits needs `git filter-repo` and `push --force`, which breaks every existing clone and any open PR. The files stop being tracked from this commit forward; purging the history is a separate, deliberate decision.
- **Not rotating credentials.** The Firebase web config in history is public-by-design and low-risk, but Firebase Console **authorized domains** and the **Cloudinary unsigned preset** should be reviewed by hand — the preset in particular should be switched to signed-only in the Cloudinary dashboard once the code change lands, and that is a dashboard action I cannot perform.
- **Migrating comments out of the recipe document** into their own collection is the correct long-term fix for P5. It requires a data migration against production data, so this plan bounds the array and paginates instead.
- **No auth-provider change.** Firebase Auth stays.
