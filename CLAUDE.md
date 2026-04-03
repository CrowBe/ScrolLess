# ScrolLess

Feed aggregator — edge-first architecture with two service tiers. External AI agent scrapes platforms → encrypts content → POSTs to this server → server relays to device → PWA stores in IndexedDB and displays unified feed with push notifications. Server never stores feed content and never talks to content platforms.

**Service tiers:**
- **Free**: Device-identity (UUID), edge storage (IndexedDB), best-effort relay, no user accounts
- **Paid**: Account-based identity, multi-device sync, encrypted relay queue for guaranteed delivery
- **Self-hosted**: SQLite + no auth middleware (single-user, owner-operated, unchanged)

**Privacy model:** Agent encrypts all content fields before POSTing. Server stores and relays ciphertext only. Content is decrypted by the device after delivery. Operator is blind to feed content in all tiers.

## Stack

- **Backend**: Node.js 20+, TypeScript, Fastify, better-sqlite3, web-push, @modelcontextprotocol/sdk
- **Frontend**: Vite, **Preact** (not React, not preact/compat), TypeScript, plain CSS, Web Crypto API
- **DB (server)**: SQLite — device registrations, source configs, sync attempt log, push subscriptions, OAuth tables. No feed content.
- **DB (device)**: IndexedDB — feed items (decrypted for display), sync log, preferences

## Docs

- `docs/ARCHITECTURE.md` — tiers, routes, delivery, crypto scheme, schema, push, PWA
- `docs/TASKS.md` — sequential build stages; read this first, complete in order
- `docs/DESIGN_SYSTEM.md` — color tokens, typography, component patterns (from Stitch screens)
- `docs/design/` — reference designs and screen PNGs
- `skill/SKILL.md` — agent scraping and encryption instructions (separate deliverable, not server code)
- `skill/resources/` — per-platform scraping notes and agent payload schema

## Route Groups (keep separate)

```
/agent/*  →  Bearer token auth          →  server/agent-routes.ts
/mcp      →  Bearer or OAuth token auth →  server/mcp.ts
/oauth/*  →  public (auth server)       →  server/oauth-routes.ts
/api/*    →  device/account auth        →  server/api-routes.ts
```

## Non-Obvious Rules (common mistakes)

- `user_id` is `'local'` (self-hosted), a device UUID `dev_*` (free tier), or an account ID `usr_*` (paid tier). The seam is in auth middleware — route handlers never care which.
- Every DB query needs `WHERE user_id = ?` — applies to all three identity modes.
- **Server never stores feed content.** `feed_items` lives in IndexedDB on device, not on the server.
- **Agent MUST encrypt** all content fields before POST using the device's public key (ECIES P-256 + AES-256-GCM). Public key is returned in `GET /agent/sync-context` under `encryption.public_key`.
- URL dedup is **client-side**: device checks IndexedDB for existing `url_hash` before storing a delivered item.
- Data retention is **client-side**: periodic IndexedDB cleanup using `preferences.retention_days`.
- `sync_attempts` replaces `sync_log` on the server — stores delivery metadata only (no content). Full sync log lives in IndexedDB.
- Agent receives `HTTP 503 { "error": "device_offline" }` when relay fails. Agent must **not** advance its `last_sync` window on 503 — retry the same window on next run.
- `last_sync_at` in `user_sources` is updated only on successful relay (200). Never updated on 503.
- `blocked_sources` is gone — use `user_sources.enabled = 0`. Never add `blocked_sources` back.
- MCP resources are served from `skill/resources/{name}.md` — keep in sync with any source added to the UI.
- Push: one notification per agent POST (grouped by source), not per item.
- Cleanup uses `fetched_at` in IndexedDB, not `published_at`; default `retention_days = 7`.
- `tags` stored as JSON string `'["a","b"]'` in IndexedDB, returned to components as parsed array.
- `sync_attempts` is append-only — multiple rows per source, never update existing rows.
- Service worker output must be `sw.js` at build root (not content-hashed).

## Dev Commands

```bash
npm run dev          # backend :3333 + Vite :5173
npm run dev:server   # backend only
npm run dev:client   # Vite only
npm run build        # production frontend build
npm start            # serves built PWA + API
```

## Quick Agent Test

```bash
# 1. Register a device and get an agent token (one-time setup)
curl -X POST http://localhost:3333/api/device/register \
  -H "Content-Type: application/json" \
  -d '{"device_id":"dev_test123","public_key":"BASE64_PUBLIC_KEY"}'

# 2. Post encrypted items (agent encrypts content fields before sending)
curl -X POST http://localhost:3333/agent/feed-items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "youtube",
    "ephemeral_public_key": "BASE64_EPHEMERAL_KEY",
    "items": [{
      "source_id": "abc123",
      "url": "https://youtube.com/watch?v=abc123",
      "published_at": "2026-03-23T10:00:00Z",
      "encrypted_fields": "BASE64_IV_CIPHERTEXT_TAG"
    }]
  }'
```
