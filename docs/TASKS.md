# Implementation Tasks

This document breaks the ScrolLess edge-first build into discrete stages. Each stage is self-contained: a coding agent should be able to complete any stage given only this document, `ARCHITECTURE.md`, `DESIGN_SYSTEM.md`, and the code produced by prior stages.

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
- `@fastify/rate-limit` — rate limiting on agent/MCP routes only
- `web-push` — Web Push notifications (VAPID)
- `preact` — UI framework
- `preact-iso` — hash router for PWA views
- `tsx` — run TypeScript backend directly
- `idb` — IndexedDB wrapper (typed, promise-based)
- `@modelcontextprotocol/sdk` — MCP server

**Dev dependencies**:
- `typescript`
- `@types/better-sqlite3`
- `@types/node`
- `vite`
- `@preact/preset-vite`
- `concurrently`
- `vitest` — unit tests

Configure `package.json` scripts:
- `dev:server` — `tsx --watch server/index.ts`
- `dev:client` — `vite`
- `dev` — both via `concurrently`
- `build` — `vite build`
- `start` — `NODE_ENV=production tsx server/index.ts`
- `generate-token` — `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `test` — `vitest run`

Set `"type": "module"` in `package.json`.

### Task 1.2: TypeScript configuration

Create `tsconfig.json` for the backend (Node.js target, ESM, strict):
- `"target": "ES2022"`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"strict": true`

Create `tsconfig.app.json` extending base config for the frontend:
- Add `"jsxImportSource": "preact"` and `"lib": ["ES2022", "DOM", "DOM.Iterable"]`

Create `tsconfig.sw.json` for the service worker (same as app but no JSX).

### Task 1.3: Vite configuration

Create `vite.config.ts`:
- Use `@preact/preset-vite`
- Dev proxy using **regex keys** to avoid matching TypeScript source files:
  ```ts
  proxy: {
    '^/api/': 'http://localhost:3333',
    '^/agent/': 'http://localhost:3333',
    '^/mcp': 'http://localhost:3333',
    '^/oauth/': 'http://localhost:3333',
  }
  ```
- Service worker output at `sw.js` (not content-hashed): configure `rollupOptions` to output `sw.js` with no hash.

### Task 1.4: Build script for service worker

Create `build-sw.mjs` that compiles `src/sw.ts` to `public/sw.js` using `esbuild` (or `tsc --outFile`). Run as part of `build` script.

### Task 1.5: Verify

Run `npm run dev` and confirm:
- Backend starts on :3333
- Vite starts on :5173
- No TypeScript errors
- `http://localhost:5173` serves the Vite default page (HTML shell)

---

## Stage 2: Database Layer

**Goal**: Create the SQLite schema and a typed database module.

### Task 2.1: Write the schema

Create `sql/schema.sql` with the following tables:

```sql
-- Device registrations (free tier)
CREATE TABLE IF NOT EXISTS device_registrations (
    user_id     TEXT PRIMARY KEY,
    public_key  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_seen   TEXT
);

-- User-configured scraping sources
CREATE TABLE IF NOT EXISTS user_sources (
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    urls            TEXT NOT NULL DEFAULT '[]',
    max_items       INTEGER,
    last_sync_at    TEXT,
    scraping_notes  TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, name)
);

-- Append-only agent sync attempt log (metadata only — no content)
CREATE TABLE IF NOT EXISTS sync_attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    source       TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    item_count   INTEGER NOT NULL DEFAULT 0,
    status       TEXT NOT NULL,  -- 'relayed' | 'device_offline' | 'error'
    error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_attempts_user ON sync_attempts(user_id, attempted_at DESC);

-- Web Push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    endpoint    TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Agent API tokens
CREATE TABLE IF NOT EXISTS agent_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash  TEXT NOT NULL UNIQUE,
    user_id     TEXT NOT NULL,
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used   TEXT
);

-- OAuth 2.0 tables
CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id       TEXT PRIMARY KEY,
    client_secret   TEXT,
    redirect_uris   TEXT NOT NULL,
    label           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
    code            TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    redirect_uri    TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
    access_token    TEXT PRIMARY KEY,
    refresh_token   TEXT UNIQUE,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    access_expires  TEXT NOT NULL,
    refresh_expires TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### Task 2.2: Database module

Create `server/db.ts`:
- Open SQLite at `data/scrolless.db` (create directory if missing)
- Execute `schema.sql` on startup
- Export a typed `db` instance
- Seed default sources (`youtube`, `x`, `news`) for `user_id = 'local'` with `enabled = 0`
- Seed OAuth clients from `config.json` if present

### Task 2.3: Config loader

Create `server/config.ts`:
- Load `config.json` if present, fall back to environment variables
- Export typed config: `vapidPublicKey`, `vapidPrivateKey`, `vapidEmail`, `agentRateLimit`, `cors`, `oauth.clients`

---

## Stage 3: Client-Side Crypto Module

**Goal**: Implement ECIES-P256-AES256GCM decryption in the browser using Web Crypto API. No external crypto libraries.

### Task 3.1: Key generation

Create `src/crypto.ts`:

```typescript
// Generate a new P-256 keypair
export async function generateKeypair(): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;

