# PoC Build & Testing Gaps

Analysis of gaps in the build plan (TASKS.md) and testing coverage for the Proof of Concept phase.

---

## Critical Gaps

### 1. No test framework in project scaffolding

**Where**: Stage 1, Task 1.1 (dependency list and scripts)

Task 1.1 lists runtime and dev dependencies but omits any test runner. There is no `vitest`, `jest`, `@testing-library/preact`, or equivalent. The `package.json` scripts section has no `test` script.

**Impact**: Every acceptance criteria across all 11 stages can only be verified manually.

**Fix**: Add to Task 1.1:
- Dev dependencies: `vitest`, `@testing-library/preact`, `supertest` (or `light-my-request` since Fastify bundles it)
- Script: `"test": "vitest run"`, `"test:watch": "vitest"`

### 2. No automated tests for server modules

**Where**: Stages 2-6

The server has five core modules (`db.ts`, `auth.ts`, `agent-routes.ts`, `api-routes.ts`, `push.ts`) with well-defined interfaces, but none have unit or integration tests. The only "test" mentioned is Task 4.5 (dedup verification), which is described loosely as "a test or verification script."

**Fix**: Add test tasks to each stage:
- **Stage 2**: `server/__tests__/db.test.ts` — test `normaliseUrl()` (all variants), `hashUrl()`, `initDb()` (creates tables, seeds preferences), in-memory SQLite for speed
- **Stage 3**: `server/__tests__/auth.test.ts` — test `hashToken()`, `verifyAgentToken()` (valid/invalid/missing), `seedAgentToken()`
- **Stage 4**: `server/__tests__/agent-routes.test.ts` — test POST validation (missing fields, bad dates, empty items), dedup, rate limiting, cleanup function, using Fastify's `inject()` method
- **Stage 5**: `server/__tests__/api-routes.test.ts` — test feed filtering, pagination, read/unread toggling, stats accuracy, sync status
- **Stage 6**: `server/__tests__/push.test.ts` — test with mocked `web-push`, verify 410 cleanup, verify notification payload shape

### 3. No CI pipeline

**Where**: Not mentioned in any stage

No GitHub Actions, no pre-commit hooks, no lint or format tooling.

**Fix**: Add a lightweight CI stage (could be part of Stage 1 or a new Stage 1.5):
- `.github/workflows/ci.yml`: install, typecheck (`tsc --noEmit`), test (`vitest run`)
- Add `eslint` and a minimal config to dev dependencies
- Script: `"lint": "eslint server/ src/"`, `"typecheck": "tsc --noEmit"`

---

## Moderate Gaps

### 4. File layout mismatches between repo and docs

The current repo has files at the root that CLAUDE.md says should be nested:

| File | Current location | Expected location |
|------|-----------------|-------------------|
| `schema.sql` | `/schema.sql` | `/sql/schema.sql` |
| `schema.json` | `/schema.json` | `/skill/schema.json` |
| `ARCHITECTURE.md` | `/ARCHITECTURE.md` | `/docs/ARCHITECTURE.md` |
| `TASKS.md` | `/TASKS.md` | `/docs/TASKS.md` |
| `SKILL.md` | `/SKILL.md` | `/skill/SKILL.md` |
| `youtube.md` | `/youtube.md` | `/skill/platforms/youtube.md` |
| `x.md` | `/x.md` | `/skill/platforms/x.md` |
| `news.md` | (missing) | `/skill/platforms/news.md` |
| `config.example.json` | `/config.example.json` | (matches, but has agent-side shape, not server-side) |

**Impact**: Stage 1 (Task 1.4) will need to reorganise or the build steps will reference wrong paths.

**Fix**: Either restructure before Stage 1 or update Stage 1 to include file reorganisation.

### 5. `config.example.json` has wrong shape

The existing `config.example.json` has the agent-side schema (`server_url`, `platforms`, `scrape_timeout_seconds`). Task 3.3 expects the server-side schema (`agent_token_hash`, `db_path`, `server`, `push`, `rate_limit`).

**Fix**: Rename current file to `skill/config.example.json`. Create a new root `config.example.json` with the server-side shape from Task 3.3.

### 6. Push notification testing requires real infrastructure

Stage 6 acceptance criteria require push notifications to actually fire, but the test plan has no mock strategy for `web-push`.

**Fix**: In `push.test.ts`, mock the `web-push` module. Verify:
- `sendNotification` is called with correct payload shape
- 410 responses trigger subscription deletion
- Other errors are caught and logged (not thrown)

### 7. Service worker output path is unverified

Task 8.4 requires `sw.js` at the build output root, not hashed. This is easy to break silently with Vite config changes.

**Fix**: Add a post-build assertion (test or script):
```bash
test -f dist/client/sw.js || (echo "sw.js missing from build root" && exit 1)
```

### 8. Frontend has no component tests

Stages 7-8 define 10+ Preact components with no test coverage.

**Fix**: At minimum, add tests for:
- `src/__tests__/api.test.ts` — verify API client builds correct URLs, handles errors
- `src/__tests__/source-filter.test.ts` — verify filter state management
- `src/__tests__/feed-list.test.ts` — verify item rendering, load-more behaviour

---

## Minor Gaps

### 9. Edge cases not covered in acceptance criteria

- `POST /agent/feed-items` with empty `items: []` — should this return `{ inserted: 0, duplicates: 0 }` or 400?
- `normaliseUrl("")` or `normaliseUrl("not-a-url")` — documented as "return input unchanged" but never tested
- Extremely long URLs (>2000 chars)
- `published_at` in the future
- Duplicate `source_id` with different URLs (same video ID, different URL)
- Tags as empty array `[]` vs missing `tags` field

### 10. Rate limiting verification is impractical

Acceptance criteria say "Rate limiting kicks in after 60 requests/hour" but sending 61 real requests is slow. No strategy for testing with a lowered limit.

**Fix**: In tests, configure rate limit to 3 req/minute, verify the 4th request gets 429.

### 11. Cleanup function is coupled to scheduler

Task 4.4 wires cleanup into a 3:00 AM cron. The cleanup logic (`cleanupOldItems`) should be testable independently.

**Fix**: Ensure `cleanupOldItems` is exported and tested directly. The scheduler is a thin wrapper.

### 12. No `user_id` seam enforcement

CLAUDE.md states every query must include `WHERE user_id = ?`, but there's no automated check. A grep-based lint rule or code review checklist would catch regressions.

**Fix**: Add a grep-based CI check:
```bash
# Every SELECT/UPDATE/DELETE on feed_items, sync_log, push_subscriptions must include user_id
```

### 13. No database migration strategy

The schema uses `CREATE TABLE IF NOT EXISTS`, which works for initial setup but won't handle column additions or schema changes during PoC iteration. If the schema changes mid-build, existing databases won't be updated.

**Fix**: Document that during PoC, delete and recreate the database on schema changes. Or add a simple version check + migration runner.
