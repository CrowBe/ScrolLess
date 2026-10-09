# Setup

ScrolLess is a work-in-progress personal host. There is no migration path between versions yet: schema changes may drop data.

Deployment is deliberately undefined while the app is rebuilt; it will be re-evaluated afterwards (#84). This page covers running it locally and its configuration.

## Local setup

Use Node.js 20+ and the repository lockfile:

```bash
npm ci
HOST=127.0.0.1 npm run dev        # API :3333, reader :5173
```

Production build of the reader and API on one port:

```bash
npm run build
HOST=127.0.0.1 DEVICE_ENROLLMENT_TOKEN=<secret> npm start
```

[server/index.ts](../server/index.ts) defaults to `0.0.0.0`; set `HOST=127.0.0.1` unless you intend to expose the listener.

## Connecting an agent

**Stdio (same machine).** `npm run mcp:config` prints the command for this checkout. The stdio server ([mcp-stdio.ts](../server/mcp-stdio.ts)) opens the same SQLite file as the web server and exposes the [push tools](../server/mcp-content-tools.ts). Trust comes from the local process boundary: whoever can launch it can write to the store. It logs to stderr only, because stdout carries the MCP protocol.

**HTTP (`/mcp`).** For agents elsewhere on your network. Requires `Authorization: Bearer <token>` with an agent token (created in Settings, or seeded from `AGENT_TOKEN_HASH`) or an OAuth access token from `/oauth/*`. Rate-limited per token (`AGENT_RATE_LIMIT_PER_HOUR`, default 600 requests).

## Reader authentication

Readers fetch `/api/*` with a device session. On first load the reader creates a non-extractable ECDSA key in IndexedDB, completes `/api/v1/device/challenge` + `/verify`, and stores the `dsess_*` token. Every verified device reads the single owner's feed.

- Outside production, requests without an `Authorization` header act as the owner, for local development.
- In production, enrollment requires `DEVICE_ENROLLMENT_TOKEN`; without it, enrollment is closed.

## Configuration

| Variable | Purpose |
|---|---|
| `DB_PATH` | SQLite file (default `data/scrolless.db`). Shared by the web server and stdio MCP server |
| `HOST`, `PORT` | Listener (default `0.0.0.0:3333`) |
| `DEVICE_ENROLLMENT_TOKEN` | Secret readers enter to enroll; required in production |
| `AGENT_TOKEN_HASH` | SHA-256 of a pre-shared agent token for HTTP `/mcp` |
| `AGENT_RATE_LIMIT_PER_HOUR` | `/mcp` request limit per token |
| `BASE_URL`, `OAUTH_CLIENTS_JSON`, `OAUTH_TOKEN_EXPIRES_IN`, `OAUTH_REFRESH_TOKEN_EXPIRES_IN`, `ADMIN_PASSWORD` | OAuth for remote MCP connectors |
| `CORS_ORIGIN`, `CLAUDE_CONNECTOR_CORS` | Browser origins allowed to call the API |
| `TRUST_PROXY` | Trust `X-Forwarded-For` behind a reverse proxy |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional Web Push when HTTP pushes commit new items |

Client `VITE_*` values are browser-visible and must never contain database or inference secrets.

## Backups

The SQLite file is the whole state. Back it up with SQLite's online backup (`sqlite3 data/scrolless.db ".backup backup.db"`) rather than copying a live WAL database. Search indexes and reader caches do not exist yet.