// Export public key to base64 uncompressed point
export async function exportPublicKey(key: CryptoKey): Promise<string>;

// Import a base64 public key (for ECDH with ephemeral key)
export async function importPublicKey(b64: string): Promise<CryptoKey>;
```

### Task 3.2: ECIES decryption

```typescript
// Decrypt a single encrypted_fields blob
// encrypted_fields = base64(iv[12] || ciphertext || authTag[16])
// ephemeralPublicKeyB64 = base64(P-256 uncompressed point) from agent POST
export async function decryptFields(
  encryptedFields: string,
  ephemeralPublicKeyB64: string,
  devicePrivateKey: CryptoKey,
): Promise<{
  title: string;
  author?: string;
  content_preview?: string;
  thumbnail_url?: string;
  tags: string[];
}>;
```

Implementation steps inside `decryptFields`:
1. Import ephemeral public key with `importKey('raw', ...)` + `{ name: 'ECDH', namedCurve: 'P-256' }`
2. `sharedSecret = await subtle.deriveBits({ name: 'ECDH', public: ephemeralKey }, devicePrivateKey, 256)`
3. Import shared secret as HKDF key material
4. `aesKey = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode('scrolless-v1') }, hkdfKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])`
5. Decode base64 → bytes; `iv = bytes[0:12]`, `cipherWithTag = bytes[12:]`
6. `plaintext = await subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherWithTag)`
7. Parse and return JSON

### Task 3.3: URL normalisation (client-side)

```typescript
// Normalise a URL for dedup hashing
export function normaliseUrl(url: string): string;

// SHA-256 of normalised URL → hex string
export async function hashUrl(url: string): Promise<string>;
```

Normalisation steps:
1. Lowercase hostname
2. Remove tracking params: `utm_*`, `s`, `ref`, `feature`
3. Convert YouTube short URLs: `youtu.be/ID` → `https://www.youtube.com/watch?v=ID`
4. Sort remaining query params alphabetically
5. Strip trailing slashes

### Task 3.4: Unit tests

Write `src/crypto.test.ts` with a round-trip test:
1. Generate device keypair
2. Simulate agent-side encryption (generate ephemeral keypair, ECDH, HKDF, AES-GCM encrypt) using Web Crypto
3. Call `decryptFields` and assert plaintext matches

Run with `npm test`.

---

## Stage 4: Device Registration

**Goal**: Device generates keypair on first boot and registers with the server. Keypair persists in IndexedDB.

### Task 4.1: IndexedDB schema

Create `src/idb.ts` using the `idb` package. Define stores:

- `device` — singleton record with `user_id`, `public_key` (base64), `private_key` (CryptoKey), `registered_at`
- `feed_items` — `FeedItem` objects; indexes on `url_hash` (unique), `published_at`, `source`, `is_read`, `is_discovery`, `is_saved`
- `sync_log` — append-only `SyncLogEntry` records; autoincrement key
- `preferences` — key-value pairs

Export `openDb(): Promise<IDBPDatabase<ScrolLessDB>>`.

