# Implementation Tasks

This document breaks the feed aggregator build into discrete stages. Each stage is self-contained: a coding agent should be able to complete any stage given only this document, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, and the code produced by prior stages.

Stages are ordered by dependency. Complete them sequentially.

---

## Stage 1: Project Scaffolding

**Goal**: Set up the monorepo structure, TypeScript config, dev tooling, and verify everything builds and runs.

### Task 1.1: Initialise project and install dependencies

Create `package.json` with the following dependencies:

**Runtime dependencies**:
- `better-sqlite3` — SQLite driver
- `fastify` — HTTP server
- `@fastify/static` — serve built frontend in production
- `@fastify/cors` — CORS for dev (Vite on different port)
- `@fastify/rate-limit` — rate limiting on agent endpoints
- `web-push` — Web Push notifications (VAPID)
- `preact` — UI framework
- `tsx` — run TypeScript backend directly

**Dev dependencies**:
- `typescript`
- `@types/better-sqlite3`
- `@types/node`
- `vite`
- `@preact/preset-vite`
- `concurrently` — run backend + frontend dev servers together

Configure `package.json` scripts:
- `dev:server` — run `server/index.ts` via `tsx --watch`
- `dev:client` — run `vite` dev server
- `dev` — run both via `concurrently`
- `build` — `vite build`
- `start` — `NODE_ENV=production tsx server/index.ts`
- `generate-token` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Set `"type": "module"` in `package.json`.

### Task 1.2: TypeScript configuration

Create `tsconfig.json` for the backend (Node.js target, ESM modules, strict mode).

Create `tsconfig.app.json` that extends the base config for the frontend (Preact JSX pragma, DOM lib).

Key settings:
- `"target": "ES2022"`
- `"module": "ESNext"`, `"moduleResolution": "bundler"`
- `"strict": true`
- `"jsxImportSource": "preact"` (in the frontend config)

### Task 1.3: Vite configuration

Create `vite.config.ts`:
- Use `@preact/preset-vite` plugin
- Set `root` to `./src` (frontend source)
- Configure dev server proxy: `/api/*` → `http://localhost:3333`
- Build output to `./dist/client`

### Task 1.4: Create directory structure

Populate with placeholder files:
- `server/index.ts` — `console.log('server starting')`
- `src/index.html` — basic HTML shell with `<div id="app">`
- `src/main.tsx` — render a "hello world" Preact component
- `src/manifest.json` — minimal valid PWA manifest
- `sql/schema.sql` — empty placeholder
- `config.example.json` — see ARCHITECTURE.md for structure

### Acceptance criteria
- `npm run dev:server` starts without errors and logs a message
- `npm run dev:client` opens a browser with the hello world component
- `npm run dev` runs both concurrently
- TypeScript compilation has no errors

---

## Stage 2: Database Layer

**Goal**: Implement SQLite initialisation, schema, and helper functions.

### Task 2.1: Schema file

Create `sql/schema.sql` with all tables as specified in ARCHITECTURE.md:
- `feed_items` (with all indexes, including composite unique on `user_id, url_hash`)
- `user_sources` — user-configured scraping sources (name, enabled, urls JSON, max_items, scraping_notes)
- `agent_tokens`
- `sync_log`
- `push_subscriptions`
- `user_preferences`
- `oauth_clients`, `oauth_auth_codes`, `oauth_tokens` — OAuth 2.0 tables

Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout.

### Task 2.2: Database module

Create `server/db.ts`:

**`initDb(dbPath?: string): Database`**
- Default path: `~/.feed-aggregator/feed.db`
- Create parent directory if missing
- Open with `better-sqlite3`
- Set pragmas: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`
- Execute `sql/schema.sql`
- Seed default `user_preferences` if not present (for `user_id = 'local'`):
  - `blocked_keywords`: `[]`
  - `max_items_per_source`: `50`
  - `retention_days`: `7`
  - Note: do **not** seed `blocked_sources` — per-source enable/disable lives in `user_sources.enabled`
- Seed default `user_sources` rows if not present (for `user_id = 'local'`):
  - `youtube` — `enabled = 0`, `urls = '["https://www.youtube.com/feed/subscriptions"]'`
  - `x` — `enabled = 0`, `urls = '["https://x.com/home"]'`
  - `news` — `enabled = 0`, `urls = '["https://news.ycombinator.com","https://arstechnica.com"]'`
- Return database instance

**`normaliseUrl(raw: string): string`**
- Lowercase hostname
- Remove tracking params: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `s`, `ref`, `feature`
- Normalise `youtu.be/X` → `https://www.youtube.com/watch?v=X`
- Sort remaining query parameters alphabetically
- Strip trailing slashes
- On parse failure, return input unchanged

