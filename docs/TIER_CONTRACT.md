# ScrolLess Tier Contract (Kickoff)

_Last updated: April 4, 2026._

This document captures the agreed product and backend contract for free vs paid behavior so implementation can proceed in parallel.

## 1. Product model

- **Single architecture / codebase** with behavior gated by tier.
- **Free tier** is device-scoped and does not require account creation.
- **Paid tier** is account-scoped with cloud queue semantics and multi-device delivery.

## 2. Data privacy contract

ScrolLess has two storage domains:
- **control plane**: server-side operational storage
- **content plane**: client-side feed/content storage

Contract:
- End-to-end encryption is mandatory in all phases.
- Feed payloads are encrypted in transit and at rest.
- The control plane may store plaintext operational metadata and encrypted payload envelopes when queueing/replay requires retention.
- The control plane must never store decrypted feed content.
- The content plane remains the decrypted feed-content store.

## 3. Tier behavior contract

### Free tier (MVP)

- Identity is device-scoped.
- No guaranteed cloud queue semantics for feed retrieval.
- If sync fails while device is offline, surface status in top banner.
- Content plane storage remains local client storage (IndexedDB in the current PWA).
- Control-plane retention is limited to operational metadata and short-lived encrypted queue state.
- Single active device policy.
- Default retention recommendation: **7 days** (user-configurable).

### Paid tier

- Identity is account-scoped.
- Multi-device is enabled.
- Submissions fan out to all registered devices.
- Guaranteed encrypted queue semantics with retry + ACK.
- Control-plane retention may include encrypted payload envelopes for replay and recovery.
- Content plane storage on client devices remains the decrypted feed database.
- Default retention recommendation: **30 days** (user-configurable).

## 4. Device auth and rotation

- Device auth model: signed challenge/response.
- `X-Device-Id` may be a routing hint, but cryptographic proof is authoritative.
- Free tier rotation policy:
  - New device verification starts a **5-minute grace period**.
  - Old device is rejected after grace expiry.

## 5. Queue and sync semantics (paid)

- Delivery tracked per recipient device.
- Queue entry is complete only when each intended device has ACKed or expired.
- Global cursor advances after at least one recipient ACK (not merely enqueue).
- Replay remains available for offline devices until TTL expiry.
- Control-plane queue storage contains encrypted payload envelopes, not decrypted feed content.
- UX target is effectively-once via idempotent write + dedup behavior.

## 6. API direction

- Versioned auth/token/device routes live under `/api/v1/...`.
- Unversioned auth/token/device endpoints are removed (no backward compatibility requirement).
- Feed-content retrieval endpoints are free-tier disabled/deprecated and reserved for paid queue workflows.

## 7. Route contracts to implement next

These are intended contracts to unblock client/server work; implementation details may evolve.

### `POST /api/v1/device/challenge`

Purpose: issue a short-lived nonce for device proof.

Request body:

```json
{
  "device_id": "dev_...",
  "public_key": "base64-or-jwk"
}
```

Response:

```json
{
  "challenge_id": "chal_...",
  "nonce": "base64...",
  "issued_at": "2026-04-04T00:00:00Z",
  "expires_at": "2026-04-04T00:05:00Z"
}
```

### `POST /api/v1/device/verify`

Purpose: verify signed challenge and establish active device identity.

Request body:

```json
{
  "challenge_id": "chal_...",
  "device_id": "dev_...",
  "signature": "base64..."
}
```

Response:

```json
{
  "ok": true,
  "user_id": "dev_...",
  "grace_expires_at": "2026-04-04T00:10:00Z"
}
```

### `POST /api/v1/queue/ack`

Purpose: idempotent recipient ACK.

Request body:

```json
{
  "delivery_id": "del_...",
  "device_id": "dev_..."
}
```

Response:

```json
{
  "ok": true,
  "status": "acked"
}
```

Behavioral requirements:

- Duplicate ACK returns success and does not create duplicate side effects.
- ACK updates per-device status and can advance global cursor once at least one device ACK exists.

## 8. Paid queue data model (minimum)

This is control-plane queue state, not the content-plane feed database.

- `delivery_id` (batch id)
- `user_id`
- `device_id`
- encrypted payload envelope + metadata
- timestamps: `submitted_at`, `acked_at`, `expires_at`
- status: `queued | delivered_unacked | acked | expired`

## 9. Acceptance checks (must pass)

1. Two paid devices A/B: if A ACKs while B is offline, cursor advances.
2. B can replay payload prior to TTL expiry.
3. Free-tier rotation enforces 5-minute grace, then old device rejection.
4. ACK endpoint is idempotent.

## 10. Implementation TODO checklist

- [x] Patch `PATCH /api/sources/:name` SQL parameter ordering bug.
- [x] Create this architecture contract doc (`docs/TIER_CONTRACT.md`).
- [x] Define and implement `POST /api/v1/device/challenge`.
- [x] Define and implement `POST /api/v1/device/verify`.
- [x] Define and implement `POST /api/v1/queue/ack` (idempotent ACK).
- [x] Migrate device/token routes to `/api/v1/...` and remove unversioned endpoints.
- [x] Add free vs paid feature flag/tier gating for feed endpoint behavior.
- [x] Implement minimal paid queue schema with per-device delivery rows.
- [x] Add acceptance tests for rotation grace period, per-device ACK, and cursor advancement.
