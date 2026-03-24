# Design System Document: The Editorial Intelligence

## 1. Overview & Creative North Star
**Creative North Star: "The Digital Curator"**
This design system moves away from the cluttered, "infinite scroll" anxiety of traditional aggregators toward a curated, high-end editorial experience. It is built on the principle of **Intelligent Quietude**. Instead of loud borders and aggressive shadows, we use "tonal architecture"—using subtle shifts in surface color and generous, intentional white space to guide the eye. 

The layout breaks the standard "boxed-in" mobile grid by utilizing asymmetrical type scales and overlapping elements, making the feed feel like a living, breathing digital magazine rather than a database.

---

## 2. Colors
Our palette is a study in sophistication, using a deep `primary` (#004555) to ground the intelligence of the brand against a breathy, architectural neutral base.

### The "No-Line" Rule
**Explicit Instruction:** Traditional 1px solid borders are strictly prohibited for sectioning. Boundaries must be defined solely through background color shifts. To separate a feed item from the background, place a `surface_container_lowest` card on a `surface` or `surface_container_low` background. 

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—like stacked sheets of fine, semi-translucent paper.
*   **Level 0 (Base):** `surface` (#f9f9fd) — The canvas.
*   **Level 1 (Sections):** `surface_container_low` (#f3f3f7) — For grouping related content blocks.
*   **Level 2 (Interactive Cards):** `surface_container_lowest` (#ffffff) — Reserved for the primary content cards to provide a "natural lift."

### Glass & Gradient Rule
To prevent a flat, "template" look, all floating elements (like bottom navigation bars or sticky headers) must use **Glassmorphism**: 
*   **Color:** `surface` at 85% opacity.
*   **Effect:** 20px Backdrop Blur.
*   **Signature Texture:** Primary CTAs should utilize a subtle linear gradient from `primary` (#004555) to `primary_container` (#0a5e72) at a 135-degree angle to provide a sense of depth and "soul."

---

## 3. Typography
The system uses a pairing of **Manrope** (Display/Headline) for a modern, geometric authority and **Inter** (Body/Label) for unparalleled legibility.

*   **Display (Manrope):** Use `display-lg` (3.5rem) with `-2%` letter spacing for editorial moments, like daily summaries.
*   **Headline (Manrope):** `headline-sm` (1.5rem) provides clear entry points for article titles.
*   **Body (Inter):** `body-md` (0.875rem) is the workhorse. Maintain a line height of 1.5x to ensure focus and reduce eye strain.
*   **Labels (Inter):** `label-sm` (0.6875rem) in `on_surface_variant` (#3f4949) is used for metadata (source name, timestamps), providing a clear hierarchy without competing with the content.

---

## 4. Elevation & Depth
We eschew traditional material elevation for **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by "stacking." A `surface_container_highest` element should only ever exist inside a `surface_container` or lower.
*   **Ambient Shadows:** For floating action buttons or modal sheets, use "Atmospheric Shadows."
    *   **Blur:** 32px to 48px.
    *   **Opacity:** 6% of `on_surface` (#1a1c1f).
    *   **Color:** Tint the shadow with 2% of the `primary` color to keep the shadows from looking "dirty."
*   **The Ghost Border Fallback:** If a container sits on an identical color background, use a **Ghost Border**: `outline_variant` (#bec8c9) at 15% opacity. 100% opaque borders are forbidden.

---

## 5. Components

### Cards & Lists
*   **Rule:** Forbid divider lines. Separate list items using `spacing-4` (1rem) of vertical white space or by alternating `surface` and `surface_container_low` backgrounds.
*   **Style:** Cards use `roundedness-xl` (0.75rem). The source logo should be placed in the top-left using a `surface_variant` circular container.

### Buttons
*   **Primary:** Gradient fill (Primary to Primary Container), `roundedness-full`, `body-md` (bold).
*   **Secondary:** Ghost style. No background, `outline_variant` Ghost Border (20% opacity), `primary` text color.
*   **Tertiary:** Plain text using `primary` color with `spacing-2` horizontal padding.

### Refined Filtering Chips
*   **State - Unselected:** `surface_container_high` background, `on_surface_variant` text. `roundedness-md`.
*   **State - Selected:** `primary` background, `on_primary` text. Add a subtle `primary_fixed` glow (shadow) to indicate the active filter.

### Feed Intelligence Indicators
*   **Component:** A small, vertical accent bar (2px wide) using the `tertiary` (#62330f) color placed to the left of "Recommended for You" headlines to denote AI-driven content without using "robot" icons.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical margins. For example, a headline might have a `spacing-8` left margin while the body has a `spacing-6`, creating an editorial "ragged" look.
*   **Do** use `surface_tint` at 5% opacity for large background areas to give the "white" a premium, paper-like quality.
*   **Do** prioritize high-contrast typography for legibility.

### Don’t
*   **Don't** use pure black (#000000) for text. Always use `on_surface` (#1a1c1f) to maintain a soft, premium feel.
*   **Don't** use standard 1px dividers. If you need a break, use a `spacing-px` (1px) height frame filled with `surface_container_highest` that only spans 60% of the container width (centered).
*   **Don't** use sharp corners. Every element must adhere to the `roundedness` scale to feel approachable and intelligent.