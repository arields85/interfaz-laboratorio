# Design: Activity Analytics

## Technical Approach

Implement a dedicated read-only `activity-series` pipeline (`service -> adapter -> domain -> query -> widget`) for the `activity-analytics-widget`, `node-red-binding`, and `global-temporal-settings` specs. The widget will fetch only `/api/hmi-data/activity-series`, derive KPIs/charts from `series`, ignore backend `summary` in the UI, and use deterministic plant-time grouping with explicit gap/no-data handling.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Endpoint stack | New `activitySeries` service/adapter/query | Reuse `useDataHistory` / `/history` | `/history` requires `variableKey` and different validation/cache semantics; keeping a separate pipeline avoids regressions and keeps the contract honest. |
| Time grouping | New tested grouping utility, reusing trend-chart-v2 timezone/shift patterns where possible | Reuse `temporalGrouping.ts` | `temporalGrouping.ts` hardcodes 6/14/22 shifts and browser-local `Date`; analytics need saved shifts, overnight support, and deterministic timezone fallback. |
| Response usage | Keep `summary` in the domain response but never render it | Show backend summary | Specs require frontend-derived analytics only; hiding `summary` prevents mixed semantics and keeps `% Prod.` authoritative. |

## Data Flow

Admin Builder
`ConnectionSettingsTab` + `PropertyDock`
→ persisted base URL + `activity-series` endpoint + widget config (`binding.machineId`, range, groupBy, thresholds)
→ `useActivitySeries(query)`
→ `fetchActivitySeries()` GET
→ `adaptActivitySeries()`
→ `buildActivityAnalytics()` + `groupActivityAnalytics()`
→ `ActivityAnalyticsWidget` KPIs + stacked bars + empty/error states

## File Changes

| File | Action | Description |
|---|---|---|
| `hmi-app/src/config/dataConnection.config.ts` | Modify | Add default/localStorage/full-URL helpers for `activity-series`; empty endpoint disables the feature. |
| `hmi-app/src/components/admin/ConnectionSettingsTab.tsx` | Modify | Add `Endpoint Activity-Series`, invalidate the new query key, and show `URL ACTIVITY-SERIES`. |
| `hmi-app/src/domain/activityAnalytics.types.ts` | Create | Backend contract, query params, range/grouping/state, grouped metrics, coverage, and widget display options. |
| `hmi-app/src/domain/admin.types.ts` | Modify | Add `activity-analytics` widget type/config and typed display options. |
| `hmi-app/src/services/activitySeries.service.ts` | Create | GET-only request serialization for preset ranges and future custom windows. |
| `hmi-app/src/adapters/activitySeries.adapter.ts` | Create | Strict response validation: purpose, window, bucket, sorted series, and legible adapter errors. |
| `hmi-app/src/queries/useActivitySeries.ts` | Create | TanStack Query hook with key `['data','activity-series',machineId,range,start,end]`. |
| `hmi-app/src/utils/activityAnalytics.ts` | Create | Pure KPI math: classification, durations, kWh, stops, coverage. |
| `hmi-app/src/utils/activityAnalyticsGrouping.ts` | Create | Shift/day/week/month grouping by resolved analytics timezone and saved shifts. |
| `hmi-app/src/{components/admin/WidgetCatalogRail.tsx,pages/admin/DashboardBuilderPage.tsx,components/admin/PropertyDock.tsx,utils/widgetCapabilities.ts,widgets/WidgetRenderer.tsx}` | Modify | Register the widget, defaults, dock controls, capability metadata, and runtime dispatch. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Create | Runtime renderer for first release layout and state handling. |

## Interfaces / Contracts

```ts
type ActivitySeriesRange = '1h' | '24h' | '7d' | '30d' | '12m' | 'custom';
type ActivityAnalyticsGroupBy = 'shift' | 'day' | 'week' | 'month';
type ActivityAnalyticsState = 'prod' | 'setup' | 'stopped' | 'no-data';

interface ActivitySeriesResponse { purpose: 'activity-analytics'; window: { start: string; end: string; timezone?: string; bucket: string; bucketMs: number }; series: Array<{ timestamp: string; timestampMs: number; value: number | null }>; summary: unknown; }
interface ActivityAnalyticsWidgetDisplayOptions { range?: Exclude<ActivitySeriesRange,'custom'>; groupBy?: ActivityAnalyticsGroupBy; setupThresholdKw?: number; prodThresholdKw?: number; displayMode?: 'kpis-and-bars' | 'kpis-bars-and-secondary'; }
```

Machine selection stays in `binding.machineId` (`node-red-v1`); `variableKey` remains unused because the endpoint already fixes the source metric.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Service URL/query serialization, adapter validation, analytics math, grouping/timezone, threshold guards | TDD-first tests in `*.test.ts` for service/adapter/utils. |
| Integration | Query enable/disable behavior and cache keys | `useActivitySeries.test.tsx` with mocked `useQuery`, matching `useDataHistory` patterns. |
| Component | Empty/error/loading/populated widget states and key labels | Smoke/accessibility tests for `ActivityAnalyticsWidget` and `WidgetRenderer`. |

Critical math rules: `Math.max(0, value)`, `prod > setup`, interval deltas, trailing cap `bucketMs * 1.5`, gaps `> bucketMs * 2` as `no-data`, no stop transitions across gaps, and kWh from data-backed hours only.

## Migration / Rollout

No migration required. Rollout is additive: endpoint config is optional, empty endpoint disables requests, and existing history widgets remain untouched.

## Open Questions

- [ ] Keep `displayMode` in the first widget schema if secondary charts slip to a later slice?
- [ ] If shared timezone helpers are extracted from trend-chart-v2, should activity analytics switch first and trend-chart-v2 follow in the same PR or a chained cleanup PR?

## Review Slicing Strategy

Recommended chained PRs (budget risk: High):
1. Endpoint/domain/query plumbing + admin connection wiring.
2. Pure analytics + timezone/grouping utilities with exhaustive tests.
3. Widget registration, PropertyDock config, renderer skeleton, empty/error states.
4. KPI/bar visualization polish and optional secondary charts only if still under budget.
