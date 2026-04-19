# Expo Refactor — Executable Task List

Companion to `docs/EXPO_REFACTOR_PLAN.md`. The plan explains **why**; this file lists **what to do**, in order, as atomic tasks a small model can execute one at a time.

## How to use this file

- Execute tasks in ID order unless `Prereqs` lists other IDs.
- Each task is self-contained: read `Inputs`, produce `Outputs`, run `Verify`.
- If `Verify` fails, fix within the same task. Do not move on.
- Mark `- [ ]` → `- [x]` in the checklist at the top of the task when done.
- Never modify `server/` routes. This refactor is frontend-only except for push-token intake (T4-02) and Clerk verification (tracked in `docs/pre-release-tasks.md`, not here).
- Never touch `main` directly. Work on the branch designated in `CLAUDE.md`.

## Conventions

- **Inputs** = files to read before editing.
- **Outputs** = files to create/modify.
- **Verify** = exact command(s) that must pass, or a concrete manual check.
- **Prereqs** = task IDs that must be done first.
- **Human-gate** = task needs a human decision or credential; stop and surface the question.

---

## Phase 0 — Decisions & Prep

### T0-01 Pick auth option (A / B / C) — Human-gate

- [ ] Read `docs/EXPO_REFACTOR_PLAN.md` §Auth Strategy.
- [ ] Surface the three options to the human; capture the decision.
- [ ] Update `docs/ARCHITECTURE.md` §Tier Model and `docs/TIER_CONTRACT.md` with the chosen option.
- **Verify**: chosen option is referenced by name in both docs; grep `docs/ARCHITECTURE.md` for "Clerk".
- **Prereqs**: none.

### T0-02 Clerk application setup — Human-gate

- [ ] Human creates Clerk app, provides publishable + secret keys.
- [ ] Record keys in a secure store; document env var names: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
- **Verify**: env var names present in `.env.example`.
- **Prereqs**: T0-01.

### T0-03 Expo / EAS account + bundle IDs — Human-gate

- [ ] Human creates Expo account, confirms bundle IDs `app.scrolless.ios` and `app.scrolless.android`.
- **Verify**: IDs recorded in this task when complete.
- **Prereqs**: none.

### T0-04 Freeze library choices

- [ ] Confirm: crypto = `@noble/curves`, storage = `expo-sqlite`, SSE = `react-native-sse`, styling = `NativeWind`, list = `@shopify/flash-list`.
- [ ] Record pinned versions in this task line.
- **Verify**: versions written here.
- **Prereqs**: none.

---

## Phase 1 — Scaffold + Core Rewrites

### T1-01 Scaffold Expo project

- [ ] Run `npx create-expo-app@latest --template tabs` at repo root; move generated `app/`, `components/`, `assets/`, `app.json`, `tsconfig.json` additions into the repo; keep `src/` untouched.
- [ ] Add `eas.json` (EAS Build config, `development` + `preview` + `production` profiles).
- [ ] Add `EXPO_PUBLIC_API_BASE_URL` to `.env.example`.
- **Outputs**: `app/`, `components/`, `lib/`, `assets/`, `app.json`, `eas.json`.
- **Verify**: `npx expo start --web` boots the template.
- **Prereqs**: T0-04.

### T1-02 App shell config

- [ ] In `app.json` set: `name`, `slug`, `scheme: scrolless`, icons, splash, iOS/Android bundle IDs from T0-03.
- **Outputs**: `app.json`.
- **Verify**: `npx expo config --type public` shows the values.
- **Prereqs**: T1-01, T0-03.

### T1-03 Port crypto module to `@noble/curves`

- [ ] Read `src/crypto.ts` and note: ECDH P-256 derive, AES-GCM decrypt, any hashing.
- [ ] Install `@noble/curves`, `@noble/hashes`.
- [ ] Implement `lib/crypto.ts` with the same public function signatures as `src/crypto.ts`.
- [ ] Copy fixture values from the Preact unit tests into `lib/crypto.test.ts`; assert bit-identical output.
- **Inputs**: `src/crypto.ts`, any `*.test.ts` that covers it.
- **Outputs**: `lib/crypto.ts`, `lib/crypto.test.ts`.
- **Verify**: `npx jest lib/crypto.test.ts` (or project test runner) passes.
- **Prereqs**: T1-01.

