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

- [x] **F1** — Setting + shape infrastructure: "Forma del marco" control in Tema (persisted like the other
  visual settings, overrides only, default Estándar), a way for components to know the active shape, tab/body
  geometry tokens, the tab + chamfered body + border overlay, applied first to `machine-activity`.
- [x] **F2** — Roll out to `kpi`, `metric-card`, `info-card`, titled `group`; charts and the other listed
  widgets stay standard.
- [x] **F3** — Builder and entrance follow the shape: selection frame, placement ghosts, hover actions,
  viewer entrance flash + outline.
- [x] **F4** — Live look with the user and tuning. First live look 2026-09-29: "se ve todo muy bien", with
  the corrections in F5; after F6 and the icon/entrance tuning the user accepted everything live
  ("todo lo que hicimos quedó perfecto", 2026-09-29).
- [x] **F5** — Corrections from the first live look (user, 2026-09-29). Outcome per item (commits `3febe44`,
  `e8a01c0`, `e4a07ef`):
  - [x] Tab colors, normal widgets. Decision history: first "white 40 % fill + title white 70 % / 100 % on hover";
    then user correction 1: reuse EXACTLY the standard title classes (`text-industrial-muted group-hover:text-white
    transition-colors`), no new opacity rule; then user correction 2 (final): tab FILL = white at 20 %
    (`--tab-frame-fill: color-mix(in srgb, #fff 20%, transparent)`), title keeps the standard behavior but through
    the tokens `--tab-frame-text` (`var(--color-industrial-muted)`) / `--tab-frame-text-hover` (`#fff`), applied
    with the same utilities (`text-(color:--tab-frame-text) group-hover:text-(color:--tab-frame-text-hover)
    transition-colors`), so the user can pick the final text color in the style lab in one place.
  - [x] Tab colors, metric-card in warning/critical: `data-alert-state` on the shell (from the `widget-state-*`
    class, follows the state live) sets `--tab-frame-fill` to the state color at `--tab-frame-alert-fill-opacity`
    (40 %); the title takes `text-status-warning|critical` (100 %, no hover change) through `TabFrameContext.alertState`.
  - [x] The data-mode dot keeps its meaning: real green (`text-status-normal`), simulated inherits the tab color
    (`--tab-frame-text`, the muted gray of the standard dot; visible on the 20 % tab and on the alert tab).
  - [x] Dot + title start further left: `--tab-frame-pad-start` 1.25rem -> 0.625rem, new `--tab-frame-gap` 0.375rem
    (was 0.5rem); vertical centering unchanged.
  - [x] One unified silhouette: `buildTabFramePath` rounds EVERY vertex (tab free corners, concave junction with the
    opposite arc sweep, both vertices of the body cut, bottom corners) with `--frame-radius-rest`; radius capped to
    half the shortest adjacent edge; inset (stroke rings) and outset (glow spread). Used by the surface clip
    (`clip-path: path()` inline, measured; the CSS polygon is only the pre-measure fallback), the border, the glow,
    the builder rings/ghosts and the entrance flash + outline. Rest border: kept on the BODY only (the tab strip is
    skipped with `clip-path: inset(var(--tab-frame-height) 0 0 0)`), as in the user's screenshot; it is an SVG
    stroke of the same path at 2x width under the surface clip. Limits: the radius is the rest radius (a preset
    whose hover radius differs does not animate the silhouette).
  - [x] Entrance outline never a rectangle. Root cause: the outline drew a `<rect>` (and the flash a full rounded
    rectangle) whenever the widget had not yet reported a tab width or the outline box had not been measured — the
    frame reported the width from a passive effect after the title-host ref state commit, then the geometry was
    measured in a second effect, so the first frames of every entrance (and any moment the width read as `null`)
    were the standard rect. Fix: `WidgetFrame` reports from the first layout pass (`0` = tab shape, width pending;
    `null` only for the standard shape/unmount); overlays and `GridSelectionFrame` draw NOTHING for a tab-shape
    widget until the unified path is measured; the polygon flash rule was replaced by the inline path clip.
  - [x] Warning/critical glow recovered: sibling layer BEHIND the surface (a `filter` on an ancestor would break
    the glass `backdrop-filter`): silhouette grown by `--tab-frame-glow-spread` (2px), `filter: blur(7px)` (= half
    the 14px box-shadow blur), state color at 20 % (28 % and blur 9px on hover), and an inline even-odd clip-path
    punches the silhouette out so only the outside survives, like a box-shadow. Approximation: the hover spread
    growth (2px -> 3px) is done with more blur/opacity, not a new path.
