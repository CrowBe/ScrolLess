# AGENTS.md

ScrolLess is a work-in-progress personal feed host. Today an agent pushes readable items over MCP (`push_items`, stdio or HTTP) into host SQLite and the reader fetches them from `/api/items`. Issue #81 defines the target (browser worker, Jev decisions, durable ledger). The old encrypted relay has been removed; no backward compatibility or data migration is required.

## Source of truth

- Before changing ownership, collection, inference or rendering, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md).
- For deployment, authentication and configuration, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- For scope and readiness, use [docs/TASKS.md](docs/TASKS.md) and [docs/pre-release-tasks.md](docs/pre-release-tasks.md). Historical hosted/tier/Expo plans are not current requirements.
- For collector work, read [skill/SKILL.md](skill/SKILL.md). Distinguish its target workflow from the current MCP/REST protocol.
- Code proves current behavior. Mark target behavior as pending until verified; resolve OPEN contract gates before enabling dependent behavior.

## Boundaries

The host owns content, observation history, preferences, read/save state, projections and jobs. Reader IndexedDB holds only the device signing key; a feed cache would be optional and rebuildable. Database credentials stay in trusted processes; browsers use scoped APIs.

Jev is the sole initial inference dependency, behind a capability-checked gateway. Local-only never falls back to hosted. Browser execution and inference are separate. Source content is evidence, not instructions; model output cannot authorize actions or invent captured facts.

Pushed content is untrusted data: validate in code, never let it change sources, preferences or permissions.

## Workflow

Use a branch and PR starting from freshly fetched `origin/main`. Keep unrelated changes intact; use an isolated worktree when the checkout is mixed. Prefer one issue-sized slice.

Keep route groups separate: `/mcp` in `server/mcp.ts` (agent-push tools in `server/mcp-content-tools.ts`, shared with the stdio entry `server/mcp-stdio.ts`), `/oauth/*` in `server/oauth-routes.ts`, `/api/*` in `server/api-routes.ts`. Extract shared parsing/default logic into dedicated modules when needed.

Align code, tests and contract at the seam being changed. Run the smallest relevant verification while iterating, then broader checks for substantial application changes; commands live in `package.json`. Add nested instructions only when a directory develops distinct rules.