**`hashUrl(url: string): string`**
- SHA-256 hash, returned as hex

### Task 2.3: Shared types

Create `server/types.ts`:
- `AgentFeedPayload` — `{ source, items: AgentFeedItem[] }`
- `AgentFeedItem` — as specified in ARCHITECTURE.md
- `AgentFeedResponse` — `{ inserted, duplicates }`
- `AgentSyncContext` — full response shape of `GET /agent/sync-context` (see ARCHITECTURE.md for exact fields)
- `AppConfig` — typed `config.json` structure

Create `src/types.ts` for frontend:
- `FeedItemResponse` — shape returned by `GET /api/feed` per item
- `FeedResponse` — `{ items, total, limit, offset }`
- `Stats` — `{ total, unread, by_source }`
- `SyncLogEntry` — `{ source, synced_at, items_added, error }`
- `PushPayload` — `{ title, body, source, count, url }`

### Acceptance criteria
- `initDb()` creates `~/.feed-aggregator/feed.db` with all tables including `user_sources` and OAuth tables
- Default preferences are seeded (no `blocked_sources` key)
- Default `user_sources` rows seeded for youtube, x, news — all with `enabled = 0`
- `normaliseUrl('https://youtu.be/abc?utm_source=twitter')` returns `'https://www.youtube.com/watch?v=abc'`
- `hashUrl` returns a consistent 64-character hex string

---

## Stage 3: Agent Authentication

**Goal**: Implement agent token verification and setup.

### Task 3.1: Auth module

Create `server/auth.ts`:

**`hashToken(token: string): string`**
- SHA-256 hash of the token, hex-encoded

**`verifyAgentToken(db: Database, token: string): { valid: boolean, userId: string | null }`**
- Hash the incoming token
- Look up in `agent_tokens` table
- If found: update `last_used` timestamp, return `{ valid: true, userId: row.user_id }`
- If not found: return `{ valid: false, userId: null }`

**`seedAgentToken(db: Database, tokenHash: string, label?: string): void`**
- Insert a row into `agent_tokens` with `user_id = 'local'` and the provided hash
- Used at startup to ensure the configured token is in the database

### Task 3.2: Fastify auth hook

Create a Fastify `preHandler` hook for agent routes:
- Extract `Authorization: Bearer <token>` from the request header
- Call `verifyAgentToken()`
- If invalid: reply 401 `{ error: "Invalid agent token" }`
- If valid: attach `userId` to the request for downstream route handlers

### Task 3.3: Setup and entry point wiring

Update `server/index.ts`:
- Read `config.json`
- On startup: call `seedAgentToken(db, config.agent_token_hash)` to ensure the token is in the database
- Log a clear message if `agent_token_hash` is not configured

Update `config.example.json`:
```json
{
  "agent_token_hash": "",
  "db_path": "~/.feed-aggregator/feed.db",
  "server": { "port": 3333, "host": "127.0.0.1" },
  "push": { ... },
  "rate_limit": { "agent_max_per_hour": 60 }
}
```

### Acceptance criteria
- A request to `/agent/state` without a token returns 401
- A request with an invalid token returns 401
- A request with the correct token returns 200
- `last_used` is updated on each successful auth

---

## Stage 4: Agent Endpoints

**Goal**: Implement the `/agent/*` routes that the scraping agent uses.

### Task 4.1: POST /agent/feed-items

Create `server/agent-routes.ts`:

Accept `AgentFeedPayload` in the request body. For each item:
1. Construct the internal `id`: `"${payload.source}:${item.source_id}"`
2. Normalise the URL (using `normaliseUrl`)
3. Hash the normalised URL
4. Execute `INSERT OR IGNORE` into `feed_items` with `user_id` from the auth hook
5. Track inserted vs duplicated counts

After all inserts:
- Insert a row into `sync_log` with the results
- If any items were inserted, trigger push notifications (via a callback — push is wired in Stage 6)
- Return `{ inserted, duplicates }`

