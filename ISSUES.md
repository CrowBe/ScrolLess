# ScrolLess — Issue Log

Two testing rounds against `main`. Screenshots for Round 2 are in [`screenshots/`](./screenshots/).

---

## Round 2 Issues (current — main @ 7a22c4b)

Tested: 2026-04-01 · Node 20 · Production build · AEDT (UTC+11)

---

### [BUG-R2-1] CRITICAL — Rate limit applies to all routes (`skipIf` not implemented in @fastify/rate-limit v9)

**Severity:** Critical

**Symptom:** After ~60 browser API calls the entire app breaks. Feed shows "No items yet", header shows "Sync unavailable". Unusable until the 1-hour rate-limit window expires.

**Root cause:**
`server/index.ts` registers `@fastify/rate-limit` globally with `skipIf: (req) => ...`. The `skipIf` option **does not exist** in `@fastify/rate-limit` v9.1.0 — it is silently ignored and the limit applies to every route including `/api/*`.

```bash
grep -c "skipIf" node_modules/@fastify/rate-limit/index.js
# → 0
```

**Reproduce:** Run the Playwright suite (12 tests × ~4 API calls each = ~48 requests); subsequent manual browsing immediately hits 429.

**Fix:** Register the rate-limit plugin only around agent/MCP routes via a scoped plugin:
```ts
await fastify.register(async (agentScope) => {
  await agentScope.register(fastifyRateLimit, { max: 60, timeWindow: '1 hour' });
  registerAgentRoutes(agentScope, db, pushCallback);
  registerMcpHandler(agentScope, db, pushCallback);
});
```

---

### [BUG-R2-2] CRITICAL — Vite proxy `/api/` still intercepts `src/api.ts` in dev mode

**Severity:** Critical (dev only — app completely broken in `npm run dev`)

**Symptom:** In dev mode, the Preact app does not boot at all. `src/api.ts` is proxied to port 3333 (Fastify), which returns 404 JSON. The JS bundle fails to load, leaving a blank page.

**Reproduce:**
```bash
npm run dev
# Navigate to http://localhost:5173
# → blank page, console: Failed to load resource: 404 /api.ts
```

**Root cause:**
The Round 1 fix changed the proxy key from `/api` to `/api/`. However, Vite's proxy matching treats `/api/` as a prefix for **any path that starts with `/api`** — including `/api.ts`. The trailing slash does not restrict matching to only paths with a subsequent slash.

Confirmed: `curl http://localhost:5173/api.ts` returns a response with `Mcp-Session-Id` header (Fastify, not Vite).

**Fix:** Use a regex key to anchor the proxy strictly to paths followed by a slash:
```ts
server: {
  proxy: {
    '^/api/': 'http://localhost:3333',
    '^/agent/': 'http://localhost:3333',
  }
}
```

---

### [BUG-R2-3] HIGH — `is_discovery=true` items leak into main Feed tab

**Severity:** High
**Screenshot:** `screenshots/01-feed-all.png` (`@ddevault` item with `is_discovery=true` visible in Feed)

**Reproduce:**
1. POST an item with `"is_discovery": true`
2. Open Feed tab → discovery item appears
3. Open Discover sub-tab → same item appears (correct)
4. Source filter badge counts 6 (correctly excludes discovery) but the card still renders in Feed

**Fix:** Add `AND is_discovery = 0` to the `/api/feed` query when serving the Feed tab. Accept `?discovery=true` to return only discovery items for the Discover tab.

---

### [BUG-R2-4] HIGH — No URL routing; `/settings` serves raw source in dev, 404 in prod

**Severity:** High

**Symptom (dev):** Navigating to `http://localhost:5173/settings` serves the raw transformed source of `src/settings.tsx` (Vite matches it as a module file).

**Symptom (prod):** Navigating to `http://localhost:3333/settings` returns 404 (Fastify has no route for it).

**Root cause:** The app uses component-state routing (`useState<View>`) — there is no URL router. Views are only reachable by clicking nav buttons. Bookmarking or sharing any view is impossible.

**Fix:** Add `preact-iso` (or hash routing) and map `/#/settings`, `/#/discover`, `/#/saved` to the corresponding views.