### T1-04 Port storage layer to `expo-sqlite`

- [ ] Read `src/idb.ts` and enumerate stores: `feed_items`, `device`, `preferences`, `sync_log`; note indexes and query patterns.
- [ ] Install `expo-sqlite`.
- [ ] Implement `lib/storage.ts` exposing the same function names as `src/idb.ts`.
- [ ] Implement a tiny pub/sub helper `lib/storage-events.ts` replacing the `scrolless:idb-updated` DOM event.
- **Inputs**: `src/idb.ts`.
- **Outputs**: `lib/storage.ts`, `lib/storage-events.ts`, `lib/storage.test.ts`.
- **Verify**: unit tests for insert + query on each store pass.
- **Prereqs**: T1-01.

### T1-05 Port SSE transport

- [ ] Install `react-native-sse`.
- [ ] Implement `lib/sse.ts`: connects to `/api/stream`, exponential backoff, visibility-based reconnect. Mirror logic in `src/bootstrap/device-session.ts`.
- **Inputs**: `src/bootstrap/device-session.ts` (SSE section only).
- **Outputs**: `lib/sse.ts`.
- **Verify**: manual — point at a running dev server, observe reconnection on network toggle.
- **Prereqs**: T1-01.

### T1-06 Port device-session bootstrap

- [ ] Implement `lib/device-session.ts` on top of T1-03, T1-04, T1-05.
- [ ] Produce `dev_*` on free tier; `local` on self-hosted (driven by env); leave `usr_*` branch for T1-08.
- **Inputs**: `src/bootstrap/device-session.ts`.
- **Outputs**: `lib/device-session.ts`, `lib/device-session.test.ts`.
- **Verify**: end-to-end with running dev backend: device enrolls, challenge/verify succeeds, stream receives ciphertext.
- **Prereqs**: T1-03, T1-04, T1-05.

### T1-07 Install Clerk for Expo

- [ ] Install `@clerk/clerk-expo`.
- [ ] Wrap `app/_layout.tsx` with `ClerkProvider` using `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`.
- [ ] Add `app/(auth)/sign-in.tsx` and `app/(auth)/sign-up.tsx` using Clerk's components.
- **Outputs**: `app/_layout.tsx`, `app/(auth)/sign-in.tsx`, `app/(auth)/sign-up.tsx`.
- **Verify**: `npx expo start --web`, can sign in on a test Clerk user.
- **Prereqs**: T1-01, T0-02.

### T1-08 Wire Clerk into device-session per chosen auth option

- [ ] Implement the auth integration decided in T0-01. Add `lib/auth.ts` exposing `getAuthHeaders()` used by all API calls.
- **Outputs**: `lib/auth.ts`, updated `lib/device-session.ts`.
- **Verify**: authenticated `/api/*` request returns 200 with the expected `user_id`.
- **Prereqs**: T1-06, T1-07, T0-01.

---

## Phase 2 — Feed Screens

### T2-01 Tab layout

- [ ] Create `app/(tabs)/_layout.tsx` with four tabs: Feed, Discover, Saved, Settings.
- **Outputs**: `app/(tabs)/_layout.tsx`.
- **Verify**: all four tabs render an empty placeholder screen.
- **Prereqs**: T1-02.

### T2-02 Port ContentCard

- [ ] Port `src/components/content-card.tsx` to `components/content-card.tsx` using RN primitives.
- **Outputs**: `components/content-card.tsx`, `components/content-card.test.tsx`.
- **Verify**: snapshot / render test passes with a fixture item.
- **Prereqs**: T2-01.

### T2-03 Port per-source cards (parallelisable)

- [ ] Port each of: `youtube-card.tsx`, `x-card.tsx`, `news-card.tsx`. One task-unit per card; same file naming in `components/`.
- **Outputs**: `components/youtube-card.tsx`, `components/x-card.tsx`, `components/news-card.tsx` (+ tests).
- **Verify**: each component's test passes.
- **Prereqs**: T2-02.

### T2-04 Port SaveButton, SourceFilter, SyncStatus, DeviceSessionStatusBadge, NotificationPrompt

- [ ] Port each from `src/components/` to `components/`.
- **Verify**: each has a passing render test.
- **Prereqs**: T2-02.

### T2-05 Feed list with FlashList

