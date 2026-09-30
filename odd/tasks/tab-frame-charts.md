# Tab frame for chart widgets — ODD feature document

> ODD feature task (not SDD). Branch `feat/tab-frame-charts` from local `main` `9f01d25` (main checkout; the
> user's dev server serves it). Engram mirror `odd/tab-frame-charts/tasks`. Follows `odd/tasks/tab-frame-shape.md`
> (F1–F10, merged to local `main` by fast-forward on 2026-09-30 with the user's OK; push still the user's decision).

## Objective

Bring the "Pestaña" frame shape to the chart widgets that have a scale/period selector in their header
(`WidgetHeaderTemporalControls`): `trend-chart`, `trend-chart-v2`, `prod-trend`, `prod-history`, `activity-analytics`.
Today they keep the STANDARD frame even when Pestaña is selected (user decision of 2026-09-29).

## Problem and why

With the tab shape the title moves into the tab and the icon into the top strip; these widgets also carry the
scale selector in the header row, and it is not decided where it goes. The user wants to SEE and ADJUST alternatives
in the style lab before the app is touched (user, 2026-09-30).

## Alternatives to build in the style lab (proposed by the parent, accepted as the set to compare)

- **A — selector in the body**: stays in the body's first row, right-aligned (minimal change; the row is almost
  empty and takes height from the chart).
- **B — selector in the tab strip**: moves up to the top strip, right side, between the tab and the icon; the chart
  gains that row. Risk: narrow widgets truncate the title sooner. Parent recommendation.
- **C — second tab on the right**: selector + icon in a mirrored tab flush with the right edge, slanted side to the
  left. Most distinctive, most loaded.

Lab controls: A/B/C switch on a sample chart widget, plus spacing, selector height and widget width (narrow case).

## Constraints

- Lab first: no app code (`hmi-app/`) changes until the user picks an alternative in the lab.
- The lab is `tools/style-lab/style-lab.html` (+ `README.md`), published at
  https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8 (republish to the SAME url).
- Same tokens and rules as the accepted tab shape: tab height 25 px, cut 19 px (constant slope), fill white 15 %,
  text white 70 % -> 100 % on hover, icon pinned top-right at 90 %, body cut 0, radius from the preset.
- When the app is implemented: strict TDD (source: global user config), runner Vitest (`npx vitest run <file>` in
  `hmi-app/`); Estándar must stay exactly as today; tokens only.

## Tasks

- [x] **C1** — Style lab: sample chart widget (title, icon, scale selector, chart area) with the A/B/C switch and the
  adjustments; "Copiar elección" includes the chosen alternative and its values; README updated; republish. Done
  2026-09-30, commit `07cc7a3` (`feat(style-lab): ...`, +477/-17 in `tools/style-lab/style-lab.html` and
  `README.md`); republished to the same artifact URL (version 14). Route: delegated writer (preparation trigger).
- [x] **C2** — User compares in the lab and picks one (with values). DECIDED 2026-09-30: **alternative B** (selector in
  the tab strip, between the tab and the icon). The user first wrote "elijo la c" with a screenshot showing B selected;
  asked, the user confirmed "la B, me equivoqué". Values from the screenshot: selector style **Subrayado** (underline),
  gap **15 px**, selector scale **100 %** (23.5 px tall in the 25 px strip). The 480 px width is only the lab sample size.
- [x] **C3** — Implement alternative B in the app for the five chart widgets (`trend-chart`, `trend-chart-v2`,
  `prod-trend`, `prod-history`, `activity-analytics`). Route: delegated writer (writer trigger: 2+ non-trivial files).
  - [x] **C3a** — Frame infrastructure: the header's `trailing` content (the scale selector) is placed in the top strip,
    right side, left of the icon, with the chosen gap as a token; the title tab (and its truncating title) stops before
    it and is hidden cleanly when it cannot fit (lab rule: under 12 px of room); the body's header row no longer takes
    height when title, icon and trailing all live in the strip (the chart gains that row). Builder rings/ghosts and the
    viewer entrance keep following the silhouette.
  - [x] **C3b** — Roll out: `supportsTabFrame` covers the five chart widgets; each renderer uses `WidgetFrame`; with
    Pestaña the selector uses the `underline` variant (today `pill`; Estándar keeps `pill`).
  - [x] **C3c** — Docs (`docs/DESIGN_SYSTEM.md`, `WIDGET_AUTHORING.md` if it documents the header) and this document.
