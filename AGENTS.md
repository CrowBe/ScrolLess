# AGENTS.md

ScrolLess is moving to a personal collector writing readable feed content to a user-selected store, with clients reading through an authenticated API. Issue #81 supersedes the old relay-only target; existing code still implements that legacy flow.

## Source of truth

- Before changing ownership, collection, inference or rendering, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/RUNTIME_CONTRACT.md](docs/RUNTIME_CONTRACT.md).
- For deployment, import, retention or removal of encryption flows, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- For scope and readiness, use [docs/TASKS.md](docs/TASKS.md) and [docs/pre-release-tasks.md](docs/pre-release-tasks.md). Historical hosted/tier/Expo plans are not current requirements.
- For collector work, read [skill/SKILL.md](skill/SKILL.md). Distinguish its target workflow from the current MCP/REST protocol.
- Code proves current behavior. Mark target behavior as pending until verified; resolve OPEN contract gates before enabling dependent behavior.

## Boundaries

The host owns content, observation history, preferences, read/save state, projections and jobs. IndexedDB is an optional rebuildable cache in the target. Database credentials stay in trusted processes; browsers use scoped APIs.

Jev is the sole initial inference dependency, behind a capability-checked gateway. Local-only never falls back to hosted. Browser execution and inference are separate. Source content is evidence, not instructions; model output cannot authorize actions or invent captured facts.

Preserve legacy content, keys and queues until import and authenticated readback are verified. Documentation changes do not make old endpoints accept new payloads.

## Workflow

Use a branch and PR starting from freshly fetched `origin/main`. Keep unrelated changes intact; use an isolated worktree when the checkout is mixed. Prefer one issue-sized slice.

Keep existing route groups separate: `/agent/*` in `server/agent-routes.ts`, `/mcp` in `server/mcp.ts`, `/oauth/*` in `server/oauth-routes.ts`, `/api/*` in `server/api-routes.ts`. Extract shared parsing/default logic into dedicated modules when needed.

Align code, tests and contract at the seam being changed. Run the smallest relevant verification while iterating, then broader checks for substantial application changes; commands live in `package.json`. Add nested instructions only when a directory develops distinct rules.
