# Architecture

## Design Principles

1. **Dumb server, smart agent**: The server stores data, serves it, and sends push notifications. It never communicates with YouTube, X, or any content platform. All platform interaction is the agent's responsibility.
2. **Agent-agnostic**: The server exposes simple REST endpoints. Any agent that can make HTTP requests can populate the feed — Cowork, Claude Code, OpenClaw, a cron job with curl, or a custom script.
3. **Self-hosted, single-user (PoC)**: Runs on the user's own hardware. A Cloudflare Tunnel provides HTTPS access from anywhere.
4. **Production-promotable**: The schema, routes, and skill are designed so that adding multi-user auth and encryption later is a wrapping exercise, not a rewrite.
5. **Installable PWA**: The frontend is a Progressive Web App with push notifications, installable on Android.

---

## Deployment Topology

```
 Desktop (Cowork + Chrome)          Cloudflare Edge           Home Server (Fedora)
┌─────────────────────────┐     ┌──────────────────┐     ┌─────────────────────────┐
│  Agent (skill runner)   │     │                  │     │  Fastify API :3333      │
│  Claude in Chrome       │─ HTTPS ─▶  Tunnel      │─────▶  ├── /agent/* routes    │
│  Scrapes platforms      │     │  (free tier)     │     │  ├── /api/* routes      │
│  Posts to /agent/*      │     │                  │     │  ├── SQLite (feed.db)   │
└─────────────────────────┘     └──────────────────┘     │  ├── Web Push sender   │
                                                          │  └── Cron (cleanup)    │
 Phone (anywhere)                                         └─────────────────────────┘
┌─────────────────────────┐              │
│  PWA (Preact)           │──── HTTPS ───┘
│  Reads from /api/*      │
│  Push notifications     │
└─────────────────────────┘
```

### Cloudflare Tunnel

Cloudflare Tunnel (`cloudflared`) creates an outbound-only encrypted connection from the home server to Cloudflare's edge. No inbound ports need to be opened.

HTTPS is provided by Cloudflare at the edge. Fastify serves plain HTTP on :3333. This is critical because PWA features (service workers, push notifications, install prompt) require HTTPS.

For quick testing without a domain: `cloudflared tunnel --url http://localhost:3333` generates a temporary public URL instantly.

---

## Server

### What the Server Does

1. **Receives feed items** from the agent via `POST /agent/feed-items`
2. **Deduplicates** items by URL hash at insert time
3. **Sends push notifications** when new items arrive
4. **Serves the feed** to the PWA via `GET /api/feed`
5. **Manages read state** (mark read/unread)
6. **Cleans up old items** on a daily schedule (configurable retention, default 7 days)

### What the Server Does NOT Do

- Call any upstream API (YouTube, X, NewsAPI, etc.)
- Store OAuth tokens for external services
- Know how to scrape or parse any platform
- Perform any content transformation or enrichment

### Route Groups

The server has two separate route groups with different auth mechanisms:

#### `/agent/*` — Agent Endpoints

