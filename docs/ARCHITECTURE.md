# Architecture

## Design Principles

1. **Dumb server, smart agent**: The server stores data, serves it, and sends push notifications. It never communicates with YouTube, X, or any content platform. All platform interaction is the agent's responsibility.
2. **MCP-first agent interface**: The primary integration point for AI agents is a Remote MCP server. The underlying REST `/agent/*` endpoints remain available for non-MCP clients (scripts, curl, cron jobs).
3. **Multi-user, production-grade**: Designed for shared hosting from the start. Every query is scoped to `user_id`. Auth, source management, and agent tokens are all per-user.
4. **Production-promotable internals**: Schema, routes, and skill are designed so scaling from SQLite to Postgres and from one user to many is a configuration change, not a rewrite.
5. **Installable PWA**: The frontend is a Progressive Web App with push notifications, installable on Android.

---

## Deployment Topology

```
 Any MCP Client (Claude Code,            Hosting (Render / self-hosted)
 Claude Desktop, LangChain…)        ┌─────────────────────────────┐
┌────────────────────────┐          │  Fastify Server :3333       │
│  MCP tools:            │          │  ├── /mcp  (MCP transport)  │
│  get_sync_context      │── HTTPS ─▶  ├── /agent/* (REST)        │
│  submit_items          │          │  ├── /api/* (PWA)           │
└────────────────────────┘          │  ├── /oauth/* (auth)        │
                                    │  ├── SQLite / Postgres       │
 Phone / Desktop (anywhere)         │  ├── Web Push sender        │
┌────────────────────────┐          │  └── Cron (cleanup)         │
│  PWA (Preact)          │── HTTPS ─▶  └─────────────────────────┘
│  Reads from /api/*     │
│  Push notifications    │
└────────────────────────┘
```

For personal/self-hosted use: a Cloudflare Tunnel (`cloudflared`) provides HTTPS from a home server without opening inbound ports. HTTPS is provided at the Cloudflare edge; Fastify serves plain HTTP on :3333.

For quick testing: `cloudflared tunnel --url http://localhost:3333` generates a temporary public URL instantly.

---

## Server

### What the Server Does

1. **Serves sync context** to agents: which sources to scrape, when last synced, what to filter
2. **Receives feed items** from agents via MCP tool or REST POST
3. **Deduplicates** items by URL hash at insert time
4. **Sends push notifications** when new items arrive
5. **Serves the feed** to the PWA via `GET /api/feed`
6. **Manages read state** and source configuration
7. **Cleans up old items** on a daily schedule

### What the Server Does NOT Do

- Call any upstream API (YouTube, X, NewsAPI, etc.)
- Store OAuth tokens for external services
- Know how to scrape or parse any platform
- Perform any content transformation or enrichment

### Route Groups

The server has four route groups:

#### `/mcp` — Remote MCP Server

Authenticated via Bearer token or OAuth access token. Used by AI agent clients (Claude Code, Claude Desktop, any MCP-compatible runtime).

Exposes MCP tools, resources, and prompt templates. Implemented via `@modelcontextprotocol/sdk` with Streamable HTTP transport.

See **MCP Server** section below.

#### `/agent/*` — REST Agent Endpoints

