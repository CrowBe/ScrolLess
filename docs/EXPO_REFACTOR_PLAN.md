# Expo Refactor Plan

Status: **On hold** — PWA is the current target. This document captures the plan for a future pivot to Expo (React Native) for app store + web deployment.

Created: 2026-04-03

---

## Motivation

- App store presence on iOS and Android
- Native push notifications (bypass iOS PWA push limitations)
- Single codebase for mobile + web via Expo's universal platform support

## Trade-offs Accepted

- **Web experience degrades**: React Native Web is functional but second-class compared to the current Preact PWA. Scroll performance, layout edge cases, and bundle size all regress.
- **Bundle size increase**: Preact (~3KB) → React Native Web + Expo runtime (significantly larger)
- **Build complexity**: Vite → Metro bundler + EAS Build. App store signing and provisioning added.
- **Service worker lost**: Offline app shell caching and web push handler replaced by expo-notifications + expo-updates on native. Web offline support requires separate work or is dropped.

## What Does NOT Change

The backend is completely unaffected. Fastify, SQLite, MCP server, OAuth, agent routes, and all `/agent/*` and `/api/*` endpoints remain identical. This is purely a frontend rewrite.

The only server-side change: push notification payloads may need to support both Web Push (existing) and FCM/APNs token-based delivery if native push is added alongside web.

---

## Migration Strategy

Scaffold the Expo project alongside the existing `client/` directory. Migrate screen by screen, keeping the PWA functional until the Expo version reaches parity. Cut over when ready.

### Directory Structure

```
client/          ← existing Preact PWA (keep until parity)
app/             ← new Expo Router file-based routes
components/      ← shared RN components
lib/             ← API client, auth, push, storage helpers
assets/          ← icons, splash screens
app.json         ← Expo config
eas.json         ← EAS Build config
```

---

## Phases

### Phase 1 — Scaffold & Auth (1-2 sessions)

- [ ] Init Expo project with `expo-router` and TypeScript
- [ ] Configure `app.json` (name, scheme, icons, splash)
- [ ] Set up EAS project (`eas.json`, link to Expo account)
- [ ] Wire `EXPO_PUBLIC_API_BASE_URL` env var
- [ ] Replace Clerk web SDK with `@clerk/clerk-expo`
- [ ] Verify authenticated API calls work against existing backend

### Phase 2 — Feed Screens (2-3 sessions)

- [ ] Build feed list with `FlatList` (pull-to-refresh, infinite scroll)
- [ ] Port `YouTubeCard` component (thumbnail, title, channel, expand)
- [ ] Port `XCard` component (author, text, expand)
- [ ] Port `NewsCard` component (headline, source, excerpt)
- [ ] Port `SourceFilter` tabs (All / YouTube / X / News + unread counts)
- [ ] Port feed/discovery toggle
- [ ] Implement mark-read (swipe or tap) via `PATCH /api/feed/:id/read`
- [ ] Implement mark-all-read

### Phase 3 — Settings Screens (1-2 sessions)

- [ ] Source list with enable/disable toggles (`PATCH /api/sources/:name`)
- [ ] Add source form (name + URLs + scraping notes)
- [ ] Agent token management (create, view, revoke)
- [ ] Sync status display (`GET /api/sync/status`)
- [ ] Danger zone (delete account data)

### Phase 4 — Push Notifications (1-2 sessions)

- [ ] Set up `expo-notifications` (permissions, token registration)
- [ ] New endpoint or adapt `POST /api/push/subscribe` to accept FCM/APNs tokens alongside Web Push subscriptions
- [ ] Server-side: send native push via FCM/APNs when device type is native
- [ ] Notification tap → deep link to feed item or source filter
- [ ] Keep existing Web Push path working for PWA/web users

### Phase 5 — Styling & Design System (1-2 sessions)

- [ ] Port color tokens from `DESIGN_SYSTEM.md` to RN StyleSheet or NativeWind config
- [ ] Port typography scale
- [ ] Port component patterns (cards, tabs, buttons, inputs)
- [ ] Dark mode support (if applicable)
- [ ] Responsive layout for web (breakpoints via `useWindowDimensions`)

### Phase 6 — Offline & Caching (1 session)

- [ ] Configure `expo-updates` for OTA updates
- [ ] Local cache strategy for feed items (AsyncStorage or SQLite via `expo-sqlite`)
- [ ] Graceful offline state (show cached feed, queue read-state changes)

### Phase 7 — Web Compatibility Pass (1-2 sessions)

- [ ] Test all screens in browser via `npx expo start --web`
- [ ] Fix RN Web layout and scroll issues
- [ ] Verify responsive behavior at mobile/tablet/desktop widths
- [ ] Test push notification fallback on web (if supported)

### Phase 8 — Store Submission (1 session)

- [ ] iOS: Apple Developer account, provisioning profile, App Store Connect listing
- [ ] Android: Google Play Developer account, signing key, Play Console listing
- [ ] First EAS builds for both platforms
- [ ] TestFlight / internal testing track
- [ ] Submit for review

---

## Estimated Total: 12-18 Claude Code Sessions

Low end assumes accepting RN Web as-is. High end includes polishing web experience and handling edge cases.

## Human Involvement Required

These steps cannot be fully automated by Claude Code:

- **App store accounts**: Apple Developer ($99/yr) and Google Play ($25 one-time) registration
- **Signing credentials**: iOS provisioning profiles and Android keystore creation are interactive
- **Design approval**: RN doesn't map 1:1 to CSS — visual trade-offs need sign-off
- **Physical device testing**: Push notifications and native behavior require real hardware
- **Store review**: App Store and Play Store review processes

## Alternative Considered: Capacitor

If the goal is app store presence with minimal rewrite, Capacitor wraps the existing Preact PWA in a native shell. Much less work (~2-3 sessions), keeps the current frontend intact, but doesn't give true native UI. Worth reconsidering if the Expo rewrite feels too heavy.
