# Deployment

Two supported deployment paths. Both serve the same app — choose based on your hosting preference.

---

## Option A: Vercel + Render (recommended, free tier)

Split hosting: Vercel serves the frontend (global CDN), Render runs the backend (persistent disk for SQLite).

### Backend on Render

1. Create a **Web Service** on Render pointing to the repo
2. Set build command: `npm install`
3. Set start command: `npm start`
4. Add a **Disk** (persistent volume) mounted at `/data`
5. Set environment variables:

```
NODE_ENV=production
AGENT_TOKEN_HASH=<sha256 hash of your agent token>
VAPID_PUBLIC_KEY=<your VAPID public key>
VAPID_PRIVATE_KEY=<your VAPID private key>
VAPID_SUBJECT=mailto:you@example.com
BASE_URL=https://yourapp.onrender.com
CORS_ORIGIN=https://yourapp.vercel.app
DB_PATH=/data/feed.db
TRUST_PROXY=true
```

`TRUST_PROXY=true` tells Fastify to read the real client IP from `X-Forwarded-For` — required behind Render/Cloudflare/Nginx so the rate limiters bucket by client rather than by proxy.

6. Set `DB_PATH=/data/feed.db` so SQLite data is persisted on the Render disk

> **Note**: Render free tier instances spin down after 15 minutes of inactivity. Push notifications won't fire while spun down. Upgrade to Starter ($7/mo) for always-on.

`BASE_URL` is the backend's own public URL. `CORS_ORIGIN` is the frontend origin allowed to call the API from the browser.

Verify these routes respond from the Render URL:
- `GET /api/stream` — 401 without `X-Device-Id`, 200 with registered device header
- `POST /agent/feed-items` — 401 (no token)
- `GET /oauth/.well-known/oauth-authorization-server` — metadata JSON
- `/mcp` — MCP endpoint

### Frontend on Vercel

1. Create a **Vercel project** pointing to the same repo
2. Set framework preset: **Vite**
3. Build command: `npm run build`
4. Output directory: `dist/client`
5. Add environment variables:

```
VITE_API_BASE_URL=https://yourapp.onrender.com
# only needed if backend enrollment protection is enabled
VITE_DEVICE_ENROLLMENT_TOKEN=<match Render DEVICE_ENROLLMENT_TOKEN>
```

6. Add `vercel.json` at the repo root (see below)
7. Deploy

Verify:
- PWA loads from the Vercel URL
- API calls reach Render (check network tab)
- Push subscription flow works end-to-end
- PWA installs on Android via "Add to Home Screen"

---

## Option B: Self-Hosted (Cloudflare Tunnel)

Single process serves both frontend and backend. Cloudflare Tunnel provides HTTPS without opening inbound ports.

### Prerequisites

- Node.js 20+
- `cloudflared` installed:

```bash
# Fedora
sudo dnf install cloudflared

# Or direct download
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

### Quick test (temporary URL)

```bash
npm run build
npm start &
cloudflared tunnel --url http://localhost:3333
```

This gives you a temporary `https://xxx.trycloudflare.com` URL — good for testing.

### Permanent tunnel with custom domain

```bash
cloudflared tunnel login
cloudflared tunnel create scrolless
cloudflared tunnel route dns scrolless feed.yourdomain.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: feed.yourdomain.com
    service: http://localhost:3333
  - service: http_status:404
```

Run: `cloudflared tunnel run scrolless`

### Build and run

```bash
npm run build
npm start
```

In self-hosted mode, CORS is not needed (same origin). The SPA fallback serves `index.html` for all non-API paths.

---

## Systemd Services

### ScrolLess server

Create `~/.config/systemd/user/scrolless.service`:

```ini
[Unit]
Description=ScrolLess Feed Aggregator
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/ScrolLess
ExecStart=/usr/bin/node --import tsx server/index.ts
Environment=NODE_ENV=production
EnvironmentFile=%h/.config/scrolless/env
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Create the env file:

```bash
mkdir -p ~/.config/scrolless
cat > ~/.config/scrolless/env << 'EOF'
AGENT_TOKEN_HASH=<your hash>
VAPID_PUBLIC_KEY=<key>
VAPID_PRIVATE_KEY=<key>
VAPID_SUBJECT=mailto:you@example.com
EOF
chmod 600 ~/.config/scrolless/env
```

Enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable --now scrolless
sudo loginctl enable-linger $USER
```

### Cloudflare Tunnel (self-hosted only)

```bash
# cloudflared has its own systemd integration:
cloudflared service install
systemctl --user enable --now cloudflared
```

Or create a manual unit at `~/.config/systemd/user/cloudflared.service` pointing to your config.

---

## Vercel Configuration

Add `vercel.json` at the repo root:

```json
{
  "rewrites": [
    { "source": "/((?!api/|agent/|mcp|oauth/|.*\\..*).*)", "destination": "/index.html" }
  ]
}
```

This routes only frontend SPA paths to `index.html`, avoids rewriting backend route groups in split-hosting deployments, and leaves asset requests alone.

---

## VAPID Key Generation

Required for push notifications. Generate once and store permanently:

```bash
npx web-push generate-vapid-keys
```

Add the public and private keys to your environment.

---

## Agent Token Setup

```bash
# Generate a random token
npm run generate-token
# Output: e.g. a1b2c3d4...

# Hash it for the server
node -e "const c=require('crypto');const t='YOUR_TOKEN_HERE';console.log(c.createHash('sha256').update(t).digest('hex'))"

# Store the HASH in AGENT_TOKEN_HASH
# Store the PLAINTEXT token in your agent's MCP config or script
```

---

## Claude Code Scheduled Sync

Once deployed, set up automatic feed syncing with Claude Code:

### 1. Configure the MCP server

Add to `~/.claude/mcp_servers.json`:

```json
{
  "scrolless": {
    "type": "streamable-http",
    "url": "https://feed.yourdomain.com/mcp",
    "headers": {
      "Authorization": "Bearer YOUR_PLAINTEXT_TOKEN"
    }
  }
}
```

### 2. Enable Chrome connector

The agent needs browser access to scrape logged-in feeds (YouTube subscriptions, X timeline). Enable the Claude in Chrome connector.

### 3. Set up recurring sync

In Claude Code, use a loop or schedule:

```
/loop 30m Use the run_feed_sync prompt from the ScrolLess MCP server.
```

Or with `/schedule` for background operation:

```
/schedule every 30 minutes: Use the run_feed_sync prompt from the scrolless MCP server.
```

### 4. Verify

- Check the PWA feed updates automatically
- Check `GET /api/sync/status` shows recent sync times
- Push notifications arrive on your phone when new items land
