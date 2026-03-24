# ScrolLess Design System

Translated from Stitch-generated files in `lumina_focus/DESIGN.md` and the five `scrolless_*/code.html` screens.

---

## Concept: "Intelligent Quietude"

A dark, editorial feed that reads like a curated magazine — not a database. Depth comes from tonal layering (color shifts), not borders or heavy shadows.

---

## Color Tokens (Dark Mode — CSS Custom Properties)

```css
:root {
  /* Surfaces — stack light-to-dark for depth */
  --surface:                  #121212; /* page background */
  --surface-container-low:    #1a1c1f; /* feed section backgrounds */
  --surface-container:        #1e2023; /* secondary sections */
  --surface-container-high:   #282a2d; /* chips (unselected), pill backgrounds */
  --surface-container-highest:#333539; /* highest-contrast UI elements */
  --surface-container-lowest: #0d0e11; /* deepest recesses */
  --surface-variant:          #3f4949; /* source icon containers */

  /* Brand */
  --primary:                  #4db6ac; /* teal — CTAs, active states, accents */
  --primary-container:        #004e5f; /* deep teal — gradient endpoint */
  --on-primary:               #003642;
  --on-primary-container:     #b4ebff;

  /* Secondary */
  --secondary:                #bbc8d5;
  --secondary-container:      #3c4853;
  --on-secondary:             #26323d;

  /* Tertiary (warm accent — AI/recommended indicator) */
  --tertiary:                 #ffb688;
  --tertiary-container:       #4a2800;
  --on-tertiary:              #ffffff;

  /* Text */
  --on-surface:               #e2e2e6; /* body text */
  --on-surface-variant:       #c0c8c9; /* metadata, timestamps, subtitles */

  /* Borders & Outlines */
  --outline:                  #899293;
  --outline-variant:          #3f4949; /* ghost borders at 10–15% opacity only */

  /* Error */
  --error:                    #ffb4ab;
  --error-container:          #93000a;
}
```

---

## Typography

```css
/* Import in index.html */
/* Manrope (headlines) + Inter (body/labels) */
@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap');

:root {
  --font-headline: 'Manrope', sans-serif;
  --font-body:     'Inter', sans-serif;
}
```

| Role | Font | Size | Weight | Notes |
|---|---|---|---|---|
| Display | Manrope | 3.5rem | 800 | `-2%` letter-spacing, editorial moments |
| Headline | Manrope | 1.5rem | 700 | Article/section titles |
| Title | Manrope | 1.125rem | 700 | Card headlines |
| Body | Inter | 0.875rem | 400 | Feed text, `1.5` line-height |
| Label | Inter | 0.6875rem | 500 | Source, timestamp metadata |

---

## Key Rules (Enforced Constraints)

- **No 1px borders.** Separate elements via background color shifts only. Ghost border (`--outline-variant` at 10–15% opacity) is the sole exception.
- **No sharp corners.** Radius scale: `0.75rem` (cards/chips), `9999px` (pills, avatars, FAB).
- **Glassmorphism** for all floating elements (sticky header, bottom nav): `background: rgba(18,18,18,0.85); backdrop-filter: blur(20px)`.
- **Tonal accent bar**: 2px wide, `--tertiary` color, left of AI-recommended headlines.
- **No pure black text.** Always use `--on-surface` (`#e2e2e6`).

---

## Elevation via Tonal Stacking

Cards sit on `--surface-container-low`, which sits on `--surface`. Never skip a level. Shadows only for floating/elevated elements:

```css
/* Card shadow */
box-shadow: 0 16px 32px rgba(0, 0, 0, 0.20);

/* Elevated card (hover) */
box-shadow: 0 24px 48px rgba(0, 0, 0, 0.30);

/* FAB / modal */
box-shadow: 0 16px 32px rgba(0, 0, 0, 0.50);

/* Primary CTA glow */
box-shadow: 0 4px 12px rgba(77, 182, 172, 0.30);
```

---

## Components

### Glassmorphism (Header & Bottom Nav)
```css
.glass {
  background: rgba(18, 18, 18, 0.85);
  backdrop-filter: blur(20px);
}
```

### Cards (3 types from feed design)
All share: `background: var(--surface-container-low); border-radius: 0.75rem; padding: 1.25rem`

- **Social (X/Twitter)**: Avatar circle + handle + timestamp header, inline media, engagement row
- **Discussion (Reddit)**: Subreddit badge, title, body preview, upvote pill
- **Editorial (News)**: Full-bleed hero image, source badge overlay, "N others reading" social proof

### Filter Chips
```css
.chip            { background: var(--surface-container-high); color: var(--on-surface-variant); border-radius: 0.75rem; padding: 0.625rem 1.25rem; }
.chip--active    { background: var(--primary); color: var(--on-primary); box-shadow: 0 4px 12px rgba(77,182,172,0.3); }
```

### Bottom Navigation (4 tabs: Feed, Discover, Saved, Settings)
- Fixed bottom, `glass`, rounded top corners (`border-radius: 24px 24px 0 0`)
- Active tab: icon in `--primary` filled circle, no label
- Inactive tabs: icon + label, `--on-surface-variant` color

### FAB
- Position: `fixed; right: 1.5rem; bottom: 6rem`
- `width: 3.5rem; height: 3.5rem; border-radius: 9999px`
- Background: `--primary`, icon: `add_comment` (Material Symbols)

### Editorial Accent Bar
```css
.accent-bar { width: 2px; height: 1.5rem; background: var(--tertiary); border-radius: 9999px; }
/* Appears left of section labels like "Daily Briefing" */
```

### Buttons
- **Primary**: `background: linear-gradient(135deg, #4db6ac, #004e5f); border-radius: 9999px; color: var(--on-primary)`
- **Ghost**: No background, `border: 1px solid rgba(63,73,73,0.2)`, `color: var(--primary)`

---

## Icons

Material Symbols Outlined. Import:
```html
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1" rel="stylesheet"/>
```
Use `font-variation-settings: 'FILL' 1` for active/filled states.

---

## 4 Screens

| Screen | Route | Key UI |
|---|---|---|
| **Feed** | `/` | Sticky header, filter chips, card feed (3 types), FAB |
| **Discover** | `/discover` | Search bar, bento grid (2-col featured + regular), trending topics |
| **Saved** | `/saved` | Category filter chips, read-only feed cards, saved icon filled |
| **Settings** | `/settings` | Avatar section, theme toggle, agent token, connected sources, danger zone |

Reference screens: `scrolless_*/screen.png`, markup: `scrolless_*/code.html`