- [ ] Install `@shopify/flash-list`.
- [ ] Implement `components/feed-list.tsx` as a `FlashList` reading from `lib/storage.ts` and subscribing via `lib/storage-events.ts`.
- [ ] `RefreshControl` triggers a manual sync.
- **Outputs**: `components/feed-list.tsx`.
- **Verify**: scrolling a seeded 200-item list is smooth on a dev device.
- **Prereqs**: T1-04, T2-03, T2-04.

### T2-06 Feed / Discover / Saved screens

- [ ] `app/(tabs)/feed.tsx`, `discover.tsx`, `saved.tsx` each mount `FeedList` with the correct filter predicate.
- **Outputs**: three screen files.
- **Verify**: each tab shows the expected items against seeded data.
- **Prereqs**: T2-05.

### T2-07 Mark-read / toggle-save / mark-all-read

- [ ] Mark-read on scroll-past and on tap. Toggle-save via `SaveButton`. Mark-all-read action in the Feed header.
- [ ] All mutations write through `lib/storage.ts` and emit a storage-events update.
- **Verify**: unit test mutates, subscribes, and observes the change.
- **Prereqs**: T2-06.

---

## Phase 3 — Settings Screen

### T3-01 Settings skeleton

- [ ] Create `app/(tabs)/settings.tsx` with four sections matching `src/settings.tsx`: Sources, Agent Tokens, Preferences, Sync Detail.
- **Outputs**: `app/(tabs)/settings.tsx`.
- **Verify**: sections render, each as a stub.
- **Prereqs**: T2-01.

### T3-02 Sources section

- [ ] Port `src/components/source-list.tsx` and `add-source-form.tsx` to `components/`.
- [ ] Wire to the same endpoints as the Preact version.
- **Verify**: add/remove a source against a dev backend.
- **Prereqs**: T3-01, T1-08.

### T3-03 Agent tokens section

- [ ] List, reveal (copy to clipboard via `expo-clipboard`), create, revoke tokens.
- **Verify**: reveal copies exact token; revoke removes it from the list.
- **Prereqs**: T3-01, T1-08.

### T3-04 Preferences form

- [ ] Fields: `blocked_keywords`, `retention_days`, `max_items_per_source`.
- **Verify**: change + reload persists values via the existing `/api/preferences` route.
- **Prereqs**: T3-01, T1-08.

### T3-05 Danger zone

- [ ] Confirm-dialog that calls `DELETE /api/data`. Route addition is tracked in `pre-release-tasks.md`; if unavailable, leave the button disabled with a TODO note.
- **Verify**: button disabled-state is correct based on route availability.
- **Prereqs**: T3-01.

### T3-06 Enrollment token screen (self-hosted)

- [ ] `app/(auth)/enroll.tsx` accepts an enrollment token and stores it for the `X-Device-Enroll-Token` header.
- **Verify**: self-hosted dev backend accepts the enrolled device.
- **Prereqs**: T1-06.

---

## Phase 4 — Push Notifications

### T4-01 Expo notifications client

- [ ] Install `expo-notifications`; request permission on first app open; obtain Expo push token.
- **Outputs**: `lib/push.ts`.
- **Verify**: token logged to console on a real device.
- **Prereqs**: T1-01.

### T4-02 Push-token intake (server change)

- [ ] Extend `POST /api/push/subscribe` in `server/api-routes.ts` to accept `{ platform: 'expo' | 'web', token: string }` alongside the existing Web Push shape.
- [ ] Dispatcher: if `platform === 'expo'`, send via Expo Push API; else keep Web Push path.
- **Outputs**: `server/api-routes.ts`, push dispatcher module.
- **Verify**: `npm run test:server` passes; integration test delivers a notification to a fake Expo endpoint.
- **Prereqs**: T4-01.

### T4-03 Deep link on tap

- [ ] Register `scrolless://feed/:id` and `scrolless://source/:name`; tap a delivered notification and land on the right screen.
- **Verify**: manual on real device.
- **Prereqs**: T4-01, T2-06.

### T4-04 Preserve Web Push on RN Web build (optional)

- [ ] Behind a runtime platform check, retain existing Web Push subscription flow.
- **Verify**: RN Web build still receives a Web Push in a dev browser.
- **Prereqs**: T4-01.

---

## Phase 5 — Styling & Design System