- [x] **F6** — Port the user's style-lab choice (2026-09-29, pasted "Copiar elección"; lab
  https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8, source `tools/style-lab/style-lab.html`). User decision:
  update the Instrumento preset (not a new preset).
  - Instrumento widget frame: radius 5 px rest AND hover (was 3), rest border 12 % (was 8), rest hidden accent
    length 25 px (was 20; thickness unchanged); everything else unchanged (hover fill 4 %, border 20 %, blur
    3/12 px, hover accent 8 px x 1 px white 60 %; buttons, container, icon buttons and tags identical).
  - Tab tokens (global): `--tab-frame-tab-cut: 19px` (was = height 25), `--tab-frame-body-cut: 0px` (was 50 —
    the body keeps NO chamfer), `--tab-frame-fill`: white 15 % (was 20), `--tab-frame-text`: white 70 % (was
    muted), `--tab-frame-text-hover`: white 100 % (unchanged), height 25 px, pad-start 10 px, alert 40 %/100 %
    unchanged. The silhouette radius is the preset radius (now 5 px).
  - Icon rule (from the lab): the header icon keeps a fixed distance from the widget's right edge (never past
    it); its preferred top is just below the body's top line; when the body cut is too small for the icon to fit
    inside the cut triangle, it moves up just enough (into the tab strip), never above the widget's top edge.
    With body cut 0 it sits in the tab strip at the right. The tab (and its truncating title) must then stop
    before the icon instead of running under it.
  - The silhouette/path generator must handle body cut 0 (degenerate vertices) everywhere it is used.
  - Outcome per item (commits `05df958`, `c8fc113`, `271317c`, `dd3e8eb`, `1a6698d`):
    - [x] Instrumento preset updated in place (radius 5 rest and hover, rest border 12 %, rest hidden accent 25 px;
      nothing else changed); tests and `docs/DESIGN_SYSTEM.md` follow.
    - [x] Tab tokens: tab cut 19px, body cut 0px, fill white 15 %, text white 70 %, hover text white 100 %; height,
      pad-start, alert 40 %/100 % and glow tokens unchanged; the title keeps `transition-colors`.
    - [x] Body cut 0: `buildTabFramePath` already merged the two coincident vertices (its dedupe of zero-length edges),
      so no code change was needed; characterization tests pin it (straight body top, 6 arcs with 1 concave, no NaN,
      inset/outset, tab spanning the width, glow clip). Every consumer derives from that generator, so the surface
      clip, border, glow, builder rings/ghosts and entrance flash/outline need no special case; the CSS polygon
      fallback stays valid (`calc(100% - 0px)`).
    - [x] Icon rule: pure `resolveTabFrameIconPlacement` (`utils/tabFrameIcon.ts`) = the lab's `placeIcon()`
      (`top = max(minTop, min(tabHeight + gap, tabHeight + bodyCut - right - 2*size - clearance))`, fixed right
      distance) plus the tab reserve. `useTabFrameIconPlacement` reads the tokens (no size dependency),
      `WidgetFrame` publishes `--tab-frame-icon-top` / `--tab-frame-icon-reserve` on the shell and renders an icon host;
      `WidgetHeader` portals the icon into the host and keeps an invisible same-size placeholder in the header row so
      nothing moves. CSS: `.hmi-tab-frame-icon-host` (absolute, `top`/`right` from tokens) and
      `.hmi-tab-frame:has(> .hmi-tab-frame-icon-host > *)` sets `--tab-frame-tab-reserve` so the tab `max-width`
      (`calc(100% - var(--tab-frame-tab-reserve, var(--tab-frame-body-cut)))`) stops before the icon (icon width +
      right distance + tab gap, or the chamfer if larger) only when the frame has an icon. The old
      `--tab-frame-icon-shift-x/y` tokens are removed.
    - [x] Estándar untouched (no standard-frame code path changed; full suite green); charts/excluded widgets stay
      standard; builder and entrance use the same generator and keep working.

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
- 2026-09-29 (F1–F3, delegated writer, strict TDD, Vitest; RED observed before each GREEN):
  - F1 `cc1450b` feat(theme): setting + shape infrastructure + machine-activity. Mechanism: Zustand
    `store/frameShape.store.ts` written by `services/frameShape.service.ts` (storage key `hmi-frame-shape`, override
    only, mirrored as `data-frame-shape` on `<html>`), read through `hooks/useFrameShape.ts`. Eligibility in ONE place:
    `supportsTabFrame` (`utils/widgetCapabilities.ts`) + `hooks/useTabFrameActive.ts` (shape tab + inside a dashboard
    grid `GridFrameScope` + eligible type + non-empty title). `components/ui/WidgetFrame.tsx` renders either today's single
    element (standard) or a shell with surface (glass classes clipped to the chamfered body + `.hmi-tab-frame-border`
    band), unclipped content and the tab (title portaled from `WidgetHeader`). RED: service (module missing), capabilities
    (`supportsTabFrame` not a function), WidgetFrame (modules missing), CSS text (9/11 failing), ThemeSettingsTab (10
    failing), MachineActivity tab test (4/6 failing with the widget reverted), grid scope in viewer/builder (failing
    with the wrapper reverted). GREEN: same files. GGA blocked the first attempt (state must live in Zustand, context
    beside the hooks, redundant inline colors, cast comment) and passed after the fixes.
  - F2 `9e9c187` feat(widgets): kpi, metric-card (state class stays on the surface), info-card, titled group. RED: 7/15
    failing in `widgets/renderers/tabFrameRollout.test.tsx` before the renderers used `WidgetFrame`.
  - F3 `5d98403` feat(builder): tab width reported per widget (`hooks/useTabFrameWidths.ts`, `TabFrameReporter`);
    `GridSelectionFrame` + placement ghosts trace `utils/tabFramePath.ts` paths (measured by
    `hooks/useTabFrameGeometry.ts`); hover actions sit `--tab-frame-height` lower; entrance flash clipped with CSS
    (`.hmi-viewer-entrance-flash-tab`), outline is a `<path pathLength="1">` sharing the rect's animated stroke rule.
    `HeaderSelectionFrame` unchanged: header-slot widgets never take the tab shape. RED: tabFramePath util, widths hook,
    GridSelectionFrame tab, overlays tab, viewer entrance wiring, builder tab tests (3/4 failing), CSS flash rule.
  - Fix `84ee23d`: content element reserves the frame border width (1px, 2px for warning/critical) so header/subtitle/
    footer do not sit 1px up-left of the standard frame.
  - Final commands (in `hmi-app/`): `npx tsc -b` clean; `npm run lint` clean; `npm test` 252 files / 3197 tests passed;
    `npm run build` ok (all rerun after the last commit `84ee23d`).
  - Not verifiable without a browser (F4): pixel match of the content positions, diagonal border crispness, hover/state
    colors, the entrance outline on the polygon, icon shift, tab text metrics, `box-shadow` glow of warning/critical
    (clipped by the chamfer clip-path in tab mode), and the top corner accents (clipped away in tab mode).
  - Token defaults (`index.css`, px CSS = screenshot px / 1.5): `--tab-frame-height: 25px`, `--tab-frame-tab-cut:
    var(--tab-frame-height)`, `--tab-frame-body-cut: 50px`, `--tab-frame-fill: #a9aaad`, `--tab-frame-text:
    var(--color-industrial-bg)`, `--tab-frame-pad-start: 1.25rem`, `--tab-frame-pad-end: 0.3rem`,
    `--tab-frame-icon-shift-x: 1.25rem`, `--tab-frame-icon-shift-y: 0.5rem`.
