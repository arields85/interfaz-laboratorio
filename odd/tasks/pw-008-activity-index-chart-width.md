# PW-008 activity-index chart width — ODD bug-fix tracker

> ODD bug fix (not SDD). Branch `fix/activity-index-chart-width` (from `main`).
> Engram mirror: `odd/pw-008-activity-index-chart-width/tasks`.

## Objective

Fix the "Índice de actividad" `TrendChartV2` widget (24H range, viewer, presentation-controller
path) drawing its plot in only ~320 px (~40% of the card) instead of filling the card width.

## Root cause

`hmi-app/src/widgets/renderers/TrendChartV2Widget.tsx`, `TrendChartV2PresentationRenderer`:
`dimensions` state started at `{ width: 320, height: 180 }` (~L294). The same div
(`chartShellRef`, `data-testid="trend-chart-v2-chart-shell"`) received inline
`style={{ width, height }}` sourced from that state **and** was the element measured by
`getBoundingClientRect` + `ResizeObserver`. An explicit inline px width beats flex stretch, so the
very first measurement re-confirmed 320×180 on the same pinned element, forever. Introduced by
`4d55a85` (2026-08-28); PW-007's `927e56e` (`visualToLayoutPx`) is a no-op at zoom 1 and was not
the cause. `LegacyTrendChartV2Widget` in the same file already separates the naturally sized
measured container (`containerRef`) from the SVG's own pixel size (`renderDimensions`) — the fix
follows that proven pattern in the same layer.

A second, independent defect was found during real-browser verification: the top-right
min/max/avg summary label rendered as a stray "mir" fragment. Root cause: the presentation
renderer's summary `<text>` set `x={layout.topMetaSlot.x}` (computed assuming `text-anchor: end`,
i.e. the label's right edge) but never applied `textAnchor` itself, so it rendered left-anchored
(SVG default) and overflowed far past the right edge of the viewBox, clipping to an unreadable
fragment. The legacy renderer (`TrendChartV2Widget.tsx` ~L1324) already applies
`textAnchor={layout.topMetaSlot.textAnchor}` plus the `SYSTEM_TEXT_STYLE` font props — the
presentation renderer's summary `<text>` was missing all of them. This persisted even after the
width fix (confirmed both bugs are independent), so it was fixed in the same file/layer.

## Fix

`hmi-app/src/widgets/renderers/TrendChartV2Widget.tsx`, `TrendChartV2PresentationRenderer`:
- Removed the inline `style={{ width, height }}` from the `chartShellRef` div (~L367). It now
  relies on its existing `WIDGET_CHART_CONTAINER_CLASS` (`flex-1 min-h-0`, full-width flex
  stretch) for natural sizing, matching the legacy renderer's pattern. `dimensions` state (fed by
  the same ResizeObserver) still drives `chartLayout`/the SVG's own `width`/`height` attributes —
  only the self-referential inline pin on the measured element was removed.
- Added `textAnchor={layout.topMetaSlot.textAnchor}` and the `SYSTEM_TEXT_STYLE` font props
  (`fontSize`, `fontFamily`, `fontWeight`, `letterSpacing`) to the summary `<text>` (~L370),
  matching the legacy renderer.

Other renderers checked for the same self-measuring/self-pinning pattern (`useState<ChartDimensions>`
non-zero initial + inline style on the same ResizeObserver-observed element): none found.
`ProduccionHistoricaWidget.tsx` and `TrendChartWidget.tsx` start their dimensions state at
`{0,0}` and only feed `dimensions.width/height` to their SVG's own `width`/`height` attributes,
never to the measured container's own CSS size — already the correct pattern. All `topMetaSlot`
usages (`TrendChartV2Widget.tsx` legacy, `TrendChartWidget.tsx`) already applied `textAnchor`; the
presentation renderer was the only omission.

## TDD

Strict TDD: enabled (source: global orchestrator config). Runner: `cd hmi-app && npx vitest run`
(focused: `npx vitest run src/widgets/renderers/TrendChartV2Widget.test.tsx`).

jsdom has no layout engine, so both regression tests assert the structural invariant rather than a
pixel measurement, using the existing `MockResizeObserver` harness in
`TrendChartV2Widget.test.tsx`, under a new `describe('TrendChartV2PresentationRenderer
(presentation-controller path)')` block:

1. **Width fix** — "does not pin the ResizeObserver-observed chart shell to the measured
   dimensions state (PW-008)": asserts `chartShellRef`'s inline `style.width`/`style.height` are
   empty, and that the measured size still reaches the SVG's `width`/`height` attributes.
   - RED (pre-fix): `expected '900px' to be ''` — the shell's inline style tracked the measured
     dimensions state 1:1, exactly the self-confirming loop described above.
   - GREEN (post-fix): passes; 59/59 tests in the file pass.
