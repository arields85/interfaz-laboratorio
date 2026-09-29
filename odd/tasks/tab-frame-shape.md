# Tab frame shape — ODD feature document

> ODD feature task (not SDD). Branch `feat/tab-frame-shape` from local `main` `40ad436` (main checkout;
> the user's dev server serves it; local `main` is 26 commits ahead of `origin/main`, not pushed by user
> decision). Engram mirror `odd/tab-frame-shape/tasks`.

## Objective

Let the user try a new widget frame SHAPE and header structure, selectable in Configuración general → Tema
("Forma del marco": Estándar / Pestaña), without changing any widget's outer width/height or content layout.

## Problem and why

The user wants a more distinctive industrial look ("cambio de forma en el contenedor y reestructurado del
header") and wants to TRY it, so it must be switchable and reversible with one click.

## Reference (user screenshots `Desktop/00.png` current, `Desktop/01.png` target; 506x542, measured with PIL)

`machine-activity` widget, both images:
- Outer frame identical: x 13–471, y 47–518. Body fill (19,21,30) and border (34,37,44) identical.
  Bottom corners keep the same ~4 px radius.
- Target TAB: title moves into a light-gray tab (169,170,173) ≈ `#a9aaad`, flush with the widget's left edge
  (x 14), top y 48, bottom y 84 (≈37 px tall), dark text, dot drawn dark; the tab's right side is cut at 45°
  (x 287 at the top → x 323 at the bottom, +1 px per row). The tab has no visible border.
- Target BODY: top edge at y 85 (below the tab), from x 13 to ≈ x 396, then its top-right corner is cut at 45°
  from (396, 85) to (471, 160) (≈75 px chamfer); the border follows the diagonal.
- Icon (heart) moves into the cut-off top-right corner, outside the body (≈ x 436–472, y 92–120).
- Subtitle ("PRODUCIENDO" at y ≈ 123), ring gauge, main value and footer ("43.00 %") keep their positions.
- Current: title row inside the body at y ≈ 93 with a gray data-mode dot; icon inside top-right (x ≈ 418).

## User decisions (2026-09-29)

- Selectable option in Tema: "Forma del marco" with Estándar (today, default) and Pestaña. Global, combinable
  with the three theme presets (fill/border/blur come from the active preset).
- Widgets with period controls (`WidgetHeaderTemporalControls`: `activity-analytics`, `prod-trend`,
  `prod-history`, `trend-chart`, `trend-chart-v2`) keep the STANDARD frame even when Pestaña is selected.

## Working assumptions (stated to the user, adjustable after the live look)

- The data-mode dot keeps its meaning inside the tab: dark for simulated (as in the screenshot), green for real.
- Pestaña applies to titled widgets whose header uses the right-side icon: `machine-activity`, `kpi`,
  `metric-card`, `info-card`, and `group` when titled. Not covered in the first pass (standard frame):
  untitled widgets, `status`, `text-title` (no frame), `connection-status` (centered icon), `alert-history`
  (left icon + pulsing severity dot), header-slot widgets (72 px tall), and every non-grid use of `.glass-panel`
  (dialogs, pages, skeletons).
- The builder shows the same shape (WYSIWYG): selection frame, placement ghosts and hover actions follow it;
  the viewer entrance flash/outline follow it too.

## Constraints

- No change to outer width/height or content positions; purely visual.
- Opt-in class/attribute for the tab shape; do NOT change the base `.glass-panel` rule (dialogs/pages use it;
  `index.css.test.ts` asserts its text).
- A `clip-path` removes the CSS border along the diagonal: draw the border with an overlay (e.g. SVG polygon
  stroke) that also follows hover and warning/critical border colors.
- Tokens only: tab height, tab chamfer, body chamfer, tab fill and text colors as CSS custom properties with
  the measured defaults; no hardcoded colors in components; Lucide icons only.
- Default Estándar: a fresh install and users who never choose Pestaña see exactly today's frames.
- TDD strict (source: global user config), runner Vitest (`npx vitest run <file>` in `hmi-app/`).

## Tasks

- [ ] **F1** — Setting + shape infrastructure: "Forma del marco" control in Tema (persisted like the other
  visual settings, overrides only, default Estándar), a way for components to know the active shape, tab/body
  geometry tokens, the tab + chamfered body + border overlay, applied first to `machine-activity`.
- [ ] **F2** — Roll out to `kpi`, `metric-card`, `info-card`, titled `group`; charts and the other listed
  widgets stay standard.
- [ ] **F3** — Builder and entrance follow the shape: selection frame, placement ghosts, hover actions,
  viewer entrance flash + outline.
- [ ] **F4** — Live look with the user and tuning.

## Acceptance criteria

- With Estándar selected, every widget renders exactly as before (existing tests green).
- With Pestaña selected, covered widgets match the reference geometry at the same outer size; content
  (subtitle, value, gauge, footer) does not move.
- Charts and the other excluded widgets keep the standard frame.
- Border follows the diagonal cut in rest, hover and warning/critical states, in all three presets.
- Builder selection/ghosts and viewer entrance overlays follow the shape.
- `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Delivery

Forecast ~800–1200 authored changed lines (tests included). Delivery as in this repository's recent practice:
local branch, fast-forward merge to `main` only on the user's explicit OK after the live check; push is a
separate user decision. RDD on: work-unit commits assessed `--committed-only` from the last reviewed boundary
(first boundary `40ad436`).

## Progress

- 2026-09-29: reference measured from the user's screenshots; read-only mapping (delegated mapper): shared
  `components/ui/WidgetHeader.tsx`; data-mode dot is `AnalyticsDataModeDot` (real = green, simulated = gray);
  `.glass-panel` on each renderer root; `ThemeStyle` in `domain/themeStyle.types.ts`; builder
  `GridSelectionFrame`/`HeaderSelectionFrame`/`getWidgetCornerRadius`; entrance `ViewerEntranceFrameOverlays`.
  Route for F1–F3: delegated writer (writer trigger: 2+ non-trivial files).

## Next step

F1–F3 via one delegated writer, then F4 live look.