---

### [BUG-R2-5] HIGH — "Saved" tab always empty (no bookmark mechanism)

**Severity:** High
**Screenshot:** `screenshots/08-saved.png`

**Symptom:** Saved tab shows "No items yet" regardless of how many feed items exist. There is no save/bookmark button on any card.

**Root cause:** No `is_saved` field in `feed_items`, no save API endpoint, no UI control to save an item.

**Fix:** Add `is_saved INTEGER NOT NULL DEFAULT 0` to the schema, `PATCH /api/feed/:id/save` endpoint, a bookmark icon button on each card, and filter by `is_saved = 1` in the Saved view.

---

### [BUG-R2-6] MEDIUM — Sync timestamp shows wrong relative time (timezone mismatch)

**Severity:** Medium
**Screenshot:** `screenshots/01-feed-all.png` ("Synced 11h ago" immediately after seeding)

**Root cause:** SQLite `datetime('now')` stores UTC without timezone indicator (e.g. `"2026-03-31 11:31:41"`). `new Date("2026-03-31 11:31:41")` parses this as **local time** in JavaScript. On UTC+11, a sync at 11:31 UTC appears as "11h ago".

**Fix (server):** Use `strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` in schema defaults.
**Fix (client):** `new Date(ts.endsWith('Z') ? ts : ts + 'Z')` when parsing timestamps from the API.

---

### [BUG-R2-7] MEDIUM — Source names not capitalised in Settings

**Severity:** Low/Medium
**Screenshot:** `screenshots/10-settings.png` ("Youtube" instead of "YouTube")

**Root cause:** Source names are stored lowercase in `user_sources.name` and rendered directly with no display-name mapping.

**Fix:**
```ts
const SOURCE_LABELS: Record<string, string> = { youtube: 'YouTube', x: 'X', news: 'News' };
```

---

### [BUG-R2-8] LOW — Add Source form shows validation error on initial render

**Severity:** Low
**Screenshot:** `screenshots/11-add-source-form.png` ("Source name is required" shown before any interaction)

**Root cause:** Validation runs eagerly on mount rather than after first submit or field blur.

**Fix:** Only show errors after `submitted` state is true, or after the field's `onBlur` fires.

---

## Round 1 Issues (resolved in PR #11)

| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| R1-1 | Critical | Dev server blank — Vite proxy `/api` matched `src/api.ts` | ⚠️ Attempted fix (trailing slash) — see BUG-R2-2 for regression |
| R1-2 | Critical | Global rate limit broke PWA routes | ⚠️ Attempted fix (skipIf) — see BUG-R2-1 for regression |
| R1-3 | High | Default sources not seeded | ✅ Fixed |
| R1-4 | High | `blocked_sources` still seeded as preference key | ✅ Fixed |
| R1-5 | High | "Saved" tab non-functional | ⚠️ Carried over as BUG-R2-5 |
| R1-6 | Medium | Sync status endpoint missing | ✅ Fixed |
| R1-7 | Medium | Agent token management missing from Settings | ✅ Fixed |
| R1-8 | Medium | `tags` returned as string not parsed array | ✅ Fixed |
| R1-9 | Low | No confirmation on mark-all-read | ✅ Fixed |
| R1-10 | Low | Service worker not registered in dev | ✅ Fixed |

---

## Summary — Round 2

| ID | Severity | Title |
|----|----------|-------|
| BUG-R2-1 | 🔴 Critical | `skipIf` silently ignored — rate limit hits all routes |
| BUG-R2-2 | 🔴 Critical | Vite proxy `/api/` still intercepts `src/api.ts` — dev mode broken |
| BUG-R2-3 | 🟠 High | Discovery items leak into main Feed tab |
| BUG-R2-4 | 🟠 High | No URL routing — views not reachable by direct URL |
| BUG-R2-5 | 🟠 High | Saved tab empty — no bookmark mechanism |
| BUG-R2-6 | 🟡 Medium | Sync timestamps wrong on non-UTC machines |
| BUG-R2-7 | 🟡 Medium | Source names not capitalised ("Youtube" not "YouTube") |
| BUG-R2-8 | 🔵 Low | Add Source form shows validation error before interaction |
