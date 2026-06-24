## Exploration: activity-analytics second iteration

### Current State
The shipped `activity-analytics` widget already has a dedicated read-only pipeline (`activitySeries.service.ts` → `activitySeries.adapter.ts` → `useActivitySeries.ts` → `ActivityAnalyticsWidget.tsx`) and computes reusable grouped buckets from one machine’s `/activity-series` response. Today the builder only exposes preset ranges (`1h`, `24h`, `7d`, `30d`, `12m`), grouping (`shift`, `day`, `week`, `month`), and setup/prod thresholds. Runtime renders KPI cards plus a scrollable grouped stacked-bar list. The domain already includes `custom` in `ActivityAnalyticsRange`, but the current service/query validation rejects custom requests, the widget only sends preset `range`, and no custom window UI exists. Grouped output already contains the metrics needed for the deferred ranking/table slice: label, prod/setup/stopped durations, `% Prod.`, `kWh`, `Stops`, coverage, and stable time boundaries.

### Affected Areas
- `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` — add runtime custom-range controls and render the new ranking block/table without breaking current empty/error states.
- `hmi-app/src/services/activitySeries.service.ts` — extend URL serialization to support `range=custom&start&end`.
- `hmi-app/src/utils/activitySeriesQueryValidation.ts` — support strict custom-window validation instead of preset-only rejection.
- `hmi-app/src/queries/useActivitySeries.ts` — include `start/end` in the query key and forward custom windows.
- `hmi-app/src/domain/activityAnalytics.types.ts` — likely promote custom-window query/display state to first-class typed contracts.
- `hmi-app/src/domain/admin.types.ts` — decide whether builder-persisted display options stay preset-only or gain explicit custom-window defaults/strategy flags.
- `hmi-app/src/utils/activityAnalytics.ts` — current analytics already expose totals and intervals; may need a small summary-table/ranking mapper rather than core math changes.
- `hmi-app/src/utils/activityAnalyticsGrouping.ts` — grouped buckets already provide most ranking/table inputs, but tie handling and label strategy may need explicit helpers.
- `hmi-app/src/components/admin/PropertyDock.tsx` — only affected if custom-range behavior becomes builder-configurable; otherwise current admin surface can stay preset-only.
- `hmi-app/src/pages/admin/DashboardBuilderPage.tsx` — only affected if the widget’s default persisted range contract changes.
- `openspec/specs/activity-analytics-widget/spec.md` — current canonical spec still encodes first-release exclusions, so second-iteration delta specs must explicitly replace them.

### Approaches
1. **Runtime-local custom window, builder stays preset-based** — keep `displayOptions.range` as preset/default behavior and add widget-local state for an active custom window, similar to `TrendChartV2Widget`.
   - Pros: smallest contract change; avoids persisting stale absolute dates in dashboard config; clear separation between builder defaults and viewer exploration.
   - Cons: custom window resets on reload/preset switch; needs careful UX for date/time picking and timezone messaging.
   - Effort: Medium

2. **Persist custom window in widget display options** — extend admin/runtime contracts so the widget can be saved with `range='custom'` plus `start/end`.
   - Pros: fully reproducible dashboard state; useful if operators expect fixed reporting windows.
   - Cons: mixes runtime exploration with builder configuration, introduces stale absolute dates in saved layouts, and forces broader admin validation/testing.
   - Effort: Medium/High

### Recommendation
Use **runtime-local custom window** for the second iteration. The codebase already has a strong precedent in `TrendChartV2Widget` for “preset baseline + temporary custom window” behavior, while the current `activity-analytics` grouped buckets already cover the ranking/table data model without needing a new analytics backend contract. Implement this as: (1) custom-query support in the activity-series service/query/validation stack, (2) widget-local custom window state and UI, and (3) pure derived mappers for ranking cards and the compact summary table. Keep admin changes minimal unless the product explicitly asks to persist absolute windows in saved dashboards.

### Risks
- Timezone conversion is the sharpest edge: the backend expects strict ISO UTC custom timestamps, while grouping/display use plant-time semantics and `resolveActivityAnalyticsTimezone()` currently prioritizes global temporal settings over response timezone.
- `ActivityAnalyticsRange` already includes `custom`, but `ActivityAnalyticsDisplayOptions.range` is preset-only today and `useActivitySeries()` currently hardcodes `null, null` for `start/end` in its cache key.
- Ranking ties are undefined in the shipped code; second iteration should specify deterministic tie-breakers (for example `% Prod.` desc/asc, then `startMs`, then label).
- Empty or low-coverage groups can distort rankings unless the spec says whether `coverageRatio === 0` groups are hidden, shown, or ranked last.
- The widget is still strictly one-machine: current binding, query, analytics, and grouped domain all assume a single machine, so broad multi-machine comparison remains a separate change.
- Packing KPI grid + ranking block + compact table into an 11x9 widget may require responsive collapse/scroll decisions to preserve readability and `hmi-scrollbar` usage.

### Ready for Proposal
Yes — tell the user the second iteration can mostly build on the existing single-machine analytics pipeline, but it MUST add explicit custom-query support and a clear runtime-vs-builder decision for date windows before proposal/spec work starts.
