# ScrolLess

A feed aggregator where an AI agent scrapes content from your platforms, posts it to a server, and a PWA displays a unified feed with push notifications. The server never talks to YouTube, X, or any content platform — the agent does, using logged-in browser sessions.

Today, ScrolLess is primarily a **self-hosted open-source app** with a local-first codebase and a PWA client.
A **hosted product** is an active architecture and roadmap track, not a finished supported deployment mode yet.
The roadmap is moving toward a Postgres-backed control plane, but the current self-hosted server still runs on SQLite today.

## How It Works

```
 Any Machine                                          Server
┌──────────────────────┐                           ┌────────────────────┐
│  Claude Code / Claude │                           │                    │
│  in Chrome            │──── POST /agent/* ───────▶│  Fastify API :3333 │
│                       │    (Bearer token)         │  Server control    │
│                       │                           │  plane (SQLite)    │
│  Scrapes YouTube, X,  │                           │  MCP server /mcp   │
│  news using logged-in │◀─── MCP tools/resources ──│  Push sender       │
│  browser sessions     │                           │                    │
└──────────────────────┘                           └────────┬───────────┘
                                                            │ Web Push
                                                   ┌────────▼───────────┐
                                                   │  PWA (any device)  │
                                                   │  Installable       │
                                                   │  Push notifications│
                                                   └────────────────────┘
```

1. **Agent scrapes**: Claude (via MCP or direct API calls) opens a browser, visits YouTube subscriptions, X timeline, and news sites, and extracts feed items.
2. **Agent posts**: The agent sends encrypted feed batches to `POST /agent/feed-items` (Bearer token auth) or via the `submit_items` MCP tool.
3. **Server relays + notifies**: The server relays encrypted items over SSE to connected devices and sends a Web Push notification.
4. **PWA renders**: The app decrypts and stores items in IndexedDB, then renders the unified feed locally.

The server is deliberately dumb, it coordinates relay + metadata and sends push notifications. All platform interaction and feed-content handling happens off-server.

ScrolLess has two storage domains:
- **server control plane storage** for accounts, tokens, config, metadata, and encrypted relay payloads when queueing/replay requires them
- **client content storage** for decrypted feed items and local reading state

Postgres in the hosted roadmap belongs to the control plane, not the decrypted feed database.

## Current Status

### What exists today

- self-hosted/local-first backend and PWA flow
- encrypted relay model between agent, server, and device
- IndexedDB persistence for client-side feed content
- MCP, OAuth, SSE, push, source management, and token-management foundations
- shipped `/api/v1/device/challenge`, `/api/v1/device/verify`, `/api/v1/queue/ack`, versioned device/token routes, tier gating, queue schema, and acceptance tests recorded in `docs/TIER_CONTRACT.md`
- current server uses SQLite plus local-first assumptions in places, so the Postgres unification work is still roadmap-state

### What is planned, not finished

- hosted multi-user account model
- Postgres-backed hosted control-plane persistence
- hosted auth and tenant isolation
- encrypted payload retention for queue/replay/recovery without exposing plaintext content
- subscription-backed entitlements
- production-ready web account and billing surface

For hosted architecture and sequencing, see:
- `docs/HOSTED_BACKEND_PLAN.md`
- `docs/ARCHITECTURE.md`
- `docs/TIER_CONTRACT.md`

## Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime** | Node.js 20+ | |
| **Database** | SQLite today for the server control plane, IndexedDB for current client content storage | Current self-hosted runtime uses SQLite; the roadmap converges hosted and self-hosted toward a later Postgres server DB path |
| **Backend API** | Fastify | Lightweight HTTP server |
| **MCP server** | `@modelcontextprotocol/sdk` | Exposes tools + resources to Claude |
| **Push** | `web-push` (VAPID) | Server-initiated notifications to the PWA |
| **Frontend** | Vite + Preact + TypeScript | Fast dev iteration, 3KB framework |
| **Agent** | Claude Code / Claude in Chrome | Browser-based scraping using logged-in sessions |

## Project Structure

```
ScrolLess/
├── README.md
├── CLAUDE.md                        # Coding agent context file
├── .mcp.json.example                # MCP client config template
├── docs/
│   ├── ARCHITECTURE.md              # Routes, auth, payload formats, schema, push, PWA
│   ├── TASKS.md                     # 13 sequential build stages
│   ├── DESIGN_SYSTEM.md             # Color tokens, typography, component patterns
│   └── DEPLOYMENT.md                # Production deployment guide
├── skill/                           # Agent skill
│   ├── SKILL.md                     # Main agent instructions
│   └── resources/
│       ├── schema.json              # Agent payload schema
│       ├── youtube.md               # YouTube scraping instructions
│       ├── x.md                     # X scraping instructions
│       └── news.md                  # News site scraping instructions
├── package.json
├── tsconfig.json
├── vite.config.ts
├── server/
│   ├── index.ts                     # Entry: Fastify setup, auth hook, route registration
│   ├── db.ts                        # Server DB init, URL normalisation + hashing
│   ├── auth.ts                      # Token hashing + verification
│   ├── types.ts                     # Shared TypeScript interfaces
│   ├── agent-routes.ts              # /agent/* endpoints (Bearer token auth)
│   ├── api-routes.ts                # /api/* endpoints (PWA)
│   ├── mcp.ts                       # /mcp endpoint (MCP server, tools, resources)
│   ├── oauth-routes.ts              # /oauth/* endpoints (OAuth 2.0)
│   └── push.ts                      # Web Push subscription mgmt + notify
├── src/                             # Frontend (Vite + Preact PWA)
│   ├── index.html
│   ├── main.tsx
│   ├── app.tsx
│   ├── api.ts                       # Typed fetch wrapper
│   ├── types.ts
│   ├── sw.ts                        # Service worker (push + offline)
│   ├── manifest.json                # PWA manifest
│   └── components/
│       ├── feed-list.tsx
│       ├── youtube-card.tsx
│       ├── x-card.tsx
│       ├── news-card.tsx
│       ├── source-filter.tsx
│       ├── sync-status.tsx
│       ├── source-list.tsx
│       ├── add-source-form.tsx
│       └── notification-prompt.tsx
└── sql/
    └── schema.sql
```

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Generate an agent token

