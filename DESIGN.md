# Manzil Recipe Vault — Product & UI Design Plan

**Status:** living document · **Started:** 2026-07-19
**Companion to:** [`PLAN.md`](PLAN.md), which covers the security and correctness audit.

This is the plan for turning a working recipe CRUD app into something people actually want to cook from. It defines the design language, the feature set, and the order of implementation. Each item carries a status marker so this doubles as the progress tracker.

`[ ]` not started · `[~]` in progress · `[x]` done

---

## 1. The problem with what we have

The app currently stores a title, a picture, an overview, a list of ingredients, and a blob of instructions. That is a *recipe record*. It is not a *cooking tool*.

Concretely, what is missing:

- **No times and no yield.** You cannot tell whether a dish takes fifteen minutes or four hours, or whether it feeds two or twelve. This is the first thing anyone wants to know and the first thing every real recipe site shows.
- **Amounts are frozen.** A recipe written for four cannot be cooked for two without mental arithmetic at the counter.
- **The reading experience assumes a desk.** Cooking happens standing up, with dirty hands, at arm's length from a phone that keeps sleeping. Small body text and a scrolling page are the wrong interface for that moment.
- **Nothing carries over between recipes.** No shopping list, no history, no sense that the app knows you were here yesterday.
- **Discovery is a search box and a tag row.** There is no browsing, no "what's good", no relationships between recipes.

The features below are chosen to close those gaps, in roughly that order of importance.

---

## 2. Design language

The existing identity is good and stays: warm peach gradient, Inter, white cards, dark slate ink, generous corner radius. What changes is *confidence* — more scale contrast, more whitespace, more deliberate motion.

### 2.1 Typographic scale

The current page is typographically flat: headings are only slightly larger than body text, so nothing leads the eye. Introduce a real scale with a display face for recipe titles.

| Token | Size | Use |
|---|---|---|
| `--text-display` | `clamp(2rem, 5vw, 3.25rem)` | Recipe detail title, home hero |
| `--text-h1` | `clamp(1.75rem, 3vw, 2.25rem)` | Page titles |
| `--text-h2` | `1.5rem` | Section headings |
| `--text-h3` | `1.125rem` | Card titles |
| `--text-body` | `1rem` | Prose |
| `--text-sm` | `0.875rem` | Metadata, hints |
| `--text-xs` | `0.75rem` | Tags, counts |

Instructions get a deliberately larger reading size (`1.0625rem`, `line-height: 1.75`) — they are read at a distance.

### 2.2 Motion

Motion communicates causality: a card lifts because it is interactive, a saved star pops because the save registered. It should never be decorative.

- Standard transition: `180ms cubic-bezier(0.2, 0, 0.2, 1)`.
- Entrances: `240ms`, fade plus a 4–8px rise. Never slide from off-screen.
- Every animation sits behind the existing `prefers-reduced-motion` block, which already reduces durations to `0.01ms` globally.

### 2.3 Elevation

Four levels only: flat (page), raised (card), floating (dropdown, popover), overlay (dialog). Already tokenised as `--shadow-sm/md/lg/xl`.

### 2.4 Rules that do not bend

- Every interactive element has a visible `:focus-visible` ring.
- Colour never carries meaning alone.
- Icon-only controls are at least 44×44 and carry an accessible name.
- The body never scrolls horizontally.
- Both themes meet WCAG AA. New tokens get checked, not assumed.

---

## 3. Feature plan

### Wave 1 — Make it a cooking tool

The highest-value work. Everything here changes what the app *is*.

#### 1.1 Structured recipe metadata `[x]`

Add to the recipe model, all optional so existing recipes stay valid:

| Field | Type | Notes |
|---|---|---|
| `servings` | number, 1–100 | Drives ingredient scaling |
| `prepMinutes` | number, 0–1440 | |
| `cookMinutes` | number, 0–1440 | |
| `difficulty` | `easy` \| `medium` \| `hard` | |
| `cuisine` | string, ≤40 chars | Also becomes a filter |

Surfaces as a metadata strip on the detail page (time, yield, difficulty), as badges on cards, and as new filter and sort options.

**Why optional:** making them required would invalidate every existing recipe and force a migration with no correct default. A recipe with no stated time is a worse recipe, not an invalid one.

