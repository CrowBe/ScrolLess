# Pre-Release Tasks

ScrolLess is a deployable product with two supported modes:

- **Hosted** — multi-user, operator-blind, Postgres + Clerk + client-side encryption
- **Self-hosted** — single-user, owner-operated, SQLite, no auth middleware required

Tasks are tiered by deployment target. Hosted-mode tasks are required before any public launch. Self-hosted tasks must be done before distributing the open-source build.

---

## Tier 1 — Required for Hosted Launch

### Postgres Migration

The current implementation uses SQLite. SQLite is not suitable for a multi-user hosted deployment — it has no concurrent write support and no access controls.

**What to change:**

1. Replace `better-sqlite3` with `postgres` (or `pg`); update `server/db.ts`
2. Replace `datetime('now')` with `NOW()` — the only SQLite-specific construct in the schema
3. Replace `INSERT OR IGNORE` with `INSERT ... ON CONFLICT DO NOTHING`
4. Set `DATABASE_URL` env var; remove SQLite file path from config
5. Run schema on first deploy; confirm all indexes exist

SQLite remains the correct choice for self-hosted deployments — no change needed for that path.

---

### Clerk User Identity

Every `/api/*` route currently defaults to `user_id = 'local'`. A hosted deployment serving multiple users must resolve a real `user_id` from the Clerk session on every request. Without this, all users share the same data.

**What to change:**

1. Integrate `@clerk/fastify` (or equivalent); add session middleware to all `/api/*` routes
2. Gate the `'local'` fallback behind `NODE_ENV !== 'production'` — in hosted mode a missing session is a 401, not a silent fallback
3. On first login, seed `user_preferences` and `user_sources` for the new `user_id`
4. Bind agent token and OAuth token creation to the authenticated `user_id`

The `WHERE user_id = ?` scoping is already in every query — this is a seam, not a rewrite.

---

### Client-Side Encryption

Feed content (title, author, content_preview, thumbnail_url, raw_json) is stored and served in plaintext. A hosted service where the operator cannot read user content requires end-to-end encryption.

**Scheme:**
- Algorithm: AES-256-GCM
- Key derivation: PBKDF2(passphrase, user-specific salt, 100 000 iterations, SHA-256)
- Salt generated once per user, stored server-side in `user_preferences`
- Passphrase entered by the user, never sent to the server
- Each value stored as `base64(iv || ciphertext || authTag)`

**Fields to encrypt:** `title`, `author`, `content_preview`, `thumbnail_url`, `raw_json`

**Fields that must stay plaintext:** `source`, `published_at`, `tags`, `is_discovery`, `is_read`, `url`, `url_hash`

**What to change:**

1. Add `GET /api/encryption/salt` and `POST /api/encryption/salt` (one-time seed) to `server/api-routes.ts`
2. Agent: derive key before each run; encrypt content fields before calling `submit_items`
3. PWA: prompt for passphrase on first load; derive the same key via Web Crypto (`SubtleCrypto.deriveKey`); decrypt before rendering

No schema changes. The server never sees or cares about the plaintext.

Self-hosted deployments may skip encryption — the owner controls both the server and the data.

---

### OAuth Client Management UI

OAuth clients are currently seeded only from `config.json`. Users of the hosted product have no way to see which MCP clients are connected or revoke access without operator intervention.

**What to change:**

1. Add to `server/api-routes.ts`:
   - `GET /api/oauth/clients` — list registered clients for the current user
   - `POST /api/oauth/clients` — register a client (name, redirect URIs, public/confidential)
   - `DELETE /api/oauth/clients/:client_id` — revoke client and all its tokens

2. Add a "Connected Apps" section to `src/settings.tsx`

3. `config.json` bootstrap continues to seed first-party clients via `INSERT OR IGNORE`; all ongoing management goes through the API

---

## Tier 2 — Required for Both Hosted and Self-Hosted

### PWA Icons Missing

`src/icons/` contains only a README. `manifest.json` references `icon-192.png` and `icon-512.png` which do not exist. Without them the "Add to Home Screen" prompt uses a browser default icon and push notifications show no icon.

Generate or design two PNGs:
- `src/icons/icon-192.png` — 192×192
- `src/icons/icon-512.png` — 512×512

---

### Preferences Not Editable in UI

`blocked_keywords`, `retention_days`, and `max_items_per_source` drive agent behaviour but there is no UI or API to view or change them. Blocked keywords are applied silently on every sync.

**What to change:**

1. Add to `server/api-routes.ts`:
   - `GET /api/preferences` — return all keys as an object
   - `PATCH /api/preferences` — accept partial update

2. Add a Preferences section to `src/settings.tsx` with inputs for each key

---

### Danger Zone / Data Deletion

No way to clear feed data or reset preferences from the UI. Currently requires manual database access.

**What to change:**

1. Add `DELETE /api/data` to `server/api-routes.ts` — deletes all `feed_items` and `sync_log` rows for the user, resets preferences to defaults
2. Add a Danger Zone section to `src/settings.tsx` with a confirmation-gated button

---

### Card Thumbnails Not Rendered

`thumbnail_url` is stored and returned in the API but none of the three card components display it. YouTube cards without thumbnails are significantly harder to scan.

Each card should render the thumbnail in its collapsed state:
- `youtube-card.tsx` — thumbnail left of title
- `news-card.tsx` — thumbnail in expanded state
- `x-card.tsx` — inline if `thumbnail_url` is set

---

### Saved Tab Empty State Copy

When the Saved tab is empty it shows "No items yet — Items will appear here once the agent syncs", which is wrong context for a bookmarks view.

Fix the empty state in `feed-list.tsx` to be view-aware: for the Saved view, show "No saved items yet — tap the bookmark icon on any card to save it for later."

---

### Sync Status Per-Source Detail

The header widget shows a single "Synced X ago" (most recent across all sources). If one source errored or stalled, this is invisible.

Add per-source sync detail — either an expandable panel in `SyncStatus` or a table in the Settings screen — showing each source's `synced_at`, `items_added`, and last error.

---

## Tier 3 — Low Priority

### "All" Tab Missing Unread Count Badge

The source filter "All" tab has no unread badge. The aggregate unread total is fetched via `GET /api/stats` but not rendered on the tab.

---

### `vercel.json` Rewrite Pattern

The current pattern `/((?!api/).*)` excludes only `/api/` paths. In split-hosting the Vercel frontend never receives `/agent/`, `/mcp`, or `/oauth/` requests (those go to Render), so this is cosmetic rather than a bug. Clean it up for correctness:

```json
{ "rewrites": [{ "source": "/((?!api/|agent/|mcp|oauth/).*)", "destination": "/index.html" }] }
```

---

## Summary

| # | Task | Applies to |
|---|------|------------|
| 1 | Postgres migration | Hosted only |
| 2 | Clerk user identity | Hosted only |
| 3 | Client-side encryption | Hosted only |
| 4 | OAuth client management UI | Hosted only |
| 5 | PWA icons | Both |
| 6 | Preferences UI + API | Both |
| 7 | Danger zone / data deletion | Both |
| 8 | Card thumbnails | Both |
| 9 | Saved tab empty state | Both |
| 10 | Sync status per-source detail | Both |
| 11 | "All" tab unread count | Both |
| 12 | `vercel.json` pattern | Both |
