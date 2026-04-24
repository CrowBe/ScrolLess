# Architecture

## Read This Document Correctly

This document mixes two things:
- the **current implementation reality** in the repository
- the **target hosted architecture** ScrolLess is moving toward

Those are not the same.
The relay-not-reader model is real today, but hosted multi-tenant identity and account-scoped operation are still in progress.
When this document conflicts with the code, the code wins.

## Design Principles

1. **Server is a relay, not a store**: The server should never become a plaintext feed-content backend. Content is intended to live on device, with the server handling relay, routing, queueing, and metadata.
2. **Two data domains, two storage planes**: ScrolLess has a control plane and a content plane. The control plane lives server-side and stores operational/account data plus ciphertext relay payloads when needed. The content plane lives client-side and stores decrypted feed items and local reading state.
3. **Encrypted content handling**: The current implementation already uses encrypted relay payloads. Hosted evolution should preserve and harden that model rather than weaken it for convenience.
4. **MCP-first agent interface**: The primary integration point for AI agents is a Remote MCP server. The underlying REST `/agent/*` endpoints remain available for non-MCP clients.
5. **Identity must become explicit**: Self-hosted `local`, free-tier `dev_*`, and hosted `usr_*` identities are the intended tiers, but the current implementation still contains local-first assumptions that must be removed before hosted mode is credible.
6. **Prefer structural alignment, not fantasy alignment**: Self-hosted and hosted paths should stay as aligned as practical, but hosted mode should not be documented as "just a config switch" when schema, auth, and identity semantics still differ.
7. **Installable PWA**: The frontend is a Progressive Web App with push notifications, installable on Android.

---

## Current Reality vs Target State

### Current implementation reality

Today the repository is primarily:
- self-hosted/local-first
- SQLite-backed
- structurally centered on `local` and device-scoped flows
- partially prepared for `dev_*` and future `usr_*` identities, but not consistently enforced across all route groups

Important caveats from the current codebase:
- some auth paths still fall back to `local`
- OAuth still behaves like a single-user local system in important places
- device identity and account identity are not yet cleanly separated for hosted mode
- hosted tenant isolation is a roadmap goal, not a completed invariant

### Target hosted state

The intended hosted architecture is:
- account-scoped identity (`usr_*`)
- explicit separation between account identity, device identity, and agent/client identity
- Postgres-backed multi-tenant persistence for the control plane
- client-resident feed/content storage for the content plane
- operator-blind content handling with explicit plaintext-metadata vs ciphertext-payload boundaries
- backend-enforced entitlements and connected-app management

### Data domains and storage planes

#### Control plane, server-side database

This is the hosted backend operational database.
In hosted mode, this should move to Postgres.

It stores:
- accounts and sessions
- devices and device bindings
- agent tokens and OAuth data
- subscriptions and entitlements
- source configuration and preferences
- sync metadata and delivery metadata
- audit/security events
- encrypted relay payloads when queueing, replay, or recovery requires server-side retention

It must not store decrypted feed content.

#### Content plane, client-side database

This is the user content database.
Today it is IndexedDB in the PWA, and future native clients may use a local SQLite-equivalent or similar local store.

It stores:
- decrypted feed items
- read/save state
- retention-managed local content
- device-local display/cache state

This is the real feed database from the user's point of view.
The server-side control plane is not the feed-content database.

Use `docs/HOSTED_BACKEND_PLAN.md` for the authoritative hosted execution sequence.

## Tier Model

### Free Tier