#### 1.2 Ingredient scaling `[x]`

A servings stepper on the detail page that rescales every amount live.

Amounts are free text (`"1 1/2 cups"`, `"200 g"`, `"2-3"`, `"a pinch"`), so this needs a parser that:

- reads integers, decimals, vulgar fractions (`½`), ASCII fractions (`1/2`), and mixed numbers (`1 1/2`);
- reads ranges (`2-3`) and scales both ends;
- renders back to the nearest sensible fraction rather than `0.6666666666666666`;
- **leaves anything it cannot parse completely alone** (`"a pinch"` stays `"a pinch"`).

That last rule is the important one. A scaler that mangles unparseable input is worse than no scaler.

#### 1.3 Cook Mode `[x]`

A full-screen, step-by-step view built for the kitchen.

- One instruction step at a time at large type.
- Ingredients for the current step visible alongside.
- Previous/next by button, arrow keys, or swipe.
- **Screen Wake Lock** so the phone does not sleep mid-recipe. Degrades silently where unsupported.
- Progress indicator; Escape exits.

Steps are derived by splitting the instruction HTML on block boundaries (`<p>`, `<li>`, `<h3>`) — no schema change, works with every existing recipe.

#### 1.4 Checkable ingredients `[x]`

Tap an ingredient to strike it through. Persisted per recipe in `localStorage`, so it survives the page refresh that happens when a wet phone locks and reopens.

#### 1.5 Print stylesheet `[x]`

`window.print()` on a recipe should produce a clean card: title, metadata, ingredients, instructions. No header, no nav, no comments, no buttons, black on white.

---

### Wave 2 — Discovery

#### 2.1 Command palette `[x]`

`⌘K` / `Ctrl+K` opens a palette that searches recipes as you type and offers navigation and actions (go home, saved recipes, my profile, add recipe, toggle theme). Full keyboard control, `role="combobox"` + `listbox`, results debounced.

#### 2.2 Related recipes `[x]`

On the detail page: up to six recipes sharing the most tags with this one, ranked by overlap. New endpoint `GET /api/recipes/:id/related`, implemented as an aggregation on the tag array.

#### 2.3 Recently viewed `[x]`

The last twelve recipes opened, in `localStorage`, shown as a horizontal strip on the home page. Purely local — no server, no tracking.

#### 2.4 Home hero `[x]`

A featured recipe at the top of the home page: the highest-rated recipe with at least three ratings, falling back to the newest. Large image, title, overview, metadata, a link in.

Hidden when a search or filter is active — the hero is for browsing, not for results.

#### 2.5 Search term highlighting `[x]`

Matched substrings in card titles and overviews get a `<mark>`. The highlighter escapes the term before building its regex — the same discipline as the server-side fix.

#### 2.6 Active filter summary `[x]`

A row of removable chips showing exactly what is being filtered, with a "clear all". Filters live in the URL already; this makes them visible.

---

### Wave 3 — Personal tools

#### 3.1 Shopping list `[x]`

Add all of a recipe's ingredients — scaled to the chosen servings — to a shopping list. The list groups by recipe, items are checkable, and it persists in `localStorage`.

Deliberately local for now. A server-backed list is Wave 5 work; the local version delivers most of the value with none of the schema risk.

#### 3.2 Keyboard shortcuts `[x]`

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `/` | Focus search |
| `g` then `h` | Home |
| `g` then `s` | Saved recipes |
| `g` then `l` | Shopping list |
| `n` | New recipe |
| `?` | Shortcut help |
| `Esc` | Close overlay |

Chords ignore keystrokes typed into inputs, textareas, and the rich-text editor.

#### 3.3 Image lightbox `[x]`

Click a recipe image to view it full-size. Escape and backdrop close, focus is trapped and restored — it reuses the existing `Modal`.

---

### Wave 4 — Polish

- `[x]` Card hover lift with image zoom, and a save-star pop.
- `[x]` Sticky detail header that appears on scroll, with a reading-progress bar. Driven by a `transform: scaleX()` rather than a width, so scrolling a long recipe composites instead of triggering layout every frame.
- `[x]` Scroll-to-top button on long pages, bottom-*left* so it cannot collide with the floating add button.
- `[x]` Toast restyle to match the design language. Status is carried by a leading edge *and* the icon — never colour alone.
- `[x]` Richer empty states.

