# Apply Progress: Activity Analytics Summary Presentation Refresh

## Status

- Completed all Phase 1-3 tasks for the single review slice.
- Preserved grouped-bars parity behavior, analytics wiring, and read-only runtime behavior.

## Completed Tasks

- [x] 1.1 RED: update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` to expect header subtitle `Distribución`, no `activity-analytics-kpis`, and no framed summary container.
- [x] 1.2 RED: add RTL assertions in `ActivityAnalyticsWidget.test.tsx` for detail order `Producción` → `Setup` → `Detenida`, one `% - hours` string per row, and centered summary detail block.
- [x] 1.3 RED: add resize-driven tests in `ActivityAnalyticsWidget.test.tsx` for responsive donut stroke clamp, `prod === base * 1.5`, and unchanged donut center semantics.
- [x] 2.1 GREEN: in `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx`, set `WidgetHeader.subtitle="Distribución"` and remove `KpiPanel` from the top region.
- [x] 2.2 GREEN: replace the framed summary variants in `ActivityAnalyticsWidget.tsx` with one compact donut-led layout using coverage, donut, and a right-side vertically centered details column.
- [x] 2.3 GREEN: add local typed summary detail rows in `ActivityAnalyticsWidget.tsx` from `analytics.durationsMs`, `utilizationRatio`, and `coverageRatio`; format inline `valueLabel` as `% - hours` in `prod/setup/stopped` order.
- [x] 2.4 GREEN: add a local donut stroke helper in `ActivityAnalyticsWidget.tsx` that clamps base thickness by available size and keeps production at `1.5x` without clipping.
- [x] 3.1 REFACTOR: keep `useActivitySeries`, `computeActivityAnalytics`, `displayGrouped`, and grouped chart wiring unchanged; remove obsolete KPI-only summary helpers from `ActivityAnalyticsWidget.tsx`.
- [x] 3.2 REFACTOR: tighten `ActivityAnalyticsWidget.test.tsx` to assert typography token families only for coverage/value/title semantics, not incidental layout styling.
- [x] 3.3 Verify from `hmi-app/`: `npm run test -- ActivityAnalyticsWidget.test.tsx`, `npm run lint`, and `npx tsc -b`.

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modified | Refreshed the summary presentation, removed KPI chrome, added typed detail rows, and made donut thickness responsive. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Modified | Locked the refreshed subtitle/layout contract, detail ordering, typography semantics, and responsive donut thickness with RTL coverage. |
| `openspec/changes/activity-analytics-summary-presentation-refresh/tasks.md` | Modified | Marked every assigned task complete. |
| `openspec/changes/activity-analytics-summary-presentation-refresh/apply-progress.md` | Created | Recorded cumulative apply evidence and TDD cycle status. |

## TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 / 2.1 | `src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration (RTL) | ✅ 51/51 | ✅ Wrote failing subtitle/KPI-removal assertions first | ✅ `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` passed | ✅ Added header subtitle absence/presence checks plus grouped-semantics invariance | ✅ Removed obsolete KPI renderer/helper code |
| 1.2 / 2.2 / 2.3 | `src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration (RTL) | ✅ 51/51 | ✅ Wrote failing ordered-detail/inline-value assertions first | ✅ `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` passed | ✅ Covered chart and text-fallback detail ordering with concrete `% - hours` outputs | ✅ Restricted assertions to semantic title/value contract instead of layout internals |
| 1.3 / 2.4 | `src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration (RTL) | ✅ 51/51 | ✅ Wrote failing resize-driven stroke-width assertions first | ✅ `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` passed | ✅ Verified constrained and expanded widths while preserving donut center semantics | ✅ Kept responsive stroke math local and clamp-based |
| 3.3 | `src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Verification | ✅ 52/52 | ✅ Existing RED coverage exercised by focused verification run | ✅ `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`, `npm run lint`, and `npx tsc -b` all passed | ➖ Verification step | ➖ No additional refactor needed |

## Test Summary

- Total tests written/updated in RED: 5 focused RTL assertions groups across 3 tasks.
- Focused test command: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- Quality gates: `npm run lint`, `npx tsc -b`
- Final status: all targeted tests, lint, and typecheck passed.

## Notes

- `useActivitySeries`, `computeActivityAnalytics`, `displayGrouped`, grouped-bar layout math, and read-only controls were intentionally left behaviorally unchanged.
- The summary details now own the semantic labels previously carried by the legend/KPI strip, so tests assert those visible outputs instead of removed chrome.
