# Manzil Recipe Vault

A recipe-sharing web app. Collect your own recipes, browse everyone else's, save the ones you like, rate and comment.

<p>
  <a href="https://github.com/hasnainrazaa03/Manzil-Recipe-Vault/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/hasnainrazaa03/Manzil-Recipe-Vault/actions/workflows/ci.yml/badge.svg" />
  </a>
</p>

---

## Layout

This is a two-package repository. Each deploys independently.

| Path | What it is | Stack |
|---|---|---|
| [`web/`](web) | The web client | React 19 · TypeScript · Vite · React Router · TanStack Query · Firebase Auth · Tiptap |
| [`server/`](server) | The API | Node 20 · TypeScript · Express 5 · Mongoose · Zod · firebase-admin |

Authentication is Firebase: the client signs in and sends the resulting ID token as `Authorization: Bearer <token>`; the API verifies it with `firebase-admin` and trusts nothing else about the caller's identity.

---

## Running it locally

### Prerequisites

- Node 20 or newer
- A MongoDB instance (local, or a free Atlas cluster)
- A Firebase project with Email/Password and Google sign-in enabled
- A Cloudinary account (optional — image upload degrades gracefully without one)

### 1. The API

```bash
cd server
cp .env.example .env      # then fill it in — see below
npm install
npm run dev               # http://localhost:4000
```

Environment variables:

| Variable | Required | Notes |
|---|---|---|
| `MONGO_URI` | yes | Connection string. |
| `PORT` | no | Defaults to `4000`. |
| `NODE_ENV` | no | `development` \| `test` \| `production`. |
| `CORS_ORIGINS` | no | Comma-separated allowlist. Defaults to `http://localhost:5173`. |
| `FIREBASE_SERVICE_ACCOUNT` | one of | The service-account JSON as a single-line string. Preferred for hosted deploys. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | one of | Path to the JSON file. Easier locally. |
| `CLOUDINARY_CLOUD_NAME` | no | Omit all three to disable uploads. |
| `CLOUDINARY_API_KEY` | no | |
| `CLOUDINARY_API_SECRET` | no | |
| `CLOUDINARY_UPLOAD_FOLDER` | no | Defaults to `manzil-recipe-vault`. |

The server validates its configuration at boot and exits with a readable message rather than failing on the first request that needs a missing value.

> **Just want to look at it?** `cd server && npm run demo` in one terminal and `cd web && npm run demo` in another needs no MongoDB, Firebase or Cloudinary — it runs the real API against a throwaway in-memory database seeded with sample recipes, with sign-in stubbed. See [`DEPLOYMENT.md`](DEPLOYMENT.md#0-running-it-locally-first).

### 2. The web client

```bash
cd web
cp .env.example .env      # fill in the Firebase web config
npm install
npm run dev               # http://localhost:5173
```

The `VITE_FIREBASE_*` values are the web config from the Firebase Console. They are **not secrets** — they ship in the client bundle by design. What protects the project is the Console's **Authorized domains** list and your Firestore/Storage rules, so keep those tight.

---

## Scripts

Both packages expose the same set:

| Command | Does |
|---|---|
| `npm run dev` | Start in watch mode |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |

The API additionally has `npm start` to run the compiled output from `dist/`.

---

## Deploying

Full instructions, including how to take the existing deployment down first and the one security item that needs doing in the Cloudinary dashboard, are in **[`DEPLOYMENT.md`](DEPLOYMENT.md)**. In brief:

### API

Any Node host works. Point it at the `server/` directory with:

- **Build:** `npm ci --include=dev && npm run build`
- **Start:** `npm start`
- **Health check:** `GET /health` — returns 200 when the database is connected, 503 otherwise.

Set `NODE_ENV=production`, `CORS_ORIGINS` to your real frontend origin, and supply the service account through `FIREBASE_SERVICE_ACCOUNT` rather than a file.

### Web client

Deploy `web/` to Vercel (set the project **Root Directory** to `web` — it changed from `family-recipe-book`). [`vercel.json`](web/vercel.json) supplies the SPA rewrite — without it, a hard load of `/recipe/:id` returns a 404 — along with long-lived caching for hashed assets and a set of baseline security headers.

Set `VITE_API_URL` to the deployed API's URL.

### One-time migration

If you are upgrading an existing deployment, run the author-name backfill once after the first deploy:

```bash
cd server && npm run build && node dist/scripts/backfill-author-names.js
```

Recipe cards used to display the author's email address. They now show a display name (`Recipe.authorName`), which recipes created before the change do not have. The script is idempotent and only touches recipes with an empty name.

---

## Notes on the API

- Every route validates its body, query, and params with Zod, and handlers receive the *parsed output* rather than the raw request. Unknown fields never reach the database layer.
- List endpoints return a consistent envelope: `{ items, page, limit, total, totalPages }`.
- Errors return `{ error: { code, message, details? } }`. In production the message for an unexpected fault is generic; the detail goes to the logs.
- Rich text is sanitized on write, not only on render.
- Email addresses are never included in any public response.
- Reads, writes, interactions, and upload-signature minting are rate limited separately, and limiting runs *before* authentication so failed sign-ins are metered too.
- Counters that accompany an array (`ratingCount`, `commentCount`) are derived inside the same atomic update that changes the array, so they cannot drift apart under concurrent writes.
- Comments are capped at 500 per recipe, which bounds the document well below MongoDB's 16 MB ceiling.
- Responses are normalised through one serialiser, so a document written before a field existed still honours the published contract.

Full endpoint list: see [`server/src/routes/`](server/src/routes).

---

## Features

See [`DESIGN.md`](DESIGN.md) for the product plan and the reasoning behind each of these.

- **Cook mode** — full-screen, one step at a time, with a screen wake lock so the phone does not sleep mid-recipe.
- **Ingredient scaling** — a servings stepper rescales every amount live, including fractions and ranges. Anything it cannot confidently parse is left untouched.
- **Shopping list** — collect ingredients from any recipe at your chosen yield; grouped, checkable, and stored in the browser so it works offline in a shop.
- **Command palette** — `⌘K` to search recipes or jump anywhere. `?` lists every shortcut.
- **Discovery** — search across titles, ingredients and tags; filter by tag, cuisine, difficulty and total time; sort by rating, popularity or speed.
- **Dark mode**, WCAG AA in both themes, full keyboard operation, and a print stylesheet that turns any recipe into a clean card.

---

## Security

`PLAN.md` documents the audit this codebase went through, including the issues that were found and fixed. Two items need attention in dashboards rather than in code:

1. **Cloudinary** — the old client uploaded with an *unsigned* upload preset whose name shipped in the JavaScript bundle, which was effectively public write access to the account's storage. Uploads now go through a server-signed, folder-and-format-constrained signature. **Disable the unsigned preset in the Cloudinary dashboard** so the old path cannot be used.
2. **Firebase** — the web config was committed in plaintext before commit `69a764e`. Web API keys are public by design, so the impact is limited, but confirm the **Authorized domains** list in the Firebase Console contains only your real domains.

To report a vulnerability, open a private security advisory on the repository rather than a public issue.

---

## Licence

ISC
