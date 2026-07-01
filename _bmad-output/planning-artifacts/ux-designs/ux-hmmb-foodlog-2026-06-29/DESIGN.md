---
title: hmmb-foodlog Design
status: final
created: 2026-06-29
updated: 2026-06-29
sources:
  - _bmad-output/planning-artifacts/prds/prd-hmmb-foodlog-2026-06-29/prd.md
colors:
  # Light mode
  bg: "#f7f9fb"
  card: "#ffffff"
  text: "#1a1c1e"
  muted: "#6b7280"
  border: "#e2e8f0"
  accent: "#0284c7"
  accent-light: "#e0f2fe"
  success: "#16a34a"
  warning: "#f59e0b"
  danger: "#dc2626"
  neutral: "#9ca3af"
  # Dark mode (prefers-color-scheme: dark)
  dark-bg: "#18181b"
  dark-card: "#232329"
  dark-text: "#f4f4f5"
  dark-muted: "#8b8b99"
  dark-border: "#3a3a46"
  dark-accent: "#2da6e4"
  dark-accent-light: "#0d2538"
  dark-success: "#4ade80"
  dark-warning: "#fbbf24"
  dark-danger: "#f87171"
  dark-neutral: "#71717a"
typography:
  font-stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  h1: "1.25rem / 700"
  h2: "1.05rem / 600"
  body: "0.95rem / 400"
  meta: "0.8rem / 400 in --muted"
rounded:
  radius-card: "12px"
  radius-input: "8px"
  radius-pill: "999px"
  radius-sm: "6px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-5: "24px"
  space-6: "32px"
shadow:
  shadow-card: "0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)"
components:
  tab-bar: sticky top, --bg fill, active tab --accent with 2px bottom border
  entry-card: --radius-card, 4px left border in confidence color, responsive photo column
  confidence-border: 4 classes mapping to --success / --neutral / --warning / --danger
  button-primary: --accent bg, white text, --radius-input
  button-link: no bg, --muted text, hover --text
  button-danger: no bg, --danger text only (no fill)
  chip: 1px --border border, --radius-pill; active bg --accent white text
  segmented-control: pill items --radius-pill; active --accent border + text + 600 weight
  photo-wall-cell: 1:1 aspect-ratio, cover fit, timestamp + kcal overlays on scrim; empty placeholder --border + icon
  photo-overlay-modal: full-screen rgba(0,0,0,.75) backdrop, 480px sheet, photo + food list
  mini-summary-bar: --card bg, 1px --border, --radius-card; macros left, 7 dots right
  tag-badge: pill, tag color bg, white or dark text by luminance
  day-separator: --muted label 0.8rem/600 with horizontal hairline
---

## Brand & Style

hmmb-foodlog is a functional personal health tracker built for daily operational use, not for marketing or onboarding. Hugo opens it every day to review what he has eaten; his nutritionist uses the read-only share link to monitor progress. The visual language serves data retrieval above all else: clear typographic hierarchy, confident use of the blue accent on exactly one primary action per screen, and generous breathing room around photos. The interface should feel calm and direct — a tool that gets out of the way. There is no dark mode toggle; the UI adapts automatically via `prefers-color-scheme` to honor the user's OS preference.


## Colors

### Light mode

`--bg` (`#f7f9fb`) is the page background — a very slightly cool off-white that keeps the viewport from feeling stark without competing with card surfaces.

`--card` (`#ffffff`) is the surface token used for all cards, modals, and the mini-summary bar. Pure white gives cards a lifted feel against `--bg` without requiring strong shadows.

`--text` (`#1a1c1e`) is the primary text color. Near-black, slightly warm, used for headings, food names, and any copy that must be read at a glance.

`--muted` (`#6b7280`) is the secondary text color. Used for timestamps, macro labels, metadata, and any text that supports rather than leads. All `meta`-size text uses `--muted` by default.

`--border` (`#e2e8f0`) is a light cool-gray used for dividers, chip outlines, photo placeholders, and the mini-summary bar outline. It carries no semantic meaning.

`--accent` (`#0284c7`) is the primary interactive color — sky blue. It marks the active tab, fills primary buttons, colors active chip and segmented-control states, and fills the tracked dots in the mini-summary bar. It must appear on at most one primary-action element per screen to preserve its signaling weight. Do not use it for decorative purposes.

`--accent-light` (`#e0f2fe`) is a pale tint of the accent used for low-emphasis accent fills, such as hover states on accent-adjacent areas or informational banners. It should never be used as body text.

