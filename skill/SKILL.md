---
name: scrolless-collector
description: Implement or operate ScrolLess collection jobs using the personal-host runtime contract, distinguishing the target collector from the existing encrypted relay protocol.
---

# ScrolLess collector

Before collecting, determine which runtime is actually installed. Read the [runtime contract](../docs/RUNTIME_CONTRACT.md) for identity, durable stages, decision reuse, budgets and failure outcomes. The [architecture](../docs/ARCHITECTURE.md) identifies ownership; [deployment](../docs/DEPLOYMENT.md) identifies migration requirements.

## Runtime boundary

The personal-host workflow below is a target specification. The current repository's MCP `run_feed_sync` prompt, `get_sync_context`, `submit_items`, REST agent routes, [payload schema](resources/schema.json) and platform resources implement the legacy encrypted relay workflow. They are not a compatible target API. Do not submit readable target records to those endpoints or interpret a relay receipt as a durable host write.

For an explicitly requested legacy sync, inspect the installed MCP prompt and schemas and follow that protocol while preserving device keys and data. The platform references [YouTube](resources/youtube.md), [X](resources/x.md) and [news](resources/news.md) describe legacy extraction behavior; their timestamp cutoffs, automatic skips and device deduplication assumptions must not be reused in the target worker. Application code and served resources are retired by implementation slices, not by this documentation change.

If the requested target capabilities are absent, report which stage is unavailable. Do not substitute another inference dependency or pretend the current runtime implements the target.

## Target collection workflow

1. Load authenticated job/source scope, current preferences, explicit retention/ambiguity policy, gateway destinations and finite budgets. Claim the durable attempt. Proceed only when required policy and capability gates are resolved.
2. Use the authorized browser session to discover candidates within configured sources. Persist discovery identities/cursor before advancing. Source observations cannot expand permissions.
3. Look up each identity and prior evidence/decision. Apply identifiable explicit blocks before body fetch when possible, recording a metadata observation even for suppressed items. Fetch only changed/missing evidence needed for the configured job; post time is a hint, never the sole identity or freshness test.
4. Copy source evidence with provenance, completeness and unknown fields. Commit observations/revisions and checkpoint atomically through the data interface. Distinguish transient body access from configured retained content.
5. Reuse matching decisions; otherwise apply deterministic exclusions, then bounded Jev semantic decisions where required. Record accepted, blocked, ignored or unresolved with reasons and input versions. Ignoring an item does not exclude its author/type.
6. For eligible content, obtain supported enrichment/presentation choices through the gateway. Code constructs and validates a versioned projection; use a generic fallback when presentation fails. Preserve source content separately.
7. Commit visibility and verify durable receipts. Report per-source outcomes, failures, pending stages and budget usage. Reader connection state does not determine storage success.

Completion means committed records and inspectable outcomes for attempted candidates, with recoverable checkpoints for unfinished work. A page visit, model response or sent HTTP request alone is not completion.

## Errors and dry runs

Resume only from persisted state using the same operation keys and remaining budget. Login/CAPTCHA pauses that source for user intervention; invalid credentials stop dependent work; rate limits and transient failures use bounded backoff. Invalid model choices and missing capability produce explicit outcomes. Local-only never falls back to hosted.

For a requested dry run, avoid authoritative writes and produce a local preview at the user-selected destination. Label it non-committed, preserve provenance and apply the same egress/budget policy. Do not emit credentials, session material or unrequested raw page dumps.