- 2026-09-29 parent: scale check — in `Desktop/00.png` the 6 CSS px data-mode dot measures 10 screen px
  (≈1.67 px per CSS px; the 24 px icon suggests ≈1.8), so the 37 px reference tab is ≈22 CSS px and the 75 px
  body cut ≈45 CSS px; the writer's 25 px / 50 px assumed 150 %. The control Chrome reports DPR 2 and the
  viewer also fits the dashboard to the window, so the final values are decided in the live look.
  RDD assess `40ad436..bc8fa45` (committed-only, `.gga` excluded): medium, 3030 lines / 42 files,
  `review_due` (`slice_budget_reached`); user GRANTED consent; START refused with
  `lens_context_budget_exceeded` (no authority created, nothing to abandon). Review pending as smaller
  candidates (e.g. one per commit: F1 `cc1450b`, F2 `9e9c187`, F3 `5d98403`, fix `84ee23d`) after the live
  tuning, so it covers the final code.

- 2026-09-29 (F5, delegated writer, strict TDD, Vitest; RED observed before each GREEN). Route: delegated writer
  (writer trigger: 2+ non-trivial files). User corrections received during F5 are recorded under the F5 items above
  (item 1 changed twice).
  - `3febe44` feat(theme): round every corner of the unified tab frame silhouette path (118+/56-). RED: 5/11
    `tabFramePath.test.ts` failing (old polygon output), then GREEN 11/11; consumers' tests stayed green because
    they compare against the generator.
  - `e8a01c0` feat(theme): unify the tab frame silhouette with rounded corners, alert glow and tab colors
    (450+/99-, over the ~400 heuristic: frame clip, border, fill, glow, colors and title share `WidgetFrame`,
    `index.css` and their tests, so they could not be split). RED: `tabFramePath` glow clip helper missing,
    `WidgetFrame.test.tsx` 7 failing (pending width, clip path, border svg, fill, glow, alert title), then
    `tabFrame.css.test.ts` 11 failing (tokens, surface, border, fill, alert fill, glow, tab), then the title
    classes 2 failing; GREEN for all after each step.
  - `e4a07ef` fix(theme): draw the rounded silhouette, never a rectangle, in the entrance and builder layers
    (164+/72-). RED: `ViewerEntranceFrameOverlays.tabFrame.test.tsx` 4 failing (flash path clip, no rect when
    the width is pending, no rect when the box is unmeasured, rect-to-path swap), `tabFrame.css.test.ts` 1 failing
    (polygon flash rule still present), `GridSelectionFrame.tabFrame.test.tsx` 1 failing (observed by stashing the
    implementation); GREEN afterwards; `tabFrame.silhouette.test.tsx` asserts the frame clip, border, flash,
    outline and rings all derive from the same generator and geometry.
  - GGA passed all three commits (advice only: header comment of `tabFramePath.ts` fixed, nested ternary in the
    overlays noted, a pre-existing informal-Spanish comment in `WidgetHeader.tsx` left).
  - Final commands (in `hmi-app/`): `npx tsc -b` clean; `npm run lint` clean; `npm test` 253 files / 3218 tests
    passed; `npm run build` ok (Tailwind emitted `text-(color:--tab-frame-text*)`; run after `e4a07ef`).
  - Not verifiable without a browser (needs the second live look): the visual rounding at the real preset radius
    (`1.5rem` on the default preset vs the ~4 px of the reference), the border gap where the body meets the tab
    (border starts at the tab base by design), the `blur` glow intensity vs the box-shadow of the standard alert
    card, the 20 % tab legibility with the muted title, the dot on the alert tab, and the entrance sequence.

