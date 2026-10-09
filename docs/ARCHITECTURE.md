# Personal-host architecture

Status: target established by [#81](https://github.com/CrowBe/ScrolLess/issues/81). The agent-push path below is implemented; the browser worker, Jev gateway and durable job ledger are pending. The [runtime contract](RUNTIME_CONTRACT.md) defines behavioral requirements; code is the evidence for what runs today. Older designs are in the [archive](archive/README.md).

## Ownership

A personal collector writes readable content to a user-selected store; readers access it through an authenticated API. The personal host is trusted with content. “Host” denotes the logical owner and trusted processes, not a requirement that every process and database share one machine.

| State | Target authority | Other copies |
|---|---|---|
| Source content and revisions | Configured host data store | Reader cache, derived search index |
| Observations, identities, aliases and decisions | Host durable ledger | Worker holds temporary observations |
| Preferences, exclusions and read/save state | Host data store | None yet; offline mutations are future work |
| Enrichment and presentation projections | Host versioned records | Reader renders validated projections |
| Jobs, attempts, budgets and checkpoints | Host data store | Worker executes a leased attempt |
| Search | Host query/index service | Rebuildable index over permitted source content |
| Platform sessions and credentials | Trusted browser/collector process | Never included in inference observations |
| Database and inference credentials | Trusted backend/gateway processes | Never shipped in client configuration |

Content retention and identity-history retention are different policies. Deleting a cached feed must not delete the host ledger; expiring a body must not make a rejected item new again. Full-body retention for hidden items requires an explicit policy ([gates](RUNTIME_CONTRACT.md#implementation-gates)).

## Components and interfaces

### Collector and browser engine

The collector coordinates bounded jobs. The engine owns browser sessions, observations and permitted actions. Code extracts source text and validates URLs and records; inference cannot invent content or grant new authority. Start with one concrete DOM browser integration and one source. Screenshot/computer-use support is optional future work with a separate capability test.

A tool with its own internal inference loop is not automatically compatible with the gateway. Integrating it requires an explicit model-routing seam and evidence that its calls obey privacy and budgets. Otherwise it is not part of the initial Jev-only path.

### Data connection

A configured adapter targets a local database, network database or authenticated data API. SQLite is the first implementation, behind the trusted host API. This is an interface around actual operations and durability guarantees, not universal SQL passthrough or an arbitrary plugin loader.

All adapters must support scoped identity lookup, atomic observation/checkpoint writes, conditional decision commits, idempotent mutations, stable pagination and readback. An adapter that cannot provide the [runtime guarantees](RUNTIME_CONTRACT.md#data-access-contract) is unsupported. Browsers use an API URL and scoped session; a database connection string is trusted-process configuration only.

### Inference gateway

The gateway translates bounded decision requests to Jev-compatible implementations and validates responses. Configuration contains eligible endpoints, capability/version declarations, privacy destinations and budgets. A local implementation needs measured task quality, latency and hardware suitability; request-shape compatibility is insufficient.

Local-only permits configured local/LAN destinations only. Hosted-unavailable and local-incompatible both produce explicit outcomes, never an unconfigured fallback. Hosted egress must declare which selected page observations or excerpts leave the machine. Database location does not establish inference privacy.

### Reader and projections

Source content, enrichment and presentation are separate records. Code enumerates supported components and bindings, Jev selects, and code assembles and validates stored JSON. Feed reads do not call inference. Navigation, actions, accessibility and responsive behavior stay deterministic. Unsupported or failed projections use a generic card, subject to eligibility.

Search indexes source content independently of presentation. Searching the captured corpus (#85) differs from topical discovery (#86), which obtains candidates and enters the same ledger/eligibility pipeline. Hidden bodies are not implicitly searchable.

## Agent-push path (implemented)

A trusted agent the user runs (for example Claude Code with its own browsing tools) acts as the collector: it extracts readable items and calls the MCP `push_items` tool, over stdio ([mcp-stdio.ts](../server/mcp-stdio.ts)) or authenticated HTTP ([mcp.ts](../server/mcp.ts)). ScrolLess stores them in the host SQLite store ([content-store.ts](../server/content-store.ts)) and readers fetch them through `/api/items`. ScrolLess itself performs no inference on this path; the agent's model is the user's choice and outside the Jev gateway. Pushed content is evidence, not instructions: fields are length-limited, links must be http(s), and no item field can change sources, preferences or permissions. Behavior is recorded in [agent-push contract v1](RUNTIME_CONTRACT.md#agent-push-contract-v1). The Jev gateway, leased jobs and scheduled browser collection below remain target work.

## Current code versus target

| Code | Responsibility today | Target change |
|---|---|---|
| [mcp-content-tools.ts](../server/mcp-content-tools.ts), [mcp-stdio.ts](../server/mcp-stdio.ts), [mcp.ts](../server/mcp.ts) | MCP push tools over stdio and HTTP | Add job/attempt scope once a worker exists |
| [content-store.ts](../server/content-store.ts), [schema.sql](../sql/schema.sql) | Items keyed by `(owner, source, source_id)`, fingerprint/revision counter, metadata-only blocked records, read/save state | Separate observations, immutable revisions, decisions and projections |
| [api-routes.ts](../server/api-routes.ts), [auth.ts](../server/auth.ts), [oauth-routes.ts](../server/oauth-routes.ts) | Reader device sessions, agent tokens, OAuth | Distinct reader/collector/admin scopes |
| [taste.ts](../server/taste.ts), [ranking-config.ts](../server/ranking-config.ts) | Taste profile from swipe verdicts; owner-editable, fully explained ranking with a discovery share ([ranking](RANKING.md)); agent taste summary | Semantic features once enrichment exists |
| [src/](../src) reader | Host-ranked swipe sessions for Feed/Discover (like, dislike, save, undo, full-screen card, discovery badge, "Why this card?"), Saved list, Settings → Ranking; IndexedDB holds only the device signing key | Optional rebuildable cache and offline mutations |

## Scope and authority

The initial product is a personal host, not a multi-tenant cloud service. Billing, tier-dependent queues, Clerk identity, Postgres convergence and Expo prerequisites from the old plans are superseded. Network database adapters, additional engines and native readers may follow concrete needs; none are prerequisites for #82.

Follow [setup](SETUP.md) for running locally and [TASKS](TASKS.md) for slices and [release checks](pre-release-tasks.md) for evidence. Any runtime policy marked OPEN in the contract must be resolved in its owning slice before enabling that behavior.
