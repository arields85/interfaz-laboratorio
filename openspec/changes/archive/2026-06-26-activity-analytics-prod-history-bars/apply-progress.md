# Apply Progress: activity-analytics-prod-history-bars

## Change
- Name: `activity-analytics-prod-history-bars`
- Work unit: `single review slice`
- Mode: `Strict TDD`
- Delivery: `single PR`
- Scope boundary: `Add the builder width factor, lower Activity Analytics compression floors, port Production History width math into grouped stacks, and stop after focused verification.`

## Gate Rerun Note
- Gate rerun re-checked the working tree for `ActivityAnalyticsWidget.tsx` scope drift.
- The mixed non-bar `ActivityAnalyticsWidget.tsx` / `ActivityAnalyticsWidget.test.tsx` presentation changes were surgically removed from the repo working tree and preserved in local backup patches outside the workspace.
- The current renderer/test diff is now scoped to the approved grouped-bar sizing/config/layout path only.
- Corrective rerun addressed the remaining apply gate failure: `npm run lint` was still red because of one unused renderer test `user`, a missing `activeDisplayOptions.range` memo dependency, and a render-time `currentOffset` reassignment in the summary donut path.

## Completed Tasks
- [x] 1.1 Extend `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` for missing/clamped `groupBarWidth` behavior.
- [x] 1.2 Add `groupBarWidth?: number` to `hmi-app/src/domain/admin.types.ts` and resolve/clamp it in `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts`.
- [x] 2.1 Extend `hmi-app/src/components/admin/PropertyDock.test.tsx` for the Activity Analytics grouped-bar slider default, persistence, and bounds.
- [x] 2.2 Add the Activity Analytics `Ancho barra` control in `hmi-app/src/components/admin/PropertyDock.tsx`.
- [x] 2.3 Extend `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` for 480px compress-before-scroll and delayed Turno-detail overflow.
- [x] 2.4 Lower Activity Analytics compressed scroll floors in `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` while preserving fit/text fallback guards.
- [x] 3.1 Extend `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` for truthful sampled labels and width-only analytics invariance across factors `0.5`, `1`, and `1.5`.
- [x] 3.2 Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` to thread resolved `groupBarWidth`, use Production History-like bar width/center math, and keep stacked semantics/tooltips read-only.
- [x] 3.3 Refactor Activity Analytics width clamping into a shared helper reused by defaults, PropertyDock, and renderer.
- [x] 4.1 Run the focused Activity Analytics test command in `hmi-app/`.
- [x] 4.2 Run `npm run lint` and `npx tsc -b` in `hmi-app/` and confirm the change stays read-only.

## Implementation Notes
- `groupBarWidth` is now a typed Activity Analytics display option with a shared clamp helper so persisted widgets without the field still render at `1.0` and every entry point enforces `0.5..1.5`.
- PropertyDock now exposes the grouped-bar width slider inside `Agrupación`, matching Production History semantics without leaking the setting into unrelated widget types.
- Visual-layout compression floors now allow 6 grouped buckets at ~480px and narrower Turno detail buckets before scrolling, while keeping fit/fallback thresholds intact.
- Grouped Activity Analytics bars now derive width and centers from the Production History formula, but preserve stacked segment ordering, segment heights, hover tooltips, and read-only analytics outputs.
- Label sampling still operates on the real rendered `displayGrouped` buckets, so omitted labels only hide text and never remove bars or tooltip targets.
- The corrective rerun added a focused renderer regression for range-driven analytics recomputation and extracted immutable donut-segment math into `src/utils/activityAnalyticsSummarySegments.ts` so the renderer stays compiler/lint clean without reviving the removed presentation work.

## Verification Evidence
- Safety net: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`95` tests passing before RED changes).
- RED check: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ❌ (`8` failures proving missing width defaults, old compression floors, absent builder slider, and pre-port renderer geometry).
- GREEN check: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`99` focused tests passing after implementation).
- Gate rerun check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`50` tests passing after isolating the grouped-bar slice from earlier presentation work).
- Gate rerun focused suite: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`99` tests passing on the isolated slice).
- Corrective RED check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ❌ (`1` failing test before GREEN because the new immutable donut helper did not exist yet); `npm run lint` ❌ (unused `user`, missing `activeDisplayOptions.range` dependency, render-time `currentOffset` mutation).
- Corrective GREEN check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`51` tests passing after adding the recomputation + immutable donut coverage and fixes).
- Corrective focused suite: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`100` tests passing).
- Quality check: `npm run lint` ✅.
- Type check: `npx tsc -b` ✅.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` | Unit | ✅ 3/3 | ✅ Added default + clamp expectations for missing/low/high/NaN values | ✅ Focused suite green | ✅ 5 cases across fallback, low, valid, high, and NaN inputs | ✅ Extracted a shared clamp helper |
| 1.2 | `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` | Unit | ✅ Same baseline | ✅ Tests referenced `groupBarWidth` before typing/resolver support existed | ✅ Focused suite green | ✅ `createDefault...` and `resolve...` both covered | ✅ Kept resolver output typed and backward-compatible |
| 2.1 | `hmi-app/src/components/admin/PropertyDock.test.tsx` | Integration | ✅ 37/37 | ✅ Added failing slider/default/clamp expectations first | ✅ Focused suite green | ✅ Covered default `×1.0`, valid `1.4`, high clamp `1.5`, low clamp `0.5` | ✅ Reused shared clamp helper in the dock |
| 2.2 | `hmi-app/src/components/admin/PropertyDock.test.tsx` | Integration | ✅ Same baseline | ✅ Slider assertions existed before the control was rendered | ✅ Focused suite green | ✅ Persistence verified through widget updates | ✅ Kept the control scoped to `Agrupación` only |
| 2.3 | `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` | Unit | ✅ 7/7 | ✅ Added failing 480px compress and delayed Turno-detail overflow expectations | ✅ Focused suite green | ✅ Covered normal grouped buckets plus Turno detail thresholds | ✅ Changed only the compressed floors |
| 2.4 | `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` | Unit | ✅ Same baseline | ✅ Layout tests failed against the old `70/36` floors | ✅ Focused suite green | ✅ Existing fit/text-fallback assertions still pass with the new floors | ✅ Preserved current summary/fallback behavior |
| 3.1 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ 48/48 | ✅ Added failing truthful-label and width-invariance expectations before renderer changes | ✅ Focused suite green | ✅ Covered sampled-label truthfulness, stack reachability, tooltip stability, and factors `0.5/1/1.5` | ✅ Assertions stayed on behavior/geometry, not implementation internals |
| 3.2 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ Same baseline | ✅ Renderer tests proved the old geometry still scrolled too early and used oversized bars; corrective rerun also added a range-change recomputation assertion before the memo dependency fix | ✅ Focused suite green | ✅ Verified widths, centers, unchanged heights, tooltips, coverage, comparison, stack count, and range-driven recomputation | ✅ Ported width math without changing analytics flow |
| 3.3 | `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` + `hmi-app/src/components/admin/PropertyDock.test.tsx` + `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Unit + Integration | ✅ Focused safety nets above | ✅ Tests relied on one shared clamp contract before refactor, then on a missing immutable donut helper before the corrective rerun refactor | ✅ Focused suite green | ✅ Shared helper exercised from defaults, builder, renderer, and donut-segment paths | ✅ Removed duplicate clamp behavior by centralizing it and moved donut segment offsets into a pure helper |
| 4.1 | Focused Activity Analytics suite | Unit + Integration | ✅ `95` baseline tests | ✅ Existing RED failures captured before code changes | ✅ `99` focused tests green | ✅ All requested files verified together | ➖ No extra refactor needed |
| 4.2 | `npm run lint` + `npx tsc -b` | Quality | N/A | ✅ Corrective rerun captured the failing lint gate before code changes | ✅ Both commands green | ➖ Single command each | ✅ Fixed the hook dependency, immutability, and unused-test issues exposed by the gates |

## Test Summary
- **Total tests written**: `11` new focused assertions/cases across defaults, layout, PropertyDock, renderer coverage, and immutable donut segment math.
- **Total tests passing**: `100` in the requested focused suite.
- **Layers used**: Unit (`2` files), Integration (`2` files), E2E (`0`).
- **Approval tests**: None — behavior changed intentionally per spec.
- **Pure functions created**: `1` shared helper (`clampActivityAnalyticsGroupBarWidth`).

## Remaining Tasks
- None — implementation and requested verification commands are complete.
