# Hosted Backend Plan

Status: **Active**
Created: 2026-04-20

This document is the execution plan for turning ScrolLess into a credible hosted backend service.

It is intended to be used for:
- work tracking
- GitHub issue creation
- implementation sequencing
- coordination across coding tools and agents

This is the canonical execution plan for hosted ScrolLess work.
If another planning or checklist doc disagrees with this one, update the other doc or remove the duplication.

Use this alongside:
- `docs/ARCHITECTURE.md`
- `docs/TIER_CONTRACT.md`
- `docs/EXPO_REFACTOR_PLAN.md`

---

## 1. Core Goal

Build **ScrolLess Cloud** as a hosted, account-based backend service with:
- real multi-tenant identity
- subscription-backed entitlements
- strong trust boundaries
- operator-blind feed-content handling
- a web surface for signup, billing, account management, and connected apps
- later support for Expo/native clients as authenticated consumers of the service

This is now the primary product lane.

---

## 2. Product Positioning

ScrolLess should be treated as three related but distinct surfaces:

### A. Open-source self-hosted ScrolLess

Purpose:
- open-source distribution
- local-first / owner-operated deployment
- strong engineering portfolio artifact

Properties:
- SQLite
- no hosted billing
- `user_id = 'local'`
- owner controls both server and data

### B. Hosted ScrolLess Cloud

Purpose:
- paid SaaS offering
- account-based cloud service
- managed sync, queueing, notifications, and device/account management

Properties:
- Postgres for control-plane persistence
- real user identity
- subscription and entitlement model
- operator-blind content handling
- multi-device capable
- client-resident content storage remains separate from server control-plane storage

### C. Client surfaces

These are clients of the hosted service, not the commercial center:
- web app
- future Expo mobile apps
- MCP / agent clients

The commercial surface should primarily live on the web, not inside mobile apps.

---

## 3. Non-Negotiable Design Requirements

### Trust boundary requirements

1. The hosted server must not become a plaintext feed-content store.
2. Feed payloads must remain ciphertext-only server-side wherever possible.
3. The server may store operational metadata and encrypted relay payloads when queueing, replay, or recovery requires it.
4. The client remains the decrypted feed-content store.
5. Entitlement enforcement must happen server-side, not in clients.
6. Tenant isolation must be explicit and testable.
7. Self-hosted convenience must not weaken hosted trust guarantees.

### Security requirements

1. No silent `local` fallback in hosted mode.
2. All hosted routes must resolve an authenticated account identity.
3. Agent tokens, OAuth tokens, and device sessions must have clear lifecycle rules.
4. Sensitive secrets must be stored and rotated using production-safe patterns.
5. Auditability and abuse controls are required for hosted operation.

### Product requirements

1. Paid functionality must be tied to a hosted subscription, not unlocked directly inside native apps.
2. The web surface must support signup, billing, and connected-app management.
3. Native apps should act as authenticated clients of an existing account.

---

## 4. Current Reality

What exists now:
- Fastify backend
- SQLite persistence
- device registration and device challenge/verify flow
- agent token auth
- OAuth foundations
- encrypted relay model
- free-tier queueing
- paid-tier queue scaffolding
- PWA client
- settings UI
- MCP support

What does **not** exist in production-ready form yet:
- hosted account identity
- hosted multi-tenant persistence
- subscription billing
- entitlement enforcement
- completed hosted encryption/key-management story
- hosted connected-app management
- hosted security posture hardening and audit coverage

---

## 5. Architectural Clarification

The hosted product should be modelled as two storage domains and the following layers.

### Storage domain A: control plane database

This is the hosted backend database and should move to Postgres.

It stores:
- account and session data
- device/account bindings
- source configuration and preferences
- agent tokens, OAuth clients, grants, and revocation state
- subscription, billing, and entitlement data
- sync, queue, and delivery metadata
- encrypted relay payloads retained for queueing, replay, and recovery
- audit and security events

It does not store decrypted feed content.

### Storage domain B: content plane database

This is the client-resident feed store.
Today it is IndexedDB in the PWA. Future native clients may use a local SQLite-equivalent or another device-local database.

It stores:
- decrypted feed items
- read/save state
- retention-managed local content
- device-local UI/cache state

This distinction is non-negotiable. Postgres migration applies to the control plane, not the decrypted feed database.

The hosted product should then be modelled as the following layers:

### Layer 1: Identity and tenant boundary