---

### Wave 5 — Server-side features `[x]`

All six shipped. Three bugs were found by the tests written alongside them, each
of the same species and each worth remembering:

- a **duplicate route registration** left behind by the comment rewrite, where
  Express matched the stale handler and served an empty list while the write
  path looked perfect;
- a **fan-out still addressing the old shape**, so renaming yourself updated
  your recipes but left every comment you had ever written showing the old name;
- a **counter decremented without checking the write took effect**, which let
  parallel follow toggles drive the follower count to -1, permanently.

The first two are the same failure mode: a schema move leaves code addressing
the old shape, it keeps reporting success, and any test checking only the half
that still works passes. Both are now pinned by assertions spanning *both*
halves — read against write, and stored document against response.

All six, in dependency order. Each is additive; the only one that touches
existing data is 5.2.

#### 5.1 Collections `[x]`

User-defined groups of saved recipes — "Weeknight dinners", "Eid", "Things I
keep meaning to try". Saving is currently a single flat list, which stops being
useful somewhere around thirty recipes.

```
Collection {
  owner       uid, indexed
  name        ≤60 chars
  description ≤300 chars
  recipes     [ObjectId]        max 200
  isPublic    boolean           default false
  createdAt / updatedAt
}
```

- `GET /api/collections?owner=me|<uid>` — own collections, or another user's public ones
- `POST|PATCH|DELETE /api/collections[/:id]`
- `PUT /api/collections/:id/recipes/:recipeId` — idempotent toggle
- Cap: 50 collections per user, 200 recipes each. Both bounded for the same reason comments are.

A collection is **not** a replacement for saving. Saving stays the one-tap
action; collections are the deliberate organising step on top of it.

#### 5.2 Comments in their own collection `[x]`

The last structural fix from `PLAN.md`. Comments are embedded, so every recipe
write rewrites the whole array, every detail read loads all of them, and the
document has a hard 16 MB ceiling that forced a 500-comment cap.

```
Comment {
  recipe    ObjectId, indexed with createdAt
  author    uid, authorName, authorPictureUrl   (denormalised)
  text      ≤2000 chars
  parent    ObjectId | null      one level of replies, no deeper
  editedAt / createdAt
}
```

`Recipe.commentCount` stays as a denormalised counter — it is what the card
renders, and a per-card count query would be one query per card.

**This needs a migration against live data**, so it ships with a reversible
script: the embedded array is copied, not deleted, until the new path is
verified in production.

Replies are capped at one level. Arbitrarily deep threading is a moderation
problem long before it is a feature.

#### 5.3 Follows and a feed `[x]`

```
Follow { follower uid, following uid, createdAt }   unique on the pair
```

- `PUT /api/users/:userId/follow` — idempotent toggle
- `GET /api/users/:userId/followers` and `/following`
- `GET /api/feed` — recipes from everyone you follow, newest first

Fan-out **on read**, not on write: query the follow list, then the recipes. For
a personal recipe app this is the right trade — it stays correct with no
maintenance, and the alternative only pays off at a scale this will not reach.

`followerCount` is denormalised onto the profile so it can be shown without a
count query.

#### 5.4 Server-backed shopping list `[x]`

The list is currently `localStorage` only, so it does not survive switching
devices — and the phone in the shop is rarely the machine the recipe was
browsed on.

```
ShoppingList { user uid unique, items [...], updatedAt }
```

**Merge semantics matter more than the model.** Signing in must not silently
discard a list built while signed out, so on sign-in the local list is merged
into the server's by item id and the local copy stays as the offline cache. A
shopping list that loses items is worse than no list.

Conflicts resolve **per field**, not by picking a winning side:

- `checked` is true if *either* copy has it ticked — un-ticking something you
  already bought is a smaller annoyance than buying it twice.
- `amount` comes from whichever copy was added more recently, because that is
  the wording the reader last saw and rescaling changes it.
- `addedAt` takes the earlier of the two, so ordering reflects when the item
  first appeared rather than when it last synced.

Nothing is ever dropped.

#### 5.5 Recipe versioning `[x]`

```
RecipeVersion { recipe ObjectId, version int, snapshot {...}, editedBy, createdAt }
```

A snapshot on every update, capped at the last 20 per recipe. Surfaces as an
edit history with a diff and a restore button.

