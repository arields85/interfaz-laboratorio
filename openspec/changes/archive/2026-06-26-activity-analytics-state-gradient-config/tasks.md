# Tasks: Activity Analytics State Gradient Configuration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 430-560 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 defaults/types → PR 2 PropertyDock → PR 3 renderer/tests |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Type contract + fallback resolver | PR 1 | Base main; includes unit RED/GREEN/REFACTOR. |
| 2 | Activity Analytics PropertyDock controls | PR 2 | Base PR 1; preserve unrelated displayOptions. |
| 3 | Renderer palette adoption + final verification | PR 3 | Base PR 2; includes renderer assertions and commands. |

## Phase 1: Foundation

- [x] 1.1 RED: extend `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` for default, legacy-missing, partial, and invalid `stateGradients` fallback.
- [x] 1.2 GREEN: add `ActivityAnalyticsStateGradientKey`, tuple type, and `stateGradients?` to `hmi-app/src/domain/admin.types.ts`.
- [x] 1.3 GREEN: add default palette plus `resolveActivityAnalyticsStateGradients()` and resolved required map wiring in `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts`.
- [x] 1.4 REFACTOR: keep resolver naming/path stable and remove duplicate fallback logic in touched Activity Analytics helpers.

## Phase 2: Admin controls

- [x] 2.1 RED: extend `hmi-app/src/components/admin/PropertyDock.test.tsx` to require six Activity Analytics color inputs and isolated nested updates.
- [x] 2.2 GREEN: add Activity Analytics-specific gradient rows/labels in `hmi-app/src/components/admin/PropertyDock.tsx` using resolved palette defaults.
- [x] 2.3 REFACTOR: centralize the nested gradient-slot update handler so range, grouping, thresholds, and `groupBarWidth` remain unchanged.

## Phase 3: Renderer palette adoption

- [x] 3.1 RED: extend `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` for donut, grouped bars, legends, detail markers, tooltip/highlight indicators, top caps, and comparison mini-bars.
- [x] 3.2 GREEN: replace hardcoded state palettes in `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` with resolved gradients/derived solids across approved surfaces only.
- [x] 3.3 GREEN: assert in renderer tests that changing colors does not alter `computeActivityAnalytics` inputs/results or read-only behavior.
- [x] 3.4 REFACTOR: extract small palette/derived-color helpers inside `ActivityAnalyticsWidget.tsx` only if needed to keep renderer readable.

## Phase 4: Verification

- [x] 4.1 Run `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` in `hmi-app/`.
- [x] 4.2 Run `npm run lint` and `npx tsc -b` in `hmi-app/`; verify spec scenarios for defaults, dock persistence, renderer-only visual change, and no analytics drift.