**Validation**:
- `source` is required, non-empty string
- `items` is required, must be an array
- Each item must have `source_id`, `title`, `url`, `published_at`
- `published_at` must be a valid ISO 8601 string
- `tags` if present must be an array of strings
- Return 400 with descriptive errors for invalid payloads

**Rate limiting**: Apply `@fastify/rate-limit` to agent routes (default: 60 req/hour per token).

### Task 4.2: GET /agent/sync-context

Replace the old two-call workflow (`GET /agent/state` + `GET /agent/preferences`) with a single endpoint.

Return everything an agent needs to plan a scraping run:

```typescript
// Response shape (see ARCHITECTURE.md for full definition)
{
  sources: [
    {
      name: "youtube",
      enabled: true,
      urls: ["https://www.youtube.com/feed/subscriptions"],
      last_sync: "2026-03-28T10:00:00Z",  // MAX(published_at) from feed_items for this source
      max_items: 20,
      scraping_resource: "scrolless://platforms/youtube"
    },
    {
      name: "x",
      enabled: false   // no further fields when disabled
    }
  ],
  filters: {
    blocked_keywords: ["sponsored"]   // from user_preferences
  }
}
```

Implementation:
- Join `user_sources` with a sub-query on `feed_items` to get `last_sync` per source
- `max_items` comes from `user_sources.max_items` (falls back to `user_preferences.max_items_per_source` if NULL)
- `scraping_resource` is always `scrolless://platforms/{name}`
- Disabled sources appear in the array with only `name` and `enabled: false` — agents must skip them
- `blocked_keywords` from `user_preferences` (never `blocked_sources` — that concept is gone)

### Task 4.3: Data retention cleanup

Create a function `cleanupOldItems(db, userId, retentionDays)`:
- `DELETE FROM feed_items WHERE user_id = ? AND fetched_at < datetime('now', '-N days')`
- `DELETE FROM sync_log WHERE synced_at < datetime('now', '-30 days')`
- Return deleted counts, log result

Schedule as a daily cron in `server/index.ts` (3:00 AM):
- Read `retention_days` from `user_preferences` (default 7)
- Call `cleanupOldItems()`

### Task 4.4: Dedup verification

Write a test or verification script that:
1. POSTs a feed item with URL `https://www.youtube.com/watch?v=abc`
2. POSTs another item with URL `https://youtu.be/abc?utm_source=twitter`
3. Verifies `inserted: 1, duplicates: 1` on the second POST
4. Verifies only one row in `feed_items`

### Acceptance criteria
- `POST /agent/feed-items` with valid payload returns `{ inserted: N, duplicates: M }`
- Duplicate URLs (even with tracking params or short-link variants) are rejected
- `GET /agent/sync-context` returns enabled sources with URLs, `last_sync`, `max_items`, `scraping_resource`, and a `filters` object with `blocked_keywords`
- Disabled sources appear in the response with only `name` and `enabled: false`
- `blocked_sources` does not appear anywhere in the response
- Invalid payloads return 400 with clear error messages
- Rate limiting kicks in after 60 requests/hour
- Daily cleanup removes items older than retention period

---

## Stage 5: PWA API Routes

**Goal**: Expose the feed data to the frontend.

### Task 5.1: Feed routes

Create `server/api-routes.ts`:

**`GET /api/feed`**
- Query params: `limit` (default 50), `offset` (default 0), `source` (optional), `unread_only` (optional boolean), `discovery` (optional boolean)
- All queries scoped to `user_id = 'local'`
- Return `{ items, total, limit, offset }`
- `items` excludes `raw_json` (select specific columns)
- `tags` is returned as a parsed JSON array, not a raw string
- Order by `published_at DESC`

**`PATCH /api/feed/:id/read`**
- URL-decode the `id` (contains colons)
- Set `is_read = 1`
- Return `{ ok: true/false }`

**`PATCH /api/feed/:id/unread`**
- Set `is_read = 0`

**`POST /api/feed/mark-all-read`**
- Optional query param: `source`
- Set `is_read = 1` for all matching unread items

**`GET /api/stats`**
- Return `{ total, unread, by_source: [{ source, count, unread }] }`

**`GET /api/sync/status`**
- Return the most recent `sync_log` entry per source:
```sql
SELECT source, synced_at, items_added, items_duped, error
FROM sync_log
WHERE user_id = 'local'
GROUP BY source
HAVING synced_at = MAX(synced_at)
```

### Task 5.2: Source management routes

Add CRUD endpoints for managing `user_sources` in `server/api-routes.ts`:

**`GET /api/sources`**
- Return all `user_sources` rows for `user_id = 'local'`
- Parse `urls` from JSON string to array before returning

**`POST /api/sources`**
- Body: `{ name, urls: string[], max_items?, scraping_notes? }`
- `name` must be non-empty, URL-safe string; reject duplicates with 409
- `urls` must be a non-empty array of valid URL strings
- Insert into `user_sources` with `enabled = 0`
- Return the created row

**`PATCH /api/sources/:name`**
- Body may contain any subset of: `enabled`, `urls`, `max_items`, `scraping_notes`
- Update only the provided fields
- Return updated row

**`DELETE /api/sources/:name`**
- Delete the row
- Return `{ ok: true }`

### Task 5.3: Static file serving

Register `@fastify/static` to serve `dist/client/` when the directory exists. Add a catch-all route serving `index.html` for non-`/api/`, non-`/agent/`, non-`/mcp`, and non-`/oauth/` paths (SPA fallback).

In dev mode: register `@fastify/cors` with origin `http://localhost:5173`.

### Task 5.4: Wire Fastify into entry point

Update `server/index.ts`:
- Create Fastify instance
- Register agent routes (with auth hook + rate limiting)
- Register API routes
- Register static file serving
- Listen on `127.0.0.1:3333`

### Acceptance criteria
- `curl http://localhost:3333/api/feed` returns feed items (after agent has posted some)
- Source filtering, unread filtering, and discovery filtering work
- Read/unread toggling works
- `GET /api/sync/status` returns last sync per source
- `GET /api/stats` returns correct counts
- `GET /api/sources` returns the three seeded default sources
- PATCH can toggle `enabled` and update `urls` on a source
- DELETE removes a source; subsequent GET does not include it

---

## Stage 6: Web Push Notifications

**Goal**: Implement push subscription management and notification sending.

### Task 6.1: Push routes

Add to `server/api-routes.ts`:

**`GET /api/push/vapid-key`**
- Return `{ key: config.push.vapid_public_key }`

**`POST /api/push/subscribe`**
- Body: `{ endpoint, keys: { p256dh, auth } }`
- `INSERT OR REPLACE` into `push_subscriptions` (endpoint is unique)
- Return `{ ok: true }`

**`POST /api/push/unsubscribe`**
- Body: `{ endpoint }`
- Delete matching row
- Return `{ ok: true }`

### Task 6.2: Push sender module

Create `server/push.ts`:

**`initPush(config): void`**
- Call `webPush.setVapidDetails(subject, publicKey, privateKey)`

**`notifyNewItems(db, userId, source, count, latestTitle?): Promise<void>`**
- Load push subscriptions for this user
- Build payload: `{ title: "${count} new from ${source}", body: "Latest: ${title}", source, count, url: "/" }`
- For each subscription: `webPush.sendNotification()`
- On 410 response: delete stale subscription
- On other errors: log and continue

### Task 6.3: Wire push into agent route

Update `POST /agent/feed-items` in `server/agent-routes.ts`:
- After inserting items, if `inserted > 0`:
  - Query the title of the most recently published inserted item
  - Call `notifyNewItems(db, userId, source, inserted, latestTitle)`

Update `server/index.ts`:
- Call `initPush(config)` at startup

### Acceptance criteria
- `GET /api/push/vapid-key` returns the public key
- Subscribing and unsubscribing works
- After a successful `POST /agent/feed-items` that inserts items, push notifications are sent
- Stale subscriptions (410) are cleaned up

---

## Stage 7: Frontend — PWA Feed UI

**Goal**: Build the Preact PWA with source filtering, read/unread, and push notification setup.

### Task 7.1: PWA manifest and icons

Create `src/manifest.json` with name, icons (192x192, 512x512), `display: standalone`, theme colour.

Generate placeholder icon PNGs. Update `src/index.html` with manifest link, theme-color meta, viewport meta.

### Task 7.2: API client

Create `src/api.ts` — typed fetch wrappers for all `/api/*` endpoints.

### Task 7.3: App shell

Create `src/app.tsx`:
- Layout: header → notification prompt → source filter → feed list
- State: source filter, discovery toggle, feed items, loading
- Fetch on mount and on filter change

### Task 7.4: Source filter tabs

Create `src/components/source-filter.tsx`:
- Tabs: All | YouTube | X | News (with unread counts from `getStats()`)
- Toggle or sub-tab: Feed vs Discovery (filters `is_discovery`)
- "Mark all read" button scoped to current filter