### T5-01 Port tokens to `lib/theme.ts`

- [ ] Read `docs/DESIGN_SYSTEM.md`; encode colors and typography as a typed object.
- **Outputs**: `lib/theme.ts`.
- **Verify**: all tokens referenced by name somewhere in `components/`.
- **Prereqs**: T1-01.

### T5-02 Install NativeWind

- [ ] Install + configure `nativewind` and `tailwindcss`; wire `tailwind.config.js` to `lib/theme.ts`.
- **Verify**: a sample `<View className="bg-surface">` renders with the expected color on iOS, Android, Web.
- **Prereqs**: T5-01.

### T5-03 Apply styles to components

- [ ] Port each card's style to Tailwind classes; preserve glass/surface layering.
- **Verify**: visual parity against `src/` screenshots on a dev device.
- **Prereqs**: T5-02, T2-04.

### T5-04 Responsive breakpoints for web

- [ ] Use `useWindowDimensions` for phone / tablet / desktop layouts.
- **Verify**: resize the web window; layout adapts at 640/1024 px.
- **Prereqs**: T5-03.

---

## Phase 6 — Offline, Caching, OTA

### T6-01 Retention cleanup port

- [ ] Port `src/retention.ts` logic to run against `expo-sqlite`; schedule at app foreground.
- **Outputs**: `lib/retention.ts`.
- **Verify**: unit test deletes items older than `retention_days`.
- **Prereqs**: T1-04.

### T6-02 Offline banner

- [ ] Port the behavior in `src/components/device-session-status.tsx` that shows a disconnected banner when SSE is down.
- **Verify**: kill the backend; banner appears within the expected interval.
- **Prereqs**: T1-05, T2-04.

### T6-03 expo-updates OTA

- [ ] Install and configure `expo-updates`; verify an OTA-eligible build picks up a published update.
- **Verify**: `eas update` delivers a change to a dev client.
- **Prereqs**: T1-01.

---

## Phase 7 — Web Compatibility Pass

### T7-01 Web smoke

- [ ] `npx expo start --web`; fix layout, scroll, focus regressions.
- **Verify**: all five screens usable in Chrome and Safari.
- **Prereqs**: all of Phase 2 and Phase 5.

### T7-02 Vercel deploy swap

- [ ] Update `vercel.json` build command to `npx expo export -p web`.
- [ ] Point output directory to the Expo web export path.
- **Verify**: preview deploy loads feed and completes sign-in.
- **Prereqs**: T7-01.

---

## Phase 8 — Store Submission (Human-gate)

### T8-01 Apple / Google accounts

- Human creates Apple Developer and Google Play accounts.

### T8-02 First EAS builds

- [ ] `eas build -p ios` and `eas build -p android`; distribute to TestFlight / Play internal track.
- **Prereqs**: T8-01.

### T8-03 Submit for review

- Human submits listings.
- **Prereqs**: T8-02.

---

## Phase 9 — PWA Cutover

### T9-01 Delete Preact PWA

- [ ] Remove `src/`, `build-sw.mjs`, `public/sw.js`, `vite.config.ts`, Preact deps from `package.json`.
- **Verify**: repo builds and tests pass with only the Expo tree present.
- **Prereqs**: T7-02 live for at least one full release cycle.

### T9-02 Doc sweep

- [ ] Update `README.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md` to reflect the Expo-only reality.
- **Verify**: no remaining references to `src/`, `vite.config.ts`, or the Preact-specific service worker outside changelogs.
- **Prereqs**: T9-01.

### T9-03 Test cleanup

- [ ] Remove Playwright tests tied to Preact DOM; keep or rewrite e2e tests for the RN Web build.
- **Verify**: `npm run test:all` green.
- **Prereqs**: T9-01.

---

## Index of hard dependencies

- `lib/crypto.ts`, `lib/storage.ts`, `lib/sse.ts` gate `lib/device-session.ts` (T1-06).
- `lib/device-session.ts` + Clerk (T1-07) gate every feature screen.
- Feed cards (T2-02..T2-04) gate `FeedList` (T2-05).
- `lib/theme.ts` (T5-01) gates NativeWind wiring (T5-02).
- Web smoke (T7-01) gates Vercel swap (T7-02).
- Vercel swap (T7-02) gates PWA deletion (T9-01).