### Task 4.2: Device init hook

Create `src/useDevice.ts`:

```typescript
export function useDevice(): {
  userId: string | null;
  publicKey: string | null;
  privateKey: CryptoKey | null;
  ready: boolean;
};
```

On mount:
1. Open IndexedDB
2. Check for existing `device` record in the `device` store
3. If none: `generateKeypair()` → create `dev_<crypto.randomUUID()>` → `POST /api/device/register` → store in IndexedDB
4. If exists: return stored record (skip registration)

### Task 4.3: Server — device registration endpoint

In `server/api-routes.ts`:

```
POST /api/device/register
Body: { public_key: string; device_id: string }
```

- Validate `device_id` starts with `dev_`
- `INSERT OR IGNORE INTO device_registrations (user_id, public_key) VALUES (?, ?)`
- Return `{ user_id, ok: true }`
- No auth required (bootstrap endpoint — no token exists yet)

### Task 4.4: Device auth middleware

Create `server/middleware/device-auth.ts`:

For `/api/*` routes in free tier, accept `X-Device-Id: dev_<uuid>` header and verify it exists in `device_registrations`. Set `request.userId`. Return 401 if not found.

This is separate from agent auth (Stage 5) — used only for PWA endpoints.

---

## Stage 5: Agent Auth Middleware

**Goal**: Shared auth for `/agent/*` and `/mcp` routes that resolves `userId` from Bearer token or OAuth access token.

### Task 5.1: Auth middleware

Create `server/middleware/agent-auth.ts`:

```typescript
export async function agentAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void>;
```

Two code paths:
1. Extract Bearer token → `SHA-256(token)` → compare to `agent_tokens.token_hash` → set `request.userId`
2. Look up `oauth_tokens.access_token` → check `access_expires > now` → set `request.userId`

Return 401 if neither path succeeds. Update `agent_tokens.last_used` after successful auth (non-blocking fire-and-forget).

### Task 5.2: Scoped plugin registration

In `server/index.ts`, register rate-limit and agent auth on a scoped plugin so they **never** affect `/api/*`:

```typescript
await fastify.register(async (agentScope) => {
  await agentScope.register(fastifyRateLimit, { max: 60, timeWindow: '1 hour' });
  agentScope.addHook('onRequest', agentAuthMiddleware);
  registerAgentRoutes(agentScope, db, sseManager);
  registerMcpHandler(agentScope, db, sseManager);
});
```

---

## Stage 6: SSE Delivery Layer

**Goal**: Server maintains a registry of active SSE connections keyed by `user_id` and can relay payloads to connected devices.

### Task 6.1: SSE manager

Create `server/sse-manager.ts`:

```typescript
export class SseManager {
  register(userId: string, reply: FastifyReply): void;
  remove(userId: string): void;
  isOnline(userId: string): boolean;
  send(userId: string, event: string, data: unknown): boolean;
  keepalive(): void;
}
```

Internals:
- `Map<string, FastifyReply>` for active connections
- `setInterval` every 30 s calling `keepalive()` which writes `: keepalive\n\n` to all open replies

### Task 6.2: SSE endpoint

In `server/api-routes.ts`:

```
GET /api/stream
Auth: X-Device-Id header (device-auth middleware)
```

- Set response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- `sseManager.register(userId, reply)`
- `UPDATE device_registrations SET last_seen = ? WHERE user_id = ?`
- `request.raw.on('close', () => sseManager.remove(userId))`
- Do not call `reply.send()` — keep the connection open

---

## Stage 7: Agent Relay Endpoints

**Goal**: Implement sync-context and feed-item relay endpoints with the correct SSE/503 semantics.

### Task 7.1: GET /agent/sync-context

Response shape:

```typescript
{
  encryption: {
    public_key: string;             // base64 P-256 point from device_registrations
    algorithm: 'ECIES-P256-AES256GCM';
  };
  sources: Array<{
    name: string;
    enabled: boolean;
    urls?: string[];
    last_sync?: string;
    max_items?: number;
    scraping_resource?: string;     // "scrolless://platforms/{name}"
  }>;
  filters: {
    blocked_keywords: string[];
  };
}
```

