# Expo Refactor Plan

Status: **Active** — executing soon, Clerk-first.
Created: 2026-04-03 · Revised: 2026-04-18

> For step-by-step execution, see `docs/EXPO_REFACTOR_TASKS.md`. This document is the rationale (motivation, trade-offs, auth options, alternatives); the tasks file is the checklist.

---

## Motivation

- App store presence on iOS and Android.
- Native push notifications (bypass iOS PWA push limitations).
- Single codebase for mobile + web via Expo's universal support.
- Clerk as the authentication wrapper for the hosted (`usr_*`) tier — see `docs/pre-release-tasks.md` §"Clerk User Identity".

## Current Frontend Reality (what's actually in the repo)

The previous revision of this plan assumed a `client/` directory and an existing Clerk web SDK. Neither is accurate. What the rewrite is actually leaving behind:

- **Location**: `src/` (Preact + preact-iso), not `client/`.
- **Build**: Vite + a custom `build-sw.mjs` service-worker build.
- **Auth**: no Clerk anywhere in the tree. Identity is a bespoke device-keypair flow in `src/bootstrap/device-session.ts`:
  - ECDH P-256 (content decrypt) + ECDSA P-256 (challenge/verify) generated in-browser via Web Crypto, stored non-extractable in IndexedDB.
  - `user_id` = `dev_<uuid>` on free tier; `local` for self-hosted; `usr_*` is the **not-yet-implemented** hosted-user target.
  - Self-hosted adds an `X-Device-Enroll-Token` header gate (`DEVICE_ENROLLMENT_TOKEN` env var).
- **State / storage**: `idb` (IndexedDB) for feed items, device record, preferences, sync log.
- **Transport**: `EventSource` SSE to `/api/stream` for real-time encrypted payloads, with exponential-backoff reconnect.
- **Push**: custom service worker (`src/sw.ts`) + Web Push (VAPID).
- **Routing**: hash-based (`#/feed`, `#/discover`, `#/saved`, `#/settings`) — no router library.
- **Styling**: plain CSS (`src/styles.css`) + Material Symbols; design tokens in `docs/DESIGN_SYSTEM.md`.
- **Tests**: vitest + `@testing-library/preact` for unit, Playwright for e2e.

The server is unchanged by this refactor. All `/agent/*`, `/api/*`, `/oauth/*`, `/mcp` routes stay as-is. The only server work this plan touches is push-token intake (native tokens alongside Web Push subscriptions) and Clerk session verification, both of which belong on the `pre-release-tasks.md` roadmap independently.

## Trade-offs Accepted

- **Web experience regresses**: React Native Web is functional but second-class compared to Preact PWA. Scroll, layout edge cases, bundle size all degrade.
- **Bundle size**: Preact (~3 KB) → RN Web + Expo runtime (hundreds of KB).
- **Build complexity**: Vite → Metro + EAS Build; app store signing and provisioning added.
- **Service worker / Web Push lost on native**: replaced by `expo-notifications` + `expo-updates`. Web variant can keep Web Push but it's no longer the primary path.

---

## Cross-Cutting Reworks (not one phase — touch every phase)

These aren't optional polish; they gate the whole migration. Budget time for them up-front.

1. **Crypto rewrite.** Web Crypto `SubtleCrypto` ECDH/ECDSA does not exist on React Native. `expo-crypto` provides hashing and random only. Options: (a) `react-native-quick-crypto` + JSI, (b) a pure-JS P-256 implementation (e.g. `@noble/curves`) — slower but portable to RN Web too. `@noble/curves` is the lower-risk pick because it works identically on native and web. All of `src/crypto.ts` and `src/bootstrap/device-session.ts` needs to be re-implemented on top of the chosen library, then re-tested against a known-good fixture from the Preact app.
2. **Storage rewrite.** IndexedDB does not exist on RN. The `feed_items`, `device`, `preferences`, `sync_log` object stores in `src/idb.ts` map cleanly onto `expo-sqlite` (ships on native and web via WASM). Keep the same logical store shape; swap the driver.
3. **SSE rewrite.** RN has no `EventSource`. Use `react-native-sse` (works on native; has a web fallback) or switch to WebSocket on the server (bigger server change — probably not worth it). Keep the existing backoff/visibility logic in `device-session.ts`.
4. **Styling rewrite.** No `class`, no CSS cascade, no `:root` custom properties on native. Port `docs/DESIGN_SYSTEM.md` tokens to a `theme.ts` constants file and use NativeWind (Tailwind-for-RN) **or** RN `StyleSheet`. Recommend NativeWind because the token set is already Tailwind-shaped.
5. **Test strategy rewrite.** `@testing-library/preact` → `@testing-library/react-native`. Playwright web-only stays for the RN Web build. Snapshot tests for the cards likely need rewriting.

