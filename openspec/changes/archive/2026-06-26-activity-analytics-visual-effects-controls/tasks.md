# Tasks: Activity Analytics Visual Effects Controls

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 520-760 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Types, defaults, clamps | PR 1 | Base main; include resolver RED→GREEN→REFACTOR tests. |
| 2 | PropertyDock visual cards + hex/alpha/effects | PR 2 | Base PR 1; keep builder-only scope and focused RTL tests. |
| 3 | Renderer adoption + final verification | PR 3 | Base PR 2; donut/grouped bars only, then run typed verification commands. |

## Phase 1: Foundation / Resolver

- [x] 1.1 RED: Extend `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` for alpha defaults/clamps, invalid hex fallback, and independent `visualEffects` fallback scenarios.
- [x] 1.2 GREEN: Update `hmi-app/src/domain/admin.types.ts` with `ActivityAnalyticsAlphaPair`, `ActivityAnalyticsSurfaceEffects`, and nested `ActivityAnalyticsDisplayOptions.visualEffects`.
- [x] 1.3 GREEN: Implement resolver/default logic in `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` for `stateGradientAlphas`, grouped-bars/donut defaults, and `0..100`/`0..8` clamps.
- [x] 1.4 REFACTOR: Export small resolver helpers/types from `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` without changing legacy `stateGradients` persistence.

## Phase 2: Builder Controls

- [x] 2.1 RED: Extend `hmi-app/src/components/admin/PropertyDock.test.tsx` for visual cards, valid hex paste commit, invalid hex blur reset, alpha updates, effect updates, and sibling-setting preservation.
- [x] 2.2 GREEN: Replace the Activity Analytics `Visualización` rows in `hmi-app/src/components/admin/PropertyDock.tsx` with state cards using full labels, paired color picker + hex field, and per-stop alpha controls.
- [x] 2.3 GREEN: Add grouped-bar and donut effect controls in `hmi-app/src/components/admin/PropertyDock.tsx` for glow, blur, top-cap, and top-cap glow with scoped update helpers.
- [x] 2.4 REFACTOR: Keep Activity Analytics-only helpers local in `hmi-app/src/components/admin/PropertyDock.tsx` so generic dock primitives stay unchanged.

## Phase 3: Renderer Adoption

- [x] 3.1 RED: Extend `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` for per-stop opacity, grouped/donut effect independence, top-cap toggles, and palette-only rerender regression.
- [x] 3.2 GREEN: Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` so donut gradients use resolved alpha/effects and optional donut-local top-cap overlays only.
- [x] 3.3 GREEN: Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` so grouped bars, legend markers, tooltip/highlight indicators, and comparison mini-bars use resolved end-stop color/alpha and grouped-bars effects only.
- [x] 3.4 REFACTOR: Isolate SVG filter/id helpers in `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` to avoid duplicated donut/grouped-bar effect wiring.

## Phase 4: Verification

- [x] 4.1 Run `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` in `hmi-app/`.
- [x] 4.2 Run `npx tsc -b`, `npm run lint`, and if stable `npm run test:coverage` in `hmi-app/`; verify no KPI segmentation controls appear and analytics outputs stay unchanged.