Responsibilities:
- user signup/login/session
- account identity (`usr_*` or equivalent)
- tenant scoping for all hosted data
- account lifecycle

Preferred direction:
- Clerk or equivalent hosted auth provider for user auth
- server-side session verification on hosted routes

### Layer 2: Device trust and key management

Responsibilities:
- device registration
- device verification / challenge flow
- device-to-account binding
- encryption public-key registration
- wrapped-key or equivalent multi-device key onboarding for paid accounts

### Layer 3: Agent and connected-app access

Responsibilities:
- agent tokens
- OAuth clients
- MCP access
- revocation and auditability

### Layer 4: Subscription and entitlement system

Responsibilities:
- plans
- subscriptions
- billing provider integration
- entitlement computation
- server-enforced feature gating

### Layer 5: Relay, queue, and delivery platform

Responsibilities:
- encrypted payload submission
- relay delivery
- queue persistence and TTL
- ACK and replay semantics
- push notification dispatch

### Layer 6: Web account surface

Responsibilities:
- signup/login
- pricing and plan management
- billing portal
- device management
- connected-app management
- account settings and support visibility

### Layer 7: Client surfaces

Responsibilities:
- consume existing account capabilities
- never be the sole source of truth for subscription state
- reflect server-side entitlements

---

## 6. Recommended Workstreams

These workstreams are the actual buckets of hosted implementation work.
GitHub issues should be derived from them.
Do not create parallel hosted checklists elsewhere unless they are temporary execution artifacts that point back to this document.

## Workstream A — Hosted identity and tenant isolation

Goal: remove local-only assumptions and establish real hosted account scoping.

Tasks:
- [ ] Choose hosted auth provider and lock the identity model
- [ ] Integrate hosted auth middleware on all hosted `/api/*` routes
- [ ] Remove silent `local` fallback in hosted mode
- [ ] Seed user preferences/sources on first hosted account creation
- [ ] Ensure every hosted query is tenant-scoped and covered by tests
- [ ] Add tests for cross-tenant isolation failures

Deliverable:
- hosted requests always resolve to a real authenticated account

---

## Workstream B — Postgres migration and hosted control-plane persistence

Goal: move hosted mode to a real multi-tenant control-plane database without turning the server into a feed-content store.

Tasks:
- [ ] Introduce Postgres-backed DB adapter for hosted mode
- [ ] Replace SQLite-specific SQL patterns
- [ ] Split self-hosted vs hosted DB configuration cleanly
- [ ] Validate schema/index parity in hosted mode
- [ ] Add migration strategy for hosted deploys
- [ ] Add test coverage for hosted persistence path

Deliverable:
- hosted deployment uses Postgres for control-plane persistence and no longer depends on SQLite assumptions

---

## Workstream C — Trust boundary and encryption model

Goal: make the hosted privacy model explicit, coherent, and implementable across both the server control plane and the client content plane.

Tasks:
- [ ] Write a hosted trust-boundary section into `docs/ARCHITECTURE.md`
- [ ] Define exactly which fields remain plaintext metadata vs ciphertext payload
- [ ] Finalize key-management model for hosted paid accounts
- [ ] Define device onboarding and additional-device recovery flow
- [ ] Ensure server never requires plaintext feed content to function
- [ ] Add tests or fixtures around hosted encryption/decryption contracts

Deliverable:
- a documented and enforceable operator-blind hosted content model

---

## Workstream D — Subscription, billing, and entitlements

Goal: support paid hosted functionality as a web-managed SaaS subscription.

Tasks:
- [ ] Choose billing provider (likely Stripe, optionally Paddle)
- [ ] Add hosted billing data model:
  - [ ] plans
  - [ ] subscriptions
  - [ ] subscription events / audit log
  - [ ] entitlement mapping
- [ ] Define feature matrix by tier
- [ ] Implement webhook ingestion and reconciliation
- [ ] Implement server-side entitlement checks
- [ ] Ensure clients consume entitlements from server responses

Deliverable:
- hosted premium capabilities are gated by backend entitlements, not client UI state

---

## Workstream E — Connected apps, OAuth, and MCP management

Goal: make hosted integrations manageable by end users.

Tasks:
- [ ] Add hosted OAuth client management APIs
- [ ] Add connected-app management UI in settings/account surface
- [ ] Support OAuth client creation, listing, revocation
- [ ] Ensure token revocation propagates correctly
- [ ] Add audit trail for token/client lifecycle

Deliverable:
- hosted users can manage connected agents and MCP clients without operator intervention