Estimate impact: these five items add ~3–5 sessions on top of pure UI porting.

---

## Auth Strategy: How Clerk Coexists with the Device-Session Flow

This is the decision that unblocks Phase 1. The current app has **three identity tiers** (`docs/ARCHITECTURE.md §Tier Model`):

| Tier | user_id | How the device authenticates today |
|------|---------|-----------------------------------|
| Self-hosted | `local` | Enrollment token + device keypair challenge/verify |
| Free | `dev_*` | Device keypair challenge/verify (no account) |
| Paid | `usr_*` | Not yet implemented — target for Clerk |

**Open design question — requires user call before Phase 1 starts:**

- **Option A (Clerk wraps `usr_*` only):** Clerk session is presented to `/api/v1/device/challenge` alongside the device public key; server binds the resulting session token to the Clerk `user_id`. Free and self-hosted paths stay unchanged. Minimal server work, but the mobile app needs two code paths (signed-in vs. anonymous device).
- **Option B (Clerk replaces device challenge/verify on paid, free stays device-only):** Clerk JWT is the bearer on `/api/*` for paid users; device keypair remains only for content decryption (ECDH). Simpler client, more server work (`@clerk/fastify` middleware, tier gating).
- **Option C (Clerk for all tiers except self-hosted):** Even free users sign in with Clerk (e.g., anonymous / email magic link). Cleanest mental model, but breaks the "no account required for free tier" promise in the current tier contract.

**Recommendation:** Option A for the first Expo build. It preserves the tier contract, keeps the server seam already described in `docs/TIER_CONTRACT.md`, and the sign-in gate can be added as an upgrade path later.

Whichever option is chosen needs to land in `docs/ARCHITECTURE.md` and `docs/TIER_CONTRACT.md` before Clerk code is written.

---

## Migration Strategy

Scaffold the Expo project in a new top-level directory (`app/` for routes, `components/`, `lib/`). Keep `src/` (the Preact PWA) building and deployable until the Expo build reaches parity on the five screens (Feed, Discover, Saved, Settings, enrollment). Cut over by switching the Vercel deploy to the Expo Web export and retiring `src/` in a follow-up PR.

### Directory Structure

```
src/             ← existing Preact PWA (keep until parity, then delete)
app/             ← Expo Router file-based routes (feed, discover, saved, settings, enroll)
components/      ← shared RN components (cards, filter, feed-list, etc.)
lib/             ← api client, auth, push, storage, crypto, sse, theme
assets/          ← icons, splash screens
app.json         ← Expo config
eas.json         ← EAS Build config
```

---

## Phases

### Phase 0 — Decisions & Prep (0.5 session, human-required)