- Fetch `user_sources` for `userId` from DB
- Fetch `device_registrations.public_key` for `userId` from DB
- For disabled sources return only `{ name, enabled: false }`
- `blocked_keywords` default is `[]`

### Task 7.2: POST /agent/feed-items

Request body:

```typescript
{
  source: string;
  ephemeral_public_key: string;
  items: Array<{
    source_id: string;
    url: string;
    published_at: string;
    is_discovery?: boolean;
    encrypted_fields: string;
  }>;
}
```

Relay logic:

**Device online** (`sseManager.isOnline(userId) === true`):
1. `sseManager.send(userId, 'feed_items', body)` — relay full payload as-is
2. `INSERT INTO sync_attempts (..., status) VALUES (..., 'relayed')`
3. `UPDATE user_sources SET last_sync_at = ? WHERE user_id = ? AND name = ?`
4. Return `200 { relayed: items.length }`

**Device offline**:
1. `INSERT INTO sync_attempts (..., status) VALUES (..., 'device_offline')`
2. Call `sendPush(...)` non-blocking (Stage 8)
3. **Do not** update `last_sync_at`
4. Return `503 { "error": "device_offline" }`

### Task 7.3: GET /api/sync/status

```typescript
// Response
{
  missed: Array<{
    source: string;
    attempted_at: string;
    status: 'device_offline' | 'error';
    item_count: number;
  }>;
  next_sync_estimate: string | null;
}
```

- Query `sync_attempts` for `userId` in the last 24 h where `status != 'relayed'`
- Estimate next sync by computing the average interval between `relayed` rows, adding it to the most recent `attempted_at`

---

## Stage 8: Web Push

**Goal**: Send a push notification when the agent POSTs and the device is offline.

### Task 8.1: VAPID setup

Load `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` from `config.json` / environment. Generate defaults on first run and persist to `config.json`.

Call `webpush.setVapidDetails(...)` during server startup.

### Task 8.2: Push helper

Create `server/push.ts`:

```typescript
export async function sendPush(
  db: Database,
  userId: string,
  payload: { title: string; body: string; source: string; count: number },
): Promise<void>;
```

- Query all `push_subscriptions` for `userId`
- Call `webpush.sendNotification()` for each
- On 410 Gone: delete the subscription
- Errors are non-fatal — log and continue

One notification per agent POST, grouped by source:

```json
{
  "title": "5 new items from YouTube",
  "body": "Your feed updated while you were away.",
  "source": "youtube",
  "count": 5
}
```

### Task 8.3: Push API endpoints

```
GET  /api/push/vapid-key    → { publicKey: config.vapidPublicKey }
POST /api/push/subscribe    → upsert into push_subscriptions
POST /api/push/unsubscribe  → delete from push_subscriptions by endpoint
```

---

## Stage 9: Service Worker + IndexedDB Writes

**Goal**: Service worker handles push events and offline caching. SSE events decrypt and persist to IndexedDB.

### Task 9.1: Service worker (src/sw.ts)

Push event handler:

```typescript
self.addEventListener('push', (event) => {
  const data = event.data?.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
```

App shell caching:
- Cache `index.html`, CSS, JS chunks on `install`
- Serve from cache for navigation requests
- Pass API requests through to network (no caching)

Build output: `public/sw.js` (no content hash). Register in the app:

```typescript
navigator.serviceWorker.register('/sw.js');
```

### Task 9.2: SSE → IndexedDB pipeline

Create `src/useFeed.ts`:

```typescript
export function useFeed(): { items: FeedItem[]; loading: boolean };
```

On mount:
1. Load existing items from IndexedDB sorted by `published_at DESC`
2. Open `EventSource('/api/stream', { withCredentials: true })`
3. On `feed_items` event:
   a. Parse JSON
   b. For each item: `decryptFields(item.encrypted_fields, payload.ephemeral_public_key, devicePrivateKey)`
   c. `url_hash = await hashUrl(item.url)`
   d. Check IndexedDB for existing `url_hash` — skip if present
   e. Build `FeedItem` and `put` into IndexedDB
   f. Update reactive state