2. **Summary label fix** — "right-aligns the min/max/avg summary label at its slot instead of
   overflowing past the plot area (PW-008)": asserts the summary `<text>` has
   `text-anchor="end"`.
   - RED (pre-fix): `Expected the element to have attribute: text-anchor="end" / Received: null`.
   - GREEN (post-fix): passes; 60/60 tests in the file pass.

RED evidence was captured by temporarily reverting each specific source line (`git stash push --
TrendChartV2Widget.tsx` for the width fix; a scoped `Edit`/revert for the text-anchor fix) and
running the failing test, then restoring the fix and re-running to GREEN. No RED output was
invented.

## Real-browser verification

Isolated headless Chrome (`--headless=new`, own `--user-data-dir` under the session scratchpad,
`--remote-debugging-port=0`, `--window-size=1920,1080`), driven via CDP over Node 24's global
`WebSocket`, closed via CDP `Browser.close`. Used the already-running dev server at
`http://127.0.0.1:5173` (not started/stopped by this task). Seeded the isolated profile's
`localStorage` key `laboratorio_hmi_dashboards_v1` (via `Runtime.evaluate` + reload) with a
minimal published `Dashboard` (`status: 'published'`, `ownerNodeId` set so
`DashboardStorageService`'s migration keeps it published and auto-derives `publishedSnapshot`)
containing one `trend-chart-v2` widget (`simulated_value` binding so the presentation-controller
path renders real data, not just a loading/no-data state), titled "Índice de actividad", range
24h. `WidgetPresentationBoundary` → `TrendChartV2Controller` routes any `trend-chart-v2` widget
through the presentation-controller path automatically in `DashboardViewer`, no special wiring
needed. Had to additionally wait out the boot shield's 8s `minVisibleMs`
(`LOADER_OPTIONS_DEFAULTS.long`) before screenshots showed real content instead of the
"ACTUALIZANDO DATOS" splash.

Measurements at 1920×1080, zoom 1 (card = `.glass-panel` ancestor of the chart shell):

| | card width | shell width | svg width (attr) |
|---|---|---|---|
| Before fix | 1220 px | 320 px (~26%) | 320 |
| After fix | 1220 px | 1202 px (~98.5%) | 1202 |

Resizing the CDP viewport to 1280 wide: before fix the shell/svg attribute stayed frozen at 320
regardless of the resize (no tracking at all, matching the bug); after fix the svg attribute
width changed to 1094 (real tracking — it *did* react to the resize, unlike the frozen-at-320
buggy baseline). Note: `getBoundingClientRect()` on the shell/svg after the CDP viewport override
reports a further-scaled value (795.7) that does not match the raw attribute (1094); this is
PW-007's page-level zoom-to-fit `transform: scale()` (confirmed via `getComputedStyle` showing the
un-transformed box still at ~1094px) reacting to the simulated viewport, not a PW-008 regression —
`ResizeObserver`'s `contentRect` deliberately ignores ancestor CSS transforms, so `dimensions`
state tracks the container's un-scaled layout size, while `getBoundingClientRect` additionally
reflects the visual zoom transform. This is a real, pre-existing (PW-007) interaction between
`Emulation.setDeviceMetricsOverride`-style resizes and the app's own zoom system; it does not
affect the 1920×1080 zoom-1 repro condition from the bug report and is out of PW-008's scope.

Screenshots (session scratchpad, `C:\Users\ARIELD~1\AppData\Local\Temp\claude\D--Proyectos-Interfaz-HMI-Interfaz-HMI\f33c2320-b72e-42ac-b3f8-9c46ccedfe38\scratchpad\`):
- `pw008-before.png` / `pw008-before-crop.png` — reproduces both bugs: ~320px-wide chart in a
  1220px card, and the "mir" label fragment.
- `pw008-after2.png` — both fixed: full-width chart, summary reads "min 4.9  max 76  avg 41".

## Checks

- `cd hmi-app && npx vitest run` — 221 files / 2531 tests passed (baseline 221/2529 + 2 new tests).
- `cd hmi-app && npx tsc -b` — clean, no output.
- `cd hmi-app && npm run lint` — clean, no findings.

## Commits

- `fix(hmi): size the trend chart v2 presentation renderer from its container` — both source
  fixes, both regression tests, this task document.

## Route

Delegated writer (single bounded PW-008 task; mapping trigger fired for the pre-existing-pattern
survey across renderers; writer trigger fired for the 2-file change: source + test).

## Remaining risks / open questions

- The zoom-transform interaction with `Emulation.setDeviceMetricsOverride`-style resizes (see
  above) was not investigated further — it appears benign and pre-existing (PW-007), but a real
  OS-level window resize was not tested (only CDP viewport override), so PW-007's own resize
  behavior at zoom ≠ 1 is not re-verified here.
- Only the presentation-controller path (`TrendChartV2PresentationRenderer`) was in scope; the
  legacy renderer was read-only reference for the correct pattern and was not modified.