```bash
npm run generate-token
# prints a random hex token — save it, you'll need it twice below
```

### 3. Set backend environment variables

Hash your token and export it:

```bash
export AGENT_TOKEN_HASH="$(node -e 'console.log(require(\"crypto\").createHash(\"sha256\").update(\"YOUR_TOKEN\").digest(\"hex\"))')"
```

Set optional values as needed:

| Environment variable | Required for |
|---|---|
| `DB_PATH` | Custom SQLite location (default: `./data/scrolless.db`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push notifications |
| `VAPID_SUBJECT` | Web Push contact (set to `mailto:you@example.com`) |
| `BASE_URL` | Backend public URL for OAuth issuer metadata and tunnel/external access |
| `CORS_ORIGIN` | Browser origin allowlist for the frontend in split-hosting deployments |
| `ADMIN_PASSWORD` | OAuth consent screen |
| `DEVICE_ENROLLMENT_TOKEN` | Protecting `/api/v1/device/register` and `/api/v1/device/challenge` from unauthorized enrollment |
| `VITE_DEVICE_ENROLLMENT_TOKEN` | Frontend header used for device enrollment when backend `DEVICE_ENROLLMENT_TOKEN` is enabled |
| `AGENT_RATE_LIMIT_PER_HOUR` | Agent/MCP rate limit (default: `60`) |
| `OAUTH_CLIENTS_JSON` | OAuth client seed list (JSON array) |

Current self-hosted deployments still use SQLite via `DB_PATH`. When the Postgres server path lands later, self-hosters should plan for a reset/cutover rather than a migration script.

Generate VAPID keys if you want push notifications:

```bash
npx web-push generate-vapid-keys
```

### 4. Start the server

```bash
npm run dev:server        # backend only, port 3333
# or
npm run dev               # backend + Vite frontend on port 5173
```

The server binds to `127.0.0.1:3333` by default. To accept connections from other devices on your local network, run with `HOST=0.0.0.0`.

### 5. Connect Claude via MCP

```bash
cp .mcp.json.example .mcp.json
# Edit .mcp.json: replace YOUR_AGENT_TOKEN_HERE with your raw token
```

The MCP server is at `http://localhost:3333/mcp`. Claude Code picks up `.mcp.json` automatically when you start a session in this directory.

Available MCP tools:

| Tool | Description |
|---|---|
| `get_sync_context` | Returns enabled sources, URLs, last sync times, and content filters |
| `submit_items` | Submit an encrypted batch; returns relayed count |

Available MCP resources: `scrolless://platforms/{name}` — platform-specific scraping instructions from `skill/resources/{name}.md`.

### 6. Quick agent test (curl)

```bash
curl -X POST http://localhost:3333/agent/feed-items \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"youtube","ephemeral_public_key":"BASE64_EPHEMERAL_P256_KEY","items":[{"source_id":"abc123","url":"https://youtube.com/watch?v=abc123","published_at":"2026-03-23T10:00:00Z","encrypted_fields":"BASE64_IV_CIPHERTEXT_TAG"}]}'
```

---

## Optional: Cloud Tunnel for Web Access

If you want to access the PWA from your phone or use Claude.ai's remote MCP connector (rather than Claude Code on the same machine), expose the server over HTTPS via a tunnel.

### Cloudflare Tunnel (recommended, free tier)

```bash
# Install cloudflared (one-time)
# https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

# Start a temporary tunnel (no account needed for quick testing)
cloudflared tunnel --url http://localhost:3333
# prints a URL like https://random-name.trycloudflare.com
```

For a stable named tunnel tied to a domain you control, follow the [Cloudflare Tunnel docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/).

### Other options

- **`ngrok`**: `ngrok http 3333` (free tier gives a temporary HTTPS URL)
- **Tailscale**: expose the server on your Tailnet; no public URL needed if all your devices are on it

### After setting up the tunnel

1. Set `BASE_URL` to your public HTTPS backend URL (e.g. `https://random-name.trycloudflare.com`). This is required for the OAuth flow when connecting via claude.ai.
2. If the frontend is served from a different origin, set `CORS_ORIGIN` to that browser origin.
3. Update your `.mcp.json` URL to the tunnel URL if using a remote MCP client.

---

## Deployment Modes

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full deployment instructions.

**Self-hosted**: this is the current supported mode. Today it is SQLite-backed and still local-first in places. The roadmap later converges self-hosted and hosted onto the same Postgres-backed server control plane, and existing self-hosters should expect a reset/cutover rather than migration tooling when that lands. Run with `npm run build && npm start`, expose via Cloudflare Tunnel or keep local.

**Hosted product**: active roadmap only. Requires real hosted identity, Postgres, tenant isolation, server-enforced entitlements, a completed ciphertext-only trust model, and the web account surface before it should be treated as a supported deployment mode. See `docs/HOSTED_BACKEND_PLAN.md`.

## Licence

MIT