`--success` (`#16a34a`) conveys high-confidence AI analysis. It appears exclusively as the left border color on entry cards with `conf-high` confidence and as a confirmation icon color.

`--warning` (`#f59e0b`) conveys low-confidence analysis. It is the left border color on `conf-low` cards and the color of the "near-limit" state on the 7-dot streak row.

`--danger` (`#dc2626`) conveys failed or zero-confidence analysis. It is the left border on `conf-zero` cards and the text color of destructive actions (button-danger). It is never used as a background fill.

`--neutral` (`#9ca3af`) conveys medium confidence (`conf-mid`). It is the left border color on cards where the AI analysis is present but not strong.

### Dark mode

Dark mode uses the D4 Neutral palette, activated automatically via `prefers-color-scheme: dark`. All token roles are identical to light mode; only the resolved values change:

| Token | Dark value |
|---|---|
| `--bg` | `#18181b` |
| `--card` | `#232329` |
| `--text` | `#f4f4f5` |
| `--muted` | `#8b8b99` |
| `--border` | `#3a3a46` |
| `--accent` | `#2da6e4` |
| `--accent-light` | `#0d2538` |
| `--success` | `#4ade80` |
| `--warning` | `#fbbf24` |
| `--danger` | `#f87171` |
| `--neutral` | `#71717a` |

Dark mode accent (`#2da6e4`) is slightly lighter than its light-mode counterpart to maintain contrast against dark card surfaces. Confidence colors shift to their higher-chroma variants so left borders remain readable on `--card` `#232329`. The `--accent-light` in dark mode (`#0d2538`) is a deep navy that functions as a tinted fill without glowing.


## Typography

The app uses the OS system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`) with no external font load. This delivers native rendering sharpness on every device Hugo uses, reduces network overhead, and matches the utilitarian design direction.

**H1 — `1.25rem / 700`** is used for section titles: screen headings (e.g., "Log", "Timeline", "Gallery"), and the date heading in the timeline view. There should be at most one H1 in the visible viewport.

**H2 — `1.05rem / 600`** is used for card-level titles such as meal name or photo overlay food-item headings. It provides visual distinction from body text without the weight of H1.

**Body — `0.95rem / 400`** is the default for all readable content: food item names, descriptions, notes, and modal text. Slightly below 1rem keeps density comfortable on mobile without shrinking to unreadable.

**Meta — `0.8rem / 400` in `--muted`** is used for all secondary and supporting data: timestamps, macro labels (`kcal`, `P`, `C`, `F`), confidence aria-labels, and day-separator text. It should never be used for primary content.

Line height defaults to browser `~1.5` for body and meta. Headings use tighter leading (`~1.2`) where vertically stacked siblings appear close together.


## Layout & Spacing

The app shell constrains to a maximum width of `720px` centered in the viewport, with `16px` horizontal side margins (`var(--space-4)`) on all screen sizes. On mobile viewports (under `480px`), margins remain `16px` so content does not press against edges.

The sticky header (tab bar) sits at the top of the viewport, `height: 48px`, with a `1px solid var(--border)` bottom hairline to separate it from page content. The header does not scroll with the page.

The primary content area begins immediately below the header. Vertical rhythm between major sections uses `var(--space-5)` (`24px`). Cards within a section use `var(--space-3)` (`12px`) vertical gap. Internal card padding is `var(--space-4)` (`16px`) on all sides.

The mini-summary bar is positioned directly below the header when present, inside the content column, not overlapping the sticky header.

On desktop (`>480px`), the entry card photo column is `flex: 0 0 200px` with the text column taking the remaining width. On mobile, the layout stacks: photo on top, text content below. No fixed heights are imposed on photo cells inside cards — the image drives height.

The spacing scale is strictly 4px-based. All gaps, padding, and margins must resolve to a multiple of `4px`.


## Elevation & Depth

The design uses minimal elevation. There is no layered shadow system, no drop shadows on interactive elements, and no blur-based depth. The only shadow token is `--shadow-card` (`0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)`), applied to cards and modal sheets to lift them off the page background. This single-level shadow keeps the interface flat enough to feel modern while allowing cards to read as discrete objects.

The photo overlay modal uses a full-screen backdrop (`rgba(0,0,0,.75)`) as the sole depth signal — no additional shadow is applied to the modal sheet itself beyond `--shadow-card`.

Borders carry more visual weight than shadows in this system. `1px solid var(--border)` defines component edges (mini-summary bar, chips, day separators). The 4px confidence left border on entry cards is the most prominent border weight in the UI and intentionally draws the eye first.


## Shapes

`--radius-card` (`12px`) applies to entry cards, the mini-summary bar, and the photo overlay modal sheet. It signals a container boundary and should be used only on block-level surface elements.

`--radius-input` (`8px`) applies to primary buttons and text inputs. Slightly less rounded than cards, signaling interactivity while distinguishing inputs from content containers.

`--radius-pill` (`999px`) applies to chips, tag badges, and segmented-control items. Full pill-rounding identifies these elements as filters and toggles — small, inline, selectable.

`--radius-sm` (`6px`) applies to small utility elements such as icon containers or inline badges at small sizes. It is the minimum radius that still reads as intentionally rounded.

No element uses `border-radius: 0`. The one exception is the confidence left border, which is a `border-left` property and therefore has no radius applied to it.


## Components

### Tab bar

| Property | Value |
|---|---|
| Position | Sticky top, full width, `height: 48px` |
| Background | `var(--bg)` |
| Bottom border | `1px solid var(--border)` |
| Tab text (inactive) | `var(--muted)`, body size |
| Tab text (active) | `var(--accent)`, `font-weight: 600` |
| Active indicator | `2px solid var(--accent)` bottom border on the active tab |
| Behavior | Tabs change the visible screen section; no scroll-based activation |

---

### Entry card

| Property | Value |
|---|---|
| Border radius | `var(--radius-card)` |
| Background | `var(--card)` |
| Shadow | `var(--shadow-card)` |
| Left border | `4px solid <confidence color>` (see Confidence border below) |
| Layout (desktop >480px) | Horizontal flex: photo column `flex: 0 0 200px`, text column fills remaining width |
| Layout (mobile <=480px) | Vertical stack: photo on top, text below |
| Reviewed state | No opacity change; a checkmark (✓) overlay appears on the card instead |
| Internal padding | `var(--space-4)` on all sides |

---

### Confidence border

The left border of every entry card communicates AI confidence at a glance. The numeric confidence value is exposed only in the element's `aria-label` for screen readers — it is not shown as a visible badge in the default card view.

| Class | CSS variable | Color (light) | Color (dark) |
|---|---|---|---|
| `conf-high` | `--success` | `#16a34a` | `#4ade80` |
| `conf-mid` | `--neutral` | `#9ca3af` | `#71717a` |
| `conf-low` | `--warning` | `#f59e0b` | `#fbbf24` |
| `conf-zero` | `--danger` | `#dc2626` | `#f87171` |

