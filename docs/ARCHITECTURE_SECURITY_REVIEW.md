# Architecture & Security Review — April 2026

Review scope: `/server`, `/src`, `/sql`, `/docs` on branch `claude/review-architecture-security-hgV02`.
Each finding is self-contained so it can be picked up individually in a future session.

---

## Critical

### ~~1. `/api/*` has no real device authentication~~ ✅ Fixed

- **Files**: `server/api-routes.ts`, `src/bootstrap/device-session.ts`, `src/api.ts`, `sql/schema.sql`
- **Fix applied** (branch `claude/security-review-task-one-F60fP`):
  - `POST /api/v1/device/verify` now issues a 30-day `dsess_*` bearer token (hash stored in new `device_sessions` table).
  - `getRequestUserId` requires `Authorization: Bearer dsess_*` for `dev_*` devices; `X-Device-Id` is no longer honoured as an auth credential for device identities.
  - Client (`device-session.ts`) generates a separate ECDSA signing keypair, runs challenge/verify on startup, persists the session token in IndexedDB, and attaches it via `Authorization` header on all API calls and as `?token=` on the SSE stream.
  - `src/api.ts` switched from `X-Device-Id` to `Authorization: Bearer`.
- **Seam alignment**: matches `docs/TIER_CONTRACT.md §4` — "cryptographic proof is authoritative, X-Device-Id is a routing hint."

### 2. Unauthenticated `usr_*` acceptance

- **File**: `server/api-routes.ts:82-84`
- **Problem**: if the `X-Device-Id` header starts with `usr_`, the request is authorized with no DB check. Pre-wires the paid tier but is an auth bypass today.
- **Fix sketch**: require `usr_*` ids to resolve against a real account/session (Clerk integration from `docs/pre-release-tasks.md` Tier 1).

### 3. OAuth access + refresh tokens stored as plaintext

- **Files**: `server/oauth-routes.ts:260-323`, `server/auth.ts:31-43`
- **Problem**: `oauth_tokens.access_token` and `refresh_token` are written and compared in the clear. A read-only SQLite leak yields working bearer tokens.
- **Fix sketch**: hash tokens on issue (`createHash('sha256').update(token).digest('hex')`), store the hash, and look up by hash. Mirror the existing `agent_tokens.token_hash` model. Update `verifyAgentToken` and both grant handlers in `oauth-routes.ts`.

### 4. `VITE_DEVICE_ENROLLMENT_TOKEN` is in the client bundle

