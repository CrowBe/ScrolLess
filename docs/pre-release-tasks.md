# Personal-host release gates

These are pending verification requirements for the target runtime, not claims that today's relay application passes them. Use the [backlog](TASKS.md) for scope and the [runtime contract](RUNTIME_CONTRACT.md) for semantics.

- [ ] **One-source proof (#82):** a real signed-in browser observation passes through the configured Jev gateway into the authoritative store and is read through the authenticated API. Closing the reader does not prevent durable capture.
- [ ] **Policies (#82):** hidden-body retention and unresolved/stale eligibility behavior are explicitly selected, documented and tested. Unknown evidence is represented without invented facts.
- [ ] **Inference (#82):** validate required capabilities, quality and finite budgets. Exercise malformed output, abstention, timeout and incompatible local endpoints. Verify local-only never contacts hosted inference and declared egress matches actual observations.
- [ ] **Authorization (#82):** reader, collector and administration scopes enforce owner/source boundaries; browser bundles contain no database/inference credentials. Private-network deployment still enforces API access.
- [ ] **Durability (#83):** repeated unchanged items reuse decisions; edited items invalidate correctly; blocked/ignored history survives body expiry. Kill/restart during stages and ambiguous writes; verify checkpoint, idempotency, fencing and budget recovery.
- [ ] **Rendering (#82/#83):** projections persist across reads, unknown versions degrade to generic cards, source content remains intact and read/save/navigation/accessibility stay deterministic.
- [ ] **Operations (#84):** bounded scheduling survives restarts, reports source failures and does not overlap work unsafely. Verify deployment on the selected personal host/network topology.
- [ ] **Migration (#84):** preserve each device's content, keys and user state; import with receipts; verify authenticated readback after restart; reconcile remaining queues; exercise rollback before retiring legacy flows.
- [ ] **Restore (#84):** restore an authoritative backup to an isolated location and verify feed, ledger, saved/read state and resumed jobs. Declare unavailable device/key cases.
- [ ] **Search (#85):** index source content independently of projections; enforce current eligibility after preference changes and rebuild without inference.
- [ ] **Discovery (#86):** record acquisition provenance and use the same identity, eligibility and budget rules as subscription collection.
- [ ] **Deletion (#87):** separate host bodies, history, user preferences and client cache; show effects on recapture, backups and pending offline mutations before deletion.
- [ ] **Documentation:** mark implemented versus pending behavior honestly; verify links, current commands and active guidance. Historical plans remain clearly superseded.

Run tests and builds appropriate to each implementation slice. A documentation-only change requires link, scope and consistency review; it does not establish runtime readiness. The old icon/thumbnail/status defect list is retired rather than copied forward without revalidation.