### Task 7.5: Feed list

Create `src/components/feed-list.tsx`:
- Routes items to source-specific card components based on `item.source`
- "Load more" button (offset pagination)
- Loading spinner, empty state

### Task 7.6: Source-specific cards

Create `src/components/youtube-card.tsx`, `x-card.tsx`, `news-card.tsx`:

Each card has expand/collapse state:
- **YouTube**: Collapsed = thumbnail + title + channel + timestamp. Expanded = larger thumbnail + full title + link.
- **X**: Collapsed = @handle + text preview + timestamp. Expanded = full text + link.
- **News**: Collapsed = headline + source + timestamp. Expanded = thumbnail + excerpt + link.

Shared: `useExpandable(id, isRead, markReadFn)` hook. Expanding marks as read.

### Task 7.7: Sync status

Create `src/components/sync-status.tsx`:
- Polls `GET /api/sync/status` every 60s
- Shows relative time since last sync
- Error indicator if any source has an error

### Task 7.8: Notification prompt

Create `src/components/notification-prompt.tsx`:
- Check push support + current permission state
- Show banner if not yet asked
- "Enable" → request permission → subscribe → POST to server
- "Not now" → dismiss, remember in localStorage
- If granted: show "Notifications: On" with disable toggle

### Task 7.9: Settings screen

Create `src/settings.tsx` — the `/settings` route:

**`SourceList` component** (`src/components/source-list.tsx`):
- Fetches `GET /api/sources` on mount
- Renders a card per source showing: name, enabled toggle, URL list (editable), max_items override
- Toggle calls `PATCH /api/sources/:name` with `{ enabled: 0|1 }`
- URL edits call `PATCH /api/sources/:name` with `{ urls: [...] }`
- Delete button calls `DELETE /api/sources/:name` (with confirmation)

**`AddSourceForm` component** (`src/components/add-source-form.tsx`):
- Fields: name (text), urls (textarea, one URL per line), optional max_items
- Submits `POST /api/sources`
- Validation: name required, at least one valid URL

Refer to `docs/DESIGN_SYSTEM.md` for the Settings screen layout, card patterns, and form styles.

### Task 7.10: Service worker (placeholder)

Create `src/sw.ts` with minimal push handler (will be fleshed out in Stage 8). Register in `src/main.tsx`. Configure Vite to output `sw.js` at the root of `dist/client/`.

### Task 7.11: Styling

Single `src/styles.css`:
- CSS custom properties for theming
- Mobile-first responsive layout
- Dark mode via `prefers-color-scheme`
- Source-specific accent colours on cards
- Unread items visually distinct (left border, bold title)

### Acceptance criteria
- Feed displays with source filtering and discovery toggle
- Cards expand/collapse with source-appropriate layouts
- Read/unread toggling works visually and persists
- "Mark all read" works
- Notification prompt appears, permission flow works
- PWA manifest is served correctly
- Settings screen renders the source list; toggling enabled and editing URLs persists via the API
- AddSourceForm creates a new source; it appears in the list immediately

---

## Stage 8: Service Worker + Offline

**Goal**: Complete the service worker with push event handling and offline app shell caching.

### Task 8.1: Push event handler

In `src/sw.ts`:

```typescript
self.addEventListener('push', (event) => {
  const payload = event.data?.json();
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      tag: `feed-${payload.source}`,
      data: { url: payload.url }
    })
  );
});
```

### Task 8.2: Notification click handler

```typescript
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow(event.notification.data?.url || '/');
    })
  );
});
```

### Task 8.3: Offline caching

Cache app shell on install. Serve cached shell for navigation requests. Pass `/api/*` and `/agent/*` through to network.

### Task 8.4: Service worker build

Ensure `sw.ts` compiles to `dist/client/sw.js` at the root (not hashed, not nested). Use a Vite plugin or separate esbuild step.

### Acceptance criteria
- Push notifications display when agent posts new items
- Tapping notification opens/focuses the PWA
- App shell loads instantly from cache even on slow connections
- API requests are not cached (always fetch from network)

---

## Stage 9: MCP Server

**Goal**: Expose the agent interface as a Remote MCP server so AI agent runtimes (Claude Code, Claude Desktop, LangChain, etc.) can connect directly.

### Task 9.1: Install MCP SDK

