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
- KPI numbers counting up from zero: out of scope for now (possible later addition).
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
- [ ] **V4** — Live tuning with the user (timings/easing) and live acceptance.

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

## Next step

V4: live tuning with the user (timings/easing in the single `:root` block of `index.css`) and live acceptance
in all three theme presets.