- No user account required.
- On first load the device generates a P-256 keypair via Web Crypto API. The private key never leaves the device (stored in IndexedDB). The public key is registered with the server.
- `user_id` = `dev_<uuid>` (generated on device, stored in IndexedDB).
- Agent encrypts all content fields (ECIES P-256 + AES-256-GCM) using the registered public key before POSTing.
- Server relays the encrypted payload to the device via SSE (`GET /api/stream`) if the connection is open.
- If the device is offline (no active SSE connection): server logs a `sync_attempt` with `status = 'device_offline'`, queues the encrypted payload in `free_queue_deliveries` (TTL: 15 min), returns HTTP 202 `{ "queued": N, "queue_ttl_minutes": 15 }` to the agent, and sends a Web Push notification to prompt the user to open the app. When the device reconnects its SSE stream, queued payloads are drained immediately.
- `last_sync_at` on `user_sources` is only updated on successful direct relay (200). It is **never** updated when a payload is queued (202).
- The server stores only **ciphertext** in `free_queue_deliveries` — it cannot read the content.
- Content lives in IndexedDB only — the server never stores decrypted feed items.

### Paid Tier

This is the target hosted direction, not a completed end-to-end implementation.

Planned properties:
- account-based identity (`usr_*`)
- multi-device support via a wrapped private key or equivalent hosted key-management model
- encrypted relay queue with TTL and per-device delivery tracking
- historical backfill for additional devices
- agent encryption against a user/account public key under the same relay-not-reader architecture

The current codebase contains partial scaffolding for this direction, but not a finished hosted account model.

### Self-Hosted

- `user_id = 'local'`, SQLite, local-first assumptions
- no hosted account middleware
- same encrypted relay model: server relays ciphertext and does not persist readable feed content

This is the mode the current repository supports most concretely today.

---

## Deployment Topology

```
 Any MCP Client (Claude Code,            Backend (Render / self-hosted)
 Claude Desktop, LangChain…)        ┌──────────────────────────────────┐
┌────────────────────────┐          │  Fastify Server :3333            │
│  MCP tools:            │          │  ├── /mcp  (MCP transport)       │
│  get_sync_context      │── HTTPS ─▶  ├── /agent/* (REST relay)       │
│  submit_items          │          │  ├── /api/* (PWA + SSE)          │
└────────────────────────┘          │  ├── /oauth/* (auth server)      │
                                    │  ├── SQLite / Postgres            │
 Phone / Desktop (anywhere)         │  ├── Web Push sender             │
┌────────────────────────┐          │  └── Cron (cleanup)              │
│  PWA (Preact)          │══ SSE ══▶  └──────────────────────────────────┘
│  IndexedDB (content)   │
│  Push notifications    │
└────────────────────────┘
```

**Split hosting (recommended)**: Frontend deployed to Vercel (free tier, global CDN); backend runs on Render (free tier, persistent disk for SQLite). `VITE_API_BASE_URL` points to Render; `CORS_ORIGIN` on the backend points to the Vercel URL.