Authenticated via Bearer token (agent API key). Used by the scraping agent.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/agent/state` | Last sync timestamp per source, total item counts |
| `GET` | `/agent/preferences` | Blocked sources, blocked keywords, content filters |
| `POST` | `/agent/feed-items` | Submit a batch of scraped feed items |

#### `/api/*` — PWA Endpoints

No auth in PoC (single user). Used by the frontend.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/feed` | Unified feed with filtering + pagination |
| `PATCH` | `/api/feed/:id/read` | Mark item as read |
| `PATCH` | `/api/feed/:id/unread` | Mark item as unread |
| `POST` | `/api/feed/mark-all-read` | Mark all (or filtered) items as read |
| `GET` | `/api/stats` | Total, unread, per-source counts |
| `GET` | `/api/sync/status` | Last agent sync time per source |
| `GET` | `/api/push/vapid-key` | Public VAPID key for push subscription |
| `POST` | `/api/push/subscribe` | Store a push subscription |
| `POST` | `/api/push/unsubscribe` | Remove a push subscription |

### Agent Authentication

Single API key generated at setup:

1. User generates a random 256-bit hex string (e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)
2. The plaintext key goes into the agent's `config.json` (local file)
3. A SHA-256 hash of the key is stored in the server's `config.json`
4. On each request, the server hashes the incoming `Authorization: Bearer <token>` value and compares against the stored hash

```
Agent request:
  POST /agent/feed-items
  Authorization: Bearer a1b2c3d4e5...

Server:
  sha256(a1b2c3d4e5...) === stored_hash? → allow : 401
```

No sessions, no cookies, no OAuth. The key never leaves the user's devices (desktop config file → HTTPS → server).

### Agent Payload Format

`POST /agent/feed-items` accepts:

```typescript
interface AgentFeedPayload {
  source: string;                    // "youtube" | "x" | "news" | custom
  items: AgentFeedItem[];
}

interface AgentFeedItem {
  // Required
  source_id: string;                 // Platform-native ID (video ID, tweet ID, etc.)
  title: string;
  url: string;                       // Canonical URL
  published_at: string;              // ISO 8601

  // Optional
  author?: string;
  content_preview?: string;          // First ~300 chars of content
  thumbnail_url?: string;
  tags?: string[];                   // Agent-assigned or user-defined
  is_discovery?: boolean;            // false = subscribed feed, true = suggested/trending
}
```

The server constructs the internal `id` as `source:source_id` (e.g. `youtube:dQw4w9WgXcQ`), normalises and hashes the URL for dedup, and inserts with `INSERT OR IGNORE`.

The response:

```typescript
interface AgentFeedResponse {
  inserted: number;                  // Count of new items (after dedup)
  duplicates: number;                // Count of items rejected by dedup
}
```

### Agent State Endpoint

`GET /agent/state` returns:

```typescript
interface AgentState {
  sources: {
    [source: string]: {
      last_sync: string | null;      // ISO 8601 timestamp of most recent item
      item_count: number;
    }
  }
}
```

The agent uses this to know: "YouTube was last synced 18 minutes ago, only scrape items newer than that."

### Agent Preferences Endpoint

`GET /agent/preferences` returns:

```typescript
interface AgentPreferences {
  blocked_sources: string[];         // e.g. ["tiktok"] — agent should skip these
  blocked_keywords: string[];        // Agent should exclude items matching these
  max_items_per_source: number;      // Don't post more than this per sync
}
```

Preferences are stored in a simple `user_preferences` table (key-value). In PoC, they're seeded from config. In production, they'd be editable in the PWA settings UI.

---

## Storage Schema

### `feed_items` — Core unified feed

```sql
CREATE TABLE feed_items (
    id              TEXT PRIMARY KEY,          -- "source:source_id"
    user_id         TEXT NOT NULL DEFAULT 'local',  -- PoC: always 'local'
    source          TEXT NOT NULL,             -- "youtube" | "x" | "news" | custom
    title           TEXT,
    author          TEXT,
    url             TEXT NOT NULL,
    url_hash        TEXT NOT NULL,             -- SHA-256 of normalised URL
    content_preview TEXT,                      -- First ~300 chars
    thumbnail_url   TEXT,
    tags            TEXT,                      -- JSON array: '["tech","ai"]'
    is_discovery    INTEGER NOT NULL DEFAULT 0, -- 0 = subscribed, 1 = discovery
    published_at    TEXT NOT NULL,             -- ISO 8601
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    is_read         INTEGER NOT NULL DEFAULT 0,
    raw_json        TEXT                       -- Full agent payload for debugging
);

CREATE UNIQUE INDEX idx_feed_url_hash ON feed_items(user_id, url_hash);
CREATE INDEX idx_feed_published ON feed_items(published_at DESC);
CREATE INDEX idx_feed_source ON feed_items(source);
CREATE INDEX idx_feed_read ON feed_items(is_read);
CREATE INDEX idx_feed_user ON feed_items(user_id);
CREATE INDEX idx_feed_discovery ON feed_items(is_discovery);
```

Note: The unique index is on `(user_id, url_hash)`, not just `url_hash`. In PoC this makes no difference (one user). In production, different users can have the same URL without conflicting.

### `agent_tokens` — Agent API keys

```sql
CREATE TABLE agent_tokens (
    token_hash  TEXT PRIMARY KEY,             -- SHA-256 of the plaintext token
    user_id     TEXT NOT NULL DEFAULT 'local',
    label       TEXT,                         -- "Cowork desktop", "OpenClaw"
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    last_used   TEXT
);
```

In PoC, this table has one row, inserted at setup. In production, users create/revoke tokens from the dashboard.

### `sync_log` — Agent sync audit trail

```sql
CREATE TABLE sync_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    source      TEXT NOT NULL,
    synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
    items_added INTEGER NOT NULL DEFAULT 0,
    items_duped INTEGER NOT NULL DEFAULT 0,
    error       TEXT
);
```

Changed from the previous design: this is now append-only (AUTOINCREMENT) rather than one-row-per-source. Multiple syncs per day means we want history, not just the latest. The `GET /api/sync/status` endpoint returns the most recent row per source.

### `push_subscriptions` — Web Push endpoints

```sql
CREATE TABLE push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL DEFAULT 'local',
    endpoint    TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `user_preferences` — Agent-readable preferences

```sql
CREATE TABLE user_preferences (
    user_id     TEXT NOT NULL DEFAULT 'local',
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,                -- JSON-encoded value
    PRIMARY KEY (user_id, key)
);
```

Seeded at setup with defaults:
- `blocked_sources`: `[]`
- `blocked_keywords`: `[]`
- `max_items_per_source`: `50`
- `retention_days`: `7`

---

## URL Normalisation & Deduplication

Applied server-side at insert time, before the URL is hashed:

1. Lowercase the hostname
2. Remove tracking parameters: `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `s`, `ref`, `feature`
3. Convert YouTube short URLs: `youtu.be/VIDEO_ID` → `https://www.youtube.com/watch?v=VIDEO_ID`
4. Sort remaining query parameters alphabetically
5. Strip trailing slashes

The agent doesn't need to normalise — the server handles it. This ensures consistent dedup even if different agents format URLs differently.

---

## Data Retention & Cleanup

A daily cron job (default 3:00 AM) deletes old feed items:

```sql
DELETE FROM feed_items
WHERE user_id = 'local'
  AND fetched_at < datetime('now', '-N days')
```

Where N is the `retention_days` preference (default: 7).

Uses `fetched_at` (when the server stored it), not `published_at` (when it was originally published). Only `feed_items` rows are cleaned up. Sync logs are preserved (they're small).

Also cleans up stale sync log entries older than 30 days:

```sql
DELETE FROM sync_log WHERE synced_at < datetime('now', '-30 days')
```

---

## Web Push Notifications

### Flow

1. PWA registers service worker → user enables notifications
2. Service worker subscribes via Push API using the VAPID public key
3. PWA sends the PushSubscription to `POST /api/push/subscribe`
4. When `POST /agent/feed-items` inserts new items, server sends push notification
5. Push service (FCM/Mozilla) delivers to the device
6. Service worker shows system notification
7. User taps → PWA opens

### Notification Grouping

One notification per agent POST, not per item. Payload:

```json
{
  "title": "5 new items from YouTube",
  "body": "Latest: Video Title Here",
  "source": "youtube",
  "count": 5,
  "url": "/"
}
```

If items from multiple sources arrive in one POST (unlikely but possible), one notification per source.

### VAPID Keys

Generated once with `npx web-push generate-vapid-keys`, stored in `config.json`.

---

## Frontend — PWA

### Requirements

- Served over HTTPS (Cloudflare Tunnel)
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
```

### Service Worker

Two responsibilities:

1. **Push handler**: Receive push events → show system notification → handle notification click (focus/open PWA)
2. **Offline cache**: Cache the app shell (HTML, CSS, JS, icons) on install. Serve cached shell for navigation requests. Pass API requests through to network.

---

## The Agent Skill

The scraping logic lives entirely outside the server, in a skill that runs on the user's desktop agent (Cowork, Claude Code, etc.).

### Skill Structure

```
skill/
├── SKILL.md              # Main instructions for the agent
├── platforms/
│   ├── youtube.md        # YouTube scraping: where to go, what to extract
│   ├── x.md              # X scraping: timeline extraction
│   └── news.md           # News sites: configurable list of sites
├── schema.json           # Expected POST /agent/feed-items payload shape
└── config.example.json   # Agent-side config template
```

### How the Agent Runs

1. Read config: server URL, agent token, enabled platforms
2. Call `GET /agent/state` to get last sync timestamps per source
3. Call `GET /agent/preferences` to get blocked sources/keywords
4. For each enabled platform:
   a. Open the platform in the browser (Claude in Chrome, using existing login)
   b. Navigate to the subscriptions/feed page
   c. Extract items newer than the last sync timestamp for that source
   d. Filter out items matching blocked keywords
   e. Structure as `AgentFeedItem[]`
5. Call `POST /agent/feed-items` with the batch
6. Log the response (inserted count, duplicate count)

### Scheduling

- **Cowork**: Set up as a recurring scheduled task (e.g. every 30 minutes)
- **Claude Code**: Run via a cron job: `*/30 * * * * cd /path/to/skill && claude-code "Run the feed scraper skill"`
- **OpenClaw**: Register as a scheduled action
- **Manual**: Run on demand from the agent

### Platform Scraping Instructions

Each platform file (`youtube.md`, `x.md`, `news.md`) provides:

1. **Target URL**: Where to navigate (e.g. `youtube.com/feed/subscriptions`)
2. **Extraction guidance**: What data to pull from the page, described semantically (not CSS selectors, since layouts change)
3. **Pagination**: How to scroll or navigate to load more items
4. **Edge cases**: Content to skip (ads, shorts, premieres, live streams) and how to identify them
5. **Field mapping**: How to map extracted data to the `AgentFeedItem` schema

The instructions are written for an AI agent that understands web pages visually and semantically — not for a traditional scraper that needs exact selectors.

### Agent Config

```json
{
  "server_url": "https://feed.yourdomain.com",
  "agent_token": "your-agent-api-key",
  "platforms": {
    "youtube": { "enabled": true },
    "x": { "enabled": false },
    "news": {
      "enabled": true,
      "sites": [
        "https://news.ycombinator.com",
        "https://arstechnica.com"
      ]
    }
  },
  "max_items_per_source": 20,
  "scrape_timeout_seconds": 120
}
```

---

## Error Handling

### Agent Errors

The agent is responsible for its own error handling:
- Browser timeouts, CAPTCHAs, login prompts → log and skip that platform
- Network errors → retry or abort
- The server returns clear HTTP status codes: 201 (created), 400 (bad payload), 401 (bad token), 429 (rate limited)

### Server Errors

- `POST /agent/feed-items` with invalid payload → 400 with descriptive error
- `POST /agent/feed-items` with invalid token → 401
- Push delivery returns 410 (Gone) → delete stale subscription
- Daily cleanup failures → log, retry next day

### Rate Limiting

The server applies a basic rate limit on `/agent/feed-items` to prevent runaway agents:
- Default: 60 requests per hour per token
- Configurable in `config.json`
- Returns 429 with `Retry-After` header when exceeded

---

## Production Seams

These are the specific points where the PoC design accommodates a future multi-user deployment. None of these are implemented in PoC — they're documented here so the codebase doesn't accidentally close them off.

### Seam 1: User Identity

**PoC**: `user_id` is hardcoded to `'local'` everywhere. No user auth on `/api/*` routes.

**Production**: Add Clerk. Clerk session cookie authenticates `/api/*` routes and resolves `user_id`. All queries gain a `WHERE user_id = ?` clause. The `agent_tokens` table links tokens to Clerk user IDs.

**What to preserve**: Every table already has a `user_id` column. Every query should use it, even though it's always `'local'` in PoC.

### Seam 2: Client-Side Encryption

**PoC**: All content stored in plaintext. No encryption.

**Production**: The agent encrypts content fields (`title`, `author`, `url`, `content_preview`, `thumbnail_url`) before POSTing. The server stores ciphertext. The PWA decrypts in the browser using a passphrase-derived key.

**What to preserve**: Content fields are stored as `TEXT` in SQLite — they'll hold ciphertext just as well as plaintext. The agent payload schema doesn't change — encrypted strings go in the same fields. The PWA needs a decryption layer between the API client and the rendering components — this is a single insertion point.

The encryption scheme for production:
- Algorithm: AES-256-GCM
- Key derivation: PBKDF2(passphrase, user-specific salt, 100000 iterations)
- The salt is stored server-side (not secret, just ensures uniqueness)
- The passphrase is entered by the user on each device, never sent to the server
- Metadata fields (`source`, `published_at`, `tags`, `is_discovery`, `is_read`) remain plaintext for querying

### Seam 3: Database

**PoC**: SQLite, single file, single process.

**Production**: Migrate to Postgres (or Turso for edge SQLite). The schema is standard SQL — no SQLite-specific features are used except `datetime('now')` default values, which would need to become `NOW()` in Postgres.

**What to preserve**: Use parameterised queries everywhere. No string concatenation in SQL. No SQLite-specific pragma-dependent behaviour in application logic.

### Seam 4: Agent Token Management

**PoC**: One token, hash stored in config.json, inserted into `agent_tokens` at startup.

**Production**: Dashboard UI for creating, labelling, and revoking tokens. Multiple tokens per user (one per agent/device). `last_used` timestamp updated on each request for audit.

**What to preserve**: The `agent_tokens` table and the auth middleware already support multiple tokens per user. The PoC just happens to only have one.

### Seam 5: Skill Distribution

**PoC**: Local folder that Cowork reads from. Config file with hardcoded server URL and token.

**Production**: Published as a GitHub repo users can clone. Optionally published as an MCP server that agents can connect to. A standalone CLI (`npx feed-agent`) for agent-agnostic usage.

**What to preserve**: The skill is already a standalone artifact with its own config. It communicates with the server only via the `/agent/*` REST API. No coupling to Cowork-specific features.

### Seam 6: Hosting

**PoC**: Cloudflare Tunnel from home server.

**Production**: Fly.io, Railway, or similar. The server is stateless except for SQLite (which would be Postgres). No file-system dependencies beyond the database.

**What to preserve**: The server binds to `127.0.0.1:3333` and doesn't assume anything about the network layer above it. HTTPS is always handled externally (Tunnel or load balancer).
