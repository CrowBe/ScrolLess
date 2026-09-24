# ScrolLess

ScrolLess is moving to a personal feed collector: a browser worker on your machine gathers content, Jev makes bounded decisions, and a user-selected data store holds the readable feed. Clients read through an authenticated ScrolLess API.

**Migration status:** this is the agreed target, not the current application. Issue [#81](https://github.com/CrowBe/ScrolLess/issues/81) establishes the documentation contract only. Current code still encrypts agent submissions, relays ciphertext and stores decrypted feed content in each reader's IndexedDB. The personal-host collector, gateway and authoritative content API remain implementation work.

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

## Run the current application for development

Requires Node.js 20+ as declared in [package.json](package.json).

```bash
npm ci
HOST=127.0.0.1 npm run dev
```

This starts the existing backend on port 3333 and the Vite reader on port 5173. It does **not** start a Jev collector. Agent ingestion needs credentials and the existing encrypted payload protocol; see [deployment](docs/DEPLOYMENT.md). Do not submit target readable-content records to today's relay endpoints.

Useful verification commands are `npm test`, `npm run test:server`, `npm run test:all`, `npm run build` and `npm run validate:boot`. See their definitions in [package.json](package.json).

## Implementation sequence

First establish this contract, then prove one browser source → Jev → SQLite → reader in [#82](https://github.com/CrowBe/ScrolLess/issues/82). Recovery, scheduling, migration, search, discovery and deletion follow as bounded slices. The old hosted/tier/Expo plans are [historical](docs/archive/README.md), not competing roadmaps.

## Licence

MIT