Restoring writes a *new* version rather than rewinding, so history is
append-only and a restore can itself be undone.

#### 5.6 Responsive images and better search `[x]`

- **`srcset` via Cloudinary transforms.** Cards currently download the full
  image and scale it in CSS. Cloudinary URLs take inline transforms, so widths
  can be requested per breakpoint. Applies only to `res.cloudinary.com` URLs —
  an arbitrary host cannot be transformed, so those fall back to the original.
- **Search that tolerates a typo.** The current text index is exact-token:
  "chiken" finds nothing. Adds trigram-ish fuzzy fallback when a text search
  returns nothing, plus ingredient-name matching.

---

## 4. Sequencing

Waves are ordered by value per unit of risk. Within the current pass:

1. Server metadata fields + related endpoint, with tests. *Everything in Wave 1 depends on the schema.*
2. Amount parser, in isolation with its own tests. *Pure logic, highest bug risk, cheapest to test.*
3. Detail page rebuild: metadata strip, scaling, checkable ingredients, lightbox, related, sticky header.
4. Cook mode.
5. Home page: hero, recently viewed, highlighting, filter chips.
6. Global: command palette, shortcuts, shopping list.
7. Print and motion polish.

---

## 5. Testing commitments

> **Where the second audit found its bugs.** Every finding in `PLAN.md` §5 lived
> in the part of the client with no tests: `pages/`, `hooks/`, `lib/queries.ts`
> and the two hand-rolled overlays. The tested modules — the amount parser, the
> formatters, the storage guards, the presentational components — were clean.
> That is not a coincidence, and it is the argument for the commitments below.


- The amount parser gets exhaustive unit tests, including everything it must refuse to touch.
- Cook mode step derivation is tested against real instruction HTML, including the degenerate single-paragraph case.
- The command palette is tested for keyboard operation.
- `localStorage` persistence is tested for the corrupt-data case — a bad value must not crash the app.
- New API fields get validation tests in the existing suite.
- **Anything holding a counter alongside the array it counts gets a concurrency
  test.** Two writers in parallel, then assert the stored array and the stored
  count agree. Sequential tests pass happily while the data corrupts.
- **Anything reading a document gets a legacy-document test**, inserted through
  the raw driver so no Mongoose default can hide a missing field.
- **Anything wired to a URL or an effect gets a "does it sit still?" test.**
  Render it, wait, and assert it has not navigated or refetched on its own.

---

## 6. Implementation notes worth keeping

Decisions taken during the build that are not obvious from the code.

- **`--accent-soft` is deliberately below 3:1** against the card. It is never the sole signal: `.palette-option.is-active` also carries a 3px accent bar, a weight change and `aria-selected`, and the cook-mode step dot carries a scale change as well as a fill. Contrast minimums apply to information-bearing colour, and this is reinforcement.
- **Cook mode has its own palette** rather than reusing the card tokens. It is opaque and maximum-contrast because it is read at arm's length in a bright kitchen, which is a different problem from reading a card.
- **The two-column recipe body forced the detail page wider** (46rem → 64rem at ≥900px). A 320px ingredient sidebar next to a 46rem container left the instructions at roughly 384px, which is below a readable measure. The overview keeps its own 46rem cap.
- **The horizontal rails are their own scroll containers**, so they structurally cannot produce page-level horizontal scroll no matter how many items land in them.
- **Printing hides the hero photo.** It is a large block of toner and the printed artefact people want is the card, not the picture. Re-showing it is a one-line change.
- **Three test-environment shims** were needed and are documented in `web/vitest.setup.ts`. The important one: Vitest's jsdom supplies jsdom's `AbortSignal` while `fetch` is Node's, which validates with `instanceof` against its own — so every request carrying a signal failed before being sent. Since the app passes a signal on every query, the entire data layer was silently untestable. The shim must be installed *after* MSW starts, or MSW simply re-wraps it.

---

## 7. Explicit non-goals

- **No nutrition data.** It would have to be estimated, and a wrong calorie count is worse than none.
- **No AI generation.** Not what this app is.
- **No social graph beyond authorship** until Wave 5 is genuinely wanted.
- **No infinite scroll.** Pagination is in the URL and shareable; infinite scroll breaks that and the back button.