- **File**: `src/config.ts:20-26`
- **Problem**: Vite exposes `VITE_*` env vars to browser JS. The "enrollment gate" is readable by any visitor and provides no real protection in a hosted deployment.
- **Fix sketch**: either drop the client-side reference and expect the user to paste it once during onboarding, or remove enrollment gating entirely in favour of the challenge/verify handshake (#1).

### 5. `free_device_rotation` is a global singleton

- **Files**: `sql/schema.sql:24-30`, `server/api-routes.ts:276-295`
- **Problem**: `scope_id = 1` means *all users* share one active-device row. User B verifying demotes user A's device into the "previous" slot.
- **Scope**: only correct for `user_id = 'local'` self-hosted.
- **Fix sketch**: change the primary key to `user_id`, update both `SELECT`/`INSERT`/`UPDATE` sites to pass the caller's `user_id`, write a migration that seeds a row for each existing user.

---

## High

### 6. No rate limiting on `/api/*` or `/oauth/*`

- **File**: `server/index.ts:195-212`
- **Problem**: the rate-limit plugin is only registered inside the agent/MCP scope. `/oauth/authorize` POST brute-forces `admin_password`, `/oauth/token` brute-forces PKCE codes, and `/api/v1/device/register` is free to spam.
- **Fix sketch**: add a second scoped plugin (or global with `skipOnError`) that rate-limits the OAuth and device routes. Keep the agent/MCP scope's stricter limit.

### 7. No explicit size caps on agent payloads

- **File**: `server/agent-routes.ts:80-143`
- **Problem**: `POST /agent/feed-items` accepts arbitrary `items.length` and arbitrary `encrypted_fields`/`url` lengths. `free_queue_deliveries` has no per-user cap either. A single authenticated agent can fill disk and memory.
- **Fix sketch**:
  - convert validation to zod: `z.array(itemSchema).max(200)`, `z.string().max(64_000)` for `encrypted_fields`, `z.string().max(2048)` for `url`.
  - add a per-user cap on `free_queue_deliveries` rows before `INSERT`.
  - consider setting Fastify `bodyLimit` explicitly instead of relying on the default 1 MB.

### 8. No Content-Security-Policy; `X-XSS-Protection` is deprecated

- **File**: `server/index.ts:156-165`
- **Problem**: the OAuth consent screen (`server/oauth-routes.ts:105-147`) is the highest-exposure HTML page and has no CSP. `X-XSS-Protection` is ignored by all modern browsers.
- **Fix sketch**: drop `X-XSS-Protection`, add `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`. Tighten further on the consent page (disallow inline styles once extracted to a CSS file).

### 9. SSE auth via query string

- **Files**: `src/bootstrap/device-session.ts:220`, `server/api-routes.ts:122-134`
- **Problem**: `device_id` ends up in access logs and `Referer` headers. EventSource can't set headers, but a one-shot signed stream token (issued by `/api/v1/device/verify`) would remove the identifier-as-credential pattern from log storage.
- **Fix sketch**: add `GET /api/stream?token=<signed_nonce>`; server validates and discards the nonce. Pairs naturally with #1.

---

## Medium

### 10. Preferences storage mismatch (silent correctness bug)

- **Files**: `src/retention.ts:12`, `src/settings.tsx` (calls `updatePreferences`)
- **Problem**: `runRetentionCleanup` reads `retention_days` from the client IDB `preferences` store, but nothing in the codebase ever writes to that store. Settings persists via `updatePreferences` to the *server* DB. User-configured retention is silently ignored on device — always defaults to 7 days.
- **Fix sketch (option A)**: on app boot, `GET /api/preferences` and write the result into IDB `preferences`. Keep `retention.ts` as-is.
- **Fix sketch (option B, cleaner)**: delete the IDB `preferences` store and have `retention.ts` hit `/api/preferences` directly. Saves a round of sync logic.

### 11. Submit-items duplication

- **Files**: `server/agent-routes.ts:80-143` and `server/mcp.ts:107-156`
- **Problem**: validation, SSE relay, queue insert, push callback, and `last_sync_at` update are duplicated. Any fix in one will drift from the other.
- **Fix sketch**: extract `submitEncryptedPayload(db, userId, payload, sseManager, pushCallback): Promise<{ relayed?: number; queued?: number; queue_ttl_minutes?: number }>` in `server/agent-routes.ts` and call it from both places.

### 12. MCP session TTL uses `createdAt`, not last-used

- **File**: `server/mcp.ts:74-86`
- **Problem**: active sessions are evicted 60 min after creation regardless of activity.
- **Fix sketch**: bump `createdAt` (rename to `lastUsedAt`) on each `handleRequest`.

### 13. Agent token hashes exposed via API

- **File**: `server/api-routes.ts:580-588`
- **Problem**: `GET /api/v1/tokens` returns `token_hash`. It isn't a login credential alone, but it's the DB primary key, so exposing it couples internals to clients.
- **Fix sketch**: return an opaque `id` instead (add `INTEGER PRIMARY KEY AUTOINCREMENT` column or use a random `tok_<uuid>` identifier), and accept that opaque id on `DELETE /api/v1/tokens/:id`.

### 14. `server/api-routes.ts` is doing too much

- **File**: `server/api-routes.ts` (~670 lines)
- **Problem**: devices, preferences, push, sources, tokens, and queue ACK in one file. The auth surface is harder to audit.
- **Fix sketch**: split into `device-routes.ts`, `source-routes.ts`, `token-routes.ts`, `preferences-routes.ts`, `push-routes.ts`. Register all from `server/index.ts`.

---

## Low / cleanup

### 15. Dead import

- `server/api-routes.ts:6` imports `DEFAULT_PREFERENCES`, never uses it. Remove.

### 16. Redundant parse round-trip

- `server/preferences.ts:39-40`: `Number.parseInt(String(JSON-parsed value))`. If the stored JSON is already a number, a direct numeric-ish check is cleaner.

### 17. SSE backpressure ignored

- `server/sse-manager.ts:45-53`: ignores the boolean return of `write()`. For large encrypted payloads this can silently drop data on slow clients. Respect backpressure or switch to `res.flushSync`-style handling.

### 18. Hardcoded Claude origins in CORS

- `server/index.ts:125-130`: `https://claude.ai` and `https://www.claude.ai` are always in the allowlist. Self-hosters who don't use Claude connectors should be able to opt out. Promote to a config flag.

### 19. `/api/push/vapid-key` reads from `user_id = 'local'`

- `server/api-routes.ts:443-450`: VAPID key is stored in `user_preferences` keyed to `'local'` and served to any user. Leaks the tier seam.
- **Fix sketch**: introduce a `server_config` kv table or serve from in-memory `config.push.vapid_public_key`.

### 20. `admin_password` has no lockout or audit trail

- `server/oauth-routes.ts:181-188`: timing-safe compare is fine, but there's no rate limit, no lockout, and no log of attempts. Pair with #6 before any hosted launch.

---

## Tier-seam observations (matches `docs/TIER_CONTRACT.md`)

- #1 is the concrete way to honour "cryptographic proof is authoritative."
- `paid_queue_deliveries` supports per-device delivery; `free_queue_deliveries` has no `device_id`. Migrating free → paid will need a delivery-per-device backfill — worth a line in `docs/TASKS.md`.
- Content-store promise is intact today. The one place that could erode it is `free_queue_deliveries.payload_envelope` — make sure logs never include it and any multi-tenant migration keeps it encrypted.

---

## Suggested tackling order

1. Device auth (#1) + `usr_*` handling (#2) — same bug class.
2. Hash OAuth tokens (#3); remove `VITE_DEVICE_ENROLLMENT_TOKEN` from bundle (#4).
3. Scope `free_device_rotation` by user (#5) — prerequisite for paid tier.
4. Rate limits on `/api/*` + `/oauth/*` (#6); payload caps on `/agent/feed-items` (#7).
5. Retention preferences mismatch (#10) — silent correctness bug.
6. Everything else is best-effort cleanup.
