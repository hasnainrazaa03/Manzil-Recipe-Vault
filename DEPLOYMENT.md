# Deployment

How to take the current deployment down and put the rewritten version up cleanly.

**Read section 1 first.** There are three things that must happen *before* the new code is live, and one of them closes a security hole that is open right now.

---

## 0. Running it locally first

You do not need MongoDB, Firebase or Cloudinary to look at the app. Demo mode runs the real API against a throwaway in-memory database with authentication stubbed.

Two terminals:

```bash
# Terminal 1 — API on :4000, seeded with 8 recipes
cd server && npm install && npm run demo

# Terminal 2 — web client on :5173
cd web && npm install && npm run demo
```

Then open **http://localhost:5173**.

**Signing in:** any email and any password works. Use `you@example.com` to sign in as the demo user (who owns two recipes and has two saved), or `amina@example.com` / `bilal@example.com` / `sara@example.com` to see the app as someone else — useful for checking that you cannot edit another person's recipe, and that you cannot rate your own.

Worth trying:

- Open **Chicken Karahi** and change the servings — every amount rescales. Note that `to taste` and `a handful` are left alone deliberately.
- Press **Cook mode** for the full-screen step-by-step view.
- Press **⌘K** for the command palette, and **?** for the shortcut list.
- Filter by **Ready in → under 30 min**. *Grandmother's Rice Pudding* is excluded because it states no time — that is deliberate, not a bug.
- Toggle the theme in the header, then **Print** a recipe to see the print layout.

Nothing is persisted. Restarting the API gives a clean, freshly seeded database.

> Demo mode is opt-in through `npm run demo` and swaps the Firebase SDK for local stubs via a Vite alias. No production code branches on it, and a normal `npm run build` never sees it.

---

## 1. Before you deploy anything

### 1.1 Disable the unsigned Cloudinary preset — do this first

This is the one item that is genuinely urgent. The old client uploaded directly to Cloudinary using an **unsigned upload preset whose name shipped in the JavaScript bundle**. Anyone who read that bundle can upload arbitrary files to your account, and will still be able to after you deploy, because the preset lives in Cloudinary rather than in the code.

1. Cloudinary dashboard → **Settings** → **Upload** → **Upload presets**.
2. Find the preset the old app used (its name is in the old bundle, and in your old `VITE_CLOUDINARY_UPLOAD_PRESET`).
3. Either **delete it**, or edit it and set **Signing Mode → Signed**.

The new code does not use an upload preset at all. It mints a server-side signature scoped to a per-user folder with an allow-list of image formats, so nothing here will break.

While you are there, it is worth checking **Media Library → Folders** for anything you did not upload.

### 1.2 Check the Firebase authorized domains

Firebase Console → **Authentication** → **Settings** → **Authorized domains**. Remove anything that is not yours. The web API key is public by design — this list is what actually protects the project.

### 1.3 Have the environment variables ready

You will need these to hand. See [`server/.env.example`](server/.env.example) and [`web/.env.example`](web/.env.example).

| Where | Variable | Notes |
|---|---|---|
| API | `MONGO_URI` | Same database as before — the data carries over. |
| API | `NODE_ENV` | `production` |
| API | `CORS_ORIGINS` | Your real frontend URL, comma-separated. **New — the old code had this hardcoded.** |
| API | `FIREBASE_SERVICE_ACCOUNT` | The whole service-account JSON as one line. **New — replaces the file.** |
| API | `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` | As before. |
| API | `CLOUDINARY_UPLOAD_FOLDER` | Optional, defaults to `manzil-recipe-vault`. |
| Web | `VITE_API_URL` | Your deployed API URL. |
| Web | `VITE_FIREBASE_*` | Six values, unchanged from before. |

**Two variables are now gone** and should be deleted from the frontend project: `VITE_CLOUDINARY_UPLOAD_PRESET` and `VITE_CLOUDINARY_API_KEY`. The client no longer talks to Cloudinary on its own.

To turn the service-account file into a single line:

```bash
cat serviceAccountKey.json | jq -c .
```

---

## 2. Taking the current deployment down

### Option A — pause it (recommended)

Reversible in one click, and keeps the URL.

**Vercel:** Project → **Settings** → **General** → scroll to **Pause Project** → *Pause*. Visitors get a paused notice instead of a broken app while you work.

**Render:** Service → **Settings** → **Suspend Web Service**.

**Railway:** Project → service → **Settings** → **Remove** the deployment, or scale replicas to zero.

### Option B — delete it

