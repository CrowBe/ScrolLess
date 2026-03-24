# ScrolLess

Personal feed aggregator. External AI agent scrapes platforms → POSTs to this server → PWA displays unified feed with push notifications. Server never talks to content platforms.

## Stack

- **Backend**: Node.js 20+, TypeScript, Fastify, better-sqlite3, web-push
- **Frontend**: Vite, **Preact** (not React, not preact/compat), TypeScript, plain CSS
- **DB**: SQLite via `schema.sql`

## Docs

- `ARCHITECTURE.md` — routes, auth, payload formats, schema, push, PWA
- `TASKS.md` — 11 sequential build stages; read this first, complete in order
- `DESIGN_SYSTEM.md` — color tokens, typography, component patterns (from Stitch screens)
- `SKILL.md` — agent scraping instructions (separate deliverable, not server code)

## Route Groups (keep separate)

```
/agent/*  →  Bearer token auth  →  server/agent-routes.ts
/api/*    →  no auth (PoC)      →  server/api-routes.ts
```

## Non-Obvious Rules (common mistakes)

- Every DB query needs `WHERE user_id = ?` (always `'local'` in PoC — production seam)
- URL dedup: normalise → SHA-256 → unique index on `(user_id, url_hash)` → `INSERT OR IGNORE`
- Agent auth: hash Bearer token with SHA-256, compare to `agent_tokens.token_hash`. Never store plaintext.
- Push: one notification per agent POST (grouped by source), not per item
- Cleanup uses `fetched_at`, not `published_at`; default `retention_days = 7`
- `tags` stored as JSON string `'["a","b"]'`, returned to frontend as parsed array
- `sync_log` is append-only — multiple rows per source, never update existing rows
- Service worker output must be `sw.js` at build root (not content-hashed)

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
curl -X POST http://localhost:3333/agent/feed-items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"youtube","items":[{"source_id":"abc123","title":"Test","url":"https://youtube.com/watch?v=abc123","published_at":"2026-03-23T10:00:00Z"}]}'
```
