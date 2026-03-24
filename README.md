# Feed Aggregator

A personal feed aggregator where an AI agent scrapes content from your platforms, posts it to your server, and a PWA serves it as a unified feed with push notifications. The server never talks to YouTube, X, or any content platform — your agent does, using your own browser sessions.

## How It Works

```
 Your Desktop                        Cloudflare Edge           Home Server
┌──────────────────────┐          ┌──────────────────┐     ┌────────────────────┐
│  Cowork / Claude Code│          │                  │     │                    │
│  + Claude in Chrome  │─ HTTPS ──│  Tunnel          │─────│  Fastify API :3333 │
│                      │          │  (free tier)     │     │  SQLite storage    │
│  Scrapes YouTube, X, │          │                  │     │  Push sender       │
│  news sites using    │          └──────────────────┘     │                    │
│  YOUR logged-in      │                                   └────────┬───────────┘
│  browser sessions    │                                            │
└──────────────────────┘                                   ┌────────▼───────────┐
                                                           │  PWA on your phone │
                                                           │  Installable       │
                                                           │  Push notifications│
                                                           └────────────────────┘
```

1. **Agent scrapes**: A scheduled Cowork task (or Claude Code, OpenClaw, etc.) opens your browser, visits your YouTube subscriptions, X timeline, and news sites, and extracts feed items.
2. **Agent posts**: The agent sends structured feed items to `POST /agent/feed-items`, authenticated with a personal API key.
3. **Server stores + notifies**: The server inserts items (deduplicating by URL hash), then sends a Web Push notification to your phone.
4. **PWA renders**: You open the app, it fetches the feed from `/api/feed`, and displays it sorted by recency with source filtering and read/unread tracking.

The server is deliberately dumb — it stores data, serves it, and sends push notifications. All platform interaction happens on the agent side.

## Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime** | Node.js 20+ | Available on target machine (Fedora Linux) |
| **Database** | SQLite via `better-sqlite3` | Zero-config, single-file, on-device storage |
| **Backend API** | Fastify | Lightweight HTTP server |
| **Push** | `web-push` (VAPID) | Server-initiated notifications to the PWA |
| **Frontend** | Vite + Preact + TypeScript | Fast dev iteration, 3KB framework |
| **Tunnel** | Cloudflare Tunnel | Public HTTPS, zero firewall config, free tier |
| **Agent** | Cowork + Claude in Chrome | Browser-based scraping using logged-in sessions |

## Project Structure

```
feed-aggregator/
├── README.md
├── CLAUDE.md                        # Coding agent context file
├── docs/
│   ├── ARCHITECTURE.md              # System design + production seams
│   └── TASKS.md                     # Implementation plan (build stages)
├── skill/                           # Agent skill (for Cowork / Claude Code)
│   ├── SKILL.md                     # Main agent instructions
│   ├── platforms/
│   │   ├── youtube.md               # YouTube scraping instructions
│   │   ├── x.md                     # X scraping instructions
│   │   └── news.md                  # News site scraping instructions
│   └── config.example.json          # Agent-side config template
├── package.json
├── tsconfig.json
├── vite.config.ts
├── config.example.json              # Server-side config template
├── server/
│   ├── index.ts                     # Entry: init DB, start cron + API
│   ├── db.ts                        # SQLite init, migrations, helpers
│   ├── agent-routes.ts              # /agent/* endpoints (agent auth)
│   ├── api-routes.ts                # /api/* endpoints (PWA)
│   ├── push.ts                      # Web Push subscription mgmt + notify
│   └── auth.ts                      # Agent token hashing + verification
├── src/                             # Frontend (Vite + Preact PWA)
│   ├── index.html
│   ├── main.tsx
│   ├── app.tsx
│   ├── api.ts                       # Typed fetch wrapper
│   ├── types.ts                     # Shared types
│   ├── sw.ts                        # Service worker (push + offline)
│   ├── manifest.json                # PWA manifest
│   └── components/
│       ├── feed-list.tsx
│       ├── feed-card.tsx
│       ├── youtube-card.tsx
│       ├── x-card.tsx
│       ├── news-card.tsx
│       ├── source-filter.tsx
│       ├── sync-status.tsx
│       └── notification-prompt.tsx
└── sql/
    └── schema.sql
```

## Quick Start (after implementation)

```bash
# Install dependencies
npm install

# Copy and configure
cp config.example.json config.json
# Edit config.json: set VAPID keys (see below)

# Generate VAPID keys for Web Push (one-time)
npx web-push generate-vapid-keys

# Generate your agent API key (one-time)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Paste the output into config.json as agent_token

# Start the server
export FEED_AGG_KEY="your-encryption-passphrase"
npm run dev

# Set up the agent (separate step — see skill/SKILL.md)
# Copy skill/ folder into your Cowork project
# Edit skill/config.json with your server URL + agent token
# Schedule a recurring Cowork task to run the scraper
```

## Production Path

This PoC is designed to be promotable to a multi-user hosted product. See the "Production Seams" section in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what changes:
- Clerk for user authentication
- Per-user agent tokens (multiple agents per user)
- Client-side encryption (server stores ciphertext, PWA decrypts)
- Postgres instead of SQLite
- Published skill as GitHub repo + MCP server

## Licence

MIT
