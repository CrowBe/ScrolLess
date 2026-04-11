# ScrolLess Roadmap

This document is the near-term engineering roadmap for the current ScrolLess codebase.

It replaces the older staged greenfield implementation plan. The project is no longer at a blank-slate phase, so planning docs should describe:

- what already exists
- what is partially implemented
- what is next
- where the architecture is intentionally heading

Use this alongside:

- `docs/ARCHITECTURE.md` for the current technical model and route/data contracts
- `docs/TIER_CONTRACT.md` for free vs paid behavior and queue semantics
- `docs/pre-release-tasks.md` for launch-readiness gaps

---

## 1. Current Implementation Snapshot

### Implemented foundations

These are present in the repository today:

- Fastify backend with route separation across:
  - `/api/*`
  - `/agent/*`
  - `/oauth/*`
  - `/mcp`
- SQLite schema and bootstrap logic
- Device registration and device challenge/verify flow
- Free-tier active-device rotation with grace period
- SSE relay infrastructure
- Free-tier encrypted short-lived queue (`free_queue_deliveries`)
- Paid-tier queue tables and ACK flow (`paid_queue_deliveries`, `/api/v1/queue/ack`)
- OAuth server foundations
- MCP server foundations
- Preact client app
- IndexedDB feed storage
- Client-side crypto/decryption pipeline
- Notification prompt and web push subscription flow
- Settings UI for source management and agent tokens
- Preferences API and Settings UI for core feed behavior
- Test coverage across server and client suites

### Important current architectural truths

- Feed content is device-resident. The server is not a plaintext feed store.
- Agent submissions are encrypted before relay.
- The server stores operational metadata and ciphertext queues, not readable feed content.
- Free tier is device-scoped and intentionally constrained.
- Paid tier direction is account-scoped with queue semantics and multi-device delivery.

---

## 2. Status by Area

### A. Core relay platform

**Status:** Mostly implemented

Includes:
- device registration
- sync context
- encrypted agent submission
- SSE delivery
- offline queueing behavior
- push subscription flow
- route versioning for device/token flows

Remaining work is mostly around tightening contracts, hosted-mode identity, and queue completeness.

### B. PWA product surface

**Status:** Implemented, with product polish gaps

Includes:
- feed rendering
- source filters
- saved/read flows
- settings
- notification prompt
- local retention cleanup

Still needs selective UI/UX refinement from `docs/pre-release-tasks.md`.

### C. Settings and controllability

**Status:** Partially complete

Implemented:
- source management
- agent tokens
- preferences editing
- some local-danger-zone actions

Still missing:
- broader reset/deletion semantics aligned with actual runtime model
- hosted-mode connected-app / OAuth client management
- better observability of sync behavior per source

### D. Documentation

**Status:** Inconsistent

- `docs/ARCHITECTURE.md` reflects the current architectural direction better than the old task plan
- `docs/TIER_CONTRACT.md` reflects queue and identity direction
- `docs/pre-release-tasks.md` captures many real gaps
- older planning assumptions were misleading and are being replaced by this roadmap

### E. Hosted-mode readiness

**Status:** Not ready

Main blockers:
- SQLite-centric persistence
- missing hosted auth/user identity plumbing
- incomplete operator-blind encryption story
- missing user-facing OAuth client management

---

## 3. Near-Term Priorities

Ordered roughly by leverage.

### Priority 1: Keep the core product trustworthy

These tasks improve confidence in day-to-day development and reduce drift.

- Keep client and server test suites green
- Close gaps where docs misrepresent current behavior
- Continue converting brittle assumptions into explicit contracts
- Avoid adding features that undermine the "server as relay, not reader" model

### Priority 2: Finish user-facing configuration and operational clarity

These are the highest-value product gaps for self-hosted and early real usage.

- Improve Danger Zone / reset semantics so they match real stored state
- Add per-source sync visibility in the UI
- Tighten preference validation and persistence behavior as needed
- Improve Settings clarity around what is local vs server-side

### Priority 3: Product polish that improves usability

From current backlog and pre-release notes:

- add missing PWA icons
- render thumbnails consistently in cards
- fix context-specific empty-state copy
- expose aggregate and per-source status in a clearer way

### Priority 4: Hosted-mode seams

These are prerequisite platform tasks for any serious hosted launch.

- migrate persistence from SQLite to Postgres
- replace `local` fallback with real hosted identity resolution
- complete the client-managed encryption flow for hosted operation
- add OAuth client management UI and APIs

### Priority 5: Paid-tier completion

These are important strategically, but should follow a stable free/self-hosted core.

- account-scoped identity (`usr_*`)
- wrapped-key multi-device model
- guaranteed encrypted queue replay semantics
- device fanout and stronger delivery lifecycle behavior
- backfill and queue lifecycle management

---

## 4. Open Workstreams

### Workstream: Self-hosted product completion

Goal: make ScrolLess feel coherent and dependable for a single-user/self-hosted workflow.

Current emphasis:
- stable tests
- accurate docs
- strong settings/configurability
- clean source management
- visible sync health
- safe local reset flows

### Workstream: Hosted platform preparation

Goal: preserve the current product model while replacing local-only assumptions.

Required capabilities:
- real user auth/session identity
- multi-tenant persistence
- operator-blind encryption guarantees
- explicit separation of local-only vs cloud-backed state

### Workstream: Paid queue model

Goal: evolve from free-tier opportunistic delivery into account-scoped multi-device delivery.

Required capabilities:
- durable encrypted queue semantics
- recipient/device tracking
- replay/backfill behavior
- wrapped-key onboarding for additional devices

---

## 5. Backlog Structure

Use GitHub Issues as the source of truth for scoped work.

Recommended interpretation:
- **issue** = a concrete unit of work
- **PR** = implementation vehicle
- **closed issue** = done

When adding issues, prefer these categories:
- bug
- enhancement
- cleanup
- docs
- hosted
- paid-tier

Optional priority labels:
- priority:high
- priority:medium
- priority:low

---

## 6. Guidance for Contributors and Agents

Before starting work:

1. read `docs/ARCHITECTURE.md`
2. read `docs/TIER_CONTRACT.md` if the task touches auth, queueing, delivery, or tier behavior
3. read `docs/pre-release-tasks.md` if the task is product-gap or launch-readiness work
4. inspect the actual implementation before trusting older assumptions

Contributors should assume:
- current code beats stale planning text
- route/data contracts must stay coherent across docs and implementation
- preserving architectural intent matters more than preserving outdated plans

---

## 7. What This Document Is Not

This is not a step-by-step bootstrapping checklist.

It is not intended to let a coding agent rebuild the repository from scratch without inspecting the code.

If a future greenfield rewrite ever happens, that should live in a separate document with explicit historical framing.

---

## 8. Immediate Candidate Issues

At the time of writing, good near-term work tends to fall into one of these buckets:

- documentation alignment
- settings and operational clarity
- UI polish with strong product leverage
- hosted-mode seams that avoid architectural backtracking
- queue and identity work that strengthens the paid-tier path without destabilising the free-tier core

Update this roadmap as major milestones land. If it drifts from reality, rewrite it again rather than patching around misleading assumptions.
