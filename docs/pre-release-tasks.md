# Pre-Release Tasks

Remaining work before ScrolLess is ready for daily personal use. Organised by priority tier.

---

## Tier 1 — Blocking (app is broken or unusable without these)

### PWA Icons Missing

**Impact:** No icons → "Add to Home Screen" uses a browser default icon, push notifications show no icon, installed PWA looks broken.

`src/icons/` contains only a README. `manifest.json` references `icon-192.png` and `icon-512.png` which do not exist.

**Fix:** Generate or design two PNGs and place them at:
- `src/icons/icon-192.png` — 192×192
- `src/icons/icon-512.png` — 512×512

A simple text/logo SVG converted to PNG is sufficient. Tools: Figma, Inkscape, or a one-liner with ImageMagick.

---

### Preferences Not Editable in UI

**Impact:** `blocked_keywords`, `retention_days`, and `max_items_per_source` are stored in `user_preferences` and drive agent behaviour (keyword filtering, cleanup schedule, per-source item caps), but there is no UI or API to view or change them. Blocked keywords in particular are silently applied to every sync without the user being aware.

**Fix:**

1. Add to `server/api-routes.ts`:
   - `GET /api/preferences` — return all preference keys as an object
   - `PATCH /api/preferences` — accept partial update `{ blocked_keywords?, retention_days?, max_items_per_source? }`

2. Add a "Preferences" section to `src/settings.tsx`:
   - `blocked_keywords` — tag-style or comma-separated input
   - `retention_days` — number input (default 7)
   - `max_items_per_source` — number input (default 50)

---

## Tier 2 — High (important for a usable daily-driver experience)

### OAuth Client Management UI

**Impact:** Connecting Claude.ai via the remote connector requires OAuth. Currently clients are only seeded from `config.json`. Users cannot see which clients are connected, and revoking access requires a server restart.

**Fix:**

1. Add to `server/api-routes.ts`:
   - `GET /api/oauth/clients` — list registered clients
   - `POST /api/oauth/clients` — register a new client (name, redirect URIs, public/confidential)
   - `DELETE /api/oauth/clients/:client_id` — revoke client and all its active tokens

2. Add a "Connected Apps" section to `src/settings.tsx` listing active OAuth clients with a revoke button.

3. `config.json` bootstrap clients continue to be seeded at startup via `INSERT OR IGNORE`; all subsequent management goes through the UI.

---

### Sync Status Per-Source Detail

**Impact:** The header widget shows a single "Synced X ago" timestamp (most recent across all sources). If one source has errored or hasn't synced in days, this is invisible.

**Fix:** Add an expandable sync detail panel (in `SyncStatus` or linked from the Settings screen) that shows each source's `synced_at`, `items_added`, and any error from the most recent `sync_log` row.

---

### Danger Zone / Account Data Deletion

**Impact:** No way to clear feed data, reset preferences, or wipe the database from the UI. Resetting currently requires manual SQLite manipulation.

**Fix:**

1. Add to `server/api-routes.ts`:
   - `DELETE /api/data` — delete all `feed_items` and `sync_log` rows for `user_id = 'local'`; reset preferences to defaults

2. Add a "Danger Zone" section at the bottom of `src/settings.tsx` with a "Clear all feed data" button behind a confirmation dialog.

---

### Saved Tab Empty State Copy

**Impact:** When nothing is saved, the Saved tab shows "No items yet — Items will appear here once the agent syncs", which is the wrong context entirely.

**Fix:** In `src/components/feed-list.tsx`, thread the current `view` (or a `emptyMessage` prop) through to the empty state so the Saved tab can show "No saved items yet — tap the bookmark icon on any card to save it for later."

---

### Card Thumbnails Not Rendered

**Impact:** `thumbnail_url` is stored and returned in the API but none of the three card components display it. YouTube cards without thumbnails are significantly harder to scan visually.

**Fix:** Each card component should render the thumbnail in its collapsed state:
- `youtube-card.tsx` — show thumbnail left of the title (standard video card layout)
- `news-card.tsx` — show thumbnail below the headline in expanded state
- `x-card.tsx` — show inline media if `thumbnail_url` is set (quoted media, link previews)

---

## Tier 3 — Low (quality of life, not blocking daily use)

### Source Filter Unread Total on "All" Tab

The "All" tab has no unread badge. Stats are fetched but the aggregate count is not rendered on the tab.

---

### `vercel.json` Rewrite Pattern Incomplete

The current pattern `/((?!api/).*)` only excludes `/api/` paths. In split-hosting the Vercel frontend will never receive `/agent/`, `/mcp`, or `/oauth/` requests anyway (those go to Render), so this is a cosmetic issue, not a bug.

---

## Production Seams (multi-user / hosted product only)

These are architectural changes required to turn ScrolLess into a hosted multi-user product. They are **not needed for personal single-user use** — the app is fully functional as a self-hosted personal tool without them.

### SQLite vs Postgres

**For personal use:** SQLite is the right choice. Single user means no write contention. Single file means trivial backups. Zero configuration. No additional service to run or pay for. The current setup works correctly and should not be changed for personal deployment.

**If you ever move to multi-user hosting:** SQLite cannot handle concurrent writes from multiple users. Migration requires: `better-sqlite3` → `pg`/`postgres`; `datetime('now')` → `NOW()`; `INSERT OR IGNORE` → `INSERT ... ON CONFLICT DO NOTHING`; and a Postgres provisioning step. The schema and query structure are already written with this seam in mind.

---

### User Identity (Clerk)

Every `/api/*` route hardcodes `user_id = 'local'`. Multi-user hosting requires Clerk session middleware to resolve a real `user_id` per request, with the `'local'` fallback gated to `NODE_ENV !== 'production'`. Not relevant until there are multiple users.

---

### Client-Side Encryption

Feed content (title, author, content_preview, thumbnail_url, raw_json) is stored in plaintext. The architecture defines AES-256-GCM with PBKDF2 key derivation from a user passphrase — the server stores only ciphertext, the PWA decrypts client-side. Required for a hosted service where the operator should not be able to read user content. For personal self-hosted use where you control the server, this is optional.

---

## Summary

| # | Task | Tier |
|---|------|------|
| 1 | PWA icons (192×192 + 512×512) | Blocking |
| 2 | Preferences UI + API (blocked_keywords, retention, max_items) | Blocking |
| 3 | OAuth client management UI + API | High |
| 4 | Sync status per-source detail | High |
| 5 | Danger zone / feed data deletion | High |
| 6 | Saved tab empty state copy | High |
| 7 | Card thumbnails rendered | High |
| 8 | "All" tab unread count badge | Low |
| 9 | `vercel.json` pattern cleanup | Low |
| — | SQLite → Postgres | Multi-user only |
| — | Clerk user identity | Multi-user only |
| — | Client-side encryption | Multi-user only |
