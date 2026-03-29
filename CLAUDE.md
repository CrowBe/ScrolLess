# ScrolLess

Personal feed aggregator. External AI agent scrapes platforms → POSTs to this server → PWA displays unified feed with push notifications. Server never talks to content platforms.

## Stack

- **Backend**: Node.js 20+, TypeScript, Fastify, better-sqlite3, web-push, @modelcontextprotocol/sdk
- **Frontend**: Vite, **Preact** (not React, not preact/compat), TypeScript, plain CSS
- **DB**: SQLite via `sql/schema.sql`

## Docs

- `docs/ARCHITECTURE.md` — routes, auth, payload formats, schema, push, PWA
- `docs/TASKS.md` — 13 sequential build stages; read this first, complete in order
- `docs/DESIGN_SYSTEM.md` — color tokens, typography, component patterns (from Stitch screens)
- `docs/design/` — reference designs and screen PNGs
- `skill/SKILL.md` — agent scraping instructions (separate deliverable, not server code)
- `skill/resources/` — per-platform scraping notes and agent payload schema

## Route Groups (keep separate)

```
/agent/*  →  Bearer token auth          →  server/agent-routes.ts
/mcp      →  Bearer or OAuth token auth →  server/mcp.ts
/oauth/*  →  public (auth server)       →  server/oauth-routes.ts
/api/*    →  session auth (Clerk)       →  server/api-routes.ts
```

## Non-Obvious Rules (common mistakes)

- Every DB query needs `WHERE user_id = ?` (always `'local'` in PoC — production seam)
- URL dedup: normalise → SHA-256 → unique index on `(user_id, url_hash)` → `INSERT OR IGNORE`
- Agent auth: two valid paths — Bearer token (hash with SHA-256, compare to `agent_tokens.token_hash`) or OAuth access token (validate against `oauth_tokens` table). Both resolve to a `userId`; route handlers never care which was used.
- `blocked_sources` is gone — use `user_sources.enabled = 0` instead. Never add `blocked_sources` back as a preference key.
- MCP resources are served from `skill/resources/{name}.md` — keep those files in sync with any source added to the UI.
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
