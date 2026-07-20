# Manzil Recipe Vault — Production Readiness Plan

**Audit date:** 2026-07-19
**Baseline commit:** `f348010` (XSS Protection and Image Security bug fix)
**Auditor:** Claude (Opus 4.8)

---

## 1. What this application is

A recipe-sharing web app in two deployables:

| Part | Path | Stack | Hosting |
|---|---|---|---|
| Frontend | `web/` | React 19 + Vite 7 + React Router 7, Firebase Auth (client SDK), Tiptap rich-text, Cloudinary uploads | Vercel |
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

## 5. Second hardening pass (2026-07-20)

An adversarial re-audit after the feature work: two independent read-only
reviews of the server and client, plus targeted verification. Everything below
was **reproduced before being fixed**, and each carries a regression test.

Notably, most of these were introduced by the rewrite itself — the first audit
found bugs in five-year-old code, this one found bugs in five-day-old code.

### Fixed — data integrity

| # | Sev | Finding |
|---|---|---|
| H1 | **S1** | **Concurrent writes silently corrupted counters, permanently.** Ratings and comments used `findById` → mutate → `save()`. Mongoose emits `$push` for the array but a plain `$set` for a counter computed from the writer's stale copy, so two people rating at once left `ratings.length` at 2 and `ratingCount` at 1 — and nothing recomputed it until the next write. Those counters drive `sort=rating`, `sort=popular`, and every star on every card. All such writes are now single atomic updates that derive the counter with `$size` in the same operation, making divergence impossible. |
| H2 | S2 | **`VersionError` answered as a 500.** The same read-modify-write raised it whenever anyone edited a comment or changed a rating while another user wrote to the same recipe — routine on a popular recipe. The edit was lost and the user saw "Something went wrong". The atomic rewrite removes the cause; the error handler now maps it, and duplicate-key errors, to 409. |
| H3 | S2 | **Every field added by the last two releases read as `undefined` on older documents.** Mongoose applies defaults on *hydration*, and every list query uses `.lean()`, which skips it. The response types promised `commentCount: number`; the runtime returned nothing, so `commentCount > 0` was false and **every pre-existing recipe showed no comment count at all**. Responses are now normalised through one serialiser, and the migration backfills the stored counters. |
| H4 | S2 | **Unbounded comment growth.** No cap existed. At the rate limit one account could push a recipe past MongoDB's 16 MB ceiling, after which *every* write to it fails — its owner could no longer edit it, and the offending comments could not be deleted. Capped, with a 409 that says so. |

### Fixed — security and correctness

| # | Sev | Finding |
|---|---|---|
| H5 | S2 | **Failed authentication was completely unmetered.** Rate limiters were mounted *after* `requireAuth`, which calls `next(err)` on a bad token and skips the rest of the chain — so the limiter never ran. An unauthenticated attacker could hammer signature minting or recipe creation with garbage tokens at unlimited rate, driving a Firebase verification on each. Limiters now run first. |
| H6 | S2 | **The query cache was never cleared on sign-out.** On a shared machine, a second person signing in within the cache window saw the first person's display name, their saved recipes starred across the grid, and their saved-recipes page. The cache is now evicted whenever the signed-in identity changes. |
| H7 | S2 | **An expired session was told it had written nothing.** Firebase tokens expire hourly; `optionalAuth` swallowed the failure and `?author=me` returned an empty list. It now returns 401 and says the session expired. |
| H8 | S3 | Malformed JSON and oversized bodies returned 500 — logging a client mistake as a server fault. Now 400 and 413. |
| H9 | S3 | `PUT /api/users/me` silently cleared `bio` and `profilePictureUrl` on a partial body: schema defaults turned an omitted key into `$set: { bio: '' }`. It now merges. |
| H10 | S4 | The migration used `??` where it needed `||`, so rows whose `authorEmail` was the empty-string default were never backfilled and re-qualified on every run. |

### Fixed — client

