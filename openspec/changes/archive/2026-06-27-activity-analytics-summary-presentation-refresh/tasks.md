# Tasks: Activity Analytics Summary Presentation Refresh

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 220-320 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Renderer summary refresh + focused RTL updates + verification | PR 1 | Single slice; keep grouped bars, analytics, and read-only behavior unchanged |

## Phase 1: Test-First Contract Lock

- [x] 1.1 RED: update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` to expect header subtitle `Distribución`, no `activity-analytics-kpis`, and no framed summary container.
- [x] 1.2 RED: add RTL assertions in `ActivityAnalyticsWidget.test.tsx` for detail order `Producción` → `Setup` → `Detenida`, one `% - hours` string per row, and centered summary detail block.
- [x] 1.3 RED: add resize-driven tests in `ActivityAnalyticsWidget.test.tsx` for responsive donut stroke clamp, `prod === base * 1.5`, and unchanged donut center semantics.

## Phase 2: Renderer Summary Refresh

- [x] 2.1 GREEN: in `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx`, set `WidgetHeader.subtitle="Distribución"` and remove `KpiPanel` from the top region.
- [x] 2.2 GREEN: replace the framed summary variants in `ActivityAnalyticsWidget.tsx` with one compact donut-led layout using coverage, donut, and a right-side vertically centered details column.
- [x] 2.3 GREEN: add local typed summary detail rows in `ActivityAnalyticsWidget.tsx` from `analytics.durationsMs`, `utilizationRatio`, and `coverageRatio`; format inline `valueLabel` as `% - hours` in `prod/setup/stopped` order.
- [x] 2.4 GREEN: add a local donut stroke helper in `ActivityAnalyticsWidget.tsx` that clamps base thickness by available size and keeps production at `1.5x` without clipping.

## Phase 3: Refactor and Focused Verification

- [x] 3.1 REFACTOR: keep `useActivitySeries`, `computeActivityAnalytics`, `displayGrouped`, and grouped chart wiring unchanged; remove obsolete KPI-only summary helpers from `ActivityAnalyticsWidget.tsx`.
- [x] 3.2 REFACTOR: tighten `ActivityAnalyticsWidget.test.tsx` to assert typography token families only for coverage/value/title semantics, not incidental layout styling.
- [x] 3.3 Verify from `hmi-app/`: `npm run test -- ActivityAnalyticsWidget.test.tsx`, `npm run lint`, and `npx tsc -b`.