- [ ] Pick auth option (A / B / C above); update `docs/ARCHITECTURE.md` §Tier Model and `docs/TIER_CONTRACT.md`.
- [ ] Create Clerk application; decide instance split (separate dev/prod, or Clerk's built-in environments).
- [ ] Create Expo/EAS account; confirm bundle identifiers (`app.scrolless.ios`, etc.).
- [ ] Decide crypto library (recommend `@noble/curves`) and storage driver (recommend `expo-sqlite`).

### Phase 1 — Scaffold + Clerk + Device Session (2–3 sessions)

- [ ] `npx create-expo-app` with the `expo-router` template and TypeScript.
- [ ] Configure `app.json` (name, scheme `scrolless://`, icons, splash, bundle IDs).
- [ ] Set up EAS (`eas.json`, link to Expo account, set up dev client).
- [ ] Wire `EXPO_PUBLIC_API_BASE_URL`.
- [ ] Install `@clerk/clerk-expo`; wrap `app/_layout.tsx` with `ClerkProvider`; add sign-in / sign-up screens under `app/(auth)/`.
- [ ] Implement `lib/crypto.ts` on top of `@noble/curves` — ECDH derive + AES-GCM decrypt; port test fixtures from Preact version.
- [ ] Implement `lib/storage.ts` on top of `expo-sqlite` — same logical stores as `src/idb.ts` (`feed_items`, `device`, `preferences`, `sync_log`).
- [ ] Port `bootstrap/device-session.ts` → `lib/device-session.ts` using `react-native-sse` and the new crypto/storage modules.
- [ ] Wire Clerk session into the device-session flow per the chosen auth option.
- [ ] Verify authenticated API calls against a running dev backend.

### Phase 2 — Feed Screens (2–3 sessions)

- [ ] `app/(tabs)/feed.tsx`, `discover.tsx`, `saved.tsx` with `expo-router` tab layout.
- [ ] Feed list using `FlashList` (Shopify) for perf; pull-to-refresh via `RefreshControl`.
- [ ] Port `YouTubeCard`, `XCard`, `NewsCard`, `ContentCard`, `SaveButton`, `SourceFilter`, `NotificationPrompt`, `SyncStatus`, `DeviceSessionStatusBadge` from `src/components/*` to `components/*`.
- [ ] Mark-read and toggle-save write through to `expo-sqlite`; UI listens via a subscription helper equivalent to the current `scrolless:idb-updated` event.
- [ ] Mark-all-read.

### Phase 3 — Settings Screen (1–2 sessions)

- [ ] Port `src/settings.tsx` (489 lines, four sections: sources, agent tokens, preferences, sync detail).
- [ ] Agent token reveal flow (clipboard via `expo-clipboard`).
- [ ] Preferences form (blocked_keywords, retention_days, max_items_per_source) — API already exists.
- [ ] Danger zone wired to `DELETE /api/data` (route addition tracked in `pre-release-tasks.md`, not this plan).
- [ ] Enrollment token input screen for self-hosted tier.

### Phase 4 — Push Notifications (1–2 sessions)

- [ ] `expo-notifications` permissions + token registration on first run.
- [ ] Extend `POST /api/push/subscribe` to accept `{ platform: 'expo' | 'web', token: string }` alongside existing Web Push subscription shape.
- [ ] Server-side dispatch: if subscription is Expo-native, send via Expo Push API (FCM/APNs handled by Expo). If Web Push, keep existing path.
- [ ] Notification tap → deep link (`scrolless://feed/:id` or `scrolless://source/:name`).
- [ ] Keep Web Push working for the RN Web build (optional; can be dropped if it costs too much).

### Phase 5 — Styling & Design System (1–2 sessions)

- [ ] Port `docs/DESIGN_SYSTEM.md` color + typography tokens to `lib/theme.ts`.
- [ ] Install NativeWind; configure Tailwind config from those tokens.
- [ ] Port component styles (cards, tabs, buttons, inputs, glass/surface layering).
- [ ] Dark mode (current design is dark-only; system theme detection is a stretch goal).
- [ ] Responsive breakpoints via `useWindowDimensions` for the web build.

### Phase 6 — Offline, Caching, OTA (1 session)

- [ ] Retention cleanup (`src/retention.ts` port) running against `expo-sqlite`.
- [ ] Graceful offline banner when the SSE stream is disconnected (current behaviour is already in `DeviceSessionStatusBadge` — port it).
- [ ] `expo-updates` configured for OTA.

### Phase 7 — Web Compatibility Pass (1–2 sessions)

- [ ] `npx expo start --web`; fix RN Web layout/scroll/focus issues.
- [ ] Responsive behaviour at phone / tablet / desktop widths.
- [ ] Verify Web Push fallback still works (if retained).
- [ ] Swap Vercel build command to `npx expo export -p web`; update `vercel.json`.

### Phase 8 — Store Submission (1 session + human)

- [ ] iOS: Apple Developer account ($99/yr), provisioning, App Store Connect listing.
- [ ] Android: Google Play Developer ($25 once), keystore, Play Console listing.
- [ ] First EAS builds for both platforms; TestFlight / internal track.
- [ ] Submit for review.

### Phase 9 — PWA Cutover (0.5 session)

- [ ] Remove `src/`, `build-sw.mjs`, `public/sw.js`, `vite.config.ts`, Preact deps from `package.json`.
- [ ] Update `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`.
- [ ] Remove Playwright tests tied to Preact DOM; keep e2e tests for the RN Web build.

---

## Estimated Total: 14–20 Claude Code Sessions

Previous estimate (12–18) under-counted the crypto/storage/SSE rewrites, the real scope of `settings.tsx`, and the Clerk-vs-device-session design work. Low end still assumes NativeWind takes styling trade-offs without polish; high end includes careful web parity.

## Human Involvement Required

- **Auth decision**: Phase 0 option A/B/C — cannot be decided by Claude.
- **App store accounts**: Apple Developer ($99/yr) and Google Play ($25).
- **Signing credentials**: iOS provisioning profiles and Android keystores are interactive.
- **Design approval**: RN doesn't map 1:1 to CSS — visual trade-offs need sign-off.
- **Physical device testing**: push + native behaviour need real hardware.
- **Store review**: Apple/Google timelines are what they are.

## Alternative Considered: Capacitor

Capacitor wraps the existing Preact PWA in a native shell (~2–3 sessions, keeps frontend intact). Doesn't give true native UI and doesn't solve the native-push iOS story cleanly. Keep on file as a fallback if Phase 1–2 reveal that the crypto/storage rewrites are worse than expected.