| # | Sev | Finding |
|---|---|---|
| H11 | **S1** | **A self-sustaining navigation loop on the home page, and pagination was unusable.** `SearchFilters`' debounce effect depended on a callback the page recreated every render; firing it pushed a navigation, which re-rendered the page, which minted a new callback, which re-armed the effect. Measured at **five navigations in 1.6 seconds with no user input**, on the app's most-visited page, on the mobile devices it targets — and each iteration ran the "a filter changed, go to page 1" branch, so `?page=2` was wiped within about a third of a second. A regression of B6, which the plan claimed to have fixed *structurally*. Fixed at all three levels: the effect no longer fires when nothing changed, the callbacks are stable, and a no-op update no longer navigates. |
| H12 | S2 | **The header shopping-list badge never updated.** `useLocalStorage` gave each caller its own `useState`, and the `storage` event does not fire in the tab that wrote it. Now a module-level store via `useSyncExternalStore`. |
| H13 | S2 | **The screen wake lock never came back.** The `release` handler cleared the flag but not the ref, so the "reacquire when visible" guard was never satisfied — one notification during cooking and the screen slept for the rest of the recipe, the exact failure cook mode exists to prevent. |
| H14 | S2 | **Global shortcuts fired through open dialogs.** Pressing `?` then `n` opened the recipe editor *behind* the still-open help dialog, leaving two `aria-modal` dialogs stacked; `g h` navigated out from under an open confirmation. Overlays are now counted and bare-key shortcuts suppressed while any is open. |
| H15 | S2 | **Cook mode's step index was never re-clamped**, so instructions changing underneath produced "Step 3 of 1", a progress bar at 300% width, and an `aria-valuenow` above its own maximum. |
| H16 | S3 | **Cook mode trapped neither focus nor restored it**, despite declaring `aria-modal="true"` — telling a screen reader the background was inert while the keyboard tabbed straight into it. The trap is now shared with `Modal`. |
| H17 | S3 | **One malformed entry destroyed the whole list.** The `localStorage` guards were `Array.every`, and a failed guard deletes the key — so a single bad element discarded the entire shopping list. Now element-wise: bad rows are dropped, good ones kept. |
| H18 | S3 | Out-of-order save toggles could leave a star permanently wrong, because the identity query holding the id list was never invalidated. |
| H19 | S4 | Chosen servings leaked one frame into the next recipe when it was already cached, because the reset ran in an effect rather than during render. |
| H20 | S4 | "Add to list" could not re-add at a different scale, so changing the yield left the shopping list silently stale with no way to update it. |

### Verified correct, no change needed

