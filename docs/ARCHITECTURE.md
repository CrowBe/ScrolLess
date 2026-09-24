# Personal-host architecture

Status: agreed target established by [#81](https://github.com/CrowBe/ScrolLess/issues/81); implementation pending. The [runtime contract](RUNTIME_CONTRACT.md) defines behavioral requirements. Code remains the evidence for what runs today. The old relay architecture is preserved in the [archive](archive/README.md).

## Ownership

A personal collector writes readable content to a user-selected store; readers access it through an authenticated API. The personal host is trusted with content. “Host” denotes the logical owner and trusted processes, not a requirement that every process and database share one machine.

| State | Target authority | Other copies |
|---|---|---|
| Source content and revisions | Configured host data store | Reader cache, derived search index |
| Observations, identities, aliases and decisions | Host durable ledger | Worker holds temporary observations |
| Preferences, exclusions and read/save state | Host data store | Client may hold pending offline mutations |
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

## Current code versus target

This map is a starting point for migration, not a claim that target services exist.

| Current code | Current responsibility | Target change |
|---|---|---|
| [agent-routes.ts](../server/agent-routes.ts), [mcp.ts](../server/mcp.ts) | Encrypted submissions and collector context | Replace ingestion semantics through a versioned contract; retire old prompts deliberately |
| [sse-manager.ts](../server/sse-manager.ts) | Device relay and delivery | Feed availability comes from durable host commit, independent of an open reader |
| [db.ts](../server/db.ts), [schema.sql](../sql/schema.sql) | SQLite operational and queue state | Add authoritative content, ledger and runtime operations; preserve old data during migration |
| [idb.ts](../src/idb.ts), [device-session.ts](../src/bootstrap/device-session.ts) | Device-owned content and decryption | Import/readback first, then optional cache and offline mutations |
| [crypto.ts](../src/crypto.ts) | Device payload decryption | Retain while old encrypted data needs it; remove only after verified cutover |
| [api-routes.ts](../server/api-routes.ts), [auth.ts](../server/auth.ts), [oauth-routes.ts](../server/oauth-routes.ts) | Existing API and identity paths | Define and enforce host reader/collector/admin scopes without assuming existing auth suffices |

The present server defaults to `0.0.0.0` in [index.ts](../server/index.ts); the development instructions explicitly bind loopback. Existing MCP prompts and platform resource files describe legacy collection behavior. Their presence is not evidence that the target contract is implemented.

## Scope and authority

The initial product is a personal host, not a multi-tenant cloud service. Billing, tier-dependent queues, Clerk identity, Postgres convergence and Expo prerequisites from the old plans are superseded. Network database adapters, additional engines and native readers may follow concrete needs; none are prerequisites for #82.

Follow [deployment/migration](DEPLOYMENT.md) to preserve existing user data. Follow [TASKS](TASKS.md) for slices and [release checks](pre-release-tasks.md) for evidence. Any runtime policy marked OPEN in the contract must be resolved in its owning slice before enabling that behavior.