- [ ] **C4** — Live look, native review (RDD per work-unit commit), merge on the user's OK.

## Acceptance criteria

- C1: the lab shows the three alternatives on the same sample widget, switchable, at a narrow and a wide width, in
  rest and hover, and the copied summary names the alternative.
- C3 (to refine): with Pestaña, the five chart widgets take the tab shape with the chosen selector placement; with
  Estándar nothing changes; `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Delivery

Forecast: C1 ~300–500 authored lines in one HTML file (tooling, not app). C3 forecast after C2. Strategy
`ask-on-risk`. RDD on: work-unit commits assessed `--committed-only` from the last reviewed boundary (first boundary
`9f01d25`; the last reviewed boundary of the previous feature is `b35a532`, the commits after it are docs).

## Progress

- 2026-09-30: user accepted the tab shape live ("quedó perfecto"), asked for the chart widgets and agreed to compare
  alternatives in the lab; `feat/tab-frame-shape` fast-forwarded into local `main` (`9f01d25`) on the user's OK
  ("sí, hacé el merge"); push not done (the user's answer named only the merge). Read-only look at the header:
  `components/ui/WidgetHeader.tsx` (`trailing` slot) and `components/ui/WidgetHeaderTemporalControls.tsx` (pill /
  underline variants). Route for C1: delegated writer (preparation trigger: the lab file is ~92 KB and must be read
  before writing).

- 2026-09-30 C1 done (`07cc7a3`). Controls added (section "Gráfico con selector", remembered in the viewer's storage
  with the rest of the lab): alternative A/B/C, "Mostrar las tres juntas" (compare view, default on), selector style
  (píldora / subrayado), gap between strip elements (0-24 px, default 8), selector scale (70-110 %), sample width
  (220-720 px, shortcuts Angosto 280 / Ancho 560), title text, and "Restablecer la pestaña a los valores aceptados".
  Sample: title + dot, TrendingUp icon (24 px at 90 %, pinned top-right, right 0, top 0), selector with the real
  options 1h 24h 7d 30d 12m (uppercase, like `WidgetHeaderTemporalControls`), Y scale 0-100, dashed grid, line and
  area drawn in inline SVG from the measured plot box. It reuses the lab's layers, `shapePath` and tokens; alternative
  C adds `twoTabPath` (mirrored right tab, same slope and radius). B and C ignore the body cut (0); A honors it. With
  the Estándar shape the sample shows today's header (title, selector, icon in one row).
  Lab changes beyond the sample: `TF_DEFAULT` now holds the accepted app tokens (tab cut 19, body cut 0; was 15 / 37)
  and the tab cut scales with the tab height (constant slope, like `scaleTabFrameCut`) for ALL lab widgets; a viewer's
  stored tuning still wins (the reset button loads the accepted values).
  "Copiar elección" appends ` · Gráfico con selector | alternativa elegida: <rule of A, B or C in prose> | separación
  entre elementos de la franja: N px | selector: estilo píldora o subrayado, escala N % (alto ≈ H px, opciones ...) |
  ancho de la muestra: N px | título de la muestra: "..." | pestaña usada: alto, corte (definido a alto 25, pendiente
  constante), corte de cuerpo, ícono 24 px al 90 % pegado arriba a la derecha`, plus a note when Estándar is active.
  Verification: page script extracted and `node --check` OK; loaded in headless Chrome (real render, no script errors)
  with a scripted pass over A/B/C at 460 / 280 / 560 px, pill and underline, gap 8 / 16, Estándar shape, single view and
  the Contorno preset, checking selector, icon and tab rectangles, title truncation and path output; visual check by
  screenshots (rest, hover text, narrow, underline). Not verified: light theme (the lab is single dark by design), hover
  by a real pointer, alert states on the sample (none), phone width.
  Republish: succeeded, https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8 (version 14).

- 2026-09-30 Native review of C1 (slice `9f01d25..80366a5`, 5 files / 599 lines, tier medium, lens review-reliability,
  consent granted by the user on 2026-09-30): APPROVED and acknowledged, lineage `review-877de77ca63001ea`. Three
  advisory findings:
  - `R3-narrow-width-two-tab-degenerate`: fixed in `b066440`. The width slider minimum is now 280 (matches "Angosto")
    and the sample width never drops below what the strip needs for the selector, the icon and the gaps (computed from
    the measured selector width; worst case alternative C: cut + end padding + selector + icon + 2 gaps, 286 px at gap 24
    and scale 110; the readout shows "(mínimo)"). A title tab with less than 12 px of room is hidden (label
    `visibility: hidden`, silhouette without the title tab, body top-left corner stays convex) instead of being drawn
    under the selector or the second tab.
  - `R3-stored-cw-unvalidated`: fixed in `b066440`. `sanitizeCw` whitelists `alt` and `selStyle`, requires a boolean
    `compare`, clamps `gap` / `selScale` / `width` to the control ranges (numbers only) and falls back per field to
    `CW_DEFAULT` (a non-string title too).
  - `R3-stored-tuning-masks-accepted-defaults`: not changed on purpose. Stored tab tuning is the viewer's own; the
    reset button ("Restablecer la pestaña a los valores aceptados") stays the way to get the accepted values.
- 2026-09-30 Fix `b066440` (`fix(style-lab): keep the chart sample valid at narrow widths and validate its stored
  state`, +55/-12, `tools/style-lab/style-lab.html` only). Verification: extracted script `node --check` OK; headless
  Chrome with a scripted pass at slider 280, gap 24, scale 110 for A, B and C (width raised to 286, selector inside the
  card in all three, title tab hidden in B and C and visible in A, correct rounded silhouette) and at 280 with defaults
  (A and B show the title, C hides it); screenshot check of the minimum case; stored-state cases (invalid enums, string
  numbers, out-of-range numbers, non-string title, `cw: null`, a stored width of 220) all load clamped or defaulted with
  no script errors. Not verified: phone width (the card is capped at 100 % of the stage, so below the floor the title
  tab still degrades but the selector can overflow the card). Republished to the same URL, version 15.

- 2026-09-30 C3 done (delegated writer, strict TDD, Vitest; RED observed before each GREEN). Route: delegated writer
  (writer trigger: 2+ non-trivial files). TDD source: global user config; runner `npx vitest run <file>` in `hmi-app/`.
  Commits (work units, Conventional Commits, no attribution; GGA passed every one):
  - `2b5c22d` feat(theme): draw the tab frame silhouette without the title tab (87+/14-). RED: `tabFramePath` 3 failed / 25
    passed (no-tab path, vertices, `TAB_FRAME_TITLE_HIDDEN`), `GridSelectionFrame.tabFrame` 1 and
    `ViewerEntranceFrameOverlays.tabFrame` 1 failed (hidden title tab) -> GREEN 28/28 and 18/18.
  - `afc1a20` feat(theme): host the header trailing content in the tab strip (818+/42-; over the ~400 heuristic only through
    tests, ~470 of the lines; hook, pure util, frame, header, CSS and their tests share one behavior). RED:
    `tabFrameTrailing` module missing, `tabFrame.css.test` 6 failed / 18 passed, `WidgetFrame.trailing.test` 10 failed / 2
    passed, `WidgetHeaderTemporalControls` 1 failed / 7 passed -> GREEN (98 files / 967 tests in ui, hooks, utils, css).
  - `fa20c33` feat(widgets): trend-chart and trend-chart-v2 take the tab frame shape (300+/26-). RED: capabilities 5 failed
    (`supportsTabFrame`), `TrendChartWidget` 4 failed / 2 guards passed, `TrendChartV2Widget` 4 failed / 61 passed -> GREEN
    28/28 and 65/65.
  - `3e3099b` feat(widgets): prod-trend, prod-history and activity-analytics take the tab frame shape (334+/15-). RED:
    `ProdTrendWidget` 3 failed / 29 passed, `ProduccionHistoricaWidget` 2 failed / 23 passed, `ActivityAnalyticsWidget` 3 failed /
    152 passed -> GREEN 32/32, 25/25 and 155/155.
  - `2353d55` docs(theme): document the chart selector in the tab strip (5+/1-, `docs/DESIGN_SYSTEM.md`, `WIDGET_AUTHORING.md`).
  - Final commands (in `hmi-app/`, after the last code commit `3e3099b`): `npx tsc -b` exit 0; `npm run lint` exit 0; `npm test`
    258 files / 3377 tests passed (an earlier full run, before the docs commit, had only the known flaky `Topbar.test.tsx`
    "continues admin navigation immediately when runtime short is disabled" failing; it passed in this run);
    `npm run build` ok.
  - Tokens added (`index.css` `:root`): `--tab-frame-trailing-gap: 15px`, `--tab-frame-min-title: 12px`. No scaling token: the
    selector is at 100 %. In a real browser (headless Chrome, scratch page with the real components and `index.css`, not
    committed) the underline selector measured 22.5 px tall, centered in the 25 px strip (y 1.3 to 23.8).
  - Mechanism:
    - Trailing host: `WidgetFrame` renders `.hmi-tab-frame-trailing-host` as the FIRST child of the shell (keyboard reaches the
      selector before the chart; `surface + content` adjacency for the border reserve is untouched). `WidgetHeader` portals
      `trailing` into it (`TabFrameContext.trailingHost`); the host is absolute, `top: 0`, `right: --tab-frame-icon-right`, strip
      height, `align-items: center`, `pointer-events: none` with `pointer-events: auto` on its children, `display: none` while
      empty. When the icon occupies the strip the host keeps `padding-right: --tab-frame-icon-strip-extent` (scaled icon +
      `--tab-frame-trailing-gap`), so the gap selector-to-icon is the token and the icon is never covered.
    - Reserve: `hooks/useTabFrameStrip.ts` (layout effect + `ResizeObserver` on shell and host + style `MutationObserver`)
      measures the shell width and the host `offsetWidth` and calls the pure `utils/tabFrameTrailing.ts`
      (`resolveTabFrameTrailing`: reserve = max(icon reserve, right + host width + gap); `resolveTabFrameStripExtent`). The shell
      publishes `--tab-frame-tab-reserve` (overrides the CSS `:has` rule inline), `--tab-frame-icon-strip-extent` and
      `--tab-frame-header-clearance`, only when there is trailing content, so every other tab widget is exactly as before.
    - Hidden title: room = frame width - reserve - tab cut - pad start - pad end; under `--tab-frame-min-title` (only with
      trailing content and a measured frame) the shell sets `data-tab-title-hidden` (`visibility: hidden` on the tab) and the
      frame reports `TAB_FRAME_TITLE_HIDDEN` (-1; 0 stays "not measured yet"). `useTabFrameGeometry` maps it to
      `tabWidth: 0`, and `buildTabFramePath` with `tabWidth <= 0` starts at the body top line with a convex top-left corner, so
      the surface clip, border, glow, builder rings and ghosts and the viewer flash and outline agree (each has a test). A
      browser check at 460 / 300 / 220 px: tab 184 / 83 px wide and ~15 px before the selector, hidden at 220.
    - Header row: with `trailing` in the tab shape `WidgetHeader` renders only a `.hmi-tab-frame-header-clearance` spacer
      (height `--tab-frame-header-clearance` = tab height - content padding-top - border, measured on the content element,
      4 px for `p-5`) plus the subtitle row if any; title, icon and trailing live in the strip. `iconPosition="left"` now also
      takes the tab (icon at the top right) in the tab shape; the standard shape is untouched. Widgets without `trailing` keep
      the invisible spacer and icon placeholder ("content does not move").
    - Variant, ONE place: `WidgetHeader` wraps the portaled trailing in `TabFrameStripContext.Provider`;
      `WidgetHeaderTemporalControls` reads it and renders `underline` there whatever `variant` it was given. The five renderers
      still pass `variant="pill"` (Estándar unchanged, pill).
    - Roll out: `supportsTabFrame` includes the five types; each renderer is rooted in `WidgetFrame` (`glass-panel` as
      `frameClassName`, the rest of the class list as `className`, the parent's as `outerClassName`, so Estándar renders the same
      single element with the same classes; `data-*`, `ref` and `data-testid` pass through to the content element). Runtime-state
      roots of `prod-trend` and `activity-analytics` (`renderRuntimeState`) and both loading roots of `trend-chart` use it too.
  - Decisions/assumptions (adjustable in the live look): (1) `prod-history`'s loading root (no header) stays the standard frame
    in both shapes (a tab with no title would be empty), like KPI's skeleton. (2) The chart container keeps its own `-mt-1`, so
    with the 4 px clearance the chart container starts 4 px inside the strip (its own 8 px top margin keeps the drawn plot below
    the strip); not adjusted without seeing a real chart. (3) The strip elements use `--tab-frame-icon-right` as the shared
    right offset; `--tab-frame-body-cut` is NOT overridden for charts (the lab ignores it for B); the default 0 gives the lab
    layout, and a larger value moves the icon out of the strip and the selector then sits at the right edge. (4) The
    `Back to preset` button of trend-chart-v2 travels with the selector into the strip (its `rounded-md` accent look is
    unchanged). (5) `trend-chart-v2` always has a title (`||` fallback), so it is always eligible.
  - Needs the browser (live look, C4): real charts in Pestaña (the unit label and top adornments against the strip and the
    tab with the 4 px overlap of the container, the `prod-history` legend row right under the strip, `prod-trend` and
    `activity-analytics` with two selector groups (the widest strip, hides the title sooner), the runtime-state layouts
    with the collapsed header), hover and focus look of the underline selector on the strip, the builder (hover actions on
    the top edge over the selector, the hidden-title silhouette in selection rings and ghosts), the viewer entrance outline
    with a hidden title tab, and phone-width viewports.
  - Gap for the parent/user: none blocking. Visual tuning (overlap of the chart under the strip, selector height against
    other themes' `theme-button` fonts) waits for the live look.

## Follow-ups requested by the user on 2026-09-30 (same branch)

- [x] **V1** — Viewer entrance: a widget whose "Mostrar fondo y marco" option is off (`showFrame: false`; `status`,
  `connection-status`) must not animate a background flash or an outline when the viewer moves between dashboards.
  Cause: `DashboardViewer` only excluded `text-title`. Fix (route: parent inline, one file + its test + one doc line,
  TDD): `drawsGridFrame(widget)` = not `text-title` AND `resolveWidgetFrameVisible(getWidgetFrameOption(widget), 'grid')`;
  the staggered entrance of the widget itself is unchanged. RED 2 failed (status and connection-status frameless still
  got both overlays) -> GREEN 29/29 (`DashboardViewer.entrance.test.tsx`). `npx tsc -b` clean, `npm run lint` clean,
  `npm test` 258 files / 3381 tests passed, `npm run build` ok. Commit `6421d74`. Needs the browser: the live look.
- [x] **K1** — DONE 2026-09-30, commit `6a6e97d` (`feat(style-lab): add three finishes for the body's top-right corner
  under the header icon`, +260/-12 in `tools/style-lab/style-lab.html` and `README.md`), republished to the same artifact
  URL (version 16). Controls ("Remate de la esquina", remembered and validated on load): switch Actual / 1 · Escalón /
  2 · Esquina abierta / 3 · Ícono sobre la línea; Escalón: *profundidad* (= "Corte cuerpo", 0-60 px; picking Escalón with
  0 loads 16 and gives the 0 back on leaving it untouched) and *desplazamiento* (shelf width, 0-80 px); Esquina abierta:
  *desvanecer* (8-120 px); Ícono sobre la línea: *separación* (0-16 px). Applies to the five main sample widgets (alert
  card included) and the chart sample A and B (not C: its icon is inside its own tab). Implementation: Escalón is a
  path variant (`computeStep`, three vertices, slope = tab cut / tab height, same radius rules) so fill, border, glow
  and hover follow it; the icon stays in the strip above the shelf; the content is pushed down to sit 6 px below the
  shelf (header bottom margin in main widgets, body top padding in the chart) and the step is clamped against the title
  tab (+ radius), the widget height and, in B, the selector (diagonal cannot start left of the selector's right edge,
  which also caps the depth). Esquina abierta and Ícono sobre la línea are masks on the border layer only (radial fade
  centered on the body's top-right corner; a hole around the icon box widened by the gap, capped at the strip gap in B);
  the "line" icon is centered on the body's top line (18 px main icon, 21.6 px chart icon) and in chart A the body row
  moves down 6 px to clear it. Decisions: the chamfer of "Actual" (Corte cuerpo > 0) also applies to Esquina abierta and
  Ícono sobre la línea (closed silhouette "as today"); the icon of the main widgets stays at the top of the strip in
  Escalón (it does not drop onto the shelf). "Copiar elección" appends ` · Remate de la esquina | remate elegido: <rule>
  | <values>` (Escalón: profundidad = Corte cuerpo, desplazamiento, slope = tab's 19 / 25, vertices, limits; Abierta:
  largo del desvanecimiento; Línea: separación) and a note that C is not affected. Verification: extracted script
  `node --check` OK; headless Chrome with an isolated profile (`--user-data-dir` in the scratch directory) at window
  widths 1500 and 1000, each finish x rest/hover (widget hover state forced through the lab's control) over the five main
  widgets and chart A/B/C at 460 px, plus extremes (step 60 / 80 at chart width 300, depth 0), reading rectangles, path
  vertices, masks and content tops (no NaN, no script errors, content clear of the shelf, B diagonal right of the
  selector); screenshots of the three finishes; stored-state cases (garbage cf, missing cf) and the depth restore. Not
  verified: hover by a real pointer, the light theme, phone width, every preset (the finishes only touch shape code shared
  by all presets, checked with the default and by reading the code), the two alert kinds (only warning was rendered).
- Original brief of K1: alternatives for the finish of the body's top-right corner under the header icon (the user
  likes the icon, not the rounded corner under it). Options on the sample widget, next to "Actual" (today's rounded
  corner): (1) **Escalón** (the user's sketch): the cut is displaced to the left and a lower flat shelf runs from the
  diagonal to the right edge, where the icon rests; two controls: depth (the existing "corte del cuerpo") and
  displacement (shelf width; 0 = today's corner chamfer); the diagonal is parallel to the tab's slanted side; every
  vertex rounded with the preset radius. (2) **Esquina abierta**: the top and right borders fade out before the corner
  (adjustable fade length). (3) **Ícono sobre la línea**: the icon centered on the body's top line, the border
  interrupted around it (adjustable gap). "Copiar elección" names the alternative and its values. Route: delegated
  writer (the lab file is ~100 KB). No app change until the user picks.
- [ ] **K2** — User picks; then the app implementation is planned.
- Incident 2026-09-30 (no code change): the user saw black blocks on tab-frame widgets. Cause: the parent's
  `git checkout main` for the merge rewrote the working tree to the pre-feature tree and back while the dev server ran,
  leaving the page with new components and the old stylesheet (every black block was a default-size 300x150 `<svg>`).
  Restarting the launcher fixed it. Rules from now on: never switch branches in this checkout (fast-forward `main` by
  ref, `git push . <branch>:main`); headless browser checks use an isolated `--user-data-dir` in the scratch directory.

## C4 — Review and live tuning (2026-09-30)

- Review of `80366a5..f23ac5e` (lab fix + C3 + V1; 35 files / 1890 lines, medium, `review-reliability`; consent granted by
  the user via prompt): APPROVED and acknowledged (`review-5196731e3e85e1e5`, burned). Reviewed boundary `f23ac5e`.
  From 2026-09-30 the user gave STANDING consent for every RDD review (no more prompts; merge and push stay theirs).
  Advisory findings (none blocking), recorded, not fixed yet:
  - WARNING R3-trailing-strip-applies-to-every-tab-widget: `WidgetHeader` moves ANY truthy `trailing` into the strip in a
    tab frame (kpi, metric-card, info-card, group, machine-activity would lose their header row if they ever pass one);
    no test pins that those widgets pass no trailing.
  - WARNING R3-selector-wider-than-frame-unbounded: the trailing host is right-anchored, `max-content`, `nowrap`; a
    selector wider than the frame (two groups in prod-trend / activity-analytics, or selector + "Back to preset") extends
    past the frame's left edge and can intercept clicks of a neighbouring widget; `titleRoom` goes negative unhandled.
  - SUGGESTION R3-hidden-title-sentinel-unproved-consumers (-1 sentinel not tested through the reporter store / ghosts);
    R3-strip-reserve-two-pass-measure (reserve measured before the icon padding applies); R3-frame-title-duplicated-from-header
    (trend-chart / trend-chart-v2 recompute the frame title per call site); R3-test-global-stub-leak-on-failure
    (`WidgetFrame.trailing.test.tsx` unstub not in `afterEach`).
- [x] **C4a** — User live look: "las unidades y el gráfico se encima mucho a la pestaña y al selector, usa chrome control
  para arreglarlo". Measured in the control Chrome (CDP 127.0.0.1:9222, viewer scale 0.818): the strip ends 25 px below
  the frame top; the header clearance (25 - 20 padding - border = ~4 px) put the header bottom exactly on the body's top
  line and every chart container's `-mt-1` pulled the chart 4 px INTO the strip; charts draw at their very top edge (unit
  label on the line; trend-chart-v2 "min / max / avg" 3 px higher, under the selector). Fix (route: parent inline, TDD):
  new token `--tab-frame-strip-gap: 12px` added to the clearance in `hooks/useTabFrameStrip.ts` (25 - above + gap), so the
  content starts 8 px below the line and the topmost chart text 5 px below it. Previewed live with the value before
  coding; verified live after (prod-trend: svg top +8 px, top text +5 px, clearance 16.39 px). RED 2 failed
  (`WidgetFrame.trailing.test.tsx` clearance 4 -> 16, `tabFrame.css.test.ts` token) -> GREEN 37/37. `npx tsc -b` clean,
  `npm run lint` clean, `npm test` 258 files / 3381 tests passed, `npm run build` ok. Commit `7f22c58`.
- [x] **C4b** — DONE 2026-09-30 (user authorized the fix of the two review WARNINGs). Route: delegated writer (writer
  trigger: 2+ non-trivial files); strict TDD (source: global user config), runner `npx vitest run <file>` in `hmi-app/`.
  - **R3-trailing-strip-applies-to-every-tab-widget** (fixed): the opt-in is a capability next to `supportsTabFrame`,
    `supportsTabFrameTrailingStrip` in `utils/widgetCapabilities.ts` (`trend-chart`, `trend-chart-v2`, `prod-trend`,
    `prod-history`, `activity-analytics`). `WidgetFrame` decides it in ONE place and carries it to the header as
    `trailingPlacement` (+ `trailingBelowStrip`, `reportTrailingWidth`) in `TabFrameContext`. Any other tab widget that passes
    `trailing` keeps it in its header row with the row's height (invisible spacer, icon slot) and the strip publishes nothing for
    it. Tests pin it for kpi, metric-card, info-card, group and machine-activity (`WidgetFrame.trailing.test.tsx`).
  - **R3-selector-wider-than-frame-unbounded** (fixed): rule decided in `resolveTabFrameTrailing` (`utils/tabFrameTrailing.ts`,
    new `placement`): strip while right offset + (selector + icon extent) + one gap (`--tab-frame-trailing-gap`) <= frame
    width (boundary = fits), otherwise `body`. The header measures the INTRINSIC width on the trailing slot itself (`w-max`,
    `shrink-0`, same in the strip or the row) and reports it to the frame, so the decision is a pure function of the intrinsic
    width and the frame width: no hysteresis needed, no oscillation. In `body`: the selector sits right-aligned in the body
    header row (pill look, like the standard frame), the row starts under the strip (clearance + `--tab-frame-strip-gap`, no
    slot for the icon, which stays in the strip: the lab's alternative A), the row shrinks (`min-w-0`) and scrolls
    (`overflow-x-auto hmi-scrollbar`) so nothing renders outside the frame, the title tab is back to normal (standard
    reserve, never hidden by the selector, silhouette with tab) and the chart starts under that row. Unmeasured frame or
    content: strip, as before.
  - Commits (Conventional, no attribution; GGA passed each): `7d520c1` feat(theme): add the chart-only trailing strip opt-in
    and the strip fit rule (112+/4-, pure modules + tests); `75a873b` fix(theme): fall back to the body header row when the
    chart selector is wider than the frame (341+/58-, hook, context, frame, header + tests); `520c492` fix(theme): start the
    body row of a fallback chart selector under the strip (46+/15-); docs commit after this (DESIGN_SYSTEM.md,
    WIDGET_AUTHORING.md, this file).
  - RED/GREEN: `tabFrameTrailing` 6 failed / 10 passed -> 16/16; `widgetCapabilities` 13 failed / 27 passed -> 40/40;
    `WidgetFrame.trailing` 20 failed / 10 passed -> 30/30; after the row-under-the-strip adjustment 2 failed / 28 passed ->
    30/30. No CSS change (the stale-stylesheet rule did not apply).
  - Final commands (in `hmi-app/`, after the last code commit `520c492`): `npx tsc -b` exit 0; `npm run lint` exit 0;
    `npm test` 258 files / 3419 tests passed; `npm run build` ok.
  - Browser check (headless Chrome, isolated profile in the scratch directory, own debugging port, scratch page with the real
    components and `index.css`, deleted, not committed): one-group selector 165.8 px wide goes to the body row at frame width
    217 and back to the strip at 218 (live resize 700 -> 200 -> 700 -> 240..215 -> 700, stable after 6 more frames each time,
    no flip-flop); two-group selector (327 px) in 330 and 180 px frames falls back with the scroller inside the frame (21 px
    from the right edge, scrollWidth 343 > 130); title tab visible in both; kpi with trailing keeps it in its row (top 17 px,
    chart 60 px); strip case unchanged (selector 22.5 px tall, top 1.3 px, chart 37 px). Not verified: the real five renderers
    in the viewer/builder (only the shared frame and header), hover and focus look of the row selector, the builder hover
    actions over the row, phone-width viewports, real pointer scrolling of the row.
  - Decisions for the parent: (1) the fallback row also takes the strip gap (16 px clearance, row top ~8 px under the strip)
    instead of the plain header row position of the tab widgets, because at the plain position the pill straddled the body's
    top line; kpi-like widgets keep the old position. (2) One gap, not two, is kept to the frame's left edge in the fit test.
  - Review findings R3-trailing-strip-applies-to-every-tab-widget and R3-selector-wider-than-frame-unbounded are closed by
    this task; the SUGGESTIONs stay open.
- Dev server finding (reproduced): two writes to `hmi-app/src/index.css` within milliseconds leave the Vite dev server
  serving the first version of the stylesheet indefinitely (TS modules update); one later single rewrite refreshes it.
  This is the mechanism behind the black blocks incident (checkout + fast-forward in the same second). Rule: one write
  per CSS edit and check the served stylesheet afterwards.

## Next step

C3 and C4b done. Then C4: live look with the user (selector fallback in narrow widgets included), RDD per work-unit
commit (standing consent), merge on the user's OK. Separate pending user decision: push of `main`.
