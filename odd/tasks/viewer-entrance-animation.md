# Viewer dashboard entrance animation — ODD feature document

> ODD feature task (not SDD). Branch `feat/viewer-entrance-animation` from `main` `b18cb82`
> (main checkout; the user's dev server serves it). Engram mirror `odd/viewer-entrance-animation/tasks`.

## Objective

When a dashboard appears in the VIEWER, it assembles itself with motion instead of appearing all at
once: widget frames appear staggered in random order while bar/ring gauges fill from zero and chart
series draw in, up to their current values. The animation doubles as a visual preload: it never
delays data loading or display.

## Problem and why

Today a dashboard pops in statically. The user wants the UI to feel more alive ("dinámica, con vida")
without losing speed.

## User decisions (2026-09-29)

- Replays EVERY time a dashboard is entered, including switching dashboards and switching views
  of the same dashboard. Periodic data refreshes (5 s poll) never replay it; values keep gliding
  to new values as today.
- Timing is NOT fixed at "under 1 s": every duration/window/easing lives in ONE place so it can be
  tuned live with the user until it looks right.
- It works as a preload: data queries start immediately exactly as today; the animation runs in
  parallel, CSS-only. If a value is already there, it grows once its frame appears; if it arrives
  mid-animation, it grows when it arrives.
- KPI numbers counting up from zero: initially out of scope; requested by the user on 2026-09-29 (V8).
- `prefers-reduced-motion`: no entrance animation.

## Scope

- Viewer grid (`hmi-app/src/components/viewer/DashboardViewer.tsx`) entrance + replay per entry.
- Gauges (`hmi-app/src/components/ui/GaugeDisplay.tsx`: bar and ring) value draw-in.
- Chart widgets drawn with custom SVG: `trend-chart`, `trend-chart-v2`, `prod-history`,
  `prod-trend`, `activity-analytics` — series draw-in left to right.
- Header widgets keep their existing entrance (`HeaderWidgetCanvas`, `hmi-header-widget-entrance`);
  coordinate so both start together.
- Out of scope: admin builder (must NOT animate), KPI count-up, data layer changes.

## Constraints

- Read-only HMI; no data-layer or query timing changes; the animation must never gate rendering.
- Scope all entrance CSS under the viewer so the builder canvas never animates.
- Tokens only (no hardcoded values in components); timings as CSS custom properties in
  `hmi-app/src/index.css` (one block), easy to tune.
- Must work identically for the three theme presets (Clásico, Contorno, Instrumento): animate the
  item wrapper / value elements, never the `--frame-*` tokens (they carry hover transitions).
- Existing tests that read final inline widths/dashoffsets synchronously must keep passing
  (animate with keyframes that end at the element's own inline value, e.g. `from`-only keyframes).
- A group container must appear no later than its members.
- TDD strict (source: global user config), runner Vitest (`npx vitest run <file>` in `hmi-app/`).

## Tasks

- [x] **V1** — Frame entrance: timing tokens block in `index.css`; per-entry replay key (dashboard id
  + active view); random stagger (shuffled order per entry, delay via CSS variable); group
  container before its members; reduced-motion off switch; builder unaffected.
- [x] **V2** — Gauge value draw-in: bar fills from zero, ring fills from empty, to the current value;
  starts after its frame; late data grows when it arrives; refreshes do not replay.
- [x] **V3** — Chart draw-in for the five SVG chart widgets (left-to-right reveal of lines, areas and
  bars), same timing tokens.
- [x] **V4** — Live tuning with the user (timings/easing) and live acceptance. Accepted 2026-09-29
  ("quedó perfecto") after the white/1 px outline and white flash (`b2df231`) and the Tema controls (V9).
- [x] **V5** — Review advisories (lineage `review-e44eea326a8f700c`, non-blocking): R3-frame-key-remount
  (WARNING: a view switch remounts every widget subtree — check widget-local state and mount-time
  fetches, add a test), R3-orders-frozen-per-key, R3-unscoped-guard-partial, R3-dashboard-wiring-untested
  (SUGGESTIONS). Evaluate after V4 so tuning and fixes share one pass. PARTIALLY CLOSED 2026-09-29:
  R3-unscoped-guard-partial (the builder-safety guard now covers every `.hmi-viewer-*` rule, see V6-V8
  progress); the other three advisories stay open. Added from the second review (lineage
  `review-342fb7268bd30b70`, non-blocking): R3-late-value-zero-flash (WARNING, visible bug: a first value
  arriving AFTER the entrance window renders as 0 for one painted frame because progress jumps to 1 in a
  passive effect — `useViewerEntranceCountUp.ts:40-65`; fix synchronously, e.g. derive the settled state
  during render or use a layout effect, and cover it with a test that inspects the first committed text)
  and R3-countup-restart-on-hasvalue-toggle (SUGGESTION: a hasValue true→false→true toggle mid-count
  restarts a full-duration count — `useViewerEntranceCountUp.ts:67-84`). Added from the third review
  (lineage `review-5db18b108b9679a6`, non-blocking): R3-combined-dirty-untested (SUGGESTION: test preset
  change + dirty slider together in `ThemeSettingsTab.tsx:129`) and R3-stored-values-not-snapped
  (SUGGESTION: snap stored overrides to the step on read, `viewerEntranceStyle.service.ts:44-48`).
  NOT ADOPTED: R3-outline-opacity-fade-only (WARNING) — refuted by the code: the outline rect uses
  `animation-fill-mode: backwards, backwards` (`index.css:855`), so the fade's `from` keyframe (the opacity
  token) already applies during its delay, i.e. through the whole draw phase; the line is drawn at the
  configured opacity, no pop. A test asserting that fill mode would still be a cheap guard.
  RESOLVED 2026-09-29 (per advisory): R3-late-value-zero-flash FIXED; R3-countup-restart-on-hasvalue-toggle
  FIXED; R3-orders-frozen-per-key FIXED; R3-stored-values-not-snapped FIXED; R3-dashboard-wiring-untested
  TEST-ONLY; R3-combined-dirty-untested TEST-ONLY; R3-outline-opacity-fade-only REFUTED with a guard test;
  R3-frame-key-remount FINDING REPORTED with a proving test (no state loss or refetch added by the key, see the
  V5 progress entry); R3-unscoped-guard-partial was closed earlier.
- [x] **V6** — Frame background flash (user feedback 2026-09-29 after the first live look: "mucho mejor,
  más dinamismo"): on entrance each frame's background flashes/blinks — a brightness overlay above the
  fill peaks and decays to the theme's rest look; visible in all three presets (correction 2026-09-29,
  verified in `themeStyle.service.ts:174-189`: Instrumento's rest frame has a 5 %→1 % white gradient base,
  3 px blur and an 8 % border; only its extra fill layer is 0 %).
- [x] **V7** — Frame outline draw-in: a line traces the frame perimeter (following its corner radius) and
  then blends into the theme's own border (all three presets have a rest border; Instrumento's is 8 %).