- **The Cloudinary signature contract.** Checked field by field against what the client posts, and independently re-derived the signature. They match — uploads will work. *(One documented limitation: `resource_type` is excluded from Cloudinary's signature, so pinning the image endpoint in code is advisory. Closing it properly needs a signed upload preset configured in the dashboard.)*
- **The `pre('validate')` hook.** No write path bypasses it in a way that leaves `totalMinutes` stale.
- **Filter composition.** `$text`, tags, difficulty, cuisine, time and author occupy distinct keys and compose correctly; `.select()` merges with the text-score projection rather than replacing it.
- **The B3 class of crash is genuinely gone.** Every `data.` access after a query is behind a loading or error gate.
- **No memory leaks.** Object URLs revoked, listeners removed, timers and animation frames cancelled.

---

## 6. Risks and things I am explicitly not doing


- **Not rewriting git history.** Removing `node_modules` from all 14 commits needs `git filter-repo` and `push --force`, which breaks every existing clone and any open PR. The files stop being tracked from this commit forward; purging the history is a separate, deliberate decision.
- **Not rotating credentials.** The Firebase web config in history is public-by-design and low-risk, but Firebase Console **authorized domains** and the **Cloudinary unsigned preset** should be reviewed by hand — the preset in particular should be switched to signed-only in the Cloudinary dashboard once the code change lands, and that is a dashboard action I cannot perform.
- **Migrating comments out of the recipe document** into their own collection is the correct long-term fix for P5. It requires a data migration against production data, so this plan bounds the array and paginates instead.
- **No auth-provider change.** Firebase Auth stays.

---

## 7. Third pass — rendering and perceived speed (2026-07-20)

Prompted by a screenshot: the magnifying glass sitting on top of the search
placeholder, the collection toggle reading as two loose pills, and "there is
slowness in the UI/UX".

### Fixed — the cascade

| # | Sev | Finding |
|---|---|---|
| C1 | **S2** | **Two components' styles had never applied.** The base layer styles form controls with `input[type='search']` and friends — (0,1,1), which silently outranks any single class. `.search-input` asked for a pill and for room to the left of the icon; it got a rectangle and the icon landed on top of the placeholder, which is what the screenshot shows. `.palette-input` asked for no chrome at all — its own comment says *"the row is the field"* — and rendered as a bordered, sunken box inside the row. Nothing errored. The declarations were parsed, applied, and beaten. The base block is now wrapped in `:where()`, contributing zero specificity, which is what a layer of defaults should always have had. |

### Fixed — the collection toggle

| # | Sev | Finding |
|---|---|---|
| C2 | S3 | **The toggle wobbled when you used it.** The selected segment was set in a heavier weight than the unselected one, so it measured wider, so every click resized both segments and shifted the row — on a control whose whole job is to sit still. Weight is now constant and selection is carried by colour and surface. |
| C3 | S3 | **Two loose pills, not one control.** Rebuilt as a segmented control on a single recessed track, so the pair reads as one either/or. |
| C7 | **S2** | **The toggle was touching the card above it.** Measured in Chromium at **0px** between the bottom edge of the "Cooks to follow" card and the top edge of the toggle, at every width — not close, flush, and reading as though the toggle belonged inside the card. `.follow-suggestions` was the only one of the three home rails with a top margin and no bottom margin, and the toggle reserved none of its own. Now 32px. Reported twice before I measured it: the first time I checked segment-to-segment spacing, found it correct, and said I could not reproduce an overlap — while the actual collision was one element up. |
| C4 | S4 | **It rendered signed out**, where "My recipes" does not exist — a segmented control with one segment is a label pretending to be a choice. It is now not drawn at all. |

### Fixed — perceived speed

| # | Sev | Finding |
|---|---|---|
| C5 | S2 | **The webfont was loaded the slowest way available.** `@import url(fonts.googleapis.com…)` sat inside the app stylesheet, so the browser could not even discover the request until it had downloaded and parsed that stylesheet — the font CSS and then the font file queued up behind it. Three chained, render-blocking round trips before text could paint. The request now starts from `index.html` with `preconnect` warming both hosts, off the critical path. |
| C6 | S2 | **API responses were uncompressed.** Recipe JSON is the same keys on every row and compresses by roughly 80%. `compression()` now runs ahead of the routes. |

### Checked, and *not* changed

- **Client-side data fetching was already right.** `staleTime`, `placeholderData: (previous) => previous` on the list, longer staleness on tags and cuisines, no refetch on focus. Routes are already lazy and Tiptap is already in its own chunk.
- **The 523 kB main chunk (146 kB gzipped) is React, the router, Query and Firebase.** Splitting it further is exactly what caused the blank-page outage in §4, and the `check-bundle` guard exists because of it. Not touching it for a marginal gain.
- **The dominant latency is almost certainly the free-tier cold start**, not the code. A Render free instance sleeps after 15 minutes and takes the better part of a minute to answer the first request. No change in this repo fixes that; keeping the instance warm or paying for it does.

### On measuring instead of reasoning

C7 was reported twice before it was fixed. The first time, I checked the spacing
*between the two segments*, found it correct, and said I could not reproduce an
overlap — the collision was one element up, between the card and the control.
Reasoning about a stylesheet is not the same as laying it out.

Chromium is available in this environment via Playwright's cache, so the second
attempt measured rather than argued: a harness that loads the real
`tokens/base/components` stylesheets, reproduces the home page's DOM, and reads
`getBoundingClientRect()` at 1440, 768 and 390 px. It reported `card→toggle: 0px`
against the committed stylesheet and `32px` after the fix. That took about as
long as the guesswork did and produced a number rather than an opinion.

### The pattern this belongs to

Every finding above is invisible to `tsc`, to `eslint`, to the test suite, and
to review. A CSS rule that loses the cascade does not warn — it is parsed,
applied, and overruled. The countermeasure is `web/src/styles/__tests__/cascade.test.ts`,
which asserts the *property* rather than any particular rule: nothing in the
base layer may set chrome from a selector a single class cannot beat.

Its first version passed while the bug was live, because it matched the whole
selector head against a single-selector shape and the offending rule was a
comma-separated list. It was fixed to split first, and both assertions were
then confirmed to fail against the un-wrapped stylesheet before being trusted.

---

## 8. Wave 7 — the writing assistant (2026-07-20)

A model that reformats rough recipe notes. The design and the rule it turns on
are in `DESIGN.md` §3 Wave 7; this section records what was found while building
it.

### The threat the feature had to be built around

Not prompt injection, not cost, not latency — **invention**. Asked to "make this
proper", a model fills gaps: "some flour" becomes "250 g flour", "cook till
done" becomes "bake at 180°C for 25 minutes". Both read beautifully, and the
recipe is now partly fiction under the author's name, for other people to cook
from. Telling the model not to is necessary and not sufficient, so the rule is
enforced after the fact in `lib/quantities.ts`, where the model gets no vote.

### Found while building

| # | Sev | Finding |
|---|---|---|
| A1 | **S2** | **A dimension leak in the quantity extractor.** `180°C` matched the temperature pass *and* the bare-number pass, so the count `180` was also recorded as something the author had written — which would then have justified an invented "180 g" of an ingredient. Text is now consumed as it is matched. Caught by a test written specifically to check that dimensions cannot bleed, because dimensions are the entire mechanism. |
| A2 | S3 | **The same invention reported twice.** Deduplication keyed on the raw substring, and the unit pattern consumes an optional trailing full stop, so "250 g" mid-sentence and "250 g." at the end of one looked like two separate findings. Keyed on the value now. |
| A3 | S3 | **Step numbering read as invented quantities.** Turning prose into "1. … 2. … 3. …" is the single most common thing this feature does, and those numerals are not quantities. Left in, every tidy-up of a three-step recipe would have reported three inventions — and a guard that cries wolf on correct output is a guard nobody reads. Numbering is stripped before the check. |
| A4 | S4 | `htmlToText` replaced every tag with a space, so `the <strong>onions</strong>.` reached the model as `the onions .` — stray spacing before punctuation, in the prose the model is being asked to imitate. |

### On the negative controls

Every guard in this feature was verified by disabling it and confirming the
tests fail. The first attempt at that was **partly vacuous**: the mutation for
the ingredient-amount guard applied, the one for the method guard silently did
not, and five tests failed where eight should have. It was caught only because
the number was wrong — the same silent-no-op-edit failure recorded in §4, caught
the same way.

The second run asserted the mutation target existed before applying it. Both
guards are now confirmed load-bearing: 5 tests for ingredient amounts, 3 for the
method, 3 for consent on the review screen.

### Accepted limitations

- **An invented ingredient with no amount cannot be caught.** "salt" carries no
  number to check. Pinned as a passing test so the limitation is stated
  somewhere that fails if it ever silently changes. The mitigation is that
  nothing is saved without the author reading it.
- **The 2% tolerance is a judgement, not a fact.** Tighter and every honest
  imperial conversion is flagged (8 oz is 226.8 g and every cookbook writes
  225); looser and 200 g passes as 250 g. Both directions are tested.