**Self-hosted**: Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:3333`) provides HTTPS without opening ports. Frontend and backend served from the same Fastify process.

---

## Server

### What the Server Does

1. **Registers devices** and stores their public keys
2. **Serves sync context** to agents: sources, last sync timestamps, encryption key, filters
3. **Receives encrypted feed payloads** from agents and relays them to devices via SSE
4. **Stores encrypted payloads only when queueing, replay, or recovery requires server-side retention**
5. **Falls back to Web Push** when the target device has no active SSE connection
6. **Logs sync attempts** (metadata only — no plaintext content)
7. **Manages source configuration, account data, and agent tokens**
8. **Runs OAuth 2.0** authorization server for MCP connector integration
9. **Cleans up stale data** on a daily schedule (sync_attempts, oauth codes/tokens, queue state)

### What the Server Does NOT Do

- Call any upstream API (YouTube, X, NewsAPI, etc.)
- Store decrypted feed items or readable feed content
- Act as the canonical content database for the user's feed
- Decrypt agent payloads — the server handles ciphertext only

### Route Groups

```
/agent/*  →  Bearer token or OAuth token auth  →  server/agent-routes.ts
/mcp      →  Bearer or OAuth token auth        →  server/mcp.ts
/oauth/*  →  public (auth server)              →  server/oauth-routes.ts
/api/*    →  device/session auth               →  server/api-routes.ts
```

#### `/mcp` — Remote MCP Server

Authenticated via Bearer token or OAuth access token. Used by AI agent clients (Claude Code, Claude Desktop, any MCP-compatible runtime).

Exposes MCP tools, resources, and prompt templates. Implemented via `@modelcontextprotocol/sdk` with Streamable HTTP transport.

See **MCP Server** section below. Unchanged from original design.

#### `/agent/*` — REST Agent Endpoints

Authenticated via Bearer token or OAuth access token.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/agent/sync-context` | Sources, last sync timestamps, device public key, filters |
| `POST` | `/agent/feed-items` | Submit a batch of encrypted feed items for relay |

#### `/api/*` — PWA Endpoints

Authenticated via device token (free tier) or session (paid tier).

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/device/register` | Register device public key, get `dev_` user_id |
| `POST` | `/api/v1/device/challenge` | Request a proof-of-possession challenge |
| `POST` | `/api/v1/device/verify` | Verify challenge signature and complete registration |
| `GET` | `/api/stream` | SSE stream — relay encrypted payloads to device |
| `GET` | `/api/sync/status` | Missed sync banner data (sync_attempts metadata) |
| `GET` | `/api/sources` | List user's configured sources |
| `POST` | `/api/sources` | Add a new source |
| `PATCH` | `/api/sources/:name` | Update a source (toggle enabled, edit URLs) |
| `DELETE` | `/api/sources/:name` | Remove a source |
| `GET` | `/api/push/vapid-key` | Public VAPID key for push subscription (global server config) |
| `POST` | `/api/push/subscribe` | Store a push subscription |
| `POST` | `/api/push/unsubscribe` | Remove a push subscription |
| `GET` | `/api/v1/tokens` | List agent tokens for the device/user |
| `POST` | `/api/v1/tokens` | Create a new agent token |
| `DELETE` | `/api/v1/tokens/:hash` | Revoke an agent token by hash |
| `POST` | `/api/v1/queue/ack` | Acknowledge delivery of a paid-tier queued payload |

**Removed routes** (replaced by IndexedDB client reads):
- `GET /api/feed` — feed is read from IndexedDB
- `PATCH /api/feed/:id/read` — read state managed in IndexedDB
- `POST /api/feed/mark-all-read` — managed in IndexedDB
- `GET /api/stats` — computed client-side from IndexedDB

#### `/oauth/*` — Authorization Server

Unchanged. See **OAuth 2.0** section.

---

## Device Registration

```
1. PWA boots for the first time
2. Device generates P-256 keypair via Web Crypto API
3. Private key stored in IndexedDB (non-extractable where supported)
4. Device generates UUID → dev_<uuid> as user_id, stored in IndexedDB
5. POST /api/device/register { public_key: "base64(P-256 point)", device_id: "dev_<uuid>" }
6. Server stores in device_registrations
7. Server returns { user_id: "dev_<uuid>", ok: true }
```

On subsequent boots the device checks IndexedDB for an existing keypair and `user_id`. If found, registration is skipped.

---

## Agent Authentication

Two supported mechanisms — both resolve to a `userId` for downstream handlers:

**Bearer Token** (pre-shared key):
1. User generates a random 256-bit hex string
2. Used as `Authorization: Bearer <token>` by the agent
3. Server hashes the incoming token with SHA-256 and compares against `agent_tokens.token_hash`

**OAuth Access Token** (Claude connector / third-party MCP clients):
- Short-lived token issued after Authorization Code + PKCE flow
- Token value returned to client; only the SHA-256 hash is stored in `oauth_tokens` (mirrors `agent_tokens.token_hash` model)
- Validated by hashing the incoming token and looking up `access_token_hash` + checking expiry

Both mechanisms are handled in shared auth middleware. Route handlers receive `userId` only.

---

## Sync Context — Agent Request

`GET /agent/sync-context` returns everything an agent needs to plan and encrypt a scraping run:

```json
{
  "encryption": {
    "public_key": "base64(P-256 uncompressed point)",
    "algorithm": "ECIES-P256-AES256GCM"
  },
  "sources": [
    {
      "name": "youtube",
      "enabled": true,
      "urls": ["https://www.youtube.com/feed/subscriptions"],
      "last_sync": "2026-04-01T10:00:00Z",
      "max_items": 20,
      "scraping_resource": "scrolless://platforms/youtube"
    },
    {
      "name": "x",
      "enabled": false
    }
  ],
  "filters": {
    "blocked_keywords": ["sponsored", "giveaway"]
  }
}
```

`last_sync_at` is only updated when the server successfully relays a payload to the device (HTTP 200). It is **never** updated on 503 `device_offline`.

---

## Encryption Scheme (ECIES-P256-AES256GCM)

### Overview

ECIES (Elliptic Curve Integrated Encryption Scheme) using P-256 with AES-256-GCM for authenticated encryption. The agent encrypts per-item; the server relays ciphertext; the device decrypts.

### Encryption (Agent Side)

For each feed item:

1. **Generate ephemeral keypair**: Agent generates a fresh P-256 keypair for this POST batch (`ephemeral_private_key`, `ephemeral_public_key`).
2. **ECDH shared secret**: `shared_secret = ECDH(ephemeral_private_key, device_public_key)`
3. **Key derivation**: `aes_key = HKDF-SHA256(shared_secret, salt=[] (empty), info="scrolless-v1", length=32)`
4. **Encrypt per item**: For each item's content fields (`title`, `author`, `content_preview`, `thumbnail_url`, `tags`):
   - Serialize fields as UTF-8 JSON
   - Generate 12-byte random IV
   - `ciphertext || authTag = AES-256-GCM(aes_key, iv, plaintext)`
   - `encrypted_fields = base64(iv || ciphertext || authTag)`
5. **Include in payload**: The ephemeral public key is included once per POST; `encrypted_fields` is per item.

### Agent POST Payload

```json
{
  "source": "youtube",
  "ephemeral_public_key": "base64(P-256 uncompressed point)",
  "items": [
    {
      "source_id": "abc123",
      "url": "https://youtube.com/watch?v=abc123",
      "published_at": "2026-04-01T10:00:00Z",
      "is_discovery": false,
      "encrypted_fields": "base64(iv[12] || ciphertext || authTag[16])"
    }
  ]
}
```

Metadata fields (`source_id`, `url`, `published_at`, `is_discovery`) remain plaintext so the server can log and dedup by URL hash without decrypting.

### Decryption (Device Side)

1. Retrieve device private key from IndexedDB
2. `shared_secret = ECDH(device_private_key, ephemeral_public_key)`
3. `aes_key = HKDF-SHA256(shared_secret, salt=[] (empty), info="scrolless-v1", length=32)`
4. For each item: `iv = encrypted_fields[0:12]`, `ciphertext = encrypted_fields[12:-16]`, `authTag = encrypted_fields[-16:]`
5. `plaintext = AES-256-GCM-Decrypt(aes_key, iv, ciphertext, authTag)`
6. Parse plaintext JSON → `{ title, author, content_preview, thumbnail_url, tags }`

### Server Behaviour

The server **never decrypts**. It:
- Validates the payload shape
- Computes `url_hash = SHA-256(normalised_url)` for dedup logging in `sync_attempts`
- Relays the full payload (including `encrypted_fields`) to the device via SSE or push
- Logs the attempt in `sync_attempts`

---

## SSE Delivery

`GET /api/stream` — the device opens a persistent SSE connection when the app is in the foreground.

### Flow

```
1. Device opens GET /api/stream (authenticated)
2. Server registers the connection against user_id
3. Agent POSTs to /agent/feed-items
4. Server checks: does user_id have an active SSE connection?
   YES → emit SSE event with full encrypted payload → return 200 to agent
         update last_sync_at on user_sources
   NO  → log sync_attempt(status='device_offline')
         queue encrypted payload in free_queue_deliveries (TTL: 15 min)
         attempt Web Push notification (prompt user to open app)
         return 202 { queued: N, queue_ttl_minutes: 15 } to agent
         last_sync_at is NOT updated (payload not yet delivered)

5. On device reconnect (GET /api/stream):
         server drains pending free_queue_deliveries rows via SSE
         marks drained rows as 'delivered'
```

### SSE Event Shape

```
event: feed_items
data: {"source":"youtube","ephemeral_public_key":"...","items":[...]}
```

### Reconnection

The device uses `EventSource` with exponential backoff. The server sends a `keepalive` comment every 30 s to prevent connection drops.

---

## Web Push (Fallback)

Web Push fires when the app is closed (no active SSE connection). It carries a notification payload only — not the encrypted content. The notification prompts the user to open the app, at which point the device will receive a fresh sync from the agent on next run.

### Flow

1. PWA registers service worker → user enables notifications
2. Service worker subscribes via Push API using VAPID public key
3. PWA sends `PushSubscription` to `POST /api/push/subscribe`
4. When agent POSTs and device is offline: server sends push notification
5. Push service (FCM/Mozilla) delivers to device
6. Service worker shows system notification
7. User taps → PWA opens → SSE reconnects → next agent run delivers content

### Notification Shape

One notification per agent POST, grouped by source:

```json
{
  "title": "5 new items from YouTube",
  "body": "Your feed updated while you were away.",
  "source": "youtube",
  "count": 5,
  "url": "/"
}
```

---

## MCP Server

Unchanged from original design. Runs at `/mcp` using Streamable HTTP transport. Wraps the same business logic as the REST agent routes.

### Tools

**`get_sync_context`** — Returns the full sync context (sources, encryption key, filters). No arguments.

**`submit_items`** — Submit a batch of encrypted items from one source. Same validation as `POST /agent/feed-items`.

```typescript
// Arguments
{
  source: string;
  ephemeral_public_key: string;   // base64 P-256 point
  items: AgentFeedItem[];
}
// Response
{ relayed: number; offline: boolean; }
```

### Resources

MCP resources serve per-platform scraping instructions. Content is served from `skill/resources/{name}.md`.

| URI | Content |
|---|---|
| `scrolless://platforms/youtube` | YouTube subscription feed extraction instructions |
| `scrolless://platforms/x` | X/Twitter timeline extraction instructions |
| `scrolless://platforms/news` | News site extraction instructions |
| `scrolless://platforms/{name}` | Custom source instructions |

### Prompts

**`run_feed_sync`** — Complete sync workflow prompt. Includes encryption instructions for the agent.

---

## OAuth 2.0

Unchanged. Implements Authorization Code flow with PKCE (RFC 7636).

### Flow

```
1. MCP client redirects user to:
   GET /oauth/authorize?client_id=X&redirect_uri=Y&code_challenge=Z&state=S

2. User authenticates and approves the connector

3. Server redirects to redirect_uri with ?code=AUTH_CODE&state=S

4. Client exchanges code:
   POST /oauth/token
   { grant_type: "authorization_code", code, redirect_uri, code_verifier }

5. Server returns:
   { access_token, token_type: "Bearer", expires_in: 3600, refresh_token }

6. Client uses access_token for MCP requests:
   Authorization: Bearer ACCESS_TOKEN
```

### OAuth Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/oauth/authorize` | Consent screen, issue auth code |
| `POST` | `/oauth/token` | Exchange code or refresh token |
| `POST` | `/oauth/revoke` | Revoke access or refresh token |
| `GET` | `/oauth/.well-known/oauth-authorization-server` | Server metadata |

---

## Server Storage Schema

The server stores **no feed content**. All tables below are metadata/infrastructure only.

### `device_registrations`

```sql
CREATE TABLE device_registrations (
    user_id     TEXT PRIMARY KEY,        -- "dev_<uuid>"
    public_key  TEXT NOT NULL,           -- base64 P-256 uncompressed point
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_seen   TEXT
);
```

### `user_sources`

```sql
CREATE TABLE user_sources (
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,              -- "youtube", "x", "news", or custom
    enabled         INTEGER NOT NULL DEFAULT 1,
    urls            TEXT NOT NULL DEFAULT '[]', -- JSON array
    max_items       INTEGER,
    last_sync_at    TEXT,                       -- updated on successful relay only
    scraping_notes  TEXT,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    PRIMARY KEY (user_id, name)
);
```

`last_sync_at` is **only** updated when the server returns 200 to the agent (successful relay). Never updated on 503.

### `sync_attempts`

Append-only log of every agent POST attempt (metadata only — no content).

```sql
CREATE TABLE sync_attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    item_count  INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL,  -- 'relayed' | 'device_offline' | 'error'
    error       TEXT            -- NULL unless status='error'
);

CREATE INDEX idx_sync_attempts_user ON sync_attempts(user_id, attempted_at DESC);
```

Used by `GET /api/sync/status` to power the missed-sync banner in the PWA.

### `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    endpoint    TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

### `free_queue_deliveries`

Short-lived encrypted relay queue for free-tier devices. Server stores **ciphertext only**. Entries have a 15-minute TTL and are purged after delivery or expiry.

```sql
CREATE TABLE free_queue_deliveries (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          TEXT NOT NULL,
    payload_envelope TEXT NOT NULL, -- JSON of the encrypted relay payload (ciphertext)
    queued_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at       TEXT NOT NULL,
    delivered_at     TEXT,
    status           TEXT NOT NULL DEFAULT 'queued' -- queued | delivered | expired
);
```

### `agent_tokens`

```sql
CREATE TABLE agent_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    last_used   TEXT
);
```

### OAuth Tables

```sql
CREATE TABLE oauth_clients (
    client_id       TEXT PRIMARY KEY,
    client_secret   TEXT,
    redirect_uris   TEXT NOT NULL,  -- JSON array
    label           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE oauth_auth_codes (
    code            TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    redirect_uri    TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Tokens stored as SHA-256 hashes only; plaintext is returned to the client once and never persisted
CREATE TABLE oauth_tokens (
    access_token_hash   TEXT PRIMARY KEY,
    refresh_token_hash  TEXT UNIQUE,
    client_id           TEXT NOT NULL,
    user_id             TEXT NOT NULL,
    access_expires      TEXT NOT NULL,
    refresh_expires     TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
```

---

## IndexedDB Schema (Device)

All feed content lives here. The server never sees plaintext.

### `feed_items`

```typescript
interface FeedItem {
  id: string;              // "source:source_id"
  user_id: string;         // dev_* | usr_* | local
  source: string;
  source_id: string;
  url: string;
  url_hash: string;        // SHA-256 of normalised URL (client-side dedup)
  published_at: string;    // ISO 8601
  fetched_at: string;      // ISO 8601 — used for retention
  is_discovery: boolean;
  is_read: boolean;
  is_saved: boolean;
  // Decrypted content fields
  title: string;
  author?: string;
  content_preview?: string;
  thumbnail_url?: string;
  tags: string[];
}
```

Indexes: `url_hash` (unique), `published_at` (desc), `source`, `is_read`, `is_discovery`, `is_saved`.

### `sync_log`

```typescript
interface SyncLogEntry {
  id: number;             // autoincrement
  source: string;
  synced_at: string;      // ISO 8601
  items_added: number;
  items_duped: number;
}
```

Append-only. Used to display last-sync time in the UI.

### `preferences`

Key-value store. Preference keys (`blocked_keywords`, `max_items_per_source`, `retention_days`) are synced from the server on each boot so local logic (e.g. retention cleanup) always uses the user's configured values.

| Key | Default | Type |
|---|---|---|
| `blocked_keywords` | `[]` | `string[]` |
| `max_items_per_source` | `50` | `number` |
| `retention_days` | `7` | `number` |
| `enrollment_token` | — | `string` |

### `device`

```typescript
interface DeviceRecord {
  id: 'singleton';
  user_id: string;          // dev_* stored here for persistence across sessions
  public_key: string;       // base64
  private_key: CryptoKey;   // non-extractable where supported
  registered_at: string;
}
```

---

## URL Normalisation & Deduplication

**Dedup is client-side.** Before storing a received item, the device:

1. Normalises the URL:
   - Lowercase hostname
   - Remove tracking params: `utm_*`, `s`, `ref`, `feature`
   - Convert YouTube short URLs: `youtu.be/ID` → `https://www.youtube.com/watch?v=ID`
   - Sort remaining query params alphabetically
   - Strip trailing slashes
2. Computes `url_hash = SHA-256(normalised_url)`
3. Checks IndexedDB: if `url_hash` already exists, discard the item
4. Otherwise, store with `url_hash`

The server does not dedup. It relays all items received from the agent.

---

## Data Retention & Cleanup

**Client-side**: A routine (triggered on app open) deletes items from IndexedDB where `fetched_at < now - retention_days`. Default: 7 days. Uses `fetched_at`, not `published_at`. The `retention_days` value is synced from the server (`GET /api/preferences`) to IndexedDB on each boot so the device always uses the user's configured value.

**Server-side cron** (daily, 3:00 AM):
- Delete `oauth_auth_codes` older than 10 minutes
- Delete expired `oauth_tokens`
- Delete `sync_attempts` older than 30 days

---

## Missed Sync Banner

On app boot, `GET /api/sync/status` returns recent `sync_attempts` metadata:

```json
{
  "missed": [
    {
      "source": "youtube",
      "attempted_at": "2026-04-01T18:00:00Z",
      "status": "device_offline",
      "item_count": 5
    }
  ],
  "next_sync_estimate": "2026-04-01T19:30:00Z"
}
```

The PWA displays: _"Feed tried to refresh at 6:00pm but your device was unreachable. Next refresh at 7:30pm."_

---

## Frontend — PWA

### Component Architecture

```
App
├── DeviceInit               # First boot: generate keypair, register device
├── MissedSyncBanner         # Conditional: show if sync_attempts has device_offline entries
├── NotificationPrompt       # One-time: request permission + subscribe
├── SourceFilter             # Tabs: All | YouTube | X | News (unread counts)
│                            # Sub-tabs: Feed | Discovery
├── SyncStatus               # "Last synced 3 min ago" + error badge
└── FeedList
    ├── YouTubeCard          # Thumbnail, title, channel, expand → preview
    ├── XCard                # Author, text, expand → full tweet
    └── NewsCard             # Headline, source, expand → excerpt + thumbnail

Settings (/#/settings)
├── SourceList               # Cards per user_source: toggle enabled, edit URLs
├── AddSourceForm            # Name + URLs + optional scraping notes
├── AgentTokens              # View/create/revoke agent tokens
└── DangerZone               # Delete local data / unregister device
```

### URL Routing

Uses `preact-iso` with hash routing. Views: `/#/` (feed), `/#/discover`, `/#/saved`, `/#/settings`.

### Service Worker

Two responsibilities:

1. **Push handler**: Receive push events → show system notification → handle tap → open PWA
2. **Offline cache**: Cache app shell on install. Serve cached shell for navigation requests. Pass API requests through to network.

Service worker output must be `sw.js` at build root (not content-hashed).

### SSE Connection Lifecycle

The PWA opens `GET /api/stream` on mount and closes it on unmount. Incoming SSE events are dispatched to a handler that:

1. Decrypts `encrypted_fields` using the device private key
2. Merges items into IndexedDB (dedup by `url_hash`)
3. Updates the feed UI reactively

---

## Agent Feed Item Schema

```typescript
interface AgentFeedItem {
  source_id: string;       // Platform-native ID
  url: string;             // Canonical URL (plaintext — server logs url_hash)
  published_at: string;    // ISO 8601 (plaintext)
  is_discovery?: boolean;  // default false (plaintext)
  encrypted_fields: string; // base64(iv[12] || ciphertext || authTag[16])
                            // Decrypts to: { title, author, content_preview, thumbnail_url, tags }
}
```

---

## Error Handling

### Agent Errors

- Device offline → 202 `{ "queued": N, "queue_ttl_minutes": 15 }` — payload queued, agent may advance `last_sync` window
- Invalid payload → 400 with descriptive message
- Invalid token → 401
- Server 429 → rate limited, stop and wait for next run

### Server Errors

- Push delivery 410 (Gone) → delete stale subscription
- Expired OAuth token → 401 with `WWW-Authenticate: Bearer error="invalid_token"`

### Rate Limiting

Two rate-limited scopes:

| Scope | Limit | Key | Reason |
|---|---|---|---|
| `/agent/*` + `/mcp` | 60 req / hour | `Authorization` header or IP | Throttle agent scraping runs |
| `/oauth/*` | 20 req / minute | IP | Protect unauthenticated PKCE/token endpoints |

`/api/*` device routes rely on device session auth as the primary protection; individual high-risk endpoints (device register, challenge, verify) are under the same IP-keyed OAuth scope limit when applicable.

### 202 device_offline Semantics (Free Tier)

- Returned to agent when there is no active SSE connection for the target `user_id`
- `last_sync_at` on `user_sources` is **not** updated (payload not yet delivered to device)
- `sync_attempts` row is inserted with `status = 'device_offline'`
- Encrypted payload queued in `free_queue_deliveries` with 15-minute TTL
- Web Push notification is attempted (notify user to open app)
- When device reconnects via SSE, queued rows are drained immediately
- Queued rows are marked `expired` after TTL and purged within 24 h
- Agent may advance its `last_sync` window on 202 (payload is safely queued)

---

## Paid Tier — Extended Design

### Multi-Device Key Wrapping

```
1. On account creation: device generates P-256 keypair
2. User sets a passphrase
3. Passphrase → Argon2id → 32-byte wrapping key
4. Private key encrypted with wrapping key (AES-256-GCM)
5. Ciphertext stored server-side in `user_key_bundles`
6. On new device: user enters passphrase → derive wrapping key → decrypt private key
7. New device now holds the same private key → receives the same encrypted payloads
```

The passphrase never leaves the client. The server stores only the ciphertext of the private key.

### Offline Queue

When a paid-tier device is offline, the server queues the encrypted relay payload in `relay_queue` with a configurable TTL (default 24 h). On reconnect, the device pulls missed payloads. Queue entries are deleted after delivery or TTL expiry.

### Additional Server Tables (Paid Tier)

```sql
CREATE TABLE user_key_bundles (
    user_id         TEXT PRIMARY KEY,    -- usr_*
    public_key      TEXT NOT NULL,       -- base64 P-256 point (plaintext)
    wrapped_key     TEXT NOT NULL,       -- base64 AES-GCM(Argon2id(passphrase), private_key)
    argon2_params   TEXT NOT NULL,       -- JSON: { m, t, p, salt }
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE relay_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT NOT NULL,
    payload         TEXT NOT NULL,       -- JSON encrypted relay payload (server never decrypts)
    queued_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    expires_at      TEXT NOT NULL,
    delivered       INTEGER NOT NULL DEFAULT 0
);
```

---

## Production Notes

### Timestamps

All SQLite defaults use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` to produce UTC ISO 8601 strings with a `Z` suffix. Client code always appends `Z` when parsing if missing: `new Date(ts.endsWith('Z') ? ts : ts + 'Z')`.

### User Identity Seam

`user_id` is always one of `'local'` | `dev_*` | `usr_*`. Auth middleware resolves this before handing off to route handlers. Every DB query includes `WHERE user_id = ?`. Never hardcode `'local'` except in the self-hosted bootstrap path.

### Source Labels

Source names are stored lowercase (`'youtube'`, `'x'`, `'news'`). Display labels are mapped client-side:

```typescript
const SOURCE_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  x: 'X',
  news: 'News',
};
```

### Hosting

The server binds to `127.0.0.1:3333`. HTTPS is always handled externally (Cloudflare Tunnel, load balancer, or platform proxy).
