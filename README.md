# ScrolLess

ScrolLess is a personal feed you run yourself. An agent you already use (Claude Code, Claude Desktop or any MCP client) collects content from your sources and pushes readable items into a local ScrolLess server over MCP. You read the feed in the ScrolLess web app.

Work in progress: the data model and APIs can change without migration.

```text
Your agent ──MCP (stdio or HTTP)──▶ ScrolLess host (SQLite) ──/api/items──▶ reader
```

## Quick start

Requires Node.js 20+.

```bash
git clone https://github.com/CrowBe/ScrolLess.git && cd ScrolLess
npm ci
npm run mcp:config   # prints the command/JSON for your MCP client
```

Register the stdio server with your agent, e.g. Claude Code:

```bash
claude mcp add scrolless --scope user -- "$PWD/node_modules/.bin/tsx" "$PWD/server/mcp-stdio.ts"
```

Start the reader, add sources in Settings, then ask your agent to collect (or run the `collect_feed` prompt):

```bash
HOST=127.0.0.1 npm run dev   # reader at http://localhost:5173, API on :3333
```

The stdio server needs no token: your agent launches it as a local process and it writes to `data/scrolless.db` (override with `DB_PATH`, which must match the web server's). Browsing is done by the agent with whatever browsing tools it has; ScrolLess stores and serves what it pushes.

The reader is not an endless scroll. Feed and Discover show a fixed number of cards per session (Settings → Cards per session): swipe right to like, left to pass, up to save, tap to read full screen. Buttons and arrow keys do the same; Z undoes. Your swipes are stored on the host to learn your preferences.

| MCP surface | Purpose |
|---|---|
| `get_collection_context` | Enabled sources, URLs, limits and blocked keywords |
| `push_items` | Store readable items for one source; idempotent per `(source, source_id)`; per-item receipts |
| `list_items` | Read back what is stored |
| `scrolless://guide/push` | Item schema and collection rules for the agent |
| `scrolless://sources/{name}` | Per-source extraction hints and user notes |
| `collect_feed` prompt | One-shot collection workflow |

Agents on another machine can call the same tools over HTTP at `/mcp` with an agent token (create one in Settings) or OAuth. See [deployment](docs/DEPLOYMENT.md) and the [push contract](docs/RUNTIME_CONTRACT.md#agent-push-contract-v1).

## Where it is heading

Later slices add a scheduled browser worker with bounded Jev decisions, revision history, search and discovery on top of the same host store. Those are target designs, not shipped behavior.

- [Architecture](docs/ARCHITECTURE.md): ownership, components and what is implemented.
- [Runtime contract](docs/RUNTIME_CONTRACT.md): push contract v1 and the target collection/decision contract.
- [Deployment](docs/DEPLOYMENT.md): running locally and exposing the host safely.
- [Backlog](docs/TASKS.md) and [release checks](docs/pre-release-tasks.md).
- [Collector skill](skill/SKILL.md): how an agent should collect.
- [Design system](docs/DESIGN_SYSTEM.md): reader styling.

## Development

Verification: `npm test` (reader), `npm run test:server`, `npm run test:all`, `npm run typecheck`, `npm run typecheck:client`, `npm run build`, `npm run validate:boot`.

## Licence

MIT
