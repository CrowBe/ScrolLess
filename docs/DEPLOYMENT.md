# Deployment and migration

The [personal-host architecture](ARCHITECTURE.md) is the target. Current code still uses encrypted relay and device-owned IndexedDB; this documentation PR does not provide the new collector, gateway, API or migration tools. Implement deployment and import in [#84](https://github.com/CrowBe/ScrolLess/issues/84), after the #82/#83 runtime foundations.

## Current development setup

Use Node.js 20+ and the repository lockfile:

```bash
npm ci
HOST=127.0.0.1 npm run dev
```

For a production-build check of the existing application:

```bash
npm run build
HOST=127.0.0.1 npm start
```

The explicit host override matters: [server/index.ts](../server/index.ts) currently defaults to `0.0.0.0`. These commands start the legacy application, not a personal-host collector. Consult the source before exposing it beyond loopback; target authentication requirements are not evidence of existing enforcement.

Existing configuration is loaded in [server/index.ts](../server/index.ts) and typed in [server/types.ts](../server/types.ts). `DB_PATH` selects the current SQLite operational database, not an authoritative readable feed database. `AGENT_TOKEN_HASH` authenticates existing agent ingestion; `BASE_URL`, `CORS_ORIGIN`, OAuth/device settings and optional VAPID keys serve the current runtime. Client `VITE_*` values are browser-visible and must never contain database or inference secrets.

Current agent endpoints require encrypted payloads, as defined in [agent-routes.ts](../server/agent-routes.ts) and [legacy payload schema](../skill/resources/schema.json). The existing MCP prompt and platform resources are legacy instructions. Do not send readable target records to them. For historical deployment context see the [archived guide](archive/DEPLOYMENT.md); its hosted roadmap and service-provider instructions are not current deployment recommendations.

## Target topology and configuration

Run a trusted collector with access to the user's signed-in browser and a host API with access to the configured data store. They may share a machine or use an authenticated connection across the user's network. Readers use the host API, not database credentials or a shared SQLite file. For SQLite, the trusted database process owns the local file; remote machines call its API.

Two configuration groups must be exposed by the implementation (names below are conceptual, not existing environment variables):

| Group | Configuration and validation |
|---|---|
| Data connection | Supported adapter, local path or network/API endpoint, credential reference, owner scope, schema version; startup verifies permissions, schema compatibility and atomic/idempotent capabilities |
| Inference gateway | Configured endpoints and credential references, capability/model versions, routing order, allowed destinations, observation egress and finite budgets; startup rejects incompatible/local-only violations |

Keep secret values in restricted trusted-process configuration. API authentication distinguishes reader, collector and administration. A private network such as a Tailnet can supply reachability and transport protection; it does not substitute for scoped application authorization. Configure trusted origins and secure transport for remote access. Do not expose an unauthenticated public listener as a setup shortcut.

The deployment slice must provide a reproducible service/startup procedure, browser-profile access, locked-down listener configuration, bounded scheduling, job status, backup/restore and a smoke test with the reader closed. No specific scheduler, tunnel provider or browser engine is mandated here.

Hosted Jev sends declared selected observations externally even when the database is local. A validated compatible local/LAN endpoint may keep inference within the configured boundary. Declare hardware, quality and latency limitations; local-only failures remain local failures.

## Migration: preserve before replacing

1. **Inventory and snapshot.** Record application/schema versions, server database and queue state, every device/origin's IndexedDB feed, read/save state and preferences. Back up the operational database consistently, including any journal state through an appropriate backup mechanism. A server backup alone does not contain today's readable device feed.
2. **Preserve decryption access.** Keep the original browser profiles/origins and device keys usable. Non-extractable keys cannot be assumed exportable. Decrypt/export within the owning device context while the legacy code still works. A missing device/key is an explicit unresolved migration case.
3. **Import into separate target storage.** Authenticate the import; validate a versioned export; attach original identity/provenance and migration batch IDs. Import content and user state idempotently. Resolve cross-device duplicates and read/save conflicts explicitly; do not silently drop one device's records. Existing excerpts are partial source evidence, not invented full articles.
4. **Verify durable readback.** Compare export/import receipts, counts, identities, field fingerprints, saved/read state and preferences. Read through the authenticated target API and render representative records. Restart the host and verify again. Track rejected/missing records; an HTTP success alone is insufficient.
5. **Cut over deliberately.** Quiesce legacy writers, reconcile late changes and remaining encrypted queues, then switch readers/collectors. Keep the old data and a documented rollback path. Target storage starts as authoritative only after verification; prior offline client mutations need reconciliation.
6. **Retire old paths.** After verified import and explicit completion of the rollback window, remove device content-key dependencies, ciphertext submission, relay queues and legacy prompts/routes in a dedicated implementation change. Revoke obsolete credentials as appropriate. Destructive cleanup requires a deliberate user action; do not couple it to startup or cache eviction.

No reset/cutover without preservation is the default. Queue TTL is not an import strategy. If unreadable queued payloads or inaccessible devices remain, report the gap and retain the originals rather than claiming complete migration.

## Backup and readiness

Target backups cover authoritative content, ledger, preferences/user state, projections and jobs plus schema versions. Search indexes and acknowledged reader caches are rebuildable. Browser login/session recovery and secret recovery are separate from content backup. Restore to an isolated location and verify API readback and job recovery before declaring a backup usable.

See [release gates](pre-release-tasks.md) and the [runtime policy gates](RUNTIME_CONTRACT.md#implementation-gates). This document specifies required evidence; it does not claim that backups, scheduling or migration have already been implemented.
