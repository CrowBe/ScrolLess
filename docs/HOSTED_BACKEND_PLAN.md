# Hosted Backend Plan

Status: **Active**
Created: 2026-04-20
Revised: 2026-04-25

This document is the canonical execution plan for ScrolLess hosted/backend work **and** the Expo/native follow-on. If another planning or checklist doc disagrees with this one, update the other doc or remove it.

Use this alongside:
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/TIER_CONTRACT.md`
- `docs/TASKS.md`

---

## 1. Core Goal

Build **ScrolLess Cloud** as a hosted, account-based backend service with:
- real multi-tenant identity
- subscription-backed entitlements
- strong trust boundaries
- ciphertext-only feed-content handling on the server
- a web surface for signup, billing, account management, and connected apps
- later Expo/native clients that consume the hosted service without becoming the commercial control plane

This is the primary product lane.

---

## 2. Product Positioning

ScrolLess should be treated as three related but distinct surfaces.

### A. Open-source self-hosted ScrolLess

Purpose:
- open-source distribution
- owner-operated deployment
- strong engineering portfolio artifact

Properties:
- single-tenant server deployment
- Postgres server control-plane persistence as the target end state
- no hosted billing
- same ciphertext-only relay model as hosted
- owner controls both server and data
- no separate hosted account middleware required for local operation

### B. Hosted ScrolLess Cloud

Purpose:
- paid SaaS offering
- account-based cloud service
- managed sync, queueing, notifications, account/device management, and connected-app access

Properties:
- Postgres for control-plane persistence
- Clerk-backed account identity for `usr_*` users
- parallel device-scoped free-tier auth for `dev_*` users on hosted
- subscription and entitlement model
- multi-device capable paid accounts
- ciphertext-only feed-content handling server-side
- client-resident content storage remains separate from server control-plane storage

### C. Client surfaces

These are clients of the hosted service, not the commercial center:
- web app
- future Expo mobile apps
- MCP / agent clients

The commercial surface lives on the web. Native apps consume existing hosted identity and entitlements.

---

## 3. Non-Negotiable Requirements

### A. Deployment and storage requirements

1. ScrolLess has two storage domains:
   - **control plane**: server-side operational/account storage
   - **content plane**: client-side decrypted feed/content storage
2. The server must never become a plaintext feed-content store.
3. The control plane may retain encrypted payload envelopes for queueing, replay, and recovery.
4. The content plane remains the decrypted feed database.
5. Self-hosted and hosted move toward **one async Postgres server DB codepath**, not separate SQLite vs Postgres architectures.
6. Hosted launches Postgres-clean:
   - no SQLite → Postgres migration tooling
   - no dual-write bridge
7. Existing self-hosters should expect reset/cutover rather than importer tooling.

### B. Identity and auth requirements

1. Clerk is the hosted account auth provider.
2. Hosted middleware must accept either:
   - a Clerk-backed account session resolving to `usr_*`, or
   - a device challenge/verify session resolving to `dev_*`
3. The free-tier promise survives: free hosted usage does **not** require account creation.
4. No silent `local` fallback in hosted mode.
5. Tenant/account identity, device identity, and agent/client identity must be explicitly separated.
6. All hosted routes must fail closed when identity cannot be resolved.

### C. Privacy and trust-boundary requirements

1. Server-side feed content is ciphertext-only.
2. Plaintext metadata exposure must be intentional, documented, and minimal.
3. Key-management model selection is a **Phase 1 exit criterion**.
4. Key-management implementation lands in **Phase 2**.
5. Queue/replay/recovery must not require server-side decryption of feed content.
6. Entitlement enforcement happens server-side, not in clients.

### D. Product and sequencing requirements

1. The web surface owns signup, billing, and account management.
2. Native apps do not directly define subscription truth.
3. Expo/native work is **Phase-5-gated** and cannot start until **Phase 3** is complete.
4. GitHub issues should be created at **workstream granularity**, not split into route-by-route shards.
5. Risks belong in the issues, not in this plan.

---

## 4. Current Reality

What exists now:
- Fastify backend
- current repo still contains SQLite/local-first assumptions in important places
- device registration and shipped `/api/v1/device/challenge` + `/api/v1/device/verify`
- shipped `/api/v1/queue/ack`
- versioned device/token routes
- free vs paid tier gating scaffolding
- minimal paid queue schema and acceptance tests
- encrypted relay model
- agent token auth
- OAuth foundations
- PWA client and settings UI
- MCP support

What is true after the recent contract work:
- `docs/TIER_CONTRACT.md` §10 items are recorded as shipped
- versioned route direction is established
- queue ACK semantics and acceptance checks are documented
- the control-plane vs content-plane split is already the intended model

What is **not** production-ready yet:
- hosted Clerk account boundary across route groups
- hosted tenant-correct persistence
- unified Postgres-only server DB path
- completed key-management implementation for multi-device paid accounts
- subscription billing and entitlement reconciliation
- hosted account / connected-app management surface
- production-grade hosted security posture

Important caveat:
- `docs/ARCHITECTURE.md` still correctly notes that OAuth and several auth/bootstrap paths continue to behave as single-user/local in places. Hosted readiness is still roadmap-state, not delivered-state.

---

## 5. Architectural Clarification

ScrolLess is built around two storage domains and a set of explicit layers.

### Storage domain A: control plane database

This is the server-side operational database.
Both hosted and self-hosted should converge on Postgres for this domain.

It stores:
- accounts and sessions
- device/account bindings
- source configuration and preferences
- agent tokens, OAuth clients, grants, and revocation state
- subscription, billing, and entitlement data
- sync, queue, and delivery metadata
- encrypted relay payloads retained for queueing, replay, and recovery
- audit and security events

It does **not** store decrypted feed content.

### Storage domain B: content plane database

This is the client-resident feed store.
Today it is IndexedDB in the PWA. Future native clients may use a local SQLite-equivalent or other device-local storage.

It stores:
- decrypted feed items
- read/save state
- retention-managed local content
- device-local UI/cache state

This distinction is non-negotiable. Postgres migration applies to the server control plane, not the decrypted feed database.

### Plaintext metadata exposure in the control plane

The control plane is allowed to see these plaintext fields and no more unless this document is updated deliberately:
- device IDs
- source names
- URLs
- URL hashes
- timestamps
- payload sizes
- recipient device IDs in queue records
- OAuth client IDs
- agent token labels

Everything else in feed content should remain ciphertext-only server-side.

### Layer 1: Identity and tenant boundary

Responsibilities:
- user signup/login/session
- Clerk-backed account identity for `usr_*`
- device-scoped challenge/verify identity for `dev_*`
- tenant scoping for all hosted data
- account lifecycle

Direction:
- Clerk is the hosted auth provider
- hosted middleware accepts either Clerk session (`usr_*`) or device challenge/verify auth (`dev_*`)
- no hosted path silently falls back to `local`

### Layer 2: Device trust and key management

Responsibilities:
- device registration
- device verification / challenge flow
- device-to-account binding
- encryption public-key registration
- multi-device paid-account onboarding
- wrapped-key recovery model selection and implementation

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
- consume server-side entitlement truth
- keep decrypted content local to the device
- never become the commercial source of truth

---

## 6. Unified Execution Plan

## Phase 1 — Identity boundary, Postgres unification decision, and hosted correctness

Goal:
- make hosted mode fail closed
- lock the auth boundary around Clerk + device auth
- choose the key-management model
- commit to one async Postgres server DB path for both hosted and self-hosted

Workstream rollup:
- Workstream A — Hosted identity and tenant isolation
- the DB-unification/foundation portion of Workstream B — Postgres migration and hosted control-plane persistence
- the key-selection and metadata-contract portion of Workstream C — Trust boundary and encryption model

### P1-T01 Finalize hosted identity contract

- **Inputs:** `docs/ARCHITECTURE.md`, `docs/TIER_CONTRACT.md`, current `server/auth.ts`, current `server/oauth-routes.ts`
- **Outputs:** updated contract docs and an issue-ready identity contract covering `usr_*`, `dev_*`, and self-hosted single-tenant semantics
- **Verify:** both docs explicitly state that hosted middleware accepts Clerk sessions for `usr_*` and device challenge/verify for `dev_*`; no "or equivalent" wording remains for hosted auth
- **Prereqs:** none

### P1-T02 Remove hosted `local` fallback and define fail-closed auth middleware

- **Inputs:** `server/auth.ts`, `server/api-routes.ts`, `server/index.ts`, `server/agent-routes.ts`, `server/oauth-routes.ts`, `server/mcp.ts`
- **Outputs:** implementation issue/spec for hosted auth middleware and route-group audit checklist, explicitly calling out removal of the current `local` fallback in `server/api-routes.ts` and the `result.userId ?? 'local'` fallback in `server/index.ts`
- **Verify:** all hosted route groups are covered by an explicit identity-resolution rule; no hosted path is allowed to default to `local`, including the current fallback sites in `server/api-routes.ts` and `server/index.ts`
- **Prereqs:** P1-T01

### P1-T03 Unify server DB direction to async Postgres-only

- **Inputs:** `server/db.ts`, `sql/schema.sql`, `README.md`, `docs/ARCHITECTURE.md`
- **Outputs:** documented DB direction: one async Postgres codepath for hosted and self-hosted, no SQLite dual-track plan
- **Verify:** plan/docs consistently describe Postgres as the single server DB destination; README includes self-hosted cutover/reset note
- **Prereqs:** P1-T01

### P1-T04 Select the paid-account key-management model

- **Inputs:** `docs/ARCHITECTURE.md`, `docs/TIER_CONTRACT.md`, current hosted privacy notes
- **Outputs:** named key-management model, recovery model, and device-onboarding model recorded in docs/issues
- **Verify:** the key-management model is no longer an open decision in this plan and is referenced as a Phase 1 exit criterion
- **Prereqs:** P1-T01

### P1-T05 Lock the plaintext-metadata contract

- **Inputs:** this document §5, `docs/ARCHITECTURE.md`, `docs/TIER_CONTRACT.md`
- **Outputs:** explicit metadata-exposure list propagated to architecture/contract docs
- **Verify:** device IDs, source names, URLs, URL hashes, timestamps, payload sizes, recipient device IDs in queue, OAuth client IDs, and agent token labels are listed consistently
- **Prereqs:** P1-T01

### P1-T06 Add tenant/auth-boundary test plan

- **Inputs:** current acceptance tests, auth-sensitive routes, schema semantics
- **Outputs:** issue-ready test matrix for hosted auth boundary, tenant isolation, and self-hosted single-tenant correctness
- **Verify:** the matrix names route coverage for `/api/*`, `/agent/*`, `/oauth/*`, and `/mcp`
- **Prereqs:** P1-T02, P1-T03, P1-T04, P1-T05

**Phase exit tests:** hosted auth-boundary integration tests, tenant-isolation tests, self-hosted single-tenant auth tests, and the current acceptance suite for `/api/v1/device/*` and `/api/v1/queue/ack` must all be green.

---

## Phase 2 — Postgres persistence and ciphertext-only trust-boundary implementation

Goal:
- implement the unified Postgres server path
- implement the selected key-management model
- harden ciphertext-only queue/replay contracts

Workstream rollup:
- remaining Workstream B — Postgres migration and hosted control-plane persistence
- implementation portion of Workstream C — Trust boundary and encryption model

### P2-T01 Build the async Postgres server persistence path

- **Inputs:** `server/db.ts`, `sql/schema.sql`, current SQLite call sites, Phase 1 DB direction
- **Outputs:** Postgres schema/migrations design, async DB adapter plan, route/query migration checklist
- **Verify:** no SQLite-specific runtime path remains in the target design; no dual-write or importer work is planned
- **Prereqs:** P1-T03

### P2-T02 Refactor schema semantics for tenant correctness

- **Inputs:** current schema, route usage, identity contract
- **Outputs:** schema changes for account/device separation, tenant scoping, queue recipient semantics, and auth-safe defaults
- **Verify:** defaults and seed/bootstrap behavior no longer encode hidden single-user assumptions
- **Prereqs:** P1-T01, P2-T01

### P2-T03 Implement the selected key-management model

- **Inputs:** Phase 1 key-management decision, encryption flows, device onboarding requirements
- **Outputs:** issue-ready implementation plan for wrapped keys / recovery / multi-device onboarding
- **Verify:** server-side flow requires ciphertext-only payload handling; multi-device onboarding is described end-to-end
- **Prereqs:** P1-T04

### P2-T04 Implement ciphertext-only queue, replay, and recovery boundaries

- **Inputs:** queue schema, ACK semantics, metadata contract, retention requirements
- **Outputs:** queue/replay implementation plan and test cases for ciphertext-only payload retention
- **Verify:** plaintext feed fields are not required anywhere in the queue/replay path; metadata exposure matches §5 exactly
- **Prereqs:** P1-T05, P2-T02, P2-T03

### P2-T05 Define hosted and self-hosted cutover rules

- **Inputs:** `README.md`, `docs/ARCHITECTURE.md`, deployment assumptions
- **Outputs:** documented cutover policy: Postgres-clean launch, no SQLite importer, self-hosters accept reset
- **Verify:** README explicitly documents the cutover/reset expectation
- **Prereqs:** P2-T01

### P2-T06 Add persistence and trust-boundary tests

- **Inputs:** Postgres schema plan, queue contracts, metadata contract, key-management flow
- **Outputs:** issue-ready test matrix for Postgres persistence, queue replay, multi-device onboarding, and ciphertext-only guarantees
- **Verify:** each trust-boundary rule has a named automated test target
- **Prereqs:** P2-T02, P2-T03, P2-T04, P2-T05

**Phase exit tests:** Postgres schema/migration tests, persistence integration tests, ciphertext-only queue/replay tests, key-management onboarding tests, ACK/replay acceptance tests, and regression tests for free-tier device auth must all be green.

---

## Phase 3 — Entitlements and billing backbone

Goal:
- turn ScrolLess hosted into a real SaaS backend with server-enforced entitlements

Workstream rollup:
- Workstream D — Subscription, billing, and entitlements

### P3-T01 Select billing provider

- **Inputs:** hosted product model, webhook/reconciliation needs, tax/compliance constraints
- **Outputs:** billing-provider decision (Stripe vs Paddle or another explicit choice), documented in issues/docs
- **Verify:** `docs/HOSTED_BACKEND_PLAN.md` §10 shrinks to the remaining unresolved billing choice only if still undecided
- **Prereqs:** P1-T01

### P3-T02 Define hosted plan matrix and entitlement model

- **Inputs:** `docs/TIER_CONTRACT.md`, product packaging assumptions, queue/device rules
- **Outputs:** plans, entitlements, limits, and downgrade behavior definitions
- **Verify:** free vs paid behavior is server-computable and client-independent
- **Prereqs:** P3-T01

### P3-T03 Add billing and entitlement schema

- **Inputs:** selected provider, plan matrix, Postgres server schema direction
- **Outputs:** schema/tasks for plans, subscriptions, subscription events, entitlement mappings, reconciliation state
- **Verify:** entitlement state can be derived server-side without trusting clients
- **Prereqs:** P2-T01, P3-T02

### P3-T04 Implement webhook ingestion and reconciliation

- **Inputs:** provider docs, billing schema, audit requirements
- **Outputs:** webhook ingestion/replay/reconciliation workstream issue
- **Verify:** idempotency, replay safety, and audit logging are named requirements
- **Prereqs:** P3-T01, P3-T03

### P3-T05 Add entitlement enforcement across route groups

- **Inputs:** entitlement model, route inventory, tier contract
- **Outputs:** hosted entitlement middleware plan and route gating matrix
- **Verify:** server route groups describe how free `dev_*` vs paid `usr_*` capabilities are enforced
- **Prereqs:** P3-T02, P3-T03, P3-T04

### P3-T06 Add entitlement test coverage

- **Inputs:** plan matrix, route gating matrix, webhook flows
- **Outputs:** issue-ready suite for upgrade/downgrade, free-tier restrictions, paid queue/device semantics, and billing reconciliation
- **Verify:** all paid features named in the plan have a corresponding test target
- **Prereqs:** P3-T05

**Phase exit tests:** billing webhook tests, reconciliation/idempotency tests, entitlement middleware integration tests, free-vs-paid route gating tests, upgrade/downgrade tests, and paid queue/device acceptance tests must all be green.

---

## Phase 4 — Web account surface, connected apps, and hosted security posture

Goal:
- make the hosted service operable by users and credible to run

Workstream rollup:
- Workstream E — Connected apps, OAuth, and MCP management
- Workstream F — Hosted security posture
- Workstream G — Web account and billing surface

### P4-T01 Build the hosted account-management surface

- **Inputs:** hosted identity contract, entitlement model, billing provider choice
- **Outputs:** issue-ready account shell for signup/login, pricing, billing portal, device management, and entitlement visibility
- **Verify:** the web surface is explicitly the commercial control plane
- **Prereqs:** P3-T05

### P4-T02 Build connected-app and OAuth/MCP management

- **Inputs:** current OAuth routes, agent-token flows, account UI requirements
- **Outputs:** workstream issue for OAuth client creation/listing/revocation, token lifecycle, MCP/agent management, and audit visibility
- **Verify:** connected apps can be managed by end users without operator intervention
- **Prereqs:** P1-T02, P3-T05

### P4-T03 Harden hosted security posture

- **Inputs:** auth flows, billing/webhook flows, token/session lifecycle, queue retention model
- **Outputs:** security workstream issue for rate limits, secret handling, TTL/rotation, structured security events, and deployment hardening
- **Verify:** sensitive routes and secrets each have an owner policy and audit/logging requirement
- **Prereqs:** P2-T04, P3-T04, P3-T05

### P4-T04 Add operator and user-facing tests for the hosted account surface

- **Inputs:** account UI, connected-app flows, security policies
- **Outputs:** issue-ready integration/e2e suite for signup, billing-portal access, device management, token revocation, OAuth revocation, and security-sensitive flows
- **Verify:** the hosted product has named tests for the end-user account surface and security-critical management flows
- **Prereqs:** P4-T01, P4-T02, P4-T03

**Phase exit tests:** account-surface e2e tests, connected-app/OAuth lifecycle tests, token revocation tests, hosted security integration tests, and billing/account-management regression tests must all be green.

---

## Phase 5 — Expo/native client alignment

**Gate:** Phase 5 cannot start until **Phase 3** is complete. Recommended sequencing is after Phase 4 so the hosted platform and account surface are already coherent.

Goal:
- align future native clients to the hosted platform after identity, persistence, and entitlements are real

Workstream rollup:
- Workstream H — Expo/native client alignment

### P5-T01 Pick auth option inside the locked hosted model — Human-gate

- **Inputs:** this document §5 Layer 1, `docs/ARCHITECTURE.md` §Tier Model, `docs/TIER_CONTRACT.md`
- **Outputs:** chosen Expo auth flow under the locked hosted model (`usr_*` via Clerk, `dev_*` via challenge/verify, self-hosted single-tenant enrollment path)
- **Verify:** chosen option is referenced in `docs/ARCHITECTURE.md` and `docs/TIER_CONTRACT.md`; grep both docs for `Clerk`
- **Prereqs:** Phase 3 complete

### P5-T02 Clerk application setup — Human-gate

- **Inputs:** chosen Expo auth flow, Clerk environment plan
- **Outputs:** secure env-var names documented: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- **Verify:** env var names are present in `.env.example`
- **Prereqs:** P5-T01

### P5-T03 Expo / EAS account + bundle IDs — Human-gate

- **Inputs:** app-store packaging plan
- **Outputs:** confirmed bundle IDs `app.scrolless.ios` and `app.scrolless.android`
- **Verify:** IDs are recorded in the task or follow-on issue when complete
- **Prereqs:** Phase 3 complete

### P5-T04 Freeze library choices

- **Inputs:** current frontend architecture, native constraints
- **Outputs:** pinned library direction: crypto = `@noble/curves`, storage = `expo-sqlite`, SSE = `react-native-sse`, styling = `NativeWind`, list = `@shopify/flash-list`
- **Verify:** versions are written into the implementation issue / package plan
- **Prereqs:** Phase 3 complete

### P5-T05 Scaffold Expo project

- **Inputs:** repo root, current `src/` tree, library choices from P5-T04
- **Outputs:** `app/`, `components/`, `lib/`, `assets/`, `app.json`, `eas.json`
- **Verify:** `npx expo start --web` boots the template
- **Prereqs:** P5-T04

### P5-T06 App shell config

- **Inputs:** `app.json`, bundle IDs from P5-T03
- **Outputs:** configured app name, slug, scheme `scrolless`, icons, splash, iOS/Android bundle IDs
- **Verify:** `npx expo config --type public` shows the expected values
- **Prereqs:** P5-T05, P5-T03

### P5-T07 Port crypto module to `@noble/curves`

- **Inputs:** `src/crypto.ts`, any crypto tests/fixtures that already exist
- **Outputs:** `lib/crypto.ts`, `lib/crypto.test.ts`
- **Verify:** project test runner passes for `lib/crypto.test.ts`
- **Prereqs:** P5-T05

### P5-T08 Port storage layer to `expo-sqlite`

- **Inputs:** `src/idb.ts`
- **Outputs:** `lib/storage.ts`, `lib/storage-events.ts`, `lib/storage.test.ts`
- **Verify:** unit tests for insert + query on each logical store pass
- **Prereqs:** P5-T05

### P5-T09 Port SSE transport

- **Inputs:** SSE logic in `src/bootstrap/device-session.ts`
- **Outputs:** `lib/sse.ts`
- **Verify:** manual check against a running dev server; reconnection works after network toggle
- **Prereqs:** P5-T05

### P5-T10 Port device-session bootstrap

- **Inputs:** `src/bootstrap/device-session.ts`
- **Outputs:** `lib/device-session.ts`, `lib/device-session.test.ts`
- **Verify:** against a running dev backend the device enrolls, challenge/verify succeeds, and the stream receives ciphertext
- **Prereqs:** P5-T07, P5-T08, P5-T09

### P5-T11 Install Clerk for Expo

- **Inputs:** Clerk app setup, Expo scaffold
- **Outputs:** `app/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`
- **Verify:** `npx expo start --web` and sign in with a test Clerk user
- **Prereqs:** P5-T05, P5-T02

### P5-T12 Wire Clerk into device-session per chosen auth option

- **Inputs:** chosen auth option from P5-T01, `lib/device-session.ts`
- **Outputs:** `lib/auth.ts`, updated `lib/device-session.ts`
- **Verify:** authenticated `/api/*` request returns 200 with the expected `user_id`
- **Prereqs:** P5-T10, P5-T11, P5-T01

### P5-T13 Tab layout

- **Inputs:** Expo router scaffold
- **Outputs:** `app/(tabs)/_layout.tsx`
- **Verify:** Feed, Discover, Saved, and Settings tabs render placeholder screens
- **Prereqs:** P5-T06

### P5-T14 Port ContentCard

- **Inputs:** `src/components/content-card.tsx`
- **Outputs:** `components/content-card.tsx`, `components/content-card.test.tsx`
- **Verify:** snapshot or render test passes with a fixture item
- **Prereqs:** P5-T13

### P5-T15 Port per-source cards

- **Inputs:** `src/components/youtube-card.tsx`, `src/components/x-card.tsx`, `src/components/news-card.tsx`
- **Outputs:** `components/youtube-card.tsx`, `components/x-card.tsx`, `components/news-card.tsx` plus tests
- **Verify:** each component test passes
- **Prereqs:** P5-T14

### P5-T16 Port shared feed UI helpers

- **Inputs:** `src/components/save-button.tsx`, `src/components/source-filter.tsx`, `src/components/sync-status.tsx`, `src/components/device-session-status.tsx`, `src/components/notification-prompt.tsx`
- **Outputs:** React Native equivalents in `components/`
- **Verify:** each has a passing render test
- **Prereqs:** P5-T14

### P5-T17 Feed list with FlashList

- **Inputs:** `lib/storage.ts`, `lib/storage-events.ts`, card components
- **Outputs:** `components/feed-list.tsx`
- **Verify:** seeded 200-item list scrolls smoothly on a dev device
- **Prereqs:** P5-T08, P5-T15, P5-T16

### P5-T18 Feed / Discover / Saved screens

- **Inputs:** tab layout, `components/feed-list.tsx`
- **Outputs:** `app/(tabs)/feed.tsx`, `app/(tabs)/discover.tsx`, `app/(tabs)/saved.tsx`
- **Verify:** each tab shows the expected items against seeded data
- **Prereqs:** P5-T17

### P5-T19 Mark-read / toggle-save / mark-all-read

- **Inputs:** storage layer, feed screens, save button
- **Outputs:** mutation wiring for read/save flows and mark-all-read
- **Verify:** unit test mutates, subscribes, and observes the change
- **Prereqs:** P5-T18

### P5-T20 Settings skeleton

- **Inputs:** `src/settings.tsx`
- **Outputs:** `app/(tabs)/settings.tsx` with Sources, Agent Tokens, Preferences, and Sync Detail sections
- **Verify:** sections render as stubs
- **Prereqs:** P5-T13

### P5-T21 Sources section

- **Inputs:** `src/components/source-list.tsx`, `src/components/add-source-form.tsx`
- **Outputs:** native ports in `components/`
- **Verify:** add/remove a source against a dev backend
- **Prereqs:** P5-T20, P5-T12

### P5-T22 Agent tokens section

- **Inputs:** current token-management UI and APIs
- **Outputs:** list/reveal/create/revoke token UI with clipboard support
- **Verify:** reveal copies the exact token and revoke removes it from the list
- **Prereqs:** P5-T20, P5-T12

### P5-T23 Preferences form

- **Inputs:** current preferences API, settings screen
- **Outputs:** preferences form for `blocked_keywords`, `retention_days`, `max_items_per_source`
- **Verify:** change + reload persists via `/api/preferences`
- **Prereqs:** P5-T20, P5-T12

### P5-T24 Danger zone

- **Inputs:** settings screen, delete-data route availability
- **Outputs:** disabled or enabled danger-zone action wired to `DELETE /api/data`
- **Verify:** button disabled-state matches actual route availability
- **Prereqs:** P5-T20

### P5-T25 Enrollment token screen (self-hosted)

- **Inputs:** self-hosted enrollment flow, device-session bootstrap
- **Outputs:** `app/(auth)/enroll.tsx`
- **Verify:** self-hosted dev backend accepts the enrolled device
- **Prereqs:** P5-T10

### P5-T26 Expo notifications client

- **Inputs:** Expo scaffold, notification requirements
- **Outputs:** `lib/push.ts`
- **Verify:** push token logs on a real device
- **Prereqs:** P5-T05

### P5-T27 Push-token intake (server change)

- **Inputs:** `server/api-routes.ts`, current Web Push intake path
- **Outputs:** push-subscribe contract extended for `{ platform: 'expo' | 'web', token: string }` plus dispatcher updates
- **Verify:** `npm run test:server` passes and an integration test reaches a fake Expo endpoint
- **Prereqs:** P5-T26

### P5-T28 Deep link on tap

- **Inputs:** notification payload design, route scheme `scrolless://`
- **Outputs:** deep-link handling for `scrolless://feed/:id` and `scrolless://source/:name`
- **Verify:** manual real-device check lands on the right screen
- **Prereqs:** P5-T26, P5-T18

### P5-T29 Preserve Web Push on RN Web build (optional)

- **Inputs:** current Web Push flow, platform runtime checks
- **Outputs:** optional RN Web retention path for Web Push
- **Verify:** RN Web build still receives a Web Push in a dev browser
- **Prereqs:** P5-T26

### P5-T30 Port design tokens to `lib/theme.ts`

- **Inputs:** `docs/DESIGN_SYSTEM.md`
- **Outputs:** `lib/theme.ts`
- **Verify:** all tokens are referenced by name somewhere in `components/`
- **Prereqs:** P5-T05

### P5-T31 Install NativeWind

- **Inputs:** `lib/theme.ts`
- **Outputs:** NativeWind/Tailwind config wired into the Expo app
- **Verify:** sample `bg-surface` style renders correctly on iOS, Android, and web
- **Prereqs:** P5-T30

### P5-T32 Apply styles to components

- **Inputs:** card/components ports, NativeWind config
- **Outputs:** styled card, tab, button, input, and surface components
- **Verify:** visual parity check against current `src/` screenshots on a dev device
- **Prereqs:** P5-T31, P5-T16

### P5-T33 Responsive breakpoints for web

- **Inputs:** styled Expo components
- **Outputs:** breakpoint-aware web layouts using `useWindowDimensions`
- **Verify:** layout adapts at 640 px and 1024 px
- **Prereqs:** P5-T32

### P5-T34 Retention cleanup port

- **Inputs:** `src/retention.ts`, `lib/storage.ts`
- **Outputs:** `lib/retention.ts`
- **Verify:** unit test deletes items older than `retention_days`
- **Prereqs:** P5-T08

### P5-T35 Offline banner

- **Inputs:** `src/components/device-session-status.tsx`, `lib/sse.ts`
- **Outputs:** disconnected-banner behavior for Expo/native
- **Verify:** kill the backend and observe the banner within the expected interval
- **Prereqs:** P5-T09, P5-T16

### P5-T36 `expo-updates` OTA

- **Inputs:** Expo build configuration
- **Outputs:** OTA update configuration
- **Verify:** `eas update` delivers a change to a dev client
- **Prereqs:** P5-T05

### P5-T37 Web smoke

- **Inputs:** Phase 5 feed/settings/styling work
- **Outputs:** fixed RN Web layout, scroll, and focus regressions
- **Verify:** all five screens are usable in Chrome and Safari
- **Prereqs:** P5-T18 through P5-T33

### P5-T38 Vercel deploy swap

- **Inputs:** RN Web build output, `vercel.json`
- **Outputs:** Expo web export deploy path
- **Verify:** preview deploy loads feed and completes sign-in
- **Prereqs:** P5-T37

### P5-T39 Apple / Google accounts — Human-gate

- **Inputs:** store-submission plan
- **Outputs:** Apple Developer and Google Play accounts
- **Verify:** accounts exist before build submission
- **Prereqs:** P5-T38

### P5-T40 First EAS builds

- **Inputs:** EAS account, configured app, bundle IDs
- **Outputs:** iOS and Android builds for TestFlight / Play internal track
- **Verify:** `eas build -p ios` and `eas build -p android` complete successfully
- **Prereqs:** P5-T39

### P5-T41 Submit for review — Human-gate

- **Inputs:** successful platform builds, store metadata
- **Outputs:** submitted App Store / Play review packages
- **Verify:** submission records exist in each store console
- **Prereqs:** P5-T40

### P5-T42 Delete the Preact PWA

- **Inputs:** stable Expo web deployment after at least one full release cycle
- **Outputs:** removal of `src/`, `build-sw.mjs`, `public/sw.js`, `vite.config.ts`, and Preact-specific deps
- **Verify:** repo builds and tests pass with only the Expo tree present
- **Prereqs:** P5-T38 live for at least one full release cycle

### P5-T43 Doc sweep

- **Inputs:** post-cutover repo layout
- **Outputs:** updated `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`
- **Verify:** no remaining references to `src/`, `vite.config.ts`, or the Preact-specific service worker outside historical changelogs
- **Prereqs:** P5-T42

### P5-T44 Test cleanup

- **Inputs:** post-cutover test suite
- **Outputs:** removal or rewrite of Preact-DOM-specific Playwright coverage for the RN Web build
- **Verify:** `npm run test:all` is green
- **Prereqs:** P5-T42

**Phase exit tests:** Expo crypto/storage tests, device-session integration tests, native/web UI tests, push-notification integration tests, RN Web smoke tests, store-build validation, and post-cutover full-repo regression tests must all be green.

---

## 7. Recommended Execution Order

1. **Phase 1** — lock identity, fail-closed auth, Postgres-only server direction, and key-management selection
2. **Phase 2** — implement Postgres persistence and ciphertext-only queue/replay/key-management boundaries
3. **Phase 3** — implement billing and server-enforced entitlements
4. **Phase 4** — add the web account surface, connected-app management, and hosted security posture
5. **Phase 5** — start Expo/native only after Phase 3 is complete, preferably after Phase 4 makes the hosted account surface coherent

The important sequencing rule is simple: do not let native/mobile run ahead of hosted identity, persistence, and entitlements.

---

## 8. Suggested Issue Breakdown

These should become GitHub issues at **workstream granularity**, not per-route-group or per-controller shards.

### Phase 1 issues
- [ ] Hosted identity contract: Clerk `usr_*`, device `dev_*`, self-hosted single-tenant rules
- [ ] Hosted auth-boundary cleanup: remove `local` fallback and fail closed across route groups
- [ ] Server DB direction: async Postgres-only codepath for hosted and self-hosted
- [ ] Key-management model selection + metadata exposure contract
- [ ] Tenant/auth-boundary test matrix

### Phase 2 issues
- [ ] Postgres schema + async persistence implementation
- [ ] Tenant-correct schema semantics and bootstrap cleanup
- [ ] Key-management implementation and multi-device onboarding
- [ ] Ciphertext-only queue/replay/recovery implementation
- [ ] Self-hosted + hosted Postgres cutover documentation
- [ ] Persistence/trust-boundary automated tests

### Phase 3 issues
- [ ] Billing provider selection + hosted plan matrix
- [ ] Billing/entitlement schema + reconciliation backbone
- [ ] Entitlement middleware and route gating
- [ ] Billing + entitlement automated tests

### Phase 4 issues
- [ ] Hosted web account surface
- [ ] Connected apps / OAuth / MCP management surface
- [ ] Hosted security posture and operator controls
- [ ] Hosted account-surface and security e2e tests

### Phase 5 issues
- [ ] Expo/native scaffold and core runtime rewrites
- [ ] Expo feed/settings/push/styling implementation
- [ ] RN Web deploy swap and store-submission prep
- [ ] PWA cutover and post-cutover docs/tests

---

## 9. Production-Grade Launch Rules

1. Hosted launch is **Postgres-clean**.
2. There is **no** SQLite → Postgres importer for hosted.
3. There is **no** SQLite/Postgres dual-write phase.
4. Self-hosted also converges to the Postgres server path.
5. Existing self-hosters should expect reset/cutover rather than automated migration tooling.
6. Server-side feed content stays ciphertext-only.
7. Expo/native work cannot redefine billing or entitlement truth.

---

## 10. Open Decisions

Only decisions that are still genuinely unresolved should stay here.

- [ ] Billing provider for hosted launch: Stripe vs Paddle
- [ ] Whether RN Web keeps Web Push as a maintained path after Expo cutover, or whether native push + web account surface become the only supported path

If a decision is closed, remove it from this section and encode it in the relevant phase/tasks instead.

---

## 11. What to Avoid

Avoid these failure modes:
- treating hosted as a thin auth wrapper over the current local-first backend
- rebuilding multiple drifting hosted or Expo planning docs
- allowing server routes to silently assume `local`
- treating Postgres as a feed-content database
- storing decrypted feed content on the server for convenience
- hiding metadata exposure instead of documenting it explicitly
- starting Expo/native before hosted identity and entitlements are real
- planning route-by-route issue sharding instead of workstream-level execution
- inventing migration tooling that slows the Postgres cutover without helping launch
- reintroducing SQLite as a parallel long-term server path

---

## 12. Definition of Success

ScrolLess should be considered successful against this plan when:

1. Hosted requests resolve cleanly to either:
   - Clerk-backed `usr_*` account identity, or
   - device-scoped `dev_*` identity for free-tier flows
2. Hosted mode fails closed and no longer depends on `local` semantics.
3. Both hosted and self-hosted server deployments use the same async Postgres codepath.
4. The server stores ciphertext-only feed payloads and only the explicitly documented plaintext metadata fields.
5. Key-management for paid multi-device accounts is selected, implemented, and tested.
6. Billing and entitlements are server-enforced and auditable.
7. Users can manage billing, devices, and connected apps from the web surface.
8. Expo/native clients consume hosted identity and entitlements without becoming the subscription source of truth.
9. The old Expo planning docs are gone because this file is the single canonical execution plan.
10. Each phase has a named test gate, and those suites are green before the next phase is treated as complete.
