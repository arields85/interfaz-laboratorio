## Exploration: trend-chart-v2

### Current State
`trend-chart` is a single existing widget type rendered by `TrendChartWidget.tsx` through the normal `WidgetRenderer` flow. In real mode it queries history through `useDataHistory -> fetchDataHistory -> adaptDataHistory`, sending `{ machineId, variableKey, range }` where `range` is still the legacy domain set (`minuto|hora|dia|semana|mes`). In simulated mode it always generates 24 random 1-minute points via `generateTrendData(baseValue, undefined, 24)`, regardless of selected range. The SVG renderer positions points by array index (`x0 + index * step`), filters out `null` history values before plotting, and uses `ChartHoverLayer` / `ChartTooltip` with index-based hover assumptions. No explicit trend-chart-specific shift configuration or timezone configuration was found; the only existing shift logic is hardcoded in `hmi-app/src/utils/temporalGrouping.ts` for `prod-history` (`06:00-14:00`, `14:00-22:00`, `22:00-06:00`).

### Affected Areas
- `hmi-app/src/domain/dataContract.types.ts` — extend history range/query/response types for preset + custom ranges, optional `window`, and future `shiftSummary` compatibility.
- `hmi-app/src/adapters/dataHistory.adapter.ts` — accept legacy + new ranges, preserve optional `window`, and keep null points intact.
- `hmi-app/src/services/dataHistory.service.ts` — support preset queries plus `custom` with `start`, `end`, optional `maxPoints`.
- `hmi-app/src/queries/useDataHistory.ts` — query key and params shape must support custom windows.
- `hmi-app/src/widgets/renderers/TrendChartWidget.tsx` — current implementation assumptions break for real-time-scale X axis, gaps, zoom state, custom range state, shift overlays, and deterministic simulated mode.
- `hmi-app/src/utils/trendDataGenerator.ts` — must become range-aware and deterministic.
- `hmi-app/src/components/ui/ChartHoverLayer.tsx` — current column-based hover model assumes uniform point spacing; likely needs a point/segment-aware alternative for time-scale hover and drag-zoom.
- `hmi-app/src/components/ui/ChartTooltip.tsx` — likely reusable, but tooltip payload/secondary shift info will expand.
- `hmi-app/src/domain/admin.types.ts` — add separate widget type/config for V2 plus typed display options for shifts/zoom behavior.
- `hmi-app/src/widgets/WidgetRenderer.tsx` — register the new widget renderer without disturbing existing `trend-chart`.
- `hmi-app/src/components/admin/WidgetCatalogRail.tsx` — expose the new widget in the builder catalog if product wants it insertable.
- `hmi-app/src/utils/widgetCapabilities.ts` — define default size/icon/capabilities for the new widget type.
- `hmi-app/src/pages/admin/DashboardBuilderPage.tsx` — add the V2 creation path/default widget config.
- `hmi-app/src/components/admin/PropertyDock.tsx` — add V2 widget settings such as shift toggle/mode and possibly preserve old widget editing separately.
- `hmi-app/src/widgets/renderers/TrendChartWidget.test.tsx` — legacy widget tests must stay green; V2 needs its own tests.
- `hmi-app/src/services/dataHistory.service.test.ts`, `hmi-app/src/adapters/dataHistory.adapter.test.ts`, `hmi-app/src/queries/useDataHistory.test.tsx` — extend TDD coverage for new range/query contracts.
- `hmi-app/src/utils/temporalGrouping.ts` — reusable source for shift boundaries, but today it is prod-history-specific and hardcoded, not a shared shift config service.

### Approaches
1. **Separate widget type (`trend-chart-v2`)** — Add a new widget/config/renderer path while preserving the existing `trend-chart` untouched.
   - Pros: safest migration path, no behavior regression for existing dashboards, easier to evolve ranges/zoom/shifts aggressively, clean proposal boundary, supports review slicing.
   - Cons: duplicates some renderer/admin registration surface, requires deciding whether V2 reuses or forks helper primitives.
   - Effort: Medium

2. **Refactor existing `trend-chart` in place** — Keep one widget type and migrate all saved widgets forward.
   - Pros: no parallel catalog/widget maintenance, one long-term renderer.
   - Cons: high regression risk, forces legacy migration + UX changes at once, harder to keep under 400-line review slices, more product ambiguity around saved widget behavior.
   - Effort: High

### Recommendation
Use a **separate widget type named `trend-chart-v2`** with a renderer such as `TrendChartV2Widget`. Scope the change as a **new historical-analysis widget** that shares the existing read-only history pipeline but extends contracts, renderer behavior, and widget configuration independently from legacy `trend-chart`. This fits the orchestrator decision, avoids breaking current dashboards, and enables phased delivery: (1) V2 registration + new history contract/ranges, (2) real timestamp scale + gaps, (3) zoom/custom range, (4) optional shifts/summary.

### Risks
- No reusable shared shift configuration object was found; only hardcoded shift logic exists in `temporalGrouping.ts`, so proposal work must decide whether to extract a shared shift config source or accept temporary coupling.
- No explicit timezone configuration was found for chart formatting; proposal must define precedence between backend `window.timezone`, any future HMI shift timezone, and browser local time.
- `ChartHoverLayer` is built around uniform `step` columns, so drag-zoom and nearest-by-timestamp hover may require either a substantial rewrite or a V2-specific interaction layer.
- `TrendChartDisplayOptions` is currently empty and PropertyDock has no trend-specific section, so shift/zoom controls add admin-surface scope beyond renderer work.
- Extended history contract (`window`, future `shiftSummary`) must remain backward-compatible with current `1.0.0` payloads.

### Ready for Proposal
Yes — tell the user the safest boundary is a new `trend-chart-v2` widget, not an in-place refactor. Proposal should lock naming (`trend-chart-v2` vs `historical-trend-chart`), decide whether V2 is catalog-visible immediately, define timezone/shift-config authority, and split delivery into review-safe slices with strict TDD.