- 2026-09-29 (F6, delegated writer, strict TDD, Vitest). Route: delegated writer (writer trigger: 2+ non-trivial files).
  - `05df958` feat(theme): update the Instrumento frame to the style lab choice (10+/10-). RED: `themeStyle.service`
    2 failing (preset values, persisted-preset radius) before the preset changed; GREEN 38/38. `c8fc113` test(theme):
    the Tema tab test pinned the old 3 px radius (1+/1-), found by the focused run after the commit.
  - `271317c` test(theme): silhouette without a body chamfer (41+). No RED possible: the generator already handled
    bodyCut 0 (characterization tests, 17/17 pass).
  - `dd3e8eb` feat(theme): add the tab frame icon placement rule (127+). RED: `tabFrameIcon.test.ts` failed on the
    missing module; GREEN 8/8.
  - `1a6698d` feat(theme): port the style lab tab tokens and place the header icon by rule (254+/40-, includes the docs).
    RED: 8 failing (`tabFrame.css.test.ts` 4: tokens, tab max-width, icon host, tab reserve; `WidgetFrame.test.tsx` 4:
    icon host + placeholder, top/reserve for body cut 0 / 50 / 100); GREEN 56/56.
  - GGA passed every commit (advice only: `WidgetFrame.tsx` header comment updated; `resolveAlertState` regex on the
    class name noted, unchanged).
  - Final commands (in `hmi-app/`): `npx tsc -b` clean; `npm run lint` clean; `npm test` 254 files / 3237 tests
    passed; `npm run build` ok.
  - Not verifiable without a browser (needs the live look): the icon position in the tab strip at the right with body
    cut 0 (vs the lab), the tab/title truncation against the icon with a long title, the 5 px rounding at the tab
    junction and bottom corners, the 15 % fill and 70 % text legibility, the 12 % rest border on the body only.

- 2026-09-29 token list after F6 (`index.css` `:root`): `--tab-frame-height: 25px`, `--tab-frame-tab-cut: 19px`,
  `--tab-frame-body-cut: 0px`, `--tab-frame-fill: color-mix(in srgb, #fff 15%, transparent)`,
  `--tab-frame-alert-fill-opacity: 40%`, `--tab-frame-text: color-mix(in srgb, #fff 70%, transparent)`,
  `--tab-frame-text-hover: #fff`, `--tab-frame-pad-start: 0.625rem`, `--tab-frame-pad-end: 0.3rem`,
  `--tab-frame-gap: 0.375rem`, `--tab-frame-glow-blur: 7px`, `--tab-frame-glow-blur-hover: 9px`,
  `--tab-frame-glow-spread: 2px`, `--tab-frame-icon-right: 7px`, `--tab-frame-icon-gap: 4px`,
  `--tab-frame-icon-clearance: 3px`, `--tab-frame-icon-min-top: 1px`, `--tab-frame-icon-tab-gap: 8px`
  (`--tab-frame-icon-shift-x/y` removed).

- 2026-09-29 token list after F5 (`index.css` `:root`): `--tab-frame-height: 25px`, `--tab-frame-tab-cut:
  var(--tab-frame-height)`, `--tab-frame-body-cut: 50px`, `--tab-frame-fill: color-mix(in srgb, #fff 20%,
  transparent)`, `--tab-frame-alert-fill-opacity: 40%`, `--tab-frame-text: var(--color-industrial-muted)`,
  `--tab-frame-text-hover: #fff`, `--tab-frame-pad-start: 0.625rem`, `--tab-frame-pad-end: 0.3rem`,
  `--tab-frame-gap: 0.375rem`, `--tab-frame-glow-blur: 7px`, `--tab-frame-glow-blur-hover: 9px`,
  `--tab-frame-glow-spread: 2px`, `--tab-frame-icon-shift-x: 1.25rem`, `--tab-frame-icon-shift-y: 0.5rem`
  (`--tab-frame-height/-tab-cut/-body-cut` still to be confirmed live, see the scale check).