---

### Button — primary

| Property | Value |
|---|---|
| Background | `var(--accent)` |
| Text | White, body size, `font-weight: 600` |
| Border radius | `var(--radius-input)` |
| Padding | `var(--space-2)` vertical, `var(--space-4)` horizontal |
| Hover | Background darkens by ~10% |
| Disabled | Opacity `0.4`, cursor `not-allowed` |
| Usage | One per screen maximum; the single primary action |

---

### Button — link

| Property | Value |
|---|---|
| Background | None |
| Text | `var(--muted)`, body size |
| Hover | Text color transitions to `var(--text)` |
| Border | None |
| Padding | `var(--space-2)` vertical, `var(--space-3)` horizontal |
| Usage | Secondary navigation actions, cancel/dismiss, supplementary links |

---

### Button — danger

| Property | Value |
|---|---|
| Background | None |
| Text | `var(--danger)`, body size |
| Hover | Text opacity increases (becomes fully opaque if currently muted) |
| Border | None |
| Fill | Never filled — text-only destructive action |
| Usage | Delete entry, remove photo; always paired with a confirmation step |

---

### Chip

| Property | Value |
|---|---|
| Inactive | `1px solid var(--border)`, `var(--muted)` text, `var(--radius-pill)` |
| Active | Background `var(--accent)`, white text, `var(--radius-pill)` |
| Padding | `var(--space-1)` vertical, `var(--space-3)` horizontal |
| Font | Meta size (`0.8rem`) |
| Usage | Filter rows (meal type, date range, tags); multiple can be active simultaneously |

---

### Segmented control

| Property | Value |
|---|---|
| Container | Pill-shaped row, `var(--border)` background, `var(--radius-pill)` |
| Inactive item | `var(--muted)` text, no border |
| Active item | `border: 1px solid var(--accent)`, `color: var(--accent)`, `font-weight: 600` |
| Radius per item | `var(--radius-pill)` |
| Usage | Mutually exclusive mode selection (e.g., Day / Week / Month view toggle) |

