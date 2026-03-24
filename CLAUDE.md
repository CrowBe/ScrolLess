# CLAUDE.md

This file provides context for coding agents working on this repository.

## What This Is

A personal feed aggregator where an external AI agent (Cowork, Claude Code, OpenClaw, etc.) scrapes content from platforms via browser automation, POSTs it to this server, and a PWA serves it as a unified feed with push notifications. The server is deliberately simple — it stores data, serves it, and sends push notifications. It never communicates with YouTube, X, or any content platform.

## Key Documents

- **`README.md`** — Project overview, architecture diagram, quick start
- **`docs/ARCHITECTURE.md`** — Full system design: route groups, agent auth, payload formats, schema, push, PWA, and production seams
- **`docs/TASKS.md`** — 11 sequential build stages with acceptance criteria
- **`skill/SKILL.md`** — Agent scraping instructions (separate deliverable, not part of the server)

**Read `docs/TASKS.md` to find the current implementation stage.** Complete stages sequentially.

## Stack

- **Backend**: Node.js 20+, TypeScript, Fastify, better-sqlite3, web-push
- **Frontend**: Vite, Preact (NOT React — use native Preact API, not preact/compat), TypeScript
- **PWA**: Service worker for push + offline cache, web app manifest
- **No CSS framework** — plain CSS with custom properties
- **No upstream API calls** — the server makes zero external HTTP requests (except to push services for notifications)

## Two Route Groups — Keep Them Separate

```
/agent/*  → Bearer token auth → used by the scraping agent
/api/*    → no auth (PoC)     → used by the PWA frontend
```

These are in separate files: `server/agent-routes.ts` and `server/api-routes.ts`. Do not merge them.

## Important Constraints

- Every database query must include `WHERE user_id = ?` even though it's always `'local'` in PoC. This is a production seam.
- URL deduplication: normalise → SHA-256 → unique index on `(user_id, url_hash)` → `INSERT OR IGNORE`
- The server normalises URLs on insert. The agent doesn't need to.
- Agent token auth: hash the Bearer token with SHA-256, compare against `agent_tokens.token_hash`. Never store plaintext tokens.
- Push notifications: one per agent POST (grouped by source), not per item.
- Feed items are deleted after `retention_days` (default 7, from `user_preferences` table). Cleanup uses `fetched_at`, not `published_at`.
- The service worker (`sw.js`) must be at the root of the build output, not hashed.
- `tags` field in `feed_items` is stored as a JSON string (`'["tech","ai"]'`), returned to the frontend as a parsed array.
- `sync_log` is append-only (multiple entries per source), not one-row-per-source.

## File Layout

```
server/          — Backend (TypeScript, runs via tsx)
  agent-routes.ts  — /agent/* endpoints (agent auth required)
  api-routes.ts    — /api/* endpoints (PWA frontend)
  auth.ts          — Token hashing + verification
  push.ts          — Web Push sender
  db.ts            — SQLite init + helpers
  types.ts         — Shared TypeScript types
  index.ts         — Entry point: wires everything together
src/             — Frontend (Preact + TypeScript PWA)
sql/             — SQL schema
skill/           — Agent skill (separate from server, for Cowork/Claude Code)
docs/            — Architecture, tasks, deployment docs
```

## Running

```bash
npm run dev:server   # Backend on :3333
npm run dev:client   # Vite on :5173
npm run dev          # Both concurrently
npm run build        # Production frontend build
npm start            # Production: serves built PWA + API
```

## Testing Agent Endpoints

```bash
# POST feed items
curl -X POST http://localhost:3333/agent/feed-items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"youtube","items":[{"source_id":"abc123","title":"Test Video","url":"https://youtube.com/watch?v=abc123","published_at":"2026-03-23T10:00:00Z"}]}'

# Check state
curl http://localhost:3333/agent/state \
  -H "Authorization: Bearer YOUR_TOKEN"
```
