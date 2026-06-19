# Tasks: Activity Analytics

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1100-1600 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 plumbing → PR2 analytics/grouping → PR3 widget wiring → PR4 renderer polish |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|---|---|---|---|
| 1 | Endpoint config + GET query plumbing | PR 1 | Base slice; no renderer yet |
| 2 | Pure analytics + grouping TDD | PR 2 | Depends on PR 1 |
| 3 | Widget registration + runtime skeleton | PR 3 | Depends on PR 2 |
| 4 | KPI/bars polish + verification | PR 4 | Secondary charts only if still in budget |

## Phase 1: Connection and Contract Foundation

- [x] 1.1 Add `activity-series` config helpers/tests in `hmi-app/src/config/dataConnection.config.ts` and `*.test.ts`; empty endpoint disables requests and URL summary stays GET-only.
- [x] 1.2 Update `hmi-app/src/components/admin/ConnectionSettingsTab.tsx` for `Endpoint Activity-Series`, save/clear, preview URL, and query invalidation.
- [x] 1.3 Create `hmi-app/src/domain/activityAnalytics.types.ts`; extend `hmi-app/src/domain/admin.types.ts` with widget config, preset ranges, groupBy, thresholds, and no deferred controls.
- [x] 1.4 RED then GREEN for `hmi-app/src/services/activitySeries.service.test.ts` and `hmi-app/src/adapters/activitySeries.adapter.test.ts`; cover serializer, validation, custom rejection, and purpose/window/sorted-series errors.
- [x] 1.5 Implement `hmi-app/src/services/activitySeries.service.ts`, `hmi-app/src/adapters/activitySeries.adapter.ts`, and `hmi-app/src/queries/useActivitySeries.ts` with key `['data','activity-series',machineId,range,start,end]` and clear error states.

## Phase 2: Pure Analytics and Grouping TDD

- [x] 2.1 RED tests in `hmi-app/src/utils/activityAnalytics.test.ts` for normalization, classification, durations, trailing cap, gap=`no-data`, utilization denominator, stop counts, kWh, and coverage.
- [x] 2.2 GREEN `hmi-app/src/utils/activityAnalytics.ts`; keep analytics pure, one-machine only, and never map gaps to stopped.
- [x] 2.3 RED tests in `hmi-app/src/utils/activityAnalyticsGrouping.test.ts` for shift/day/week/month, overnight shifts, day boundary, fallback timezone, and non-browser-local stability.
- [x] 2.4 GREEN `hmi-app/src/utils/activityAnalyticsGrouping.ts`, reusing `useTemporalSettings`, `temporalSettings.config.ts`, `trendChartV2Shifts.ts`, and `trendChartV2Time.ts` rules without `temporalGrouping.ts`.

## Phase 3: Widget Wiring and First Release Renderer

- [x] 3.1 Extend `hmi-app/src/utils/widgetCapabilities.ts`, `WidgetCatalogRail.tsx`, and `DashboardBuilderPage.tsx`; register `activity-analytics` defaults (`24h`, one `binding.machineId`, thresholds, no deferred UI).
- [x] 3.2 Update `hmi-app/src/components/admin/PropertyDock.tsx` with machine, range, groupBy, threshold, and display-mode controls plus setup/prod validation.
- [x] 3.3 RED component/query tests for `useActivitySeries`, `WidgetRenderer`, and `ActivityAnalyticsWidget` loading/error/endpoint-empty/missing-machine/empty-series states.
- [x] 3.4 Implement `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` and wire `hmi-app/src/widgets/WidgetRenderer.tsx`; ship KPI cards + stacked bars first, secondary charts only if PR 4 stays in budget.

## Phase 4: Verification

- [x] 4.1 Run `npm run test -- activitySeries activityAnalytics useActivitySeries ActivityAnalyticsWidget widgetCapabilities` from `hmi-app/`.
- [x] 4.2 Run `npm run lint` and `npx tsc -b` from `hmi-app/`; maintainer-approved external exception recorded for repo-wide lint drift outside this change.
  - Waiver / external exception: `npx tsc -b` is green, but full `npm run lint` still fails on pre-existing unrelated files outside the `activity-analytics` scope. Per explicit user decision, do not fix those repo-wide lint issues in this change; treat them as a separately pending repo task while allowing `sdd-verify` to proceed for `activity-analytics`.
- [x] 4.3 Manually verify Builder/runtime: endpoint disable-empty, default `24h`, timezone-stable grouping, no summary UI, no deferred UI, no write flows.

## Review Workload Forecast

- Estimated changed lines: 1100-1600.
- Chained PRs recommended: Yes.
- 400-line budget risk: High.
- Decision needed before apply: Yes.
- Recommended PR boundary: PR1 plumbing, PR2 analytics/grouping, PR3 widget wiring, PR4 renderer polish.