- [x] **V8** — Numbers count up from zero to their value on entrance (main values of `kpi`, `metric-card`,
  `machine-activity`, keeping each widget's decimals and unit); viewer-only, entry-only (refreshes keep
  today's behavior), reduced motion shows the value directly. Reverses the earlier "out of scope" note.
- [x] **V9** — Admin controls (user request 2026-09-29, during V4 tuning): a new "Animación de entrada"
  section in Configuración general → Tema with three sliders, each showing its value, persisted like the
  rest of the visual configuration and global to the three presets: outline thickness 0.5–3 px (current
  1 px), outline opacity 0–100 % (the animated white line, NOT the theme's rest border; current 100 %,
  needs a new token), flash intensity 0–50 % (current 16 %). Changing a dashboard replays the entrance to
  preview. Live tuning so far (commit `b2df231`): outline white `#ffffff` and 1 px, flash white `#ffffff`.

## Acceptance criteria

- Entering a dashboard (or switching dashboard/view) replays the entrance; a 5 s refresh does not.
- Data requests are issued at mount exactly as before (no added await/gate).
- Reduced motion shows the dashboard without animation.
- Builder canvas shows no entrance animation.
- All three theme presets look correct during the entrance.
- `npx tsc -b`, `npm run lint`, `npm test` green.

## Delivery

Forecast ~500–800 authored changed lines (tests included). Delivery follows the practice used in this
repository during this session: local branch, fast-forward merge to `main` and push only on the
user's explicit OK after the live check; no PRs are opened. RDD is on: each work-unit commit is
assessed (`--committed-only`, base = last reviewed boundary, first boundary `b18cb82`).

## Progress

- 2026-09-29: feature document created; exploration done (delegated mapper). Route for V1–V3:
  delegated writer (writer trigger: 2+ non-trivial files).

- 2026-09-29 V1 (route: delegated writer; commit `6ca7b92`): `entranceKey` prop on `DashboardViewer`
  (`buildViewerEntranceKey(dashboardId, activeViewId)` from `Dashboard.tsx`) keys the grid frame, so a new
  dashboard/view remounts and replays while a data refresh keeps the nodes. Stagger orders come from
  `utils/viewerEntrance.ts` (shuffle with injectable random, evenly spread fractions in [0,1], locked group
  pulled to its earliest member), cached per key in render-phase state; CSS multiplies the fraction by
  `--viewer-entrance-spread`. RED: `viewerEntrance.test.ts` (module missing) and
  `DashboardViewer.entrance.test.tsx` (9/10 failing). GREEN: `npx vitest run` on both, 8/8 and 10/10.
  Tokens block + `hmi-viewer-frame-entrance` (fade + scale 0.96 -> 1) in `index.css`, reduced motion off.
- 2026-09-29 V2 (route: delegated writer; commit `4419d07`): bar fill `width: 0%` -> inline width
  (`from`-only keyframes); ring segments fade in sequentially by angular fraction (index based, never value
  based, so refreshes cannot change a delay and replay); static top cap appears when the sweep ends. RED:
  `GaugeDisplay.entrance.test.tsx` 6/6 failing. GREEN: 6/6; existing `GaugeDisplay`, `KpiWidget`,
  `MachineActivityWidget` suites unchanged and green.
- 2026-09-29 V3 (route: delegated writer; commit `7799a36`): one hook, class `hmi-viewer-chart-reveal`
  on the shared `WidgetChartLayout` svgs (covers `trend-chart`, `trend-chart-v2`, `prod-history`,
  `prod-trend`) and on the `activity-analytics` % PROD trend, its overlay and the groups chart; keyframes
  `clip-path: inset(-100% 100% -100% 0)` -> `inset(-100% -100% -100% 0)` (explicit end: `none` is not
  interpolable). The donut summary is intentionally not animated. RED: `WidgetChartLayout.entrance.test.tsx`
  4/4 and the new ActivityAnalytics test failing. GREEN: all pass.
- 2026-09-29 verification (in `hmi-app/`): `npx tsc -b` clean; `npm run lint` clean; `npm test` 237 files /
  2981 tests passed; `npm run build` OK. Not verified: real browser rendering (jsdom cannot run CSS animations).
- 2026-09-29 parent spot check: `DashboardViewer.entrance.test.tsx` + `GaugeDisplay.entrance.test.tsx`
  16/16. RDD assess `b18cb82..c0bbaee` (committed-only, `.gga` excluded): medium, 913 lines,
  `review_due` (`slice_budget_reached`); user GRANTED consent; one lens (reliability), in-process capture;
  lineage `review-e44eea326a8f700c` APPROVED, acknowledged, authority burned. Reviewed boundary is now
  `c0bbaee`. Four non-blocking advisories recorded as V5.

- 2026-09-29 V6 + V7 (route: delegated writer; commit `77a8bcd`, one work unit because both share the
  overlay component): design choice = a `ViewerEntranceFrameOverlays` component rendered by
  `DashboardViewer` INSIDE the item surface, after the widget (so it paints above the frame fill and is
  contained in the surface stacking context), instead of per-renderer markup or pseudo-elements: it cannot
  collide with `.glass-panel::after` (corner accents) or `.glass-panel-group::before` (group fill), covers
  every widget type in one place, and gets the exact frame box from `resolveWidgetSurfaceInset(widget)`
  (same value as the surface padding; group = 0px) and the radius from `--frame-radius-rest`. Flash = a
  `div` with a gradient of `--viewer-entrance-flash-color`, opacity 0 -> peak (18 % of the duration) -> 0.
  Outline = a `div` (carries the inset, because a replaced `svg` does not stretch between insets) holding
  an `svg` with `<rect pathLength="1" width/height 100 %>`; `rx/ry` come from CSS
  (`rx: var(--frame-radius-rest)`), `stroke-dashoffset` 1 -> 0 then an opacity fade over the theme's own
  border. Neither animates the `--frame-*` tokens. `text-title`
  (frameless) gets no overlays. Reduced motion: both `animation: none` (base opacity 0 = invisible).
  RED: `DashboardViewer.entrance.test.tsx` 6 failing (overlays missing, tokens/keyframes/rules/reduced
  motion absent); GREEN: 19/19 at that point. Guard test: every selector mentioning `.hmi-viewer-` (comments and
  keyframes stripped) must carry `[data-viewer-entrance='true']`; it already passed on the existing
  gauge/chart classes and now also protects the new ones (R3-unscoped-guard-partial closed).
- 2026-09-29 V8 (route: delegated writer; commit `78694c6`): `ViewerEntranceContext` (per-item stagger order,
  provided by `DashboardViewer`, `null` outside the viewer) + `useViewerEntranceCountUp(hasValue)` in
  `hooks/` return a 0..1 progress; widgets scale only their main value text with
  `resolveViewerCountUpValue` (rounded to the value's own decimals mid-count, the untouched value at the
  end, so the final text is exactly today's). Timing has one source of truth: spread, value offset,
  `--viewer-entrance-count-duration` and the `--viewer-entrance-ease` cubic-bezier are read from the
  `:root` tokens via `getComputedStyle` (a pre-commit review flagged a private JS easing; replaced with the
  shared curve evaluated by `resolveCubicBezierProgress`). Start = item delay + value offset, i.e. together
  with the gauge fill. One-shot per mount: the grid remounts per entry (`entranceKey`), a refresh keeps the
  mount and the hook is settled, so no replay; existing rAF tweens in `KpiWidget`/`MachineActivityWidget`
  are untouched (they animate refreshes; the KPI glide value still feeds the gauge). Late data: first
  value inside the window counts from its arrival; after the window it shows directly. Reduced motion,
  missing tokens or no provider (builder) -> progress 1. RED: `viewerEntrance.test.ts` (10 failing),
  `useViewerEntranceCountUp.test.tsx` (module missing), `viewerEntranceCountUp.test.tsx` (5 failing on
  the initial-zero assertions), `DashboardViewer.entrance.test.tsx` (2 failing); later RED for the shared
  ease (8 failing). GREEN: all pass (70 tests in the four touched suites). Test clock in
  `test/entranceClock.ts`.
- 2026-09-29 verification V6-V8 (in `hmi-app/`): `npx tsc -b` clean; `npm run lint` clean; `npm test`
  239 files / 3033 tests passed (an earlier full run had one `Topbar.test.tsx` failure under parallel load,
  16/16 twice alone and green on the next full run); `npm run build` OK. Not verified: real browser
  rendering per theme preset (jsdom cannot run CSS animations).
- 2026-09-29 parent spot check: `DashboardViewer.entrance.test.tsx`, `useViewerEntranceCountUp.test.tsx`,
  `viewerEntranceCountUp.test.tsx` 46/46. RDD assess `c0bbaee..3e080a5` (committed-only, `.gga` excluded):
  medium, 1404 lines, `review_due` (`slice_budget_reached`); user GRANTED consent; one lens (reliability),
  in-process capture; lineage `review-342fb7268bd30b70` APPROVED, acknowledged, authority burned. Reviewed
  boundary is now `3e080a5`. Two non-blocking advisories added to V5.

- 2026-09-29 V9 (route: delegated writer; commit `ed4f339`): "Animación de entrada" section in
  Configuración general → Tema (`ThemeSettingsTab`), three `DockSliderField`s (existing primitive, reused per
  the user's instruction): "Grosor del contorno" 0.5–3 px step 0.25 (default 1) ->
  `--viewer-entrance-outline-width`; "Opacidad del contorno" 0–100 % step 5 (default 100) -> NEW
  `--viewer-entrance-outline-opacity` (default `1`, in the single `:root` block; it is the `from` opacity of
  the outline-fade keyframes, i.e. the PEAK the fade starts from, so draw-then-fade is unchanged);
  "Intensidad del destello" 0–50 % step 1 (default 16) -> `--viewer-entrance-flash-peak`. Persistence:
  `services/viewerEntranceStyle.service.ts` (type in `domain/viewerEntrance.types.ts`, flagged by the
  pre-commit review): code defaults are the source of truth, only overrides are stored (`hmi-viewer-entrance`,
  key removed when all equal defaults), values at default REMOVE the inline property so the `index.css`
  default applies, reapplied at boot by `applyViewerEntranceOverrides()` in `main.tsx`; global for the three
  presets. Tab contract: slider move previews on `:root` and marks dirty (also clears when returning to the
  saved value), Guardar persists + `saved`, Descartar restores the snapshot without persisting, unmount with an
  unsaved preview restores the saved values. Replay preview = existing `entranceKey` (change dashboard/view).
  User request during implementation: each control is slider PLUS precise numeric input (typing, up/down
  buttons, ArrowUp/ArrowDown, unit, clamp/snap on commit, slider<->input sync). Reused `DockSliderField` +
  `AdminNumberInput`; the gaps were extended minimally: `DockSliderField` `unit` prop, `AdminNumberInput`
  ArrowUp/ArrowDown stepping and Spanish aria-labels on the step buttons ("Aumentar valor"/"Disminuir valor").
  RED: 6 tests failing + 2 suites unresolved (`ThemeSettingsTab.test`, `viewerEntranceStyle.service.test` –
  module missing) and 2 CSS-contract tests in `DashboardViewer.entrance.test`. GREEN: 89/89 in the six
  touched suites (+ `GlobalSettingsDialog.test`). Verification (in `hmi-app/`): `npx tsc -b` clean;
  `npm run lint` clean; `npm test` 240 files / 3056 tests passed (an earlier full run had one
  `Topbar.test.tsx` failure under parallel load, 16/16 alone); `npm run build` OK. Pre-commit review blocked
  twice with genuine findings ("tres temas" hardcoded count; type outside `domain/`), fixed, then PASSED.
  Not verified: real browser rendering of the outline opacity / new controls.
- 2026-09-29 parent spot check: `ThemeSettingsTab`, `viewerEntranceStyle.service`, `DockSliderField`,
  `AdminNumberInput` tests 44/44. RDD assess `3e080a5..5f02b19` (committed-only, `.gga` excluded): medium,
  697 lines, `review_due` (`slice_budget_reached`); user GRANTED consent; one lens (reliability), in-process
  capture; lineage `review-5db18b108b9679a6` APPROVED, acknowledged, authority burned. Reviewed boundary is
  now `5f02b19`. Findings recorded under V5 (one warning refuted with code evidence).

- 2026-09-29 V5 (route: delegated writer; commits `ff761d8`, `23e65ec`, `da4b6b9`, `e0dc3cb`, `2495324`,
  `755b632`, `466c9d8`; no visuals, timings or token defaults changed). TDD strict, runner Vitest.
  - R3-late-value-zero-flash (fixed, `ff761d8`): `useViewerEntranceCountUp` now decides during render (sanctioned
    render-phase state adjustment) whether the first value arrives inside or after the window, so the first
    committed render already shows the final value; a layout effect could not do it because the first commit
    would still contain the scaled-by-0 DOM. RED: the committed-progress recorder saw a 0 commit (test failed);
    GREEN: all committed values are 1. One `eslint-disable react-hooks/purity` (one-shot clock read stored in state).
  - R3-countup-restart-on-hasvalue-toggle (fixed, same commit): the count keeps ONE origin in state; a
    true->false->true toggle resumes on that timeline and ends at the original end. RED: progress restarted
    (0.0045 vs 0.96 mid-count); GREEN: >= mid value after the toggle and exactly 1 at the original end.
  - R3-orders-frozen-per-key (fixed, `23e65ec`): `extendViewerEntranceOrders` gives widgets added under the same
    key a random order (injectable random), never touches existing orders (no reshuffle, no remount), pulls a
    new locked group container to its earliest member; removed widgets leave gaps on purpose (closing them
    would reshuffle). RED: util suite (function missing, 3 tests) and viewer order test (0 vs 0.75); the
    removal test passed immediately (regression guard).
  - R3-stored-values-not-snapped (fixed, `da4b6b9`): shared `utils/normalizeStepValue.ts` extracted from
    `DockSliderField` (no duplication) and used on read in the service. RED: off-step 1.13 / 47 / 20.4 came
    back unsnapped; GREEN: 1.25 / 45 / 20.
  - R3-outline-opacity-fade-only (refuted, guard `e0dc3cb`): asserts `animation-fill-mode: backwards, backwards`
    on the outline rect. Passed immediately; fault injection (`none, backwards` in index.css) made it fail, reverted.
  - R3-combined-dirty-untested (test-only, `2495324`): three tests (preset back to saved while a slider is
    dirty; slider back while another preset is selected; both back clears). Passed immediately; fault
    injection on each half of the dirty expression failed the matching tests, reverted.
  - R3-dashboard-wiring-untested (test-only, `755b632`): the page test mock now exposes the received
    `entranceKey` (the real viewer needs canvas measurement plus every widget dependency); the key follows
    the active view and dashboard and survives a data refresh. Passed immediately; fault injections (view
    id dropped, dashboard id replaced, random suffix) each failed it, reverted. The real keyed-frame remount
    is covered by `DashboardViewer.entrance.test`.
  - R3-frame-key-remount (finding + proving test, `466c9d8`): only the grid frame is keyed; widgets are keyed by
    id inside it, and view/dashboard ids are remapped on clone/duplicate, so a switch already unmounted the
    previous widgets and mounted the new ones BEFORE this feature: no new local-state loss in practice
    (range/custom window/groupBy/turno, hover, tabs, filters, KPI glide all reset as they already did; only a
    widget sharing an id across two views would now also reset). `DashboardViewer`'s own hover state and the
    page-level `useDataOverview` are outside the keyed frame. Mount-time queries: history and activity-series
    use `staleTime: 30_000` with param-based keys, the trend-v2 prefetch skips cached keys and cancels on
    unmount; so a remount within 30 s of the last fetch is served from cache, and older data refetches exactly
    as on a first entry. Test with a real QueryClient: no extra history/activity requests across view
    switches (including back), none for a same-id remount, and a counter control that does fetch for uncached
    data. Fault injection (`staleTime: 0`) failed it, reverted. No redesign needed; a decision is only needed
    if replay should preserve widget state for same-id widgets (not the case today).
  - Verification (in `hmi-app/`): `npx tsc -b` clean; `npm run lint` clean; `npm test` 242 files / 3075 tests
    passed; `npm run build` OK. Pre-commit review PASSED on every commit. Not verified: real browser rendering.
- 2026-09-29 parent spot check: `useViewerEntranceCountUp`, `viewerEntranceStyle.service`, `viewerEntrance`
  tests 47/47. RDD assess `5f02b19..f9d4324` (committed-only, `.gga` excluded): medium, 680 lines,
  `review_due` (`slice_budget_reached`); user GRANTED consent; one lens (reliability), in-process capture;
  lineage `review-513987dd8f836965` APPROVED, acknowledged, authority burned. Reviewed boundary is now
  `f9d4324`. Two non-blocking SUGGESTIONS kept as follow-ups (not scheduled; no effect on current use):
  R3-extend-new-member-of-existing-group (`utils/viewerEntrance.ts:87-95`: a member added under the same key
  to an already existing locked group can get an order lower than its container) and R3-snap-can-exceed-max
  (`utils/normalizeStepValue.ts:11-17`: clamp-then-snap can exceed max when (max - min) is not a multiple of
  step, and step 0 gives NaN; pre-existing logic moved from `DockSliderField`; the three entrance controls'
  ranges divide evenly by their steps).

## Next step

Final live check by the user (late-arriving values no longer flash 0, the count-up survives value toggles,
widgets added mid-entrance get their own delay), then the merge decision (fast-forward to `main` and push only
on the user's explicit OK). V4 (live tuning) was accepted by the user ("quedó perfecto").