4. On `close` / `error`: exponential backoff reconnect (cap at 30 s)

### Task 9.3: Retention cleanup

Create `src/retention.ts`:

```typescript
export async function runRetentionCleanup(retentionDays: number): Promise<void>;
```

Deletes `feed_items` from IndexedDB where `fetched_at < now - retentionDays`. Call once on app boot.

---

## Stage 10: PWA Data Layer

**Goal**: Typed hooks that expose feed data from IndexedDB. No API calls for content reads.

### Task 10.1: useFeedItems

```typescript
export function useFeedItems(filter: {
  source?: string;
  is_discovery?: boolean;
  is_saved?: boolean;
}): FeedItem[];
```

Reads from IndexedDB using the appropriate index. Returns items sorted by `published_at DESC`.

### Task 10.2: useUnreadCounts

```typescript
export function useUnreadCounts(): Record<string, number>;
// { all: 12, youtube: 8, x: 3, news: 1 }
```

### Task 10.3: Item mutations

```typescript
export async function markRead(id: string): Promise<void>;
export async function markUnread(id: string): Promise<void>;
export async function markAllRead(source?: string): Promise<void>;
export async function toggleSaved(id: string): Promise<void>;
```

All mutations write to IndexedDB and trigger reactive re-renders via Preact signals or context.

### Task 10.4: usePreferences

```typescript
export function usePreferences(): {
  prefs: Preferences;
  set: (key: string, value: unknown) => Promise<void>;
};
```

Reads/writes the `preferences` store in IndexedDB. Default values:

| Key | Default |
|---|---|
| `blocked_keywords` | `[]` |
| `max_items_per_source` | `50` |
| `retention_days` | `7` |
| `notif_prompt_dismissed` | `false` |

### Task 10.5: useSyncStatus

```typescript
export function useSyncStatus(): {
  missed: MissedSync[];
  nextEstimate: string | null;
};
```

Fetches `GET /api/sync/status` on mount. Used by the missed-sync banner.

---

## Stage 11: Feed UI

**Goal**: Full feed UI — source filter tabs, feed/discovery sub-tabs, item cards, read/save actions.

### Task 11.1: App shell + router

Create `src/App.tsx` using `preact-iso`:

```typescript
import { Router, Route } from 'preact-iso';

export function App() {
  return (
    <Router>
      <Route path="/" component={FeedView} />
      <Route path="/discover" component={FeedView} />
      <Route path="/saved" component={SavedView} />
      <Route path="/settings" component={SettingsView} />
      <Route default component={NotFound} />
    </Router>
  );
}
```

Use hash-based navigation (`/#/`, `/#/settings`, etc.).

### Task 11.2: DeviceInit gate

Wrap `<App>` in `<DeviceInit>` that renders a loading spinner until `useDevice().ready === true`. Show an error state with a retry button if registration fails.

### Task 11.3: MissedSyncBanner

Renders conditionally when `useSyncStatus().missed.length > 0`.

Example copy: _"Feed tried to refresh at 6:00pm but your device was unreachable. Next refresh at 7:30pm."_

Dismiss button clears local state for the session. Format times in local timezone.

### Task 11.4: SourceFilter tabs

Tabs: `All | YouTube | X | News`. Each shows the unread count badge from `useUnreadCounts`. Selecting a tab filters `useFeedItems`. Sub-tabs `Feed | Discovery` toggle `is_discovery`.

Source display names are mapped via:

```typescript
const SOURCE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  x: 'X',
  news: 'News',
};
```

### Task 11.5: FeedList + cards

Render the appropriate card per `item.source`:
- `YouTubeCard` — thumbnail, title, channel name, relative age, read/save actions
- `XCard` — author, preview text, relative age, read/save actions
- `NewsCard` — headline, source label, thumbnail, relative age, read/save actions

Cards follow design tokens from `DESIGN_SYSTEM.md`. Read items have reduced opacity. Tapping a card marks it read and calls the platform URL. Bookmark icon calls `toggleSaved(item.id)`.

### Task 11.6: SyncStatus bar