---

## Workstream F — Hosted security posture

Goal: make the service defensible from a trust and abuse perspective.

Tasks:
- [ ] Define secret-management requirements for hosted deploys
- [ ] Define token/session TTLs and rotation policies
- [ ] Review rate limiting and abuse controls by route group
- [ ] Add structured security logging/audit events
- [ ] Add basic security checklist for deployment environments
- [ ] Document incident-sensitive areas: tokens, queue payloads, auth callbacks, webhooks

Deliverable:
- hosted service has a minimally credible security posture and operating model

---

## Workstream G — Web account and billing surface

Goal: move the commercial center to the web.

Tasks:
- [ ] Add signup/login/account shell for hosted users
- [ ] Add pricing / plan selection surface
- [ ] Add billing management / portal entry point
- [ ] Add device management surface
- [ ] Add connected-app management surface
- [ ] Add entitlement visibility in account settings

Deliverable:
- users can create and manage hosted accounts and subscriptions on web

---

## Workstream H — Expo/native client alignment

Goal: keep mobile work aligned with the hosted backend, but do not lead with it.

Tasks:
- [ ] Re-scope Expo work as authenticated client work, not billing-center work
- [ ] Ensure mobile app reflects existing entitlements only
- [ ] Avoid direct in-app subscription unlock flow
- [ ] Define safe mobile UX for account-required and premium-required states
- [ ] Sequence Expo implementation after hosted identity/entitlements are stable

Deliverable:
- native clients are aligned with the hosted SaaS model and app-store constraints

---

## 7. Suggested Execution Order

The current codebase is still structurally local-first in several important places.
That means the real first job is not "add hosted features", it is "remove hidden single-user assumptions without breaking self-hosted mode".

### Phase 1 — Identity boundary and hosted correctness

Goal:
make hosted mode fail closed and establish a real multi-tenant identity model.

Includes:
- Workstream A — Hosted identity and tenant isolation
- the identity parts of Workstream B — Hosted persistence
- schema cleanup required to remove implicit `local` assumptions
- tenant-isolation and auth-boundary tests across route groups

Concrete outcomes:
- account identity, device identity, and agent/client identity are explicitly separated
- hosted requests resolve to a real authenticated account identity
- no hosted code path silently falls back to `local`
- schema defaults and bootstrap behavior no longer make hosted correctness optional

Why first:
without this phase, every later hosted feature sits on top of a misleading single-user model.

### Phase 2 — Hosted persistence and trust boundary

Goal:
move hosted mode onto real multi-tenant storage and make the operator-blind content contract explicit.

Includes:
- remaining hosted persistence work from Workstream B — Postgres migration and hosted persistence
- Workstream C — Trust boundary and encryption model

Concrete outcomes:
- hosted mode runs on Postgres
- hosted deploys use an explicit migration path
- plaintext metadata vs ciphertext payload boundaries are documented and enforced
- hosted key-management and multi-device onboarding direction is defined clearly enough to implement

Why second:
Postgres alone is not the milestone. The real milestone is a hosted platform whose persistence model and privacy model match each other.

### Phase 3 — Entitlements and billing backbone

Goal:
turn hosted ScrolLess into a real SaaS backend, not just a multi-user app.

Includes:
- Workstream D — Subscription, billing, and entitlements

Concrete outcomes:
- billing provider selected
- hosted plan matrix defined
- subscription and entitlement tables implemented
- server-side entitlement enforcement exists and clients consume server truth

Why third:
entitlements only matter once identity, tenancy, and trust boundaries are real.

### Phase 4 — User-facing hosted account surface and operator controls

Goal:
make the hosted platform manageable by end users and credible to operate.

Includes:
- Workstream E — Connected apps, OAuth, and MCP management
- Workstream F — Hosted security posture
- Workstream G — Web account and billing surface

Concrete outcomes:
- users can manage connected apps, devices, and billing on the web
- token/client lifecycle is auditable and revocable
- hosted deployment and security posture are minimally production-credible

Why fourth:
this is where the product becomes operable and sellable, but it should not lead the platform work.

### Phase 5 — Expo/native client alignment

Goal:
align future native clients to the hosted platform after the hosted backend contract is stable.

Includes:
- Workstream H — Expo/native client alignment

Concrete outcomes:
- native work consumes existing hosted identity and entitlements
- mobile remains a client surface, not the commercial control plane

Why last:
starting mobile before hosted identity and entitlements are stable would reintroduce confusion and likely force rework.

