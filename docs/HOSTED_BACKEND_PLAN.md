# Hosted Backend Plan

Status: **Active**
Created: 2026-04-20

This document is the execution plan for turning ScrolLess into a credible hosted backend service.

It is intended to be used for:
- work tracking
- GitHub issue creation
- implementation sequencing
- coordination across coding tools and agents

Use this alongside:
- `docs/ARCHITECTURE.md`
- `docs/TIER_CONTRACT.md`
- `docs/pre-release-tasks.md`
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
- Postgres
- real user identity
- subscription and entitlement model
- operator-blind content handling
- multi-device capable

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
3. The server may store operational metadata only.
4. Entitlement enforcement must happen server-side, not in clients.
5. Tenant isolation must be explicit and testable.
6. Self-hosted convenience must not weaken hosted trust guarantees.

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

The hosted product should be modelled as the following layers:

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

## Workstream B — Postgres migration and hosted persistence

Goal: move hosted mode to a real multi-tenant database.

Tasks:
- [ ] Introduce Postgres-backed DB adapter for hosted mode
- [ ] Replace SQLite-specific SQL patterns
- [ ] Split self-hosted vs hosted DB configuration cleanly
- [ ] Validate schema/index parity in hosted mode
- [ ] Add migration strategy for hosted deploys
- [ ] Add test coverage for hosted persistence path

Deliverable:
- hosted deployment no longer depends on SQLite assumptions

---

## Workstream C — Trust boundary and encryption model

Goal: make the hosted privacy model explicit, coherent, and implementable.

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

Phase 1:
- Workstream A — Hosted identity and tenant isolation
- Workstream B — Postgres migration and hosted persistence

Phase 2:
- Workstream C — Trust boundary and encryption model
- Workstream D — Subscription, billing, and entitlements

Phase 3:
- Workstream E — Connected apps, OAuth, and MCP management
- Workstream F — Hosted security posture

Phase 4:
- Workstream G — Web account and billing surface

Phase 5:
- Workstream H — Expo/native client alignment

This is the recommended order because it builds the platform before polishing the clients.

---

## 8. Suggested Issue Breakdown

These should become GitHub issues.

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

### Client alignment
- [ ] Update Expo refactor plan to reflect hosted-first sequencing
- [ ] Define mobile UX for existing-account and premium-account states

---

## 9. Open Decisions

These need explicit calls before implementation gets too far.

- [ ] Auth provider: Clerk vs alternative
- [ ] Billing provider: Stripe vs Paddle
- [ ] Hosted encryption model details: wrapped private key vs alternative
- [ ] Free hosted offering: whether anonymous/device-tier remains, and in what form
- [ ] Whether hosted web remains PWA-first before Expo, or Expo becomes a parallel effort later

---

## 10. What to Avoid

- Do not let hosted mode silently inherit self-hosted trust assumptions.
- Do not put subscription logic primarily in the mobile app.
- Do not rely on client-side gating for paid features.
- Do not weaken the relay-not-reader architecture for convenience.
- Do not start Expo as the main lane before hosted identity and entitlements exist.

---

## 11. Definition of Success

ScrolLess Cloud is on the right track when:
- a hosted user can sign in to a real account
- hosted data is tenant-isolated in Postgres
- feed content remains operator-blind or ciphertext-only by design
- subscriptions are managed on the web and enforced on the backend
- users can manage tokens, connected apps, and devices without operator help
- the architecture story is coherent enough to explain in one pass to another engineer, investor, or reviewer

That is the bar.