Authenticated via Bearer token. The underlying REST layer — also callable directly by scripts or non-MCP agents.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/agent/sync-context` | Single call: enabled sources with URLs + last sync + filters |
| `POST` | `/agent/feed-items` | Submit a batch of scraped feed items |

#### `/api/*` — PWA Endpoints

Session-authenticated (Clerk). Used by the frontend.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/feed` | Unified feed with filtering + pagination |
| `PATCH` | `/api/feed/:id/read` | Mark item as read |
| `PATCH` | `/api/feed/:id/unread` | Mark item as unread |
| `POST` | `/api/feed/mark-all-read` | Mark all (or filtered) items as read |
| `GET` | `/api/stats` | Total, unread, per-source counts |
| `GET` | `/api/sync/status` | Last agent sync time per source |
| `GET` | `/api/sources` | List user's configured sources |
| `POST` | `/api/sources` | Add a new source |
| `PATCH` | `/api/sources/:name` | Update a source (toggle enabled, edit URLs) |
| `DELETE` | `/api/sources/:name` | Remove a source |
| `GET` | `/api/push/vapid-key` | Public VAPID key for push subscription |
| `POST` | `/api/push/subscribe` | Store a push subscription |
| `POST` | `/api/push/unsubscribe` | Remove a push subscription |

#### `/oauth/*` — Authorization Server

Implements OAuth 2.0 Authorization Code flow with PKCE. Required for Claude connector integration and any third-party MCP client.

See **OAuth 2.0** section below.

### Agent Authentication

Two supported mechanisms — both produce a resolved `userId` for downstream handlers:

**Bearer Token** (for scripts, direct REST, and MCP clients using pre-shared keys):
1. User generates a random 256-bit hex string
2. The plaintext key is used in the agent's MCP config or passed as `Authorization: Bearer <token>`
3. A SHA-256 hash is stored in `agent_tokens`
4. Server hashes the incoming token and compares against the stored hash

**OAuth Access Token** (for Claude connector and third-party MCP clients):
- Short-lived access token issued after Authorization Code + PKCE flow
- Validated against `oauth_tokens` table, checking expiry and user binding
- See OAuth 2.0 section for full flow

Both mechanisms are handled in a shared auth middleware. The route handlers never care which was used.

---

## MCP Server

The MCP server runs at `/mcp` using the Streamable HTTP transport from `@modelcontextprotocol/sdk`. It wraps the same business logic as the REST agent routes.

### Tools

**`get_sync_context`**

Returns everything an agent needs to plan a scraping run. No arguments.

```typescript
// Response
{
  sources: [
    {
      name: "youtube",
      enabled: true,
      urls: ["https://www.youtube.com/feed/subscriptions"],
      last_sync: "2026-03-28T10:00:00Z",  // scrape items newer than this
      max_items: 20,
      scraping_resource: "scrolless://platforms/youtube"
    },
    {
      name: "x",
      enabled: false  // skip — no further fields needed
    },
    {
      name: "news",
      enabled: true,
      urls: ["https://news.ycombinator.com", "https://arstechnica.com"],
      last_sync: "2026-03-28T08:30:00Z",
      max_items: 20,
      scraping_resource: "scrolless://platforms/news"
    }
  ],
  filters: {
    blocked_keywords: ["sponsored", "giveaway"]
  }
}
```

`enabled: false` replaces the old `blocked_sources` concept. If a source isn't enabled, the agent skips it — no separate blocklist needed.

**`submit_items`**

Submit a batch of scraped items from one source.

```typescript
// Arguments
{
  source: string;    // "youtube" | "x" | "news" | custom
  items: AgentFeedItem[];
}

// Response
{
  inserted: number;
  duplicates: number;
}
```

Same validation and dedup behaviour as `POST /agent/feed-items`.

### Resources

MCP resources serve the per-platform scraping instructions. The agent fetches these at runtime — no local skill files needed.

| URI | Content |
|---|---|
| `scrolless://platforms/youtube` | YouTube subscription feed extraction instructions |
| `scrolless://platforms/x` | X/Twitter timeline extraction instructions |
| `scrolless://platforms/news` | News site extraction instructions |
| `scrolless://platforms/{name}` | Custom source instructions (user-added) |

Resource content is served from `skill/resources/{name}.md`. When a user adds a custom source in the PWA, they optionally provide scraping hints that are stored in `user_sources.scraping_notes` and merged into the resource response.

### Prompts

**`run_feed_sync`**

A prompt template that encodes the complete sync workflow. An agent running `/loop update my ScrolLess feed` or similar needs no other instructions.

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

---

## OAuth 2.0

Implements Authorization Code flow with PKCE (RFC 7636). Required for Claude connector integration.

### Flow

```
1. MCP client (e.g. Claude) redirects user to:
   GET /oauth/authorize?client_id=X&redirect_uri=Y&code_challenge=Z&state=S

2. User authenticates (Clerk session) and approves the connector

3. Server redirects to redirect_uri with:
   ?code=AUTH_CODE&state=S

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
| `GET` | `/oauth/authorize` | Show consent screen, issue auth code |
| `POST` | `/oauth/token` | Exchange code or refresh token for access token |
| `POST` | `/oauth/revoke` | Revoke an access or refresh token |
| `GET` | `/oauth/.well-known/oauth-authorization-server` | Server metadata (for auto-discovery) |

### Client Registration

In the PoC and small-scale deployment, clients are registered manually via `config.json`:

```json
{
  "oauth": {
    "clients": [
      {
        "client_id": "claude-connector",
        "redirect_uris": ["https://claude.ai/oauth/callback"],
        "is_public": true
      }
    ],
    "token_expires_in": 3600,
    "refresh_token_expires_in": 2592000
  }
}
```

In production, a dashboard UI allows users to register and revoke clients.

---

## Storage Schema

### `feed_items` — Core unified feed

```sql
CREATE TABLE feed_items (
    id              TEXT PRIMARY KEY,          -- "source:source_id"
    user_id         TEXT NOT NULL,
    source          TEXT NOT NULL,
    title           TEXT,
    author          TEXT,
    url             TEXT NOT NULL,
    url_hash        TEXT NOT NULL,             -- SHA-256 of normalised URL
    content_preview TEXT,
    thumbnail_url   TEXT,
    tags            TEXT,                      -- JSON array: '["tech","ai"]'
    is_discovery    INTEGER NOT NULL DEFAULT 0,
    published_at    TEXT NOT NULL,             -- ISO 8601
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    is_read         INTEGER NOT NULL DEFAULT 0,
    raw_json        TEXT
);

CREATE UNIQUE INDEX idx_feed_url_hash ON feed_items(user_id, url_hash);
CREATE INDEX idx_feed_published ON feed_items(published_at DESC);
CREATE INDEX idx_feed_source ON feed_items(source);
CREATE INDEX idx_feed_read ON feed_items(is_read);
CREATE INDEX idx_feed_user ON feed_items(user_id);
CREATE INDEX idx_feed_discovery ON feed_items(is_discovery);
```

### `user_sources` — User-configured scraping sources

```sql
CREATE TABLE user_sources (
    user_id         TEXT NOT NULL,
    name            TEXT NOT NULL,              -- "youtube", "x", "news", or custom
    enabled         INTEGER NOT NULL DEFAULT 1,
    urls            TEXT NOT NULL DEFAULT '[]', -- JSON array of URLs to scrape
    max_items       INTEGER,                    -- NULL = use global default
    scraping_notes  TEXT,                       -- Optional hints merged into MCP resource
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, name)
);
```

Default sources are seeded at account creation (youtube, x, news — all with `enabled = 0` until the user activates them).

### `agent_tokens` — Agent API keys

```sql
CREATE TABLE agent_tokens (
    token_hash  TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    label       TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_used   TEXT
);
```

### `sync_log` — Append-only agent sync audit trail

```sql
CREATE TABLE sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    source      TEXT NOT NULL,
    synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
    items_added INTEGER NOT NULL DEFAULT 0,
    items_duped INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);
```

### `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    endpoint    TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `user_preferences` — Global per-user settings

```sql
CREATE TABLE user_preferences (
    user_id     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,  -- JSON-encoded
    PRIMARY KEY (user_id, key)
);
```

Seeded defaults:
- `blocked_keywords`: `[]`
- `max_items_per_source`: `50`
- `retention_days`: `7`

Note: `blocked_sources` is no longer a preference key — per-source enable/disable lives in `user_sources.enabled`.

### OAuth tables

```sql
CREATE TABLE oauth_clients (
    client_id       TEXT PRIMARY KEY,
    client_secret   TEXT,           -- NULL for public clients (PKCE only)
    redirect_uris   TEXT NOT NULL,  -- JSON array
    label           TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE oauth_auth_codes (
    code            TEXT PRIMARY KEY,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    redirect_uri    TEXT NOT NULL,
    code_challenge  TEXT NOT NULL,  -- PKCE S256 challenge
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE oauth_tokens (
    access_token    TEXT PRIMARY KEY,
    refresh_token   TEXT UNIQUE,
    client_id       TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    access_expires  TEXT NOT NULL,
    refresh_expires TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## URL Normalisation & Deduplication

Applied server-side at insert time before hashing:

1. Lowercase the hostname
2. Remove tracking parameters: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `s`, `ref`, `feature`
3. Convert YouTube short URLs: `youtu.be/VIDEO_ID` → `https://www.youtube.com/watch?v=VIDEO_ID`
4. Sort remaining query parameters alphabetically
5. Strip trailing slashes

The agent doesn't need to normalise — the server handles it.

---

## Data Retention & Cleanup

A daily cron (default 3:00 AM) deletes old feed items:

```sql
DELETE FROM feed_items
WHERE user_id = ?
  AND fetched_at < datetime('now', '-N days')
```

Where N is the `retention_days` preference (default: 7). Uses `fetched_at`, not `published_at`.

Also cleans oauth_auth_codes older than 10 minutes and expired oauth_tokens.

---

## Web Push Notifications

### Flow

1. PWA registers service worker → user enables notifications
2. Service worker subscribes via Push API using the VAPID public key
3. PWA sends the PushSubscription to `POST /api/push/subscribe`
4. When `submit_items` / `POST /agent/feed-items` inserts new items, server sends push notification
5. Push service (FCM/Mozilla) delivers to the device
6. Service worker shows system notification
7. User taps → PWA opens

### Notification Grouping

One notification per agent POST, not per item:

```json
{
  "title": "5 new items from YouTube",
  "body": "Latest: Video Title Here",
  "source": "youtube",
  "count": 5,
  "url": "/"
}
```

---

## Frontend — PWA

### Requirements

- Served over HTTPS
- Web app manifest with 192x192 and 512x512 icons
- Service worker for push events + offline app shell caching
- `"display": "standalone"` for native-app feel on Android

### Component Architecture

```
App
├── NotificationPrompt    # One-time: request permission + subscribe
├── SourceFilter          # Tabs: All | YouTube | X | News (with unread counts)
│                         # Sub-tabs or toggle: Feed | Discovery
├── SyncStatus            # "Last synced 3 min ago" + error badge
└── FeedList
    ├── YouTubeCard       # Thumbnail, title, channel, expand → preview
    ├── XCard             # Author, text, expand → full tweet
    └── NewsCard          # Headline, source, expand → excerpt + thumbnail

Settings (/settings)
├── SourceList            # Cards for each user_source: toggle enabled, edit URLs
├── AddSourceForm         # Name + URLs + optional scraping notes
├── AgentTokens           # View/create/revoke agent tokens
└── DangerZone            # Delete account data
```

### Service Worker

Two responsibilities:

1. **Push handler**: Receive push events → show system notification → handle notification click
2. **Offline cache**: Cache the app shell on install. Serve cached shell for navigation requests. Pass API requests through to network.

---

## The Agent Skill

The scraping logic lives outside the server. With the MCP server in place, the agent needs no local skill files — it discovers everything at runtime.

### MCP-Based Workflow (primary)

An agent with the ScrolLess MCP server configured needs only a single instruction:

```
Use the run_feed_sync prompt from the ScrolLess MCP server.
```

Or equivalently for a `/loop` invocation:

```
Call get_sync_context, scrape each enabled source per its scraping_resource instructions, submit via submit_items.
```

### REST-Based Workflow (fallback / non-MCP clients)

For agents that cannot connect to an MCP server, `skill/SKILL.md` documents the equivalent workflow using direct REST calls to `/agent/sync-context` and `/agent/feed-items`.

### Platform Scraping Instructions

Instructions live in `skill/resources/{platform}.md` and are served as MCP resources at `scrolless://platforms/{platform}`. Each file provides:

1. **Target URL(s)**: Where to navigate
2. **Extraction guidance**: What data to pull, described semantically
3. **Pagination**: How to scroll or page through results
4. **Edge cases**: Content to skip and how to identify it
5. **Field mapping**: How to map extracted data to the `AgentFeedItem` schema

Instructions are written for an AI agent that understands pages visually — not for a traditional scraper needing exact selectors.

### Agent Feed Item Schema

```typescript
interface AgentFeedItem {
  // Required
  source_id: string;       // Platform-native ID (video ID, tweet ID, etc.)
  title: string;
  url: string;             // Canonical URL — server normalises for dedup
  published_at: string;    // ISO 8601

  // Optional
  author?: string;
  content_preview?: string;  // First ~300 chars
  thumbnail_url?: string;
  tags?: string[];
  is_discovery?: boolean;    // false = subscribed feed, true = suggested/trending
}
```

---

## Error Handling

### Agent Errors

- Browser timeouts, CAPTCHAs, login prompts → log and skip that source
- Network errors → retry once, then abort that source
- Server 401 → token invalid, stop and alert user
- Server 429 → rate limited, stop and wait for next run

### Server Errors

- Invalid payload → 400 with descriptive error
- Invalid token → 401
- Push delivery 410 (Gone) → delete stale subscription
- Expired OAuth token → 401 with `WWW-Authenticate: Bearer error="invalid_token"`

### Rate Limiting

Applied on MCP and REST agent endpoints:
- Default: 60 requests per hour per token/user
- Configurable in `config.json`
- Returns 429 with `Retry-After` header

---

## Production Notes

### Database

**Current**: SQLite, single file.
**Production**: Migrate to Postgres (or Turso for edge SQLite). The schema uses standard SQL — the only SQLite-specific construct is `datetime('now')` which becomes `NOW()` in Postgres.

Use parameterised queries everywhere. No string concatenation in SQL.

### User Identity

User auth is handled by Clerk. Clerk session cookie authenticates `/api/*` routes and resolves `user_id`. The MCP and `/agent/*` routes use token-based auth (Bearer or OAuth) which also resolves to a `user_id`. All queries are already scoped with `WHERE user_id = ?`.

### Client-Side Encryption (optional)

For private deployments, content fields can be encrypted by the agent before submission and decrypted in the browser. The server stores ciphertext in the same `TEXT` columns — no schema changes needed.

- Algorithm: AES-256-GCM
- Key derivation: PBKDF2(passphrase, user-specific salt, 100000 iterations)
- Salt stored server-side; passphrase never sent to server
- Metadata fields (`source`, `published_at`, `tags`, `is_discovery`, `is_read`) remain plaintext for querying

### Hosting

The server binds to `127.0.0.1:3333` and makes no assumptions about the network layer. HTTPS is always handled externally (Cloudflare Tunnel, load balancer, or platform proxy).