Only if you want a genuinely fresh project. You lose the deployment history, the URL assignment, and every environment variable — **copy the env vars out first**, especially the Firebase service account, which you cannot re-read from the Firebase console after creation (you would have to generate a new key).

### What you must not delete

**Do not delete the MongoDB database.** All the recipes live there and the new code reads the same collections. If you want a safety net first:

```bash
mongodump --uri "$MONGO_URI" --out ./backup-$(date +%F)
```

---

## 3. Deploying the API

The API is a TypeScript project now, so it has a build step.

| Setting | Value |
|---|---|
| Root directory | `server` |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Node version | 20 or newer |
| Health check path | `/health` |

Set the environment variables from 1.3, then deploy.

**Verify it is up:**

```bash
curl https://YOUR-API-URL/health
# {"status":"ok","database":"connected","uptime":3}
```

A `"database":"disconnected"` here means `MONGO_URI` is wrong or your database's IP allow-list does not include the host. On MongoDB Atlas: **Network Access** → allow your platform's egress addresses, or `0.0.0.0/0` if it does not publish them.

### 3.1 Run the one-time migration

Once, after the first successful deploy:

```bash
npm run migrate:author-names
```

Recipe cards used to show the author's email address. They now show a display name, which recipes written before the change do not have. This backfills them and repairs comments that stored a full email as the commenter's public name. It is idempotent — running it twice is harmless.

If your host has no shell, run it from your machine with the production `MONGO_URI` set in your local `server/.env`.

---

## 4. Deploying the web client

> **The folder was renamed.** It is `web/`, not `family-recipe-book/`. If you are reusing the existing Vercel project, the **Root Directory** setting must be changed or the build will fail with "no such directory".

| Setting | Value |
|---|---|
| Root directory | **`web`** |
| Framework preset | Vite |
| Build command | `npm run build` (the default) |
| Output directory | `dist` (the default) |
| Node version | 20 or newer |

Set `VITE_API_URL` and the six `VITE_FIREBASE_*` values, delete the two Cloudinary ones, and deploy.

`web/vercel.json` supplies the SPA rewrite, asset caching and security headers — no dashboard configuration needed for those.

### 4.1 Close the loop on CORS

Once the frontend has its final URL, make sure it is in the API's `CORS_ORIGINS` and **redeploy the API** so it picks up the change. This is the single most common cause of "it works locally but the deployed site shows no recipes".

---

## 5. Checking it actually works

In order, because each step depends on the one before:

1. `curl https://YOUR-API-URL/health` → `status: ok`, `database: connected`
2. Open the site. Recipes load on the home page. *(If not: CORS, or `VITE_API_URL`.)*
3. Open a recipe directly by URL, e.g. `/recipe/<some-id>`, in a fresh tab. **This is the SPA rewrite test** — a 404 here means the Root Directory or `vercel.json` is not being picked up.
4. Sign in. *(If not: Firebase authorized domains.)*
5. Check a recipe card shows a **name, not an email**. An email means the migration in 3.1 has not run.
6. Add a recipe with a photo. *(If the upload fails: Cloudinary env vars, or you disabled the preset but the API secret is wrong.)*
7. Set servings on a recipe and confirm the amounts rescale.
8. Toggle dark mode; hard-refresh and confirm it does not flash light first.
9. On a phone, open Cook mode and confirm the screen does not sleep.

### If something is wrong

Check the API logs first — errors are structured JSON with a `code`, and validation failures name the exact field. The client shows the server's message rather than a generic failure, so the on-screen text is usually the real answer.

| Symptom | Almost always |
|---|---|
| No recipes, console shows a CORS error | `CORS_ORIGINS` missing the frontend URL, or the API not redeployed after adding it |
| 404 on a direct recipe link | Root Directory not set to `web` |
| 503 from `/health` | `MONGO_URI` wrong, or Atlas IP allow-list |
| Sign-in popup closes immediately | Domain missing from Firebase authorized domains |
| Emails on recipe cards | Migration 3.1 not run |
| Uploads fail with 503 | `CLOUDINARY_*` not set on the API |
| Server exits at boot | Read the log — it validates its configuration at startup and names the missing variable |

---

## 6. Rolling back

The old code is still in git history at `f348010`. If you need to go back, redeploy that commit — but note it will show emails on cards again, since the migration renames a field it does not read.

Nothing in this release drops or renames existing data. `authorName` and the metadata fields were **added**; `authorEmail` is still stored, it is simply no longer sent to clients.