---

### Photo wall cell

| Property | Value |
|---|---|
| Aspect ratio | `1 / 1` (square) |
| Image fit | `object-fit: cover` |
| Timestamp overlay | Top-right corner, white text on `rgba(0,0,0,.45)` scrim, meta size |
| Kcal overlay | Bottom-left corner, white text on `rgba(0,0,0,.45)` scrim, meta size |
| Empty state (no photo) | Background `var(--border)`, centered icon in `var(--muted)` |
| Interaction | Tap/click opens the Photo overlay modal |

---

### Photo overlay modal

| Property | Value |
|---|---|
| Backdrop | Full-screen, `rgba(0,0,0,.75)` |
| Sheet position | Centered, `max-width: 480px`, `border-radius: var(--radius-card)` |
| Sheet background | `var(--card)` |
| Photo | Fills full sheet width, `object-fit: cover`, displayed at top |
| Food list | Below the photo, inside the sheet, scrollable if needed |
| Close | Accessible close button in top-right of sheet with `aria-label="Close"` |
| Behavior | Clicking/tapping the backdrop closes the modal |

---

### Mini-summary bar

| Property | Value |
|---|---|
| Background | `var(--card)` |
| Border | `1px solid var(--border)` |
| Border radius | `var(--radius-card)` |
| Layout | Macros (`kcal`, `P`, `C`, `F`) on left; 7 streak dots on right |
| Macro text | Meta size, `var(--muted)` labels, body size values |
| Dot — filled | `var(--accent)` |
| Dot — warning | `var(--warning)` |
| Dot — empty | `var(--border)` |
| Placement | Inside the content column, below the tab bar |

---

### Tag badge

| Property | Value |
|---|---|
| Shape | Pill, `var(--radius-pill)` |
| Background | Tag's assigned color |
| Text | White or dark (`var(--text)`) chosen by computed luminance of the tag color |
| Font | Meta size |
| Usage | Attached to entry cards and filter chips; purely informational |

---

### Day separator (Timeline)

| Property | Value |
|---|---|
| Label text | Date string in `var(--muted)`, `font-size: 0.8rem`, `font-weight: 600` |
| Hairline | `1px solid var(--border)` extending full column width beside the label |
| Spacing | `var(--space-4)` vertical margin above, `var(--space-3)` below |
| Usage | Appears once per calendar day in the Timeline view to group entries |


## Do's and Don'ts

| # | Do | Don't |
|---|---|---|
| 1 | Use `--accent` only on primary interactive elements: active tab, primary button, active chip, filled streak dots. | Do not use `--accent` for decorative highlights, borders on non-interactive elements, or more than one primary button per screen. |
| 2 | Communicate confidence exclusively via the left border color of the entry card. | Do not show a floating confidence percentage badge in the default card view. |
| 3 | Use `--muted` for all secondary text: timestamps, macro labels, metadata, placeholder text. | Do not use `--muted` for primary readable content (food names, headings, important values). |
| 4 | Indicate reviewed state with a checkmark (✓) overlay on the card. | Do not reduce card opacity to indicate a reviewed state. |
| 5 | Provide `aria-label` with the numeric confidence value on the confidence border element. | Do not rely solely on color to communicate confidence — the aria-label is required. |
| 6 | Use icon buttons with a visible `aria-label` or an adjacent visible text label. | Do not use icon-only buttons without an accessible label. |
| 7 | Respect `prefers-color-scheme` automatically by scoping dark tokens in a `@media (prefers-color-scheme: dark)` block. | Do not add a manual dark mode toggle in the UI. |
| 8 | Let photos breathe — allow them to render at their natural aspect ratio in cards and at full sheet width in the overlay. | Do not crop or constrain photos with arbitrary fixed heights inside the overlay modal. |
| 9 | Apply shadow only via `--shadow-card` on cards and modal sheets. | Do not add shadows to buttons, chips, tabs, or other interactive elements. |
| 10 | Use gradients nowhere. | Do not add gradient fills to any surface, button, or background. |
| 11 | Use `border-left: 4px solid` for confidence borders on entry cards. | Do not use floating badges, icons, or color fills on the card body to communicate confidence. |
| 12 | Keep the spacing scale strictly on the 4px grid (`--space-1` through `--space-6`). | Do not introduce arbitrary pixel values (e.g., `10px`, `15px`) for margins or padding. |
