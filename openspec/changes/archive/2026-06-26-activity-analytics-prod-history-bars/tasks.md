# Tasks: Activity Analytics Production History Bar Behavior

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 260-360 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Typed config, builder control, layout/renderer update, focused tests | PR 1 | Single review slice; include targeted verification commands |

## Phase 1: Foundation / Config

- [x] 1.1 RED: extend `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` for missing `groupBarWidth`, invalid low/high values, and default `1` fallback.
- [x] 1.2 Add `groupBarWidth?: number` to `hmi-app/src/domain/admin.types.ts` and resolve/clamp it in `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` to `0.5..1.5`.

## Phase 2: Builder / Layout

- [x] 2.1 RED: extend `hmi-app/src/components/admin/PropertyDock.test.tsx` for an Activity Analytics grouped-bar slider that shows `×1.0`, persists `displayOptions.groupBarWidth`, and clamps bounds.
- [x] 2.2 Add the `Agrupación` control in `hmi-app/src/components/admin/PropertyDock.tsx` using the typed `displayOptions.groupBarWidth` path only.
- [x] 2.3 RED: extend `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` for 6 buckets at ~480px compress-before-scroll and delayed Turno-detail overflow.
- [x] 2.4 Update `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` to lower compressed scroll floors while preserving current fit/text fallback guards.

## Phase 3: Renderer / Behavior

- [x] 3.1 RED: extend `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` for truthful sampled labels, unchanged stack count/segments, and analytics invariance at factors `0.5`, `1`, and `1.5`.
- [x] 3.2 Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` to thread resolved `groupBarWidth`, port Prod History-like bar width/center math, and keep stacked semantics/tooltips read-only.
- [x] 3.3 REFACTOR: keep renderer/layout helpers minimal and remove any duplicate clamp logic that is no longer needed after tests pass.

## Phase 4: Verification

- [x] 4.1 Run `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` in `hmi-app/`.
- [x] 4.2 Run `npm run lint` and `npx tsc -b` in `hmi-app/`; confirm no write/control behavior was introduced.
