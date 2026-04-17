# Architecture & Security Review — Round 2

Validation pass after the merges that closed out the first review. Read alongside the git log for PRs #70–#74.

Tests: `npm test` (81 passed) and `npm run test:server` (48 passed).

## Legend

- **Fixed** — change lands cleanly and addresses the root cause.
- **Partial** — mitigation is in, but the core risk is only narrowed, not eliminated.
- **Deferred** — intentionally unchanged; still relevant for the hosted roadmap.
- **Not fixed** — gap from round 1 that did not get picked up.

---

## Status of round-1 findings

| # | Finding | Status | Notes |
|---|---------|--------|-------|
| 1 | No device session token | **Fixed** | `device_sessions` table, `dsess_*` bearer tokens issued on verify, hash-stored (`api-routes.ts:98`, `:293`). |
| 2 | `usr_*` header bypass | **Fixed** | `getRequestUserId` only accepts `Bearer dsess_*`; non-prod falls back to `'local'` (`api-routes.ts:107`). |
| 3 | OAuth tokens stored plaintext | **Fixed** | Schema and all read/write paths in `oauth-routes.ts` use SHA-256 hashes; `db.ts:65` migrates old rows. |
| 4 | Enrollment token in client bundle | **Fixed** | `VITE_DEVICE_ENROLLMENT_TOKEN` is gone; token is entered at runtime and stored in IndexedDB (`main.tsx:49`, `device-session.ts:147`). |
| 5 | `free_device_rotation` global singleton | **Partial** | Schema PK is now `user_id`, but every callsite in `api-routes.ts` still hardcodes `'local'` (lines 104, 273, 279, 289). In hosted multi-user, two devices from different users would still contend for the same row. Fix the callsites before enabling Clerk. |
| 6 | Missing rate limits | **Partial** | OAuth scope capped at 20/min and agent/MCP scope at 60/hr. `/api/*` (including unauthenticated `/api/v1/device/register`, `/challenge`, `/verify`) has no limiter — an attacker can still pound the challenge endpoint. |
| 7 | No payload caps | **Fixed** | `items.length ≤ 200`, `url ≤ 2048`, `encrypted_fields ≤ 64 000`, per-user queue cap 500 (`agent-routes.ts:87`, `:135`, `:150`, `:165`). |
| 8 | Missing CSP / legacy XSS header | **Fixed** | `onSend` hook writes CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, HSTS in prod (`server/index.ts:159`). No `X-XSS-Protection` reintroduced. |
| 9 | SSE auth via unverified query param | **Fixed** | `/api/stream` requires `?token=dsess_*` resolved via `lookupSessionToken` (`api-routes.ts:121`, `:310`). |
| 10 | Preferences not hydrated to device | **Fixed** | `syncPreferencesToIdb()` runs on boot (`main.tsx:31`), retention reads from IDB. |
| 11 | Submit logic duplicated REST vs MCP | **Fixed** | Extracted `submitEncryptedPayload` (`agent-routes.ts:71`) used by both `POST /agent/feed-items` and the `submit_items` MCP tool. |
| 12 | MCP session TTL used `createdAt` | **Fixed** | `transports` map tracks `lastUsedAt`, refreshed per request; eviction runs every 10 min against a 1-hour idle window (`mcp.ts:73–85`, `:226`). |
| 13 | `GET /api/v1/tokens` returns `token_hash` | **Not fixed** | Row is returned verbatim (`api-routes.ts:596`). Hash exposure is not a credential compromise, but it lets anyone with UI access correlate/delete entries without authenticating as the token owner. Project just `id`, `label`, `created_at`, `last_used`. |
| 14 | `api-routes.ts` too large | **Not fixed** | Still 683 lines mixing device auth, sources, preferences, push, tokens, queue ack. Split into `device-routes.ts`, `sources-routes.ts`, `preferences-routes.ts`, `tokens-routes.ts`, `queue-routes.ts` when the next feature lands here. |
| 15 | Unused `DEFAULT_PREFERENCES` import | **Fixed** | `api-routes.ts` now imports only `readPreferences` and `sanitizeBlockedKeywords`. |
| 16 | `parseInt(JSON.parse(...))` round-trip | **Not fixed** | `agent-routes.ts:38` still does `parseInt(JSON.parse(prefs.get('max_items_per_source') ?? '50'), 10)`. Use `readPreferences(db, userId)` like the REST route — the helper already coerces to `number`. |
| 17 | SSE backpressure ignored | **Not fixed** | `SseManager.send()` writes synchronously without checking `reply.raw.write` return value or listening for `drain` (`sse-manager.ts:45`). Large payloads to a slow client will buffer unbounded in Node. |
| 18 | Claude CORS hardcoded | **Fixed** | Opt-out via `CLAUDE_CONNECTOR_CORS=false`; default keeps the connector workflow working (`server/index.ts:127`). |
| 19 | VAPID key stored under `'local'` only | **Deferred** | Still per-server, not per-user. Acceptable for self-hosted; revisit alongside Clerk migration. |
| 20 | `admin_password` brute-force risk | **Partial** | OAuth scope is now 20/min per IP — adequate for a single-user PoC. Before hosted launch, add a per-identity failure counter and backoff. |

