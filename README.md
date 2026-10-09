# ScrolLess

ScrolLess is moving to a personal feed collector: a browser worker on your machine gathers content, Jev makes bounded decisions, and a user-selected data store holds the readable feed. Clients read through an authenticated ScrolLess API.

**Migration status:** the first working path is **agent push**: run ScrolLess locally as your own MCP server, let an agent (Claude Code, Claude Desktop or any MCP client) collect content and push readable items into your local SQLite store, and read them in the ScrolLess reader. The Jev gateway and scheduled browser collector remain target work. The legacy encrypted relay (ciphertext to each reader's IndexedDB) still runs alongside until existing device data is migrated.

## Quick start: your own local MCP server

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

Then ask the agent to collect (or use the `collect_feed` prompt). It calls `get_collection_context`, browses your sources with whatever browsing tools it has, and calls `push_items`. Start the reader to see the feed:

```bash
HOST=127.0.0.1 npm run dev   # reader at http://localhost:5173
```

The stdio server needs no token: the agent launches it as a local process and it writes to `data/scrolless.db` (override with `DB_PATH`, which must match the web server's). Configure sources and blocked keywords in the reader's Settings.

| MCP surface | Purpose |
|---|---|
| `get_collection_context` | Enabled sources, URLs, limits and blocked keywords |
| `push_items` | Store readable items for one source; idempotent per `(source, source_id)`; per-item receipts |
| `list_items` | Read back what is stored |
| `scrolless://guide/push` | Item schema and collection rules for the agent |
| `scrolless://sources/{name}` | Per-source extraction hints and user notes |
| `collect_feed` prompt | One-shot collection workflow |

Agents on another machine can use the same tools over HTTP at `/mcp` with an agent token or OAuth (see [deployment](docs/DEPLOYMENT.md)). The contract is recorded in the [runtime contract](docs/RUNTIME_CONTRACT.md#agent-push-contract-v1).

## Target flow

```text
Signed-in browser → collector worker → authoritative data connection
                          ↕                        ↕
                    Jev gateway             authenticated API → readers
```

The worker owns browser execution; Jev selects among code-defined choices. The host owns source content, observation history, preferences, read/save state, projections, collection jobs and search. IndexedDB may provide a rebuildable offline cache.

Two interfaces are configurable:

- **Data connection:** a local database, network database or authenticated data API through a supported adapter. SQLite is the first implementation. Database credentials stay in trusted processes; browsers receive scoped API access.
- **Inference gateway:** translates requests and responses, checks capabilities and routes within the configured privacy policy. Jev is the sole initial inference dependency. Hosted inference sends selected observations externally; a compatible local implementation must be validated for the required decisions. Local-only never falls back to hosted.

The target needs no application-level feed encryption, device content keys or ciphertext relay. Authentication and secure transport remain required independently of that decision. A personal machine or LAN host reached over a private network is a supported deployment direction; it does not imply anonymous access.

## Start here

- [Architecture](docs/ARCHITECTURE.md): ownership, boundaries and current-code map.
- [Runtime contract](docs/RUNTIME_CONTRACT.md): durable collection, decisions, rendering and unresolved implementation gates.
- [Deployment and migration](docs/DEPLOYMENT.md): current development setup, target deployment and preservation of existing data.
- [Backlog](docs/TASKS.md): #81–#87 and implementation order.
- [Release checks](docs/pre-release-tasks.md): evidence required before declaring the new runtime ready.
- [Collector skill](skill/SKILL.md): workflow and target/current protocol boundary.
- [Design system](docs/DESIGN_SYSTEM.md): existing reader styling.

## Run the application for development

Requires Node.js 20+ as declared in [package.json](package.json).

```bash
npm ci
HOST=127.0.0.1 npm run dev
```

This starts the backend on port 3333 and the Vite reader on port 5173. It does **not** start a Jev collector. Readable content arrives through the MCP `push_items` tool above; the legacy `/agent/*` routes and MCP `submit_items` still require the encrypted relay payload.

Useful verification commands are `npm test`, `npm run test:server`, `npm run test:all`, `npm run build` and `npm run validate:boot`. See their definitions in [package.json](package.json).

## Implementation sequence

First establish this contract, then prove one browser source → Jev → SQLite → reader in [#82](https://github.com/CrowBe/ScrolLess/issues/82). Recovery, scheduling, migration, search, discovery and deletion follow as bounded slices. The old hosted/tier/Expo plans are [historical](docs/archive/README.md), not competing roadmaps.

## Licence

MIT