Shows "Last synced N min ago" from the most recent `sync_log` entry in IndexedDB. Shows an error badge if the most recent `sync_attempts` from `useSyncStatus` has `status = 'device_offline'`.

### Task 11.7: NotificationPrompt

One-time in-app banner:
- Show if `Notification.permission === 'default'` and `notif_prompt_dismissed !== true`
- On accept: `Notification.requestPermission()` → subscribe → `POST /api/push/subscribe`
- On dismiss: set `notif_prompt_dismissed = true` in preferences

---

## Stage 12: Settings + Source Management

**Goal**: Settings view with source management, agent tokens, and danger zone.

### Task 12.1: SourceList

One card per `user_source` from `GET /api/sources`. Each card:
- Source name (via `SOURCE_LABELS`) with enabled/disabled toggle
- URL list (editable inline, one URL per line)
- `PATCH /api/sources/:name` on change (debounced 500 ms)
- Delete button → `DELETE /api/sources/:name` with confirmation

### Task 12.2: AddSourceForm

Fields: `name` (text), `urls` (textarea — one URL per line), `scraping_notes` (optional textarea).

Validation runs only after first submit attempt or on field blur — never on mount. On submit: `POST /api/sources`. On success: close form and refresh `SourceList`.

### Task 12.3: AgentTokens

```
GET    /api/agent-tokens       → list { id, label, created_at, last_used }
POST   /api/agent-tokens       → { label } → { token (shown once), id }
DELETE /api/agent-tokens/:id   → revoke
```

On create: display the plaintext token in a modal with a "Copy" button and a note that it will not be shown again.

### Task 12.4: DangerZone

"Delete all local data" button:
1. Clear IndexedDB stores (`feed_items`, `sync_log`, `preferences`)
2. `DELETE /api/device` — unregister device on server
3. Reload page (triggers fresh device registration on next boot)

---

## Stage 13: MCP Server

**Goal**: MCP server at `/mcp` wrapping the same relay logic as the REST agent routes.

### Task 13.1: Tool — get_sync_context

Wraps `GET /agent/sync-context` logic. No arguments. Returns sources, encryption key, filters.

### Task 13.2: Tool — submit_items

Arguments:

```typescript
{
  source: string;
  ephemeral_public_key: string;
  items: AgentFeedItem[];
}
```

Response: `{ relayed: number; offline: boolean }`. Wraps the SSE relay / 503 logic from Stage 7.2.

### Task 13.3: Resources

Serve `skill/resources/{name}.md` as MCP resources at `scrolless://platforms/{name}`. For custom sources, merge `user_sources.scraping_notes` into the response body.

### Task 13.4: Prompt — run_feed_sync

Prompt template that instructs the agent to:
1. Call `get_sync_context`
2. For each enabled source: fetch `scraping_resource`, scrape, encrypt fields (ECIES), call `submit_items`
3. Log results

Include encryption instructions inline in the prompt — the agent must encrypt before calling `submit_items`.

### Task 13.5: Register MCP handler

In `server/mcp.ts`, use `@modelcontextprotocol/sdk` Streamable HTTP transport. Mount at `/mcp`. The scoped Fastify plugin from Stage 5.2 applies rate-limit and agent auth automatically.

---

## Stage 14: OAuth 2.0

**Goal**: Authorization Code flow with PKCE for Claude connector and third-party MCP clients.

### Task 14.1: Endpoints

```
GET  /oauth/authorize
POST /oauth/token
POST /oauth/revoke
GET  /oauth/.well-known/oauth-authorization-server
```

### Task 14.2: Authorize endpoint

- Validate `client_id`, `redirect_uri` against `oauth_clients`
- Show an HTML consent screen
- On user approval: generate 32-byte hex auth code, store in `oauth_auth_codes` with 10 min expiry
- Redirect to `redirect_uri?code=CODE&state=STATE`

### Task 14.3: Token endpoint

- `grant_type: 'authorization_code'`: verify code, verify PKCE S256 challenge, issue access + refresh tokens stored in `oauth_tokens`
- `grant_type: 'refresh_token'`: verify refresh token not expired, issue new access token
- Access token expiry: 1 h. Refresh token expiry: 30 days.