---

## New findings from this pass

### N1 — `device_registrations.user_id` conflates user and device

`device-session.ts:129` mints `user_id = dev_<uuid>` and stores it both as the device record's `user_id` and as the primary key of `device_registrations`. Server-side, `/agent/*` auth maps an agent token to a `user_id` of `'local'`, while `/api/*` maps a session token to `dev_<uuid>`. As soon as a real user_id seam is added (Clerk, finding #5 follow-up), the `dev_*` values will need to migrate to a `device_id` column and a separate `user_id` foreign key. Track this in the same hosted-mode migration work as finding #5.

### N2 — Device sessions never rotate

The `dsess_*` token issued on verify lives for 30 days and is persisted in IndexedDB (`device-session.ts:281`). Nothing refreshes it before expiry, nothing revokes it on explicit sign-out, and `/api/*` has no `POST /device/logout`. A device that is lost stays authenticated for the full TTL. Add a logout endpoint (delete from `device_sessions`) and a refresh path so the UI doesn't dead-end when a token expires mid-session.

### N3 — `device_challenges` rows are never cleaned up

`cleanupGlobal` in `agent-routes.ts:235` purges free/paid queue rows, OAuth codes/tokens, and `sync_attempts`, but nothing deletes consumed or expired rows from `device_challenges` or `device_sessions`. Both tables will grow unbounded on a long-running server. Add a pair of `DELETE WHERE expires_at < now()` statements in the same cleanup pass.

### N4 — `X-Device-Enroll-Token` comparison uses different-length `timingSafeEqual` path

`hasValidEnrollmentToken` at `api-routes.ts:140` returns `false` early when lengths differ — which is correct, but the length comparison itself leaks the expected token length. Low severity because the token length is effectively public (config value), but note it if you ever harden the enrollment flow.

### N5 — Scraping notes injected verbatim into MCP resource text

`mcp.ts:162` appends `scraping_notes` to the resource body without any sanitisation. An untrusted user (in a future multi-tenant world) could embed prompt-injection instructions that the agent would execute. Not exploitable in the current single-user model but worth a comment here before the route surface expands.

### N6 — `seedOAuthClients` uses `INSERT OR REPLACE`

`oauth-routes.ts:14` re-seeds every startup, which wipes `is_active` flags an operator may have toggled (the column exists but there's no UI to toggle it yet). Prefer `INSERT OR IGNORE` or `INSERT ... ON CONFLICT(client_id) DO UPDATE SET redirect_uris = excluded.redirect_uris`.

---

## Suggested next pickups, in order

1. **Finish #5** — pass the real `user_id` into `resolveDeviceRotation` and the verify handler's rotation queries. Without this, the schema migration is cosmetic.
2. **Finding #13 + #17** — both are small, both sit on the boundary between PoC and hosted readiness.
3. **N3 (cleanup) + N2 (session rotation)** — operational cleanliness before any multi-user deployment.
4. **#6 rate limits on `/api/*`** — at minimum on the three unauthenticated device endpoints.
5. **#14** — split `api-routes.ts` when the next route lands there; no need to churn on it until then.