Add `@modelcontextprotocol/sdk` to `package.json` runtime dependencies.

### Task 9.2: MCP server module

Create `server/mcp.ts`. Use `@modelcontextprotocol/sdk` with the Streamable HTTP transport, mounted at `/mcp`.

Apply the same Bearer/OAuth auth middleware as `/agent/*`. Agents authenticate with the same token — the MCP layer is just another interface to the same business logic.

### Task 9.3: Tool — get_sync_context

Register a `get_sync_context` tool (no input arguments).

Implementation: call the same logic as `GET /agent/sync-context` (extract to a shared function so both routes use it). Return the `AgentSyncContext` object.

### Task 9.4: Tool — submit_items

Register a `submit_items` tool with input schema:
```typescript
{
  source: string;
  items: AgentFeedItem[];
}
```

Implementation: call the same logic as `POST /agent/feed-items`. Return `{ inserted, duplicates }`.

### Task 9.5: Resources — platform scraping instructions

Register a resource provider for the `scrolless://platforms/{name}` URI scheme.

- Read content from `skill/resources/{name}.md`
- If the source has `scraping_notes` in `user_sources`, append them to the file content
- If no file exists for `{name}`, return a generic extraction prompt
- Return as MIME type `text/markdown`

This allows agents to fetch per-platform instructions at runtime without any local files.

### Task 9.6: Prompt — run_feed_sync

Register a `run_feed_sync` prompt template with no arguments:

```
Call get_sync_context to get your work order.
For each source where enabled is true:
  1. Fetch the scraping_resource to get platform-specific instructions
  2. Navigate to each URL in urls[]
  3. Extract items published after last_sync
  4. Skip any item whose title or content contains a blocked_keyword
  5. Collect up to max_items items
  6. Call submit_items with the batch
Log the inserted/duplicates counts. If a source fails, continue to the next.
```

### Task 9.7: Wire MCP into server

Register the MCP handler in `server/index.ts` at `/mcp`.

### Acceptance criteria
- An MCP client can connect to `http://localhost:3333/mcp` using a Bearer token
- `get_sync_context` returns the correct structure
- `submit_items` inserts items and triggers push notifications (same as REST POST)
- `scrolless://platforms/youtube` returns the content of `skill/resources/youtube.md`
- `run_feed_sync` prompt is listed and returns the correct template text
- Unauthenticated requests return 401

---

## Stage 10: OAuth 2.0

**Goal**: Add Authorization Code + PKCE flow so Claude connector and third-party MCP clients can authenticate without a pre-shared token.

### Task 10.1: OAuth routes module

Create `server/oauth-routes.ts`. These routes are public (no auth middleware on the routes themselves — the endpoints implement the OAuth protocol).

**`GET /oauth/.well-known/oauth-authorization-server`**
- Return server metadata: `issuer`, `authorization_endpoint`, `token_endpoint`, `revocation_endpoint`, `response_types_supported`, `code_challenge_methods_supported`

**`GET /oauth/authorize`**
- Query params: `client_id`, `redirect_uri`, `response_type=code`, `code_challenge`, `code_challenge_method=S256`, `state`
- Validate `client_id` against `oauth_clients` in config
- Validate `redirect_uri` against registered URIs
- Show a consent screen (can be minimal for PoC — HTML form with "Allow" button)
- On approval: generate a random auth code, store in `oauth_auth_codes` with 10-minute expiry, redirect to `redirect_uri?code=CODE&state=STATE`

**`POST /oauth/token`**
- Body: `grant_type`, `code`, `redirect_uri`, `code_verifier` (for authorization_code) or `refresh_token` (for refresh)
- For `authorization_code`: verify code exists, not expired, PKCE challenge matches (`SHA-256(code_verifier) == code_challenge`)
- Issue access token (random 32-byte hex, 1-hour expiry) and refresh token
- Store in `oauth_tokens`
- Delete used auth code
- Return `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token }`

**`POST /oauth/revoke`**
- Body: `token` (access or refresh token)
- Delete matching row from `oauth_tokens`
- Return 200 (always, per RFC 7009)

### Task 10.2: Extend auth middleware

Update the auth middleware in `server/auth.ts` to accept both token types:

1. Try Bearer token path: hash incoming token, look up in `agent_tokens`
2. If not found, try OAuth path: look up raw token in `oauth_tokens`, check `access_expires`
3. Return resolved `userId` from whichever path succeeds
4. If both fail: return 401