- 2026-09-29 F4 live tuning (route: parent inline, 1-2 files each, TDD):
  - The user found the header icon slightly too big and touching the body line: pinned to the top-right
    corner with no margin (`--tab-frame-icon-right: 0px`, `--tab-frame-icon-min-top: 0px`) and scaled to 90 %
    toward that corner (new `--tab-frame-icon-scale: 0.9`, `transform-origin: top right`; the placement rule uses
    the scaled size, values rounded to 2 decimals). RED 4 (`tabFrame.css.test.ts`, `WidgetFrame.test.tsx`) ->
    GREEN 64/64; `npm test` 3237/3237. Commit `692f5ba`. User: "perfecto".
  - Entrance animation defaults set to the user's live values (outline 0.5 px at 40 %, flash 6 %):
    `DEFAULT_VIEWER_ENTRANCE_SETTINGS` + `index.css` tokens + `docs/DESIGN_SYSTEM.md`; tests that hardcoded the
    old saved flash value now use the constant. RED 2 -> GREEN 76/76; `npx tsc -b` clean, `npm run lint` clean,
    `npm test` 3238/3238. Commit `917cb83`.
  - Observed in the user's screenshot of Tema → "Animación de entrada": the three controls sit in narrow columns and
    the numeric inputs overlap their labels ("Grosor del cont[0.5]rno"). Fixed with the user's OK: one control per
    row (`flex flex-col`, like the other admin panels). RED 1 -> GREEN 65/65 (`ThemeSettingsTab`,
    `GlobalSettingsDialog`). Commit `7955394`.

## F7 — Group widget title as a tab (requested 2026-09-29, implemented 2026-09-30, live look pending)

