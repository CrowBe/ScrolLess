# Pre-Release Tasks

This document is no longer the main hosted planning doc.

For hosted backend/server execution, use:
- `docs/HOSTED_BACKEND_PLAN.md`

This file should stay focused on release-readiness checks that are still useful outside the hosted execution plan.

---

## 1. Self-hosted release readiness

These are the highest-value remaining checks for the open-source self-hosted product.

### PWA Icons Missing

`src/icons/` contains only a README. `manifest.json` references `icon-192.png` and `icon-512.png` which do not exist. Without them the "Add to Home Screen" prompt uses a browser default icon and push notifications show no icon.

Generate or design two PNGs:
- `src/icons/icon-192.png` — 192×192
- `src/icons/icon-512.png` — 512×512

---

### Danger Zone / Data Deletion

Make sure local reset/deletion semantics match the actual runtime model.

What to verify or finish:
- any destructive UI clearly matches what is actually deleted
- local content deletion does not imply server-side feed deletion that does not exist
- preference reset behavior is explicit and reversible where appropriate

---

### Card Thumbnails Not Rendered

`thumbnail_url` is stored and returned in the API but none of the three card components display it. YouTube cards without thumbnails are significantly harder to scan.

Each card should render the thumbnail in its collapsed or relevant state:
- `youtube-card.tsx` — thumbnail left of title
- `news-card.tsx` — thumbnail in expanded state
- `x-card.tsx` — inline if `thumbnail_url` is set

---

### Saved Tab Empty State Copy

When the Saved tab is empty it should describe saved/bookmarked behavior, not initial sync behavior.

---

### Sync Status Per-Source Detail

The header widget shows a single "Synced X ago". If one source errored or stalled, this is invisible.

Add per-source sync detail in either:
- an expandable panel in `SyncStatus`, or
- the Settings screen

---

## 2. Cross-cutting release checks

### Preferences clarity

Ensure preference editing is visible, understandable, and consistent with actual agent/server behavior.

### Deployment confidence

Ensure the self-hosted deployment path remains clearly documented and tested enough to be trustworthy for real users.

### Architecture consistency

Before release, confirm:
- docs still match implementation
- relay-not-reader constraints still hold
- no new feature has turned the server into a plaintext feed-content store

---

## 3. Hosted note

Hosted launch readiness, hosted production-grade gaps, identity work, Postgres control-plane migration, encryption/privacy completion, billing, and operator concerns are all owned by:
- `docs/HOSTED_BACKEND_PLAN.md`

Do not rebuild a second hosted checklist here.