Existing Bearer token agents must continue working unchanged.

### Task 10.3: Client registration

Read OAuth client registrations from `config.json` at startup and seed `oauth_clients` table. See ARCHITECTURE.md for the `config.json` shape.

### Task 10.4: Cleanup

Extend the daily cron to also delete:
- `oauth_auth_codes` where `expires_at < now`
- `oauth_tokens` where `access_expires < now` and no valid `refresh_expires`

### Acceptance criteria
- Claude connector OAuth flow completes end-to-end (authorize → token exchange → MCP request with access token)
- Refresh token exchange works
- Revocation invalidates the token immediately
- Expired tokens return 401 with `WWW-Authenticate: Bearer error="invalid_token"`
- Bearer token agents are unaffected — existing tokens still work
- `GET /oauth/.well-known/oauth-authorization-server` returns valid metadata

---

## Stage 11: Agent Skill

**Goal**: Write the scraping skill instructions for Claude Code / Cowork agents.

### Task 11.1: Skill main instructions

Update `skill/SKILL.md` to document the MCP-first workflow:

1. **Primary path**: Agent connects to the ScrolLess MCP server and invokes the `run_feed_sync` prompt. That prompt contains the full workflow — no other instructions needed.
2. **Expanded MCP steps** (for agents that need explicit steps): call `get_sync_context`, read each source's `scraping_resource`, scrape, call `submit_items`.
3. **REST fallback** (non-MCP clients): `GET /agent/sync-context` for context, `POST /agent/feed-items` to submit.

Do **not** include references to local `config.json` for platform settings — sources come from `get_sync_context`. Do **not** include references to `blocked_sources`.

### Task 11.2: Platform resource files

Create `skill/resources/youtube.md`, `skill/resources/x.md`, `skill/resources/news.md`.

These files are served as MCP resources at `scrolless://platforms/{name}`. Each file provides:
1. Target URL(s) to navigate
2. Extraction guidance (described semantically — not selectors)
3. Pagination instructions
4. Edge cases to skip
5. Field mapping to `AgentFeedItem`

**`skill/resources/youtube.md`**:
- Navigate to `https://www.youtube.com/feed/subscriptions`
- Requires the user to be logged into YouTube in Chrome
- Extract: video title, channel name, video URL, publish timestamp, thumbnail URL
- `source_id` = video ID from the `v=` parameter
- Skip: YouTube Shorts (`/shorts/` in URL), ads, unaired premieres
- `is_discovery: false`

**`skill/resources/x.md`**:
- Navigate to `https://x.com/home` (Following tab, not For You)
- Requires the user to be logged into X in Chrome
- Extract: author handle, display name, tweet text, tweet URL, publish timestamp
- `source_id` = tweet ID from URL
- Skip: ads/promoted tweets, retweets (unless quote tweets), Spaces
- `is_discovery: false`

**`skill/resources/news.md`**:
- Navigate to each URL provided in the source's `urls[]`
- No login required for public news sites
- Extract: article title, publication name, article URL, publish timestamp
- `source_id` = SHA-256 of the article URL
- Handle different site layouts semantically
- `is_discovery: false`

### Task 11.3: Payload schema

Create `skill/schema.json` — a JSON Schema document describing the `AgentFeedItem` payload. Agents can reference this to validate output before submitting.

### Acceptance criteria
- `skill/SKILL.md` clearly describes MCP-first workflow with REST fallback
- No references to local `config.json` platform settings or `blocked_sources`
- `skill/resources/` contains files for youtube, x, and news
- An agent reading the files can execute a full sync run against a live server

---

## Stage 12: Skill Evaluation

**Goal**: Validate that the skill reliably populates the feed across platforms and error conditions.

### Task 12.1: Dry run mode

Add a `--dry-run` flag to the skill instructions:
- When enabled, the agent writes extracted items to a local `dry-run-output.json` file instead of submitting
- Inspect the output: are all fields present? Are timestamps valid ISO 8601? Are URLs valid?

### Task 12.2: MCP smoke test

- Connect an MCP client to `http://localhost:3333/mcp` using a Bearer token
- Call `get_sync_context` — verify it returns enabled sources with the expected structure
- Call `submit_items` with a sample YouTube item — verify `inserted: 1`
- Call `submit_items` again with the same item — verify `duplicates: 1`
- Fetch resource `scrolless://platforms/youtube` — verify it returns the instruction markdown

