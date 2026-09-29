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
- [ ] **F4** — Live look with the user and tuning. First live look 2026-09-29: "se ve todo muy bien", with
  the corrections in F5.
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
    the numeric inputs overlap their labels ("Grosor del cont[0.5]rno") — pending the user's OK to fix.

## Next step

Live look (F4) with the user on the F6 result (Instrumento 5 px, body cut 0, icon in the tab strip, tab stopping
before the icon, tab colors, alert glow, entrance; tokens above are the tuning knobs). Then the native review in smaller slices (the whole branch exceeds
the reviewer budget): one candidate per work-unit commit, from the F1 boundary `40ad436`.
