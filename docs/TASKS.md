# ScrolLess Roadmap

This document is now a short top-level roadmap, not the detailed hosted execution plan.

For hosted backend/server work, use:
- `docs/HOSTED_BACKEND_PLAN.md` as the canonical source of truth

Use this document for:
- top-level product direction
- self-hosted vs hosted sequencing
- concise orientation for contributors

---

## 1. Current product lanes

### Self-hosted ScrolLess

Status:
- real and usable now
- still needs product tightening and polish

Main goals:
- improve setup and deployment confidence
- improve sync observability and settings clarity
- preserve the relay-not-reader architecture
- keep the self-hosted open-source experience credible

### Hosted ScrolLess Cloud

Status:
- active product and architecture lane
- not yet production-ready

Main goals:
- build a real hosted control plane
- preserve ciphertext-only server handling for feed content
- add identity, entitlements, account management, and production-grade operations

All detailed hosted sequencing, phases, production-readiness requirements, and issue breakdown now live in `docs/HOSTED_BACKEND_PLAN.md`.

---

## 2. Priority order

1. Keep the current self-hosted product trustworthy and usable
2. Execute hosted foundation work in the order defined by `docs/HOSTED_BACKEND_PLAN.md`
3. Only advance native/mobile client work once hosted Phase 3 (entitlements) is complete, following the Phase 5 gate in `docs/HOSTED_BACKEND_PLAN.md`

---

## 3. Contributor guidance

Before starting work:

1. read `docs/ARCHITECTURE.md`
2. read `docs/TIER_CONTRACT.md` if the task touches auth, queueing, delivery, privacy, or tier behavior
3. read `docs/HOSTED_BACKEND_PLAN.md` if the task touches hosted/server work
4. inspect the implementation before trusting older assumptions

Rules of thumb:
- code beats stale planning text
- architecture docs define constraints
- the hosted backend plan defines hosted execution order
- GitHub issues define scoped execution work

---

## 4. Backlog structure

Use GitHub Issues as the source of truth for scoped work.

Recommended interpretation:
- **document** = strategy, architecture, or contract
- **issue** = concrete executable work
- **PR** = implementation vehicle

If this roadmap starts duplicating the hosted plan again, trim it rather than letting two planning docs drift.