- [x] **F7** — The `group` widget's title and icon adopt the same tab format as the other tab-frame widgets
  (they already get the tab when titled; this changes the title's TYPOGRAPHY and the tab's HEIGHT):
  - Title typography = exactly the `text-title` widget's typography and settings ("Texto" and "Tamaño", e.g.
    35), WITHOUT its "Alinear" and "Color" options (not needed for the group).
  - Tab fill and title color in rest/hover = the same as the other tabs (`--tab-frame-fill` white 15 %,
    `--tab-frame-text` white 70 % → `--tab-frame-text-hover` white 100 %).
  - The tab height grows with the title font size so the text always has an even breathing space above and
    below; the tab grows DOWNWARD, into the widget (the widget's outer height never changes; the body's top line
    moves down with it). The icon placement rule and the unified silhouette follow the taller tab.
  - Scope (decided by the user 2026-09-29): Pestaña stays the independent "Forma del marco" setting, combinable
    with any preset — NOT tied to Instrumento. F7 follows the same rule as the other tab widgets.
  - Property panel: the group's title needs the text-title "Tamaño" control (load the project skill
    `widget-property-panel` before touching property panels).
  - Outcome (delegated writer, strict TDD, Vitest; commits `8af3bc2`, `3a3ca55`, `b09d21f`, `12b32f8`):
    - [x] Typography: `utils/dashboardTitleTypography.ts` (`buildDashboardTitleTypography`, line height 1.1) is now the
      single source of the `text-title` typography (`TextTitleWidget` uses it; its tests stay green) and the group tab
      title uses it (font, weight, tracking from the `--font-dashboard-title`/`-weight-`/`--tracking-` tokens, `fontSize` px,
      no Alinear/Color). Colors, hover and `transition-colors` are the other tabs' (`--tab-frame-text` ->
      `--tab-frame-text-hover`); the data-mode dot rule is untouched. Decision (adjustable): the title is shown AS TYPED
      (no `uppercase`), like the `text-title` widget; the other tabs stay uppercase.
    - [x] Taller tab: token `--tab-frame-title-pad-y: 4.25px` (= (25 px - 11 px x 1.5 line box) / 2, i.e. the standard tab's
      spacing around the standard title). `resolveTabFrameHeight` (`utils/tabFrameHeight.ts`) = `max(--tab-frame-height,
      fontSize x 1.1 + 2 x pad-y)`; default 35 px -> 47 px; 12 px stays at 25 px. `WidgetFrame` takes `tabTitleFontSize`
      (only used while the frame is the tab shape), computes it with `hooks/useTabFrameHeight.ts` (tokens read from the
      document root, not the shell, to avoid feedback; re-measures on html style changes) and publishes it as the shell's own
      inline `--tab-frame-height`, so the fill, the border clip, the tab and the icon host follow with no CSS change. The
      title span carries `padding-top/bottom: var(--tab-frame-title-pad-y)` so `truncate` never clips ascenders/descenders.
      Outer size and content positions do not change (the tab overlays the widget's own space; the body line moves down).
    - [x] Mapping of every reader of the tab height (rg `tab-frame-height`): (1) `index.css` fill, border clip, tab (inside the
      shell: follow the inline override); (2) `useTabFrameGeometry` and `useTabFrameIconPlacement` (both now take an optional
      `tabHeight`, used by `WidgetFrame`); (3) OUTSIDE the shell, which cannot see the inline value: `GridSelectionFrame`
      (rings, also the placement ghosts through `PlacementGhostRect`), `ViewerEntranceFrameOverlays` (flash + outline) and the
      `BuilderCanvas` hover-actions offset (it read `var(--tab-frame-height)`). Fix: `TabFrameReporter(width, height?)` reports
      the effective height next to the width only when there is an own size (so every other widget reports exactly as before),
      `useTabFrameWidths` returns `heights`, and `BuilderCanvas`/`DashboardViewer` pass `tabHeight` to those layers
      (`resolveHoverActionsTop` builds the offset). Tests prove each consumer uses the taller height.
    - [x] Data and panel: `GroupDisplayOptions.titleFontSize?: number` (`domain/admin.types.ts`); default
      `DEFAULT_TEXT_TITLE_FONT_SIZE` (35), adjustable in the live look. `PropertyDock` General section shows the same
      "Tamaño" row as `text-title` (`DockFieldRow` + `AdminNumberInput`, min 12, max 200, `commitOnBlur`) for `group` only;
      no new primitive; it is always shown (it only takes effect while the frame is the tab shape).
    - [x] Estándar unchanged: no standard-frame code path changed (the prop, the context field and the reporter height are
      only used in the tab shape); tests assert the group in the standard shape keeps the uppercase body title, no inline
      height, and the other tab widgets keep the uppercase title, no height override and `report(width)` with one argument.
    - RED/GREEN: `dashboardTitleTypography` + `tabFrameHeight` (modules missing, 2 files failed) and `tabFrame.css.test` (1
      failed: pad-y token) -> GREEN 30/30 with `TextTitleWidget`; `WidgetFrame.test` 8 failed (height, floor, live, silhouette,
      icon top, reporter, typography, padding) -> GREEN 48/48; consumers 7 failed (`useTabFrameWidths` 3, `GridSelectionFrame` 2,
      `ViewerEntranceFrameOverlays` 1, `DashboardViewer` 1) + `BuilderCanvas` 3 failed (hover actions offset, rings, ghost) ->
      GREEN; `tabFrameRollout` 2 failed (group typography/size) and `PropertyDock` 2 failed (Tamaño default and persistence) ->
      GREEN.
    - Not verifiable without a browser (live look): how 47 px of tab looks at the default 35 px (tab, junction rounding,
      title truncation next to the icon); the tab cut (`--tab-frame-tab-cut: 19px`) is a fixed px, so a taller tab makes the
      slanted side steeper (decision for the live look: scale it with the height?); real font metrics of the title font
      against the 1.1 line height and the 4.25 px pad; the icon placement with the taller tab and body cut 0 (it sits in the
      strip at the top right); `uppercase` off; the real hover color transition.

## F8 — Fix two review findings (user authorized 2026-09-30, before the visual review)

- [x] **F8** — Fix R3-001 and R3-path-degenerate-geometry from the native review (advisory findings promoted to
  work by the user's explicit authorization). Route: delegated writer (writer trigger: 2+ non-trivial files).
  - [x] R3-001, invalid stored size. `normalizeTitleFontSize` (non-finite/non-number -> `DEFAULT_TEXT_TITLE_FONT_SIZE`
    35, finite -> clamped to [12, 200]) plus the shared `MIN_/MAX_TEXT_TITLE_FONT_SIZE` live in
    `utils/dashboardTitleTypography.ts` together with `DEFAULT_TEXT_TITLE_FONT_SIZE` (moved from `TextTitleWidget.tsx`:
    the lint rule `react-refresh/only-export-components` forbids exporting a function from a renderer file; the old
    importers now import from the util). `GroupWidget` passes the normalized size to `WidgetFrame`; `PropertyDock` uses
    the constants for the group and text-title inputs and shows the normalized size for the group; `resolveTabFrameHeight`
    never returns NaN (non-finite title/pad -> base height, non-finite base -> 0 floor). Decision: `TextTitleWidget` ALSO
    uses the normalizer (trivial, identical for every value the panel can produce, 12-200; only a corrupt or out-of-range
    stored value changes, from NaN/unbounded to the default/clamped). Left as is: the info-card `valueFontSize` input keeps
    its own literal `min={12} max={200}` (a different setting, not the title size).
  - [x] R3-path-degenerate-geometry, short group with a tall tab. Minimum body rule: `minBody = bodyCut + 2 x frame radius`
    (both from existing tokens/measurements, no new token); effective tab = `min(requested, shellHeight - minBody)`,
    floored at 0, by the pure `capTabFrameHeight` (`utils/tabFrameHeight.ts`). `useTabFrameHeight(titleFontSize, shellRef)`
    applies it (shell `clientHeight` + `border-top-left-radius` + body cut token from the root; ResizeObserver on the
    shell, next to the existing style MutationObserver; an unmeasured shell, height 0, is not capped). `WidgetFrame`
    publishes that one value as the inline `--tab-frame-height`, uses it for the silhouette and icon placement, and reports
    it through `TabFrameReporter`, so the CSS tab, the silhouette and the builder/entrance consumers agree.
    Defensive: `buildTabFramePath` clamps the chamfer to the box and the tab height to `height - bodyCut` (non-finite ->
    0), so no caller can fold the polygon. `.hmi-tab-frame-tab` gets `overflow: hidden` so a title taller than the capped
    tab is clipped vertically (the width was already `truncate`d). The cap applies only to a tab with its own size (the
    group); the standard 25 px tab and every other widget are unchanged (existing tests untouched and green).
  - Commits: `54157fb` fix(theme) normalize the stored title size and never publish a NaN tab height (120+/18-);
    `6b4c917` fix(theme) keep the silhouette valid when the tab is taller than the frame (62+/1-);
    `8da703b` feat(theme) cap the tab height to what the widget can give and clip its title (197+/16-, over the ~400
    heuristic only through tests: hook, frame, util and CSS share one behavior).
  - RED/GREEN (Vitest): commit 1 RED 9 failed / 27 passed in 3 files (`TextTitleWidget`, `tabFrameHeight`,
    `tabFrameRollout`: normalizer missing, NaN height, NaN group size) -> GREEN (75 files / 1145 tests after moving the
    normalizer tests to `dashboardTitleTypography.test.ts`). Commits 2-3 RED 16 failed / 91 passed in 4 files
    (`tabFramePath` 5, `tabFrameHeight` 4 `capTabFrameHeight is not a function`, `tabFrame.css` 1, `WidgetFrame` 6) ->
    GREEN 107/107.
  - Final commands (in `hmi-app/`, after the last code commit `8da703b`): `npx tsc -b` clean; `npm run lint` clean;
    `npm test` 256 files / 3299 tests passed; `npm run build` ok.
  - Needs the browser (visual review): a real short group (a few grid rows) with a large title size (e.g. 100-200): the tab
    should shrink to leave the body, the title must be clipped inside it with no spill, the icon must still sit sensibly,
    and the builder rings/ghosts and the viewer entrance outline must follow the capped tab; also that the cap re-applies
    when the widget is resized in the builder.
  - Review S6 (`688eed2..ea955e3`, 20 files / 493 lines, medium, `review-reliability`, consent granted in advance):
    APPROVED and acknowledged (`review-144b07bf90f4232a`, burned). Advisory findings handled by the parent (route: inline,
    2 mechanical files + tests, TDD):
    - R3-cap-stale-frame-element (WARNING) — refuted: `WidgetFrame` passes `titleFontSize = null` while not in the tab
      shape, so a shape switch changes the hook's dependency and the effect re-runs on the newly mounted shell.
      Characterization test added (`WidgetFrame.test.tsx`: cap after a live standard -> tab -> standard -> tab switch);
      it passed on first run (no RED possible, behavior already correct).
    - R3-textitle-panel-unnormalized (SUGGESTION) — fixed: the text-title "Tamaño" input shows `normalizeTitleFontSize(...)`,
      like the group. RED 3 failed (NaN -> 35, 500 -> 200, 4 -> 12) -> GREEN `PropertyDock.test.tsx` 102/102. Commit `5651f44`.
    - R3-resize-test-global-leak (SUGGESTION) — fixed: `vi.unstubAllGlobals()` moved to an `afterEach` of that describe.
      Commit `00406bd` (with the characterization test).
    - Final commands (in `hmi-app/`, after `00406bd`): `npx tsc -b` clean; `npm run lint` clean; `npm test` 256 files / 3303
      tests passed; `npm run build` ok.
    - RDD assess `ea955e3..00406bd` (committed-only, `.gga` excluded): medium, 36 lines / 3 files, `review_due` false
      (`under_budget`): pending in the slice from boundary `ea955e3`; no further review due now.

## Next step — EXACT RETURN POINT (session closed 2026-09-29)

State: branch `feat/tab-frame-shape` (main checkout, the user's dev server serves it), HEAD = the commit that
records this closeout on top of `ce94353`; working tree clean except the untracked `.gga` (never commit it).
Local `main` = `40ad436` (viewer entrance animation merged), 26 commits ahead of `origin/main`, NOT pushed.
F1–F6 done and accepted live; F7 implemented 2026-09-30 (commits `8af3bc2`..`12b32f8`), live look pending. Order agreed with the user:

1. F7 — group widget tab title (above). DONE in code (TDD, all four commands green); needs the live look (Pestaña selected,
   a titled group, "Tamaño" in the property panel) before the closeout steps.
2. Native review of the branch in slices (the whole branch, ~5500 lines, exceeds the reviewer budget —
   `lens_context_budget_exceeded`). Proposed slices from the F1 boundary `40ad436`: `..cc1450b` (F1, ~1600),
   `..84ee23d` (F2–F3), `..e4a07ef` (F5), `..3bece2f` (F6 + style lab), `..HEAD` (tuning + F7). Each slice end
   except HEAD is reviewed in a temporary git worktree checked out at that commit (sibling folder, e.g.
   `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\review-sN`, so the user's dev server is untouched), with
   `gentle-ai review status --cwd <worktree> ... --base-ref <previous slice end> --committed-only
   --untracked-scope=exclude --expected-untracked-inventory=<from status>`; relay each consent; acknowledge each
   approval; delete the worktrees afterwards (a CodeGraph daemon may lock `.codegraph/` files — see
   `backlog/leftover-worktree-cleanup` for the Restart Manager technique).
   User authorization (2026-09-29, new session): steps 1 and 2 run autonomously; the user GRANTED in advance the
   consent of every RDD review of this feature (native review slices included) and approves the sliced review.
   Steps 3 and 4 wait for the user's visual review.
   DONE 2026-09-30: all 5 slices APPROVED and acknowledged (see "Native review outcome" below); worktrees deleted.
   Then F8 (two findings fixed on the user's authorization) reviewed as S6, APPROVED; follow-up `5651f44`, `00406bd`
   under budget. NEXT: the user's visual review of F7 + F8 (Pestaña; titled group; "Tamaño"; a short group with a large
   size), then steps 3-4.
3. Fast-forward merge `feat/tab-frame-shape` into local `main` (only on the user's OK, after the visual review).
4. Push `main` to `origin` only when the user decides.

## Native review outcome (2026-09-30)

Every slice: risk medium, one lens (`review-reliability`), consent granted (user, in advance), APPROVED, exact
acknowledgement ran (authority burned). Reviewed in temporary worktrees at each slice end, committed-only.

| Slice | Range | Files / lines | Lineage |
|---|---|---|---|
| S1 | `40ad436..cc1450b` | 27 / 1622 | `review-a7710c7b729d12e9` |
| S2 | `cc1450b..84ee23d` | 33 / 1426 | `review-19c2678ab5977ce5` |
| S3 | `84ee23d..e4a07ef` | 16 / 1020 | `review-c0d8d81566e6607a` |
| S4 | `e4a07ef..3bece2f` | 17 / 1268 | `review-8b5b22694acbbc07` |
| S5 | `3bece2f..688eed2` | 38 / 1058 | `review-57890c968d9ed705` |

Advisory (non-blocking) findings, re-checked at HEAD `688eed2` by a read-only explorer (source + tests, not run):

- Real but niche (user-visible):
  - R3-path-degenerate-geometry (S2): `buildTabFramePath` does not guard `height < tabHeight + bodyCut`; with the F7
    taller group tab (size 200 -> ~228 px tab) on a short group the silhouette inverts/spikes.
  - R3-001 (S5): `GroupWidget` passes the stored `titleFontSize` unclamped/unvalidated; a non-numeric persisted value gives
    a NaN tab height (`--tab-frame-height: NaNpx`, NaN path). The UI input already limits 12–200.
- Latent / low: R3-frame-toggle-remount (S1: standard vs tab trees differ, subtree remounts on a shape switch);
  R3-token-parse-zero (S2: `parseCssLengthPx` accepts only px/rem, `calc()`/`var()` token overrides read as 0);
  R3-deferred-entrance-flash-mount (S3, partially: ~one commit of delay, never skipped); R3-pending-fallback-full-strip
  (S3, partially: full-width band only if the title host stays at width 0).
- Test/tooling quality: R3-hex-guard-loophole (S1, `tabFrame.css.test.ts` hex guard skips hex followed by `var`, stale
  test title); R3-radius-test-mocked (S2); R3-spy-leak-on-failure (S2, `WidgetFrame.test.tsx` no `afterEach` restore);
  R3-icon-placement-remeasure-untested (S4); R3-002 (S5, `useTabFrameHeight` re-measure untested);
  R3-stylelab-instrument-preset-stale (S4, `tools/style-lab` Instrumento still 3 / 8 / 20 vs app 5 / 12 / 25).
- Resolved at HEAD: R3-tab-hover-lost (S1: `.group:hover .glass-panel` reaches the surface inside the `group` shell);
  R3-icon-portal-inherited-style (S4: icon color is inline, `group-hover` still applies inside the shell).

R3-path-degenerate-geometry and R3-001 were fixed in F8 on the user's explicit authorization (2026-09-30); the rest stay out of scope without the user's decision (findings never expand scope by themselves).

- 2026-09-30 (F7, delegated writer, strict TDD, Vitest). Route: delegated writer (writer trigger: 2+ non-trivial files);
  the writer mapped every reader of the tab height first (`rg`, see the F7 item). Commits: `8af3bc2`
  feat(theme) tab title height rule + shared typography (110+/6-); `3a3ca55` feat(theme) grow the tab with a title that has its
  own size (323+/23-, over the ~400 heuristic only through tests: frame, header, hooks and their tests share one behavior);
  `b09d21f` feat(theme) builder and entrance layers follow the reported tab height (230+/27-); `12b32f8` feat(widgets) group
  tab title + Tamaño control + docs (107+/3-). GGA passed every commit (advice only: `min`/`max` 12/200 now repeated 3 times,
  could become `MIN_/MAX_TEXT_TITLE_FONT_SIZE`; `stroke="white"` in the tab hover ring copies the existing rect branch).
  - Token added (`index.css` `:root`): `--tab-frame-title-pad-y: 4.25px`. All other tokens unchanged.
  - Final commands (in `hmi-app/`, after the last code commit `12b32f8`): `npx tsc -b` clean; `npm run lint` clean;
    `npm test` 256 files / 3273 tests passed (one earlier full run failed 1 test in `Topbar.test.tsx` "continues admin
    navigation immediately when runtime short is disabled": it passes alone, in `src/components` twice and in the next full run;
    unrelated to this work, looks load-timing-dependent); `npm run build` ok.