### Task 14.4: Revoke and cleanup

- `POST /oauth/revoke`: delete row from `oauth_tokens` by access or refresh token
- Daily cleanup (schedule on server `ready` hook):
  - `DELETE FROM oauth_auth_codes WHERE expires_at < datetime('now')`
  - `DELETE FROM oauth_tokens WHERE access_expires < datetime('now') AND (refresh_expires IS NULL OR refresh_expires < datetime('now'))`
  - `DELETE FROM sync_attempts WHERE attempted_at < datetime('now', '-30 days')`

---

## Stage 15: Agent Skill (with Encryption)

**Goal**: Write `skill/SKILL.md` documenting the REST-based workflow for non-MCP agents, including ECIES encryption instructions.

### Task 15.1: SKILL.md

Document the complete workflow:
1. `GET /agent/sync-context` → receive sources and `encryption.public_key`
2. For each enabled source: navigate to URLs, extract items per `scraping_resource` instructions
3. For each item, perform ECIES-P256-AES256GCM encryption:
   - Generate ephemeral P-256 keypair
   - ECDH with device public key from sync context
   - HKDF-SHA256(`shared_secret`, salt=`scrolless-v1`) → 256-bit AES key
   - AES-256-GCM encrypt JSON `{ title, author, content_preview, thumbnail_url, tags }`
   - `encrypted_fields = base64(iv[12] || ciphertext || authTag[16])`
4. `POST /agent/feed-items` with encrypted payload
5. Handle responses:
   - `200` — items relayed
   - `503 { "error": "device_offline" }` — device not connected; retry next scheduled run
   - `401` — invalid token; stop and alert user
   - `429` — rate limited; stop and wait for next run

Include pseudocode for the encryption step. Note: sending plaintext is a protocol violation.

### Task 15.2: Per-platform resources

Ensure `skill/resources/youtube.md`, `skill/resources/x.md`, and `skill/resources/news.md` exist and each document:
1. Target URLs
2. Extraction guidance (semantic descriptions for AI agents, not CSS selectors)
3. Pagination instructions
4. Edge cases to skip
5. Field mapping to encrypted `AgentFeedItem` schema

---

## Stage 16: Skill Evaluation

**Goal**: Automated tests verifying that the agent skill produces valid, correctly encrypted payloads and that the server relay semantics are correct.

### Task 16.1: Online relay test

Create `e2e/eval-skill.ts`:
1. Start the server on a test port with a test device registered
2. Open a test SSE connection as the device
3. Simulate an agent: `GET /agent/sync-context` → construct ECIES-encrypted payload → `POST /agent/feed-items`
4. Assert server returns `200 { relayed: N }`
5. Assert SSE event received contains the original payload unmodified (server relayed without decrypting)
6. Decrypt on the test device private key → assert plaintext matches

### Task 16.2: Offline relay test

Repeat without an active SSE connection:
- Assert server returns `503 { "error": "device_offline" }`
- Assert `sync_attempts` row inserted with `status = 'device_offline'`
- Assert `last_sync_at` on `user_sources` is unchanged

---

## Stage 17: Production Build

**Goal**: Build the production artefact and smoke-test it.

### Task 17.1: Production build

```bash
npm run build
```

- Vite bundles frontend to `dist/`
- Service worker compiled to `dist/sw.js` (no content hash)
- No TypeScript errors

### Task 17.2: PWA manifest

Create `public/manifest.json`:

```json
{
  "name": "ScrolLess",
  "short_name": "ScrolLess",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f0f",
  "theme_color": "#0f0f0f",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Task 17.3: Static serving

In `server/index.ts` (production mode):
- Register `@fastify/static` serving `dist/` at `/`
- Add a catch-all GET route returning `dist/index.html` for all non-API, non-agent paths (SPA fallback)

### Task 17.4: Smoke test

```bash
npm start
```

Verify:
- App loads at `http://localhost:3333`
- Device registration completes (check IndexedDB in DevTools)
- SSE connection opens (`/api/stream` in Network tab)
- `http://localhost:3333/settings` renders Settings view (not 404)
- Agent curl test from `CLAUDE.md` returns 200 or 503, not 404 or 500

