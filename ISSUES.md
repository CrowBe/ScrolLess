# ScrolLess — Local Testing Issues

**Tested:** 2026-03-31
**Branch:** `test/local-run-and-issues`
**Tested against:** `main` @ a35c105
**Tester:** Claude (automated via Playwright + curl)

---

## Setup Notes

- Config created from `config.example.json` with fresh VAPID keys and a generated agent token
- Dev server (`npm run dev`) could not be used due to **Issue #1** below
- All testing was done against the production build served by Fastify (`npm run build && npm start`)
- MCP endpoint verified working with correct `Accept` header

---

## Issues

### 🔴 #1 — Dev server is completely broken: Vite proxy intercepts the `api.ts` module

**Severity:** Critical
**File:** `vite.config.ts:17`

**Steps to reproduce:**
1. `npm run dev`
2. Open `http://localhost:5173`

**Expected:** App loads with dark UI, feed view visible.
**Actual:** Blank white page. No CSS applied. No UI rendered.

**Root cause:**
The Vite dev proxy is configured as:
```ts
proxy: {
  '/api': 'http://localhost:3333',
  '/agent': 'http://localhost:3333',
}
```
Vite's proxy rules match on path _prefix_. The path `/api` matches not only `/api/feed` (the intended API route) but also `/api.ts` — the frontend source module that `main.tsx` imports as `import … from './api'`. When the browser fetches `http://localhost:5173/api.ts`, Vite forwards the request to the backend, which returns `404 {"message":"Route GET:/api.ts not found"}`. The module fails to load silently; the Preact app never mounts.

**Evidence:** Network request log shows `GET /api.ts → 503` during Vite dev session. `document.getElementById('app').innerHTML` is empty after page load.

**Fix direction:** Change the proxy key to `'/api/'` (trailing slash) so it only matches actual API calls, not source file paths with the `api` prefix.

---

### 🔴 #2 — Global rate limiter applies to all routes, including the PWA's `/api/*` endpoints

**Severity:** Critical
**File:** `server/index.ts:101–110`

**Steps to reproduce:**
1. Start the server
2. Make ~60 requests to any combination of `/agent/*`, `/api/*`, `/mcp` within one hour (this happens easily during automated testing or page reloads)
3. Call `GET /api/stats` (or any `/api/*` endpoint)

**Expected:** Rate limiting applies only to agent/MCP routes. PWA routes (`/api/*`) are always accessible.
**Actual:** `{"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded, retry in 1 hour"}` — the entire PWA becomes non-functional.

**Root cause:**
The `@fastify/rate-limit` plugin is registered at the root Fastify instance (no `prefix` or route filter), so it applies to every route. The code comment on line 109 says:
```
// Only apply to /agent/* — we'll scope this in the route registration
```
…but the scoping was never implemented.

**Fix direction:** Either (a) register the rate limiter only inside the `registerAgentRoutes`/`registerMcpHandler` scope, or (b) add a `skipIf` function that returns `true` for all paths not starting with `/agent/` or `/mcp`.

---

### 🟠 #3 — Default sources (youtube, x, news) are not seeded — agent sync returns empty

**Severity:** High
**File:** `server/db.ts`

**Steps to reproduce:**
1. Fresh install (no existing DB)
2. `GET /agent/sync-context` with a valid Bearer token

**Expected:** Response includes three default sources (youtube, x, news) with `enabled: false`, per architecture docs:
> "Default sources are seeded at account creation (youtube, x, news — all with enabled = 0 until the user activates them)."

**Actual:** `{"sources":[],"filters":{"blocked_keywords":[]}}` — empty sources array.

**Root cause:** `initDb()` seeds `user_preferences` but never inserts default rows into `user_sources`. The Settings UI consequently shows "No sources configured yet. Add one below." on a fresh install, which is confusing — users expect to see youtube/x/news pre-populated (but disabled) and just toggle them on.

**Fix direction:** Add `INSERT OR IGNORE INTO user_sources (user_id, name, enabled, urls) VALUES ...` for youtube, x, and news inside the `seedAll` transaction in `db.ts`.

---

### 🟠 #4 — `blocked_sources` still seeded as a user_preference (violates documented constraint)

**Severity:** High
**File:** `server/db.ts:43`

**Observed:**
```ts
seedPref.run('blocked_sources', JSON.stringify([]));
```

**Expected:** `blocked_sources` is not a valid preference key per `CLAUDE.md`:
> "`blocked_sources` is gone — use `user_sources.enabled = 0` instead. Never add `blocked_sources` back as a preference key."

**Actual:** It is seeded into `user_preferences` on every fresh DB init. While currently harmless (nothing reads it), it is dead data that contradicts the architecture decision and could cause confusion if future code attempts to use it.

**Fix direction:** Remove the `seedPref.run('blocked_sources', ...)` line from `db.ts`.

---

### 🟠 #5 — "Saved" tab shows all items, identical to the main Feed (feature non-functional)

**Severity:** High
**File:** `src/app.tsx:41`

**Steps to reproduce:**
1. Open the app with feed items present
2. Click the "Saved" tab in the bottom nav

**Expected:** "Saved" shows only items that have been explicitly saved/bookmarked by the user.
**Actual:** "Saved" shows all items — including unread ones — identical to the main Feed view.

**Root cause:**
In `app.tsx` the Saved view passes:
```ts
unread_only: view === 'saved' ? false : undefined,
```
`unread_only: false` is treated identically to `undefined` by the API (it just omits the `is_read = 0` filter), so the full item list is returned. There is no `read_only: true` parameter and no bookmark/save mechanism separate from `is_read`. The "Saved" concept is architecturally undefined — the DB schema has `is_read` but no `is_saved`/`is_bookmarked` column.

