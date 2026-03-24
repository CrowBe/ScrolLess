# Implementation Tasks

This document breaks the feed aggregator build into discrete stages. Each stage is self-contained: a coding agent should be able to complete any stage given only this document, `ARCHITECTURE.md`, and the code produced by prior stages.

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
- `agent_tokens`
- `sync_log`
- `push_subscriptions`
- `user_preferences`

Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout.

### Task 2.2: Database module

Create `server/db.ts`:

**`initDb(dbPath?: string): Database`**
- Default path: `~/.feed-aggregator/feed.db`
- Create parent directory if missing
- Open with `better-sqlite3`
- Set pragmas: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`
- Execute `sql/schema.sql`
- Seed default `user_preferences` if not present:
  - `blocked_sources`: `[]`
  - `blocked_keywords`: `[]`
  - `max_items_per_source`: `50`
  - `retention_days`: `7`
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
- `AgentState` — `{ sources: { [source]: { last_sync, item_count } } }`
- `AgentPreferences` — `{ blocked_sources, blocked_keywords, max_items_per_source }`
- `AppConfig` — typed `config.json` structure

Create `src/types.ts` for frontend:
- `FeedItemResponse` — shape returned by `GET /api/feed` per item
- `FeedResponse` — `{ items, total, limit, offset }`
- `Stats` — `{ total, unread, by_source }`
- `SyncLogEntry` — `{ source, synced_at, items_added, error }`
- `PushPayload` — `{ title, body, source, count, url }`

### Acceptance criteria
- `initDb()` creates `~/.feed-aggregator/feed.db` with all tables
- Default preferences are seeded
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

**Goal**: Implement the three `/agent/*` routes that the scraping agent uses.

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

### Task 4.2: GET /agent/state

Return the `AgentState` object:
- For each distinct `source` in `feed_items` (for this `user_id`):
  - `last_sync`: the `published_at` of the most recent item for that source
  - `item_count`: total items for that source

```sql
SELECT source,
       MAX(published_at) as last_sync,
       COUNT(*) as item_count
FROM feed_items
WHERE user_id = ?
GROUP BY source
```

### Task 4.3: GET /agent/preferences

Read from `user_preferences` table for this `user_id`:
- `blocked_sources` → parse as JSON array
- `blocked_keywords` → parse as JSON array
- `max_items_per_source` → parse as integer

Return the `AgentPreferences` object.

### Task 4.4: Data retention cleanup

Create a function `cleanupOldItems(db, userId, retentionDays)`:
- `DELETE FROM feed_items WHERE user_id = ? AND fetched_at < datetime('now', '-N days')`
- `DELETE FROM sync_log WHERE synced_at < datetime('now', '-30 days')`
- Return deleted counts, log result

Schedule as a daily cron in `server/index.ts` (3:00 AM):
- Read `retention_days` from `user_preferences` (default 7)
- Call `cleanupOldItems()`

### Task 4.5: Dedup verification

Write a test or verification script that:
1. POSTs a feed item with URL `https://www.youtube.com/watch?v=abc`
2. POSTs another item with URL `https://youtu.be/abc?utm_source=twitter`
3. Verifies `inserted: 1, duplicates: 1` on the second POST
4. Verifies only one row in `feed_items`

### Acceptance criteria
- `POST /agent/feed-items` with valid payload returns `{ inserted: N, duplicates: M }`
- Duplicate URLs (even with tracking params or short-link variants) are rejected
- `GET /agent/state` returns per-source timestamps and counts
- `GET /agent/preferences` returns the seeded defaults
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

### Task 5.2: Static file serving

Register `@fastify/static` to serve `dist/client/` when the directory exists. Add a catch-all route serving `index.html` for non-`/api/` and non-`/agent/` paths (SPA fallback).

In dev mode: register `@fastify/cors` with origin `http://localhost:5173`.

### Task 5.3: Wire Fastify into entry point

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

### Task 7.9: Service worker (placeholder)

Create `src/sw.ts` with minimal push handler (will be fleshed out in Stage 8). Register in `src/main.tsx`. Configure Vite to output `sw.js` at the root of `dist/client/`.

### Task 7.10: Styling

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

## Stage 9: Agent Skill

**Goal**: Write the scraping skill that runs in Cowork / Claude Code.

### Task 9.1: Skill main instructions

Create `skill/SKILL.md`:

This is the primary instruction file the agent reads. It should cover:

1. **Purpose**: You are a feed scraping agent. Your job is to visit platforms in the browser, extract feed items, and POST them to the server.
2. **Config**: Read `config.json` from this skill's directory for server URL, agent token, and platform settings.
3. **Workflow**:
   a. Call `GET /agent/state` to get last sync timestamps
   b. Call `GET /agent/preferences` to get blocked sources/keywords
   c. For each enabled platform, read the corresponding platform instruction file
   d. Open the platform in the browser, extract items newer than last sync
   e. Filter out blocked keywords
   f. POST to `/agent/feed-items`
4. **Error handling**: If a platform fails (CAPTCHA, timeout, layout change), log the error and continue to the next platform. Don't fail the entire run.
5. **Payload format**: Reference `schema.json` for the exact shape.

### Task 9.2: Platform instruction files

**`skill/platforms/youtube.md`**:
- Navigate to `https://www.youtube.com/feed/subscriptions`
- Requires the user to be logged into YouTube in Chrome
- Extract: video title, channel name, video URL, publish timestamp, thumbnail URL
- Identify videos by the video ID in the URL (the `v=` parameter)
- Set `source: "youtube"`, `source_id` to the video ID
- Skip: YouTube Shorts (URL contains `/shorts/`), ads, premieres that haven't aired
- Scroll to load more videos if needed (up to `max_items_per_source`)
- Set `is_discovery: false` for subscription feed items

**`skill/platforms/x.md`**:
- Navigate to `https://x.com/home` (Following tab, not For You)
- Requires the user to be logged into X in Chrome
- Extract: author handle, display name, tweet text, tweet URL, publish timestamp
- Set `source: "x"`, `source_id` to the tweet ID (from the URL)
- Skip: ads/promoted tweets, retweets (unless quote tweets), Twitter Spaces
- Set `is_discovery: false` for timeline items

**`skill/platforms/news.md`**:
- Navigate to each URL in `config.platforms.news.sites` (e.g. Hacker News, Ars Technica)
- No login required for public news sites
- Extract: article title, source/publication name, article URL, publish timestamp
- Set `source: "news"`, `source_id` to a hash of the article URL
- Handle different site layouts semantically (HN looks different from Ars Technica)
- Set `is_discovery: false`

### Task 9.3: Payload schema

Create `skill/schema.json` — a JSON Schema document describing the `POST /agent/feed-items` payload. The agent can reference this to validate its output before posting.

### Task 9.4: Agent config template

Create `skill/config.example.json`:
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

### Acceptance criteria
- A Cowork session can read the skill files and understand the task
- Running the skill with YouTube enabled populates the feed on the server
- Items have correct source, source_id, title, URL, and timestamp
- Blocked keywords from preferences are respected
- The agent handles failures gracefully (one platform failing doesn't stop others)

---

## Stage 10: Skill Evaluation

**Goal**: Validate that the skill reliably populates the feed across platforms and error conditions.

### Task 10.1: Dry run mode

Add a `--dry-run` flag to the skill instructions:
- When enabled, the agent writes extracted items to a local `dry-run-output.json` file instead of POSTing
- Inspect the output: are all fields present? Are timestamps valid ISO 8601? Are URLs valid?

### Task 10.2: Single-source smoke test

- Enable only YouTube in the skill config
- Run the skill
- Verify: items appear in `GET /api/feed?source=youtube`
- Run again: verify no duplicates (dedup working)
- Verify: push notification was received

### Task 10.3: Multi-source test

- Enable YouTube + news
- Run the skill
- Verify: both sources appear in the feed
- Verify: source filter tabs show correct counts
- Verify: `GET /agent/state` shows both sources with correct timestamps

### Task 10.4: Preferences test

- Add a blocked keyword to preferences (e.g. "sponsored")
- Run the skill
- Verify: items matching the keyword are not posted

### Task 10.5: Failure recovery test

- Run the skill targeting a site that requires a login the agent doesn't have
- Verify: the agent logs the error and continues to the next platform
- Verify: sync_log shows the error for that source
- Verify: other sources still populated correctly

### Task 10.6: Freshness test

- Let the skill run on its scheduled cadence for 24+ hours
- Verify: new items appear in each sync
- Verify: no duplicate items accumulate
- Verify: the 7-day cleanup removes old items
- Verify: push notifications continue to arrive for new content

### Acceptance criteria
- All five test levels pass
- The feed is reliably populated from scheduled agent runs
- Errors are logged, not silent
- Dedup and cleanup work over time

---

## Stage 11: Production Build & Deployment

**Goal**: Make the app deployable for daily use.

### Task 11.1: Production server

Verify `npm run build && npm start` serves:
- All API routes on `/api/*`
- Agent routes on `/agent/*` (with auth)
- Built frontend at `/`
- Service worker at `/sw.js`
- Manifest at `/manifest.json`

### Task 11.2: Systemd service

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

### Task 11.3: Cloudflare Tunnel

Create `docs/DEPLOYMENT.md` with:
1. `cloudflared` installation on Fedora
2. Quick test: `cloudflared tunnel --url http://localhost:3333`
3. Permanent tunnel with custom domain
4. Tunnel config YAML
5. DNS routing
6. Systemd service for cloudflared
7. Verification: PWA installs, push works, agent can reach server

### Task 11.4: Cowork scheduled task setup

Document how to set up the agent as a recurring Cowork task:
1. Create a Cowork project
2. Grant access to the `skill/` folder
3. Enable Claude in Chrome connector
4. Set up the recurring task (e.g. every 30 minutes)
5. Verify: feed populates automatically on schedule

### Acceptance criteria
- Server runs as a systemd service, survives reboots
- Cloudflare Tunnel provides stable HTTPS access
- PWA installs on Android from the public URL
- Push notifications work end-to-end
- Scheduled Cowork task populates the feed automatically
- The app is usable as a daily driver