---

## Stage 18: Paid Tier — Account Identity

**Goal**: Implement `usr_*` account identity with multi-device key wrapping using Argon2id.

### Task 18.1: Additional dependencies

Add `argon2` (Node.js native binding) or use `@noble/hashes` for a pure-JS Argon2id implementation available in both Node and browser.

### Task 18.2: User account registration

```
POST /api/account/register
Body: { user_id: "usr_<uuid>", public_key: string, wrapped_key: string, argon2_params: object }
```

Client steps:
1. Generate P-256 keypair
2. Prompt user for passphrase
3. `Argon2id(passphrase, random_salt, { m: 65536, t: 3, p: 4 })` → 32-byte wrapping key
4. `AES-256-GCM(wrapping_key, raw_private_key_bytes)` → `wrapped_key`
5. POST `{ user_id, public_key, wrapped_key, argon2_params: { salt, m, t, p } }`

Server stores in `device_registrations` and new `user_key_bundles` table (see ARCHITECTURE.md schema).

### Task 18.3: Add device

```
POST /api/account/add-device
Body: { user_id: string }
Response: { wrapped_key: string; argon2_params: object; public_key: string }
```

Client derives wrapping key from passphrase → decrypts private key → stores keypair in IndexedDB.

### Task 18.4: Offline relay queue

Add `relay_queue` table (schema in ARCHITECTURE.md). For `usr_*` users when device is offline:
- Insert payload into `relay_queue` with `expires_at = now + 24h` instead of returning 503
- Return `202 { "queued": true }`

On `GET /api/stream` connect: flush undelivered `relay_queue` entries as `feed_items` SSE events, then mark `delivered = 1`.

---

## Stage 19: Paid Tier — Queue Cleanup & Multi-Device Delivery

**Goal**: TTL cleanup, historical backfill, and per-device delivery tracking for multi-device accounts.

### Task 19.1: Queue TTL cleanup

Add to the daily cron:

```sql
DELETE FROM relay_queue WHERE expires_at < datetime('now') OR delivered = 1;
```

### Task 19.2: Historical backfill endpoint

```
GET /api/relay/backfill?since=ISO8601
```

Returns up to 100 undelivered `relay_queue` entries for `userId` created after `since`. Paginated with a cursor. New devices call this on first login to catch up on recent items.

### Task 19.3: Per-device delivery tracking

Extend `relay_queue` with a `relay_deliveries` join table that tracks which registered devices have received each payload. A queue entry is only considered fully delivered once all active devices have confirmed receipt (or their TTL expires). On delivery, insert a row into `relay_deliveries`; the cleanup job uses this to determine what to prune.

---

## Stage 20: Paid Tier — Passphrase Change & Key Rotation

**Goal**: Allow users to change their passphrase (re-wrap private key) and rotate their encryption keypair.

### Task 20.1: Passphrase change

```
PATCH /api/account/key-bundle
Body: { wrapped_key: string; argon2_params: object }
```

Client steps:
1. Derive old wrapping key → decrypt private key
2. Derive new wrapping key from new passphrase
3. Re-encrypt private key
4. `PATCH` new `wrapped_key` and `argon2_params` to server

All other devices must re-enter the new passphrase on next login to re-derive the wrapping key.

### Task 20.2: Keypair rotation

```
PUT /api/account/key-bundle
Body: { public_key: string; wrapped_key: string; argon2_params: object }
```

Client generates a new P-256 keypair, wraps the new private key, and replaces the bundle. Server updates `device_registrations.public_key`. The next agent `GET /agent/sync-context` returns the new public key; future payloads are encrypted to the new key.

### Task 20.3: Recovery code

On account creation, generate a 12-word BIP39-style recovery phrase:
- Derive a 32-byte recovery key from the phrase using PBKDF2-SHA512
- `AES-256-GCM(recovery_key, raw_private_key_bytes)` → stored as `recovery_ciphertext` in `user_key_bundles`
- Allow `POST /api/account/recover` — body: `{ recovery_phrase, new_passphrase }` — to restore a wrapped key if the passphrase is forgotten