**Screenshot:** `screenshots/10-saved-view.png` shows all 6 items including unread ones.

---

### 🟡 #6 — CORS `methods` missing `PATCH` (blocks cross-origin mark-read and source updates)

**Severity:** Medium
**File:** `server/index.ts:82`

**Observed:**
```ts
methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
```

**Expected:** `PATCH` is included, since the API exposes:
- `PATCH /api/feed/:id/read`
- `PATCH /api/feed/:id/unread`
- `PATCH /api/sources/:name`

**Actual:** In the split-hosting deployment (PWA on Vercel, API on Render — the recommended setup per `docs/DEPLOYMENT.md`), all three PATCH endpoints will fail CORS preflight. Items cannot be marked as read, and sources cannot be updated from the deployed frontend.

**Fix direction:** Add `'PATCH'` to the `methods` array.

---

### 🟡 #7 — Agent token management is absent from Settings UI

**Severity:** Medium
**File:** `src/settings.tsx`

**Steps to reproduce:**
1. Open Settings

**Expected (per `docs/ARCHITECTURE.md`):**
> `AgentTokens — View/create/revoke agent tokens`

**Actual:** The Settings page shows a static "AGENT TOKEN" card with instructions to run `npm run generate-token` and manually edit `config.json`. There is no UI to create, view, copy, or revoke tokens. A non-technical user (or any user on a hosted deployment) cannot set up their agent without CLI access.

**Screenshot:** `screenshots/03-settings-empty.png` and `screenshots/11-settings-view.png`

---

### 🟡 #8 — Source filter tab counts don't account for discovery flag (misleading in Discover view)

**Severity:** Medium
**File:** `src/app.tsx`, `server/api-routes.ts` (`/api/stats`)

**Steps to reproduce:**
1. Have feed items present (none with `is_discovery: true`)
2. Click the "Discover" tab in the bottom nav

**Expected:** Source filter tab badges (YouTube 3, X 1, News 2) reflect the count of discovery items for each source.
**Actual:** Tab badges show total item counts regardless of the discovery flag. The Discover feed shows "No items yet" while the tabs show non-zero counts — implying items exist but none are visible. This is confusing.

**Root cause:** `getStats()` / `GET /api/stats` counts all items and doesn't segment by `is_discovery`. The `SourceFilter` component receives these undifferentiated counts and displays them in both the Feed and Discover contexts.

**Screenshot:** `screenshots/09-discover-view.png` — tabs show "All 6" but feed area shows "No items yet".

---

### 🟢 #9 — Notification prompt suppressed in headless / non-HTTPS context

**Severity:** Low (expected browser behaviour; document for awareness)

**Observed:** On `http://localhost:3333` (HTTP, not HTTPS), the Push API notification prompt in `NotificationPrompt` is not rendered.
**Expected in production:** The prompt should appear on the first visit over HTTPS and disappear after dismissal.
**Note:** This is expected — browsers gate the Push API on a secure origin. The component may need a guard so it doesn't silently fail on HTTP; currently it just renders nothing.

---

### 🟢 #10 — `SyncStatus` shows stale/inaccurate "Synced X ago" when API is rate-limited

**Severity:** Low
**File:** `src/components/sync-status.tsx`

**Steps to reproduce:**
1. Trigger the rate limit (#2 above)
2. Observe the header sync timestamp

**Expected:** Component shows an error state or hides when `GET /api/sync/status` returns 429.
**Actual:** Component continues to display the last cached sync time, which becomes increasingly stale (observed: "Synced 11h ago" when items were submitted seconds prior). No error indicator is shown.

---

## Summary Table

| # | Severity | Area | Short description |
|---|----------|------|-------------------|
| 1 | 🔴 Critical | `vite.config.ts` | Dev server blank — proxy intercepts `api.ts` module |
| 2 | 🔴 Critical | `server/index.ts` | Rate limiter is global, kills PWA after 60 requests/hour |
| 3 | 🟠 High | `server/db.ts` | Default sources not seeded — sync context empty on fresh install |
| 4 | 🟠 High | `server/db.ts` | `blocked_sources` still seeded as preference (violates CLAUDE.md) |
| 5 | 🟠 High | `src/app.tsx` | "Saved" tab shows all items — no bookmark mechanism |
| 6 | 🟡 Medium | `server/index.ts` | CORS missing `PATCH` — breaks mark-read/source update on split deploy |
| 7 | 🟡 Medium | `src/settings.tsx` | Agent token management missing from UI |
| 8 | 🟡 Medium | `src/app.tsx`, `/api/stats` | Source tab counts don't reflect discovery filter (misleading) |
| 9 | 🟢 Low | `src/components/notification-prompt.tsx` | Notification prompt suppressed on HTTP |
| 10 | 🟢 Low | `src/components/sync-status.tsx` | Stale sync timestamp when rate limited |

---

## What Works

- ✅ Production build (`npm run build && npm start`) serves the PWA and API correctly
- ✅ `POST /agent/feed-items` inserts items and deduplicates by URL hash
- ✅ Feed renders with correct source filter tabs (All / YouTube / X / News) with item counts
- ✅ Source filter tabs correctly filter the feed list
- ✅ Dark theme design system renders correctly
- ✅ Bottom navigation (Feed / Discover / Saved / Settings) switching works
- ✅ Settings page renders with "Add Source" form
- ✅ MCP endpoint responds correctly (`initialize`, verified with Accept header)
- ✅ OAuth `.well-known` metadata endpoint is present
- ✅ URL normalisation and deduplication logic functions correctly
- ✅ Sync log correctly records agent POST events
- ✅ `GET /agent/sync-context` returns correct structure (empty until sources are configured)
- ✅ Push VAPID public key served via `/api/push/vapid-key`
- ✅ Service worker built to `dist/client/sw.js` (non-content-hashed)