### Task 12.3: Single-source end-to-end test

- Enable YouTube in the Settings screen (`PATCH /api/sources/youtube` with `enabled: 1`)
- Run the `run_feed_sync` prompt via MCP (or REST fallback)
- Verify: items appear in `GET /api/feed?source=youtube`
- Run again: verify no duplicates (dedup working)
- Verify: push notification was received

### Task 12.4: Multi-source test

- Enable YouTube + news
- Run the skill
- Verify: both sources appear in the feed
- Verify: source filter tabs show correct counts
- Verify: `GET /agent/sync-context` shows both sources with correct `last_sync` timestamps

### Task 12.5: Keyword filter test

- Add a blocked keyword to preferences (e.g. "sponsored")
- Run the skill
- Verify: items containing the keyword are not submitted

### Task 12.6: Failure recovery test

- Run the skill targeting a source that requires a login the agent doesn't have
- Verify: the agent logs the error and continues to the next source
- Verify: `sync_log` shows the error for that source
- Verify: other sources still populated correctly

### Task 12.7: Freshness test

- Let the skill run on its scheduled cadence for 24+ hours
- Verify: new items appear in each sync
- Verify: no duplicate items accumulate
- Verify: the 7-day cleanup removes old items
- Verify: push notifications continue to arrive for new content

### Acceptance criteria
- MCP tools and resources respond correctly
- End-to-end sync populates the feed reliably
- Keyword filtering works
- Errors are logged, not silent
- Dedup and cleanup work over time

---

## Stage 13: Production Build & Deployment

**Goal**: Make the app deployable for daily use.

### Task 13.1: Production server

Verify `npm run build && npm start` serves:
- All API routes on `/api/*`
- Agent routes on `/agent/*` (with auth)
- MCP endpoint at `/mcp` (with auth)
- OAuth endpoints at `/oauth/*`
- Built frontend at `/`
- Service worker at `/sw.js`
- Manifest at `/manifest.json`

### Task 13.2: Systemd service (self-hosted)

Create `feed-aggregator.service` for systemd user service:

```ini
[Unit]
Description=Feed Aggregator
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/feed-aggregator
ExecStart=/usr/bin/node --import tsx server/index.ts
Environment=NODE_ENV=production
EnvironmentFile=%h/.config/feed-aggregator/env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

With installation instructions in comments:
```bash
# mkdir -p ~/.config/systemd/user
# cp feed-aggregator.service ~/.config/systemd/user/
# echo 'FEED_AGG_KEY=your-passphrase' > ~/.config/feed-aggregator/env
# chmod 600 ~/.config/feed-aggregator/env
# systemctl --user daemon-reload
# systemctl --user enable --now feed-aggregator
# sudo loginctl enable-linger $USER
```

### Task 13.3: Deployment options

Create `docs/DEPLOYMENT.md` covering two deployment targets:

**Fly.io / Railway (primary — recommended)**:
1. Create `fly.toml` / `railway.toml` with port 3333, health check on `/api/stats`
2. Set environment variables for `config.json` values
3. Persistent volume for the SQLite database file
4. Deploy command and verification steps
5. Configure a custom domain

**Cloudflare Tunnel (personal/self-hosted fallback)**:
1. `cloudflared` installation on Fedora
2. Quick test: `cloudflared tunnel --url http://localhost:3333`
3. Permanent tunnel with custom domain
4. Tunnel config YAML
5. DNS routing
6. Systemd service for cloudflared
7. Verification: PWA installs, push works, agent can reach server and MCP endpoint

### Task 13.4: Claude Code scheduled task setup

Document how to set up the agent as a recurring Claude Code task:
1. Configure the ScrolLess MCP server in Claude Code (`~/.claude/mcp_servers.json`)
2. Enable Claude in Chrome connector
3. Set up a `/loop` or `/schedule` task (e.g. every 30 minutes): `Use the run_feed_sync prompt from the ScrolLess MCP server.`
4. Verify: feed populates automatically on schedule

### Acceptance criteria
- Server runs as a systemd service (self-hosted) or on Fly.io/Railway (cloud)
- HTTPS access established via Cloudflare Tunnel or platform proxy
- PWA installs on Android from the public URL
- Push notifications work end-to-end
- MCP server is reachable from Claude Code at the public URL
- OAuth flow completes end-to-end with Claude connector
- Scheduled Claude Code task populates the feed automatically
- The app is usable as a daily driver
