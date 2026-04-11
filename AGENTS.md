# AGENTS.md

ScrolLess project memory for Ben + Ro. Keep this concise, durable, and hard to misread.

## Purpose

ScrolLess is an edge-first feed aggregator.

Flow:
- external agent gathers items from source platforms
- agent encrypts content fields client-side
- agent submits ciphertext to ScrolLess server
- server relays ciphertext to device
- device stores content in IndexedDB and renders the feed

Core product promise: the server is a relay and coordinator, not a readable content backend.

## Architectural guardrails

- Server never stores readable feed content.
- Content lives on device in IndexedDB.
- Agent encrypts content before submission.
- Server handles ciphertext, metadata, routing, auth, queueing, and push.
- Preserve the tier seam: `local`, `dev_*`, and `usr_*` identities should differ mainly in auth and delivery semantics, not require route rewrites.
- Prefer changes that keep self-hosted and hosted paths structurally aligned.

If a change pressures ScrolLess toward "server as source-of-truth content store", stop and re-check `docs/ARCHITECTURE.md` and `docs/TIER_CONTRACT.md`.

## Source of truth

Read these when relevant:
- `docs/ARCHITECTURE.md` for system design and route/data flow
- `docs/TIER_CONTRACT.md` for free/paid behavior and queue/device rules
- `docs/pre-release-tasks.md` for remaining launch work
- `docs/TASKS.md` for roadmap/status
- `skill/SKILL.md` for agent-side scraping/encryption contract

Code is the truth for current implementation details. Avoid copying volatile facts here.

## Repo workflow

- Use branch + PR workflow. Do not work directly on protected `main`.
- Start from a freshly updated local `main` matching `origin/main`.
- Create a clearly named branch per task.
- Prefer one issue/PR-sized change at a time.
- If repo state is stale or mixed, reset and branch again rather than stacking confusion.

## Implementation guidance

- Keep route groups separate:
  - `/agent/*` in `server/agent-routes.ts`
  - `/mcp` in `server/mcp.ts`
  - `/oauth/*` in `server/oauth-routes.ts`
  - `/api/*` in `server/api-routes.ts`
- Put shared parsing/default logic in dedicated modules when route files start growing.
- Prefer explicit tests for behavior changes in both client and server where applicable.
- Fix the seam, not just the symptom. If a bug reflects drift between docs, tests, and implementation, align all three.

## Data and state ownership

Default ownership model:
- server DB: identities, tokens, source config, sync metadata, delivery/queue metadata, push subscriptions
- device IndexedDB: feed items, local read/save state, retention behavior, decrypted display state
- agent: source-specific fetch logic and encryption before submit

Do not casually move client state onto the server just because it is convenient.

## Current priorities

Prefer work in this order:
1. architecture clarification and state-boundary hardening
2. product usability improvements
3. docs accuracy
4. tests and maintenance reliability

Issue `#54` is the current architecture-focused thread unless a newer issue supersedes it.

## Testing

Useful commands:
- `npm test`
- `npm run test:server`
- `npm run test:all`
- `npm run build`

Run the smallest relevant verification while iterating, then run broader checks before handing off substantial changes.

## Notes for future AGENTS files

If a directory develops special rules, add a nested `AGENTS.md` there instead of bloating this file.
Likely candidates over time:
- `server/AGENTS.md` for auth, queue, and route conventions
- `src/AGENTS.md` for PWA, IndexedDB, and UI state conventions
- `skill/AGENTS.md` for agent payload and scraping contract details