This is the recommended order because it builds the hosted platform spine before product surface expansion.

---

## 8. Suggested Issue Breakdown

These should become GitHub issues.
They are derived from the workstreams and phases above, not a separate planning source.

### Foundation
- [ ] Pick hosted auth provider and finalize hosted identity model
- [ ] Add hosted-mode auth middleware and remove production `local` fallback
- [ ] Introduce Postgres adapter and schema migration path
- [ ] Add tenant-isolation tests across hosted route groups

### Trust and privacy
- [ ] Document hosted trust boundary in architecture docs
- [ ] Finalize hosted encryption/key-management model
- [ ] Implement hosted encryption salt / wrapped-key support
- [ ] Add test fixtures for hosted encrypted payload contract

### Billing and entitlements
- [ ] Choose billing provider and define hosted plan matrix
- [ ] Add subscription and entitlement tables
- [ ] Implement billing webhooks and reconciliation
- [ ] Add backend entitlement enforcement layer

### Account surface
- [ ] Add hosted account shell and settings surface
- [ ] Add billing management UI
- [ ] Add connected apps / OAuth client management UI
- [ ] Add device management UI

### Security and operations
- [ ] Define token/session TTL and rotation policy
- [ ] Add structured auth and security audit logs
- [ ] Review and tighten route-level rate limiting
- [ ] Write hosted deployment security checklist
- [ ] Define hosted deployment topology and provider baseline (for example Render backend + Render Postgres + Vercel frontend)
- [ ] Define migration, backup, and restore approach for hosted control-plane Postgres
- [ ] Add queue health, webhook failure, and auth-failure observability requirements
- [ ] Write minimum operator runbooks for auth outage, billing/webhook failure, queue backlog, and push delivery failure

### Client alignment
- [ ] Update Expo refactor plan to reflect hosted-first sequencing
- [ ] Define mobile UX for existing-account and premium-account states

---

## 9. Production-grade hosted readiness requirements

A real hosted server is not complete when the architecture exists on paper. It also needs a minimally credible operating model.

Required categories:

### A. Identity and tenant correctness
- hosted auth must fail closed
- tenant isolation must be testable
- account, device, and agent/client identity must be distinct

### B. Control-plane persistence and migration
- hosted Postgres for the control plane
- explicit migration flow
- backup and restore plan
- staging vs production separation

### C. Trust boundary and encrypted retention
- explicit plaintext-metadata vs ciphertext-payload boundary
- encrypted payload retention rules for queue/replay/recovery
- no server-side decrypted feed store

### D. Billing and entitlement correctness
- billing provider integration
- webhook verification and reconciliation
- server-side entitlement computation
- downgrade/cancellation/failure handling

### E. Observability and abuse resistance
- structured logs and audit events
- queue and webhook health visibility
- rate limits and abuse controls by route group
- alert-worthy failure modes documented

### F. Support and lifecycle flows
- account deletion and data deletion semantics
- token compromise and revoke-all flow
- device recovery / additional-device onboarding
- operator support visibility that does not break trust boundaries

### G. Deployment and operations
- hosted topology decision
- secret management and rotation policy
- deployment/rollback expectations
- operator runbooks for the main failure cases

These are part of the hosted plan, not a separate checklist.

## 10. Open Decisions

These need explicit calls before implementation gets too far.

- [ ] Auth provider: Clerk vs alternative
- [ ] Billing provider: Stripe vs Paddle
- [ ] Hosted encryption model details: wrapped private key vs alternative
- [ ] Free hosted offering: whether anonymous/device-tier remains, and in what form
- [ ] Whether hosted web remains PWA-first before Expo, or Expo becomes a parallel effort later

---

## 11. What to Avoid

- Do not let hosted mode silently inherit self-hosted trust assumptions.
- Do not put subscription logic primarily in the mobile app.
- Do not rely on client-side gating for paid features.
- Do not weaken the relay-not-reader architecture for convenience.
- Do not start Expo as the main lane before hosted identity and entitlements exist.

---

## 12. Definition of Success

ScrolLess Cloud is on the right track when:
- a hosted user can sign in to a real account
- hosted data is tenant-isolated in Postgres
- feed content remains operator-blind or ciphertext-only by design
- subscriptions are managed on the web and enforced on the backend
- users can manage tokens, connected apps, and devices without operator help
- the architecture story is coherent enough to explain in one pass to another engineer, investor, or reviewer

That is the bar.
