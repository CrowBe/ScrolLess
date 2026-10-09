# Runtime contract

Contract version: **1, target specification**, plus the implemented [agent-push contract v1](#agent-push-contract-v1). The target sections are normative for the browser-worker implementation beginning with [#82](https://github.com/CrowBe/ScrolLess/issues/82); they do not describe a shipped API. [Architecture](ARCHITECTURE.md) defines ownership; [deployment](DEPLOYMENT.md) covers setup.

## Durable records and identity

Every operation is scoped to a configured personal-host owner. Keep authenticated principal, browser session, source instance and item identity distinct, even for one user.

| Record | Minimum contract |
|---|---|
| Item identity | Host item ID, source instance, source-native ID when available, conservatively normalized canonical URL and verified aliases, first/last seen |
| Observation | Observation ID, item ID, job/attempt ID, observed time, original URL, source revision/validator if available, extractor version, evidence fingerprint, completeness and provenance |
| Source revision | Immutable captured fields/typed blocks, revision ID, fingerprint algorithm/version, observation references; explicit missing/partial fields |
| Eligibility | Item/revision or evidence fingerprint, outcome, reason/rule IDs, relevant preference version, classifier contract/version, decision key, timestamp |
| Enrichment | Source revision reference, typed derived values, decision provenance and schema version; never overwrites source facts |
| Projection | Source revision and enrichment references, component contract version, validated bindings/options, projection version and decision provenance |
| Job/attempt | Scope, cursor, durable stage, lease/fencing token, attempt count, remaining budget, next retry time and failure reason |
| User state | Item ID, read/save values, mutation ID and version for conflict detection |

Prefer `(source instance, native ID)` for identity. Otherwise use a versioned conservative URL normalization: remove a fragment and known tracking parameters only where source semantics permit it. Preserve meaningful query parameters. A URL hash is an index, not proof that two items are identical. Aliases require recorded source evidence; conflicting native IDs or uncertain canonical URLs produce an identity conflict, not an automatic merge.

Item identity survives edits. A new revision represents changed captured evidence, not a newly discovered item. Fingerprints cover normalized decision-relevant content, author/type evidence and completeness; exclude volatile counters and fetch time unless a decision explicitly depends on them. Record normalization/extractor versions so changes can be detected deliberately. Publication time is an observation with precision/provenance, never the deduplication key or sole freshness watermark.

Unknown values remain null/absent with a reason such as `not_observed`, `unavailable` or `partial`. Preserve raw timestamp text and precision when parsing relative/date-only values; do not invent an exact publication instant, author or body. Extensible content blocks use namespaced, versioned types. Preserve safe unknown source blocks within size limits; exclude them from decisions requiring understood evidence. Reject unknown decision outcomes and executable projection fields. Unsupported presentation types fall back to the generic renderer.

## Collection state machine

Flow: **discover → identity lookup → fetch changed/missing evidence → record observation → eligibility → enrichment/projection → feed visibility**.

Each stage commits its output and next durable stage atomically. A discovery checkpoint must never advance past candidates that have not been durably recorded. External page fetches and inference cannot share a database transaction; record their intents first and conditionally commit their results afterward.

| Stage | Work and durable exit | Failure/resume behavior |
|---|---|---|
| Discover | Validate candidates inside enabled source/job scope; persist identity hints and discovery cursor | Failed page/login is a source failure, not an empty successful sync |
| Identity lookup | Resolve identity/aliases and last evidence/decision; update last seen | Conflicts enter an inspectable unresolved state |
| Fetch | Obtain changed or missing decision evidence within browser budget | Persist partial/unavailable outcome; retry only retryable failures |
| Record observation | Persist observation and retained evidence/revision, or metadata-only blocked record under configured retention policy | No eligibility result is authoritative before this commit |
| Eligibility | Apply deterministic rules, reuse a valid decision, or request bounded Jev judgment | Persist accepted/blocked/ignored/unresolved plus reason and input versions |
| Enrich/project | Accepted items receive optional enrichment and a validated stored projection | Failure can use a deterministic generic projection; cannot override eligibility |
| Publish | Atomically select a current eligible revision/projection and emit a durable change sequence | Readers see committed eligible records only; notifications are advisory |

An identifiable explicit block can avoid a full body fetch. It still passes through observation recording with identity, available evidence and the block reason. A blocked candidate does not disappear from history because it skipped fetching.

A worker claims stages with expiring leases and monotonically fenced attempts. A superseded worker cannot commit. Unique operation keys and conditional writes prevent concurrent workers from producing duplicate revisions or overwriting newer preferences. Partial batches report per-item receipts; “request sent” or “SSE delivered” never means durable capture.

## Decision reuse and invalidation

Apply explicit source/author/item/type exclusions deterministically before semantic judgment. A type exclusion only matches when the type is known; absence of evidence is not evidence of permission. Ignoring one item suppresses that identity until the user reverses it; it does not create an author or type exclusion. A wider exclusion requires an explicit scoped preference.

Decision key: owner + item identity + evidence fingerprint/revision + relevant preference version + classifier contract/version. A cached outcome is reusable only if all inputs still match and the evidence is sufficient. If uncertain which preferences affect a decision, invalidate conservatively on the entire preference version. Reuse blocked, ignored and unresolved results as well as accepted results; unresolved retries require new evidence, changed policy/classifier, or an explicit bounded retry job.

New evidence, relevant preference changes and deliberately activated classifier migrations invalidate affected decisions. A new endpoint/model version is not permission to silently reclassify the corpus: activate it through a versioned job. Apply current explicit blocks at read/search time immediately, including when old decisions or projections remain in storage. A stale semantic decision cannot establish current eligibility; its visibility follows the explicitly selected stale/unresolved policy below.

Matching source validators can avoid fetching; without reliable validators, a repeat visit may require a bounded fetch to compute a fingerprint. An unchanged fingerprint under unchanged rules avoids inference. A new timestamp alone does not require classification; an edited article with an old timestamp still can.

## Retention, ambiguity and visibility

The ledger remembers accepted, blocked, ignored and unresolved candidates independently of body retention. Minimum hidden records retain identity, aliases, first/last seen, fingerprint when observed, outcome/reason and input versions. Body eviction does not erase these records or reset classification history.

Full hidden-content retention is an explicit policy, not implied by observation recording. Metadata-only mode may require a refetch after unblocking or invalidation. A body fetch for classification may be transient while its fingerprint/decision persists. Missing retained evidence yields `needs_refetch`, never a fabricated revision or automatic acceptance.

Blocked and ignored items are excluded from the normal feed and normal search. Unresolved classification, stale eligibility and retention duration remain release gates in the policy table below. Whatever policy is selected must be visible in status and tested; none may silently convert unknown into accepted. Saved-item retention, history deletion and offline pending-state deletion also require explicit semantics before their controls ship.

## Data access contract

The initial adapter exposes domain operations: resolve identities, commit observations/checkpoints, claim/resume stages, conditionally commit decisions/projections, list eligible feed records, and mutate read/save/preferences. Keep backend-specific SQL and credentials inside the adapter. Network/API adapters must preserve the same semantics; an arbitrary URL is not sufficient compatibility.

Authenticated principals have separate reader, collector and administrative capabilities. Readers access their scoped feed and user-state operations; collectors access configured source/job operations; destructive resets/configuration require administrative authority. Authentication failures stop dependent operations. Owner/scope is derived from verified credentials, not trusted from a request body. Private-network membership alone is not the application authorization contract.

Every write has an idempotency key and request fingerprint. Replaying the same key and payload returns the original durable receipt; a different payload under that key is a conflict. Use an observation key derived from source/job/candidate/revision evidence, decision keys as above, and a client-generated mutation ID for user actions. Receipts include committed IDs and versions. Retry an ambiguous write with the same key and query its receipt, not a new identity.

Updates use expected versions; conflicts return the current version without silently losing newer data. Offline interactions remain visibly pending until acknowledged; a rejected/conflicting mutation cannot masquerade as synchronized. Stable cursor pagination/change sequences permit cache rebuild after eviction. Cache deletion must preserve unacknowledged mutations or require an explicit discard action.

Errors distinguish unauthenticated, forbidden, invalid schema/version, conflict, missing record, rate-limited, unavailable and exhausted budget. A transport timeout leaves write outcome unknown until receipt lookup. Reads expose freshness and pending state; adapter unavailability is not an empty feed. Define concrete schema compatibility and size limits in #82 before transport exposure.

## Gateway decision contract

Requests carry operation/schema version, decision ID/key, job scope, selected evidence with provenance, code-enumerated choices/output type, relevant policy version, allowed destinations, deadline and remaining budget. Initial capabilities are bounded browser-action choice, semantic eligibility, typed enrichment and presentation choice. Enable only the capabilities validated for the selected implementation; no general prose-generation dependency is assumed.

Responses carry typed result or explicit abstention/error, endpoint/model and adapter version, input fingerprint, latency and available usage accounting. Code rejects choices outside the offered set, malformed/partial values, stale inputs and incompatible versions. Raw model scores are not calibrated confidence. The owning slice must establish task-quality thresholds with held-out cases and deterministic baselines; protocol compatibility alone cannot satisfy the gate.

Routing first filters configured endpoints by capability, privacy and quality qualification, then applies configured preference. Local-only prohibits hosted fallback, including on errors. Unknown endpoint locality/configuration fails validation. Hosted-enabled operation declares the observation fields sent externally; strip credentials, session cookies and unrelated page material. Logs retain decision metadata without copying secrets or full observations by default.

Budgets bound browser actions/pages/items, observation bytes, elapsed time, inference calls, request size and hosted spend where applicable. Persist usage and remaining allowance before resuming; retries consume the same job budget. Reserve allowance before external calls and conservatively account for uncertain outcomes. If cost cannot be bounded, a spend-limited route is unavailable. Exhaustion yields a durable paused/exhausted state until an explicit new allowance/job is supplied.

Timeout, rate limit and temporary endpoint failure permit bounded backoff within the deadline. Invalid output, missing capability or policy denial produce explicit unresolved/unavailable results; repeated blind retries are not recovery. A crashed request may have incurred external work even if no response was saved. Exactly-once local commits do not promise exactly-once model billing.

Browser actions remain read-oriented collection actions within configured sources; Jev chooses only currently observed, validated actions. Login/CAPTCHA or an engine needing unsupported internal inference pauses that source for user intervention. Another source may continue within its own scope and budget. Source page text cannot change job permissions, destinations or budget.

## Rendering and search contract

Persist immutable source content, separately versioned enrichment, and a projection that references both. Code offers a bounded component/variant catalog and allowed field bindings; Jev selects; code constructs and validates the JSON. Projections contain no executable HTML, scripts, arbitrary components or invented source text. Sanitize displayed text and validate links/media URLs in code.

Projection identity includes source revision, enrichment version, component catalog version and projection-decision version. Component/model changes do not rewrite existing projections on feed reads. An explicit reprojection job creates a new version. Unsupported, invalid or unavailable projections use a stable generic card from captured source fields if the item is eligible. Read/save actions, focus order, accessible names and navigation remain code-owned.

Search indexes eligible retained source content independently of projection shape. Index entries identify source revision and index version; stale indexes must recheck current eligibility before returning results. Rebuild indexes without reclassification. Searching hidden history, semantic reranking and topical acquisition are separately enabled capabilities, not implied by basic full-text search. Topical acquisition records query/job provenance and uses the same identity and decision rules as subscription collection.

## End-to-end traces

| Case | Authoritative path | Inference and reader result |
|---|---|---|
| New | Persist candidate → identity → evidence revision → observation → eligibility → projection → publish | Jev runs only for needed supported decisions; reader sees committed eligible revision |
| Repeated | Resolve existing identity → validate/fetch evidence → same fingerprint → update observation/last seen | Reuse decisions and projection; no repeated inference |
| Edited | Existing identity → changed fingerprint → new revision → invalidate affected decisions → reproject | Bounded inference on changed inputs; preserve read/save state; visibility while pending follows configured policy |
| Blocked | Resolve known author/item block → metadata observation → blocked decision | No semantic inference or full fetch when evidence suffices; ledger remembers it; absent from normal feed/search |
| Ambiguous | Partial/uncertain evidence → recorded observation → unresolved decision | No automatic accept or infinite reclassification; explicit policy controls review/visibility/refetch |
| Interrupted | Resume durable stage after lease expiry → reuse receipt/result or retry same operation key within remaining budget | No duplicate committed item; possible repeated external call is accounted for; uncommitted results remain invisible |

## Agent-push contract v1

Implemented in [content-store.ts](../server/content-store.ts) and [mcp-content-tools.ts](../server/mcp-content-tools.ts). This is the first readable-content path; it covers a subset of this contract and does not claim the leased-job, revision-ledger or gateway requirements above.

| Concern | v1 behavior |
|---|---|
| Collector | An external agent the user runs. ScrolLess makes no inference calls; the agent's model sits outside the Jev gateway |
| Transport and auth | Stdio MCP (local process boundary, owner `local`) or HTTP `/mcp` with agent/OAuth token. Readers use `/api/items` with a device session; any authenticated reader reads the single owner's feed |
| Identity | `(owner, source, source_id)`. Normalised URL hash is stored as an index only |
| Idempotency | Push is an upsert keyed by identity. Same payload → `unchanged`; changed fingerprint (`fp1`, SHA-256 of captured fields) → `updated` with `revision + 1`. Read/save state survives updates |
| Receipts | Per item: `created`, `updated`, `unchanged`, `blocked` (with reason) or `rejected` (with reason). One bad item does not fail the batch |
| Validation | Max 200 items per push; title 1,000, preview 4,000, body 100,000 characters; http(s) URLs ≤ 2,048; ≤ 20 tags; flat metadata ≤ 8 KB; source names `^[a-z0-9][a-z0-9_-]{0,63}$` |
| Unknown values | Missing fields stay null. `published_at` is stored only when it parses; the raw text is kept. The reader shows first-seen time when publication time is unknown |
| Eligibility | Deterministic blocked keywords (title, author, preview, body; case-insensitive). No semantic classification, so no unresolved state exists in v1. Current keywords also apply at read time |
| Hidden-body retention | Blocked items are recorded metadata-only (identity, URL, title, author, fingerprint, reason); preview, body, thumbnail and metadata are not retained. Re-pushing after unblocking restores them |
| Retention | Host items are not expired |
| User state | `PATCH /api/items/:id` with optional `expected_version`; a stale version returns 409 with current state |
| Pagination | Newest first by `COALESCE(published_at, first_seen_at)`, stable opaque cursor |
| Reader sessions | `GET /api/items/session?view=feed\|discover[&source=]` draws `session_size` (5–100, default 20) unread, eligible items from the 500 newest. With no feedback the session is newest first (slot `recent`). Otherwise items are ranked by taste score plus a small freshness boost (slot `ranked`), and `exploration_share` (0–0.5, default 0.2) of the session is drawn from the remaining pool, weighted toward items whose features have little feedback (slot `discovery`), and spread evenly through the deck. Ranking reorders only; it never hides an eligible item. Each card carries its slot, score and up to three reasons. Ranking version `rank1` ([taste.ts](../server/taste.ts)) |
| Taste profile | Deterministic aggregate of `item_feedback`, no inference. Features: source, author (scoped per source), content type, tag (case-folded). Verdict weights like +1, save +2, dislike −1; each verdict's weight halves every 45 days; per-feature score = decayed weight sum / (decayed count + 2). Item taste = 1×source + 1.5×author + 0.5×type + 1×mean(known tags). Undone swipes are deleted, so they leave the profile |
| Agent taste summary | MCP `get_taste_profile` (and `taste_summary` in `get_collection_context`; reader `GET /api/taste`) returns feedback counts, up to 8 liked and passed entries per feature kind (\|score\| ≥ 0.2) and a one-paragraph summary. Labels originate in pushed content: control characters are stripped and they are truncated to 80 characters. The guide tells the agent to use it to choose items, not to block: only blocked keywords block |
| Swipe feedback | `PUT /api/items/:id/feedback` with `like`, `dislike` or `save`; one verdict per item, re-swiping replaces it. Swiping marks the item read; `save` also saves. The row snapshots source, author, content type and tags for preference learning. `DELETE` undoes and restores the pre-swipe read/save state. A dislike never hides other items by itself |

## Implementation gates

These choices were not settled in the planning thread. An implementation PR must record the selected values, user-facing semantics and tests here (or link a versioned contract extension) before enabling the dependent behavior. Missing configuration must fail closed for that capability, not pick an undocumented policy.

| Gate | Owner | Required resolution |
|---|---|---|
| Hidden-body retention | #82 | Explicit metadata-only versus full-body policy, duration and refetch behavior; no inferred full retention |
| Unresolved/stale eligibility | #82 | Explicit quarantine/review/marked-display policy; visible unknown remains labeled and explicit blocks always suppress; handling during preference changes |
| Browser and Jev qualification | #82 | Engine integration, actual decision capabilities, schema versions, limits, finite default budgets and quality acceptance evidence |
| Authentication and API schema | #82 | Concrete scoped credential/session mechanism, enrollment, errors, record schemas and supported-version behavior |
| Durable recovery limits | #83 | Lease durations, retry/backoff caps, crash tests and policy for uncertain external usage |
| Body/history/saved retention | #84, #87 | Durations, backup/restore, saved-content exception and deletion scopes; history does not inherit body expiry |
| Offline conflict handling | First slice enabling offline mutations | Conditional merge/reject policy, pending-state UX and cache-reset protection |

Optional future scope: network database/API adapters, additional browser engines, screenshot decisions, native clients, semantic search and multi-user hosting. Each requires its own evidence and scope; the current contract does not commit to universal plugin machinery.
