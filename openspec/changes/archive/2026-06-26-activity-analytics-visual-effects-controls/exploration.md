## Exploration: activity-analytics-visual-effects-controls

### Current State
`activity-analytics` already has a dedicated builder/runtime path, but its visual controls are still narrow. `hmi-app/src/domain/admin.types.ts` only stores `stateGradients` as three `[startHex, endHex]` tuples. `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` resolves only strict `#RRGGBB` values, so alpha or richer color payloads are currently rejected. `hmi-app/src/components/admin/PropertyDock.tsx` exposes exactly six `input[type="color"]` controls in the Activity Analytics Visualización section, with no companion text input, no alpha sliders, and a fixed narrow label column (`w-14` + `whitespace-nowrap`) that explains the cramped `Prod.` / `Det.` / `Ini.` behavior. In `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx`, the donut uses one fixed glow filter (`feGaussianBlur stdDeviation="2.5"`) and grouped bars always render a top-cap highlight with a hardcoded `drop-shadow(0 0 6px ...)`; there is no independent blur/glow configuration for donut vs grouped bars, and there is no donut top-cap concept yet. Reference-only patterns already exist in `ProduccionHistoricaWidget.tsx` (bar cap + glow) and `GaugeDisplay.tsx` (circular glow filter).

### Affected Areas
- `hmi-app/src/domain/admin.types.ts` — extend the Activity Analytics display contract with Activity-Analytics-only visual effect settings; today it only supports gradient tuples.
- `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` — add backward-compatible defaults/resolution/clamping for alpha and donut/bar effect settings while preserving legacy widgets.
- `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` — update resolver coverage because current tests explicitly lock gradients to plain hex-only tuples.
- `hmi-app/src/components/admin/PropertyDock.tsx` — add pasteable hex fields, alpha controls, donut/grouped-bars glow+blur controls, top-cap toggles/config, and a less cramped layout.
- `hmi-app/src/components/admin/PropertyDock.test.tsx` — expand focused dock tests for new controls, safe defaults, and nested partial updates.
- `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` — consume the new visual settings in donut and grouped bars only, without changing analytics or other widgets.
- `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` — lock renderer behavior for donut/grouped-bars-only effects, optional top-caps, and backward-compatible fallback behavior.
- `hmi-app/src/widgets/renderers/ProduccionHistoricaWidget.tsx` — reference only for the existing local top-cap glow treatment the user wants to approximate.
- `hmi-app/src/components/ui/GaugeDisplay.tsx` — reference only for circular glow/blur behavior similar to the requested donut approximation.
- `hmi-app/src/components/admin/adminSidebarStyles.ts` — likely touchpoint if the current `w-14 nowrap` label primitive is too restrictive for the new Activity Analytics controls.

### Approaches
1. **Additive Activity Analytics visual-effects contract** — keep `stateGradients` as the existing hex tuples, then add parallel Activity Analytics-only fields for per-slot alpha and for donut/grouped-bars effects.
   - Pros: smallest migration; preserves current gradient tests/mental model; easy safe fallback for persisted widgets; scope stays limited to Activity Analytics.
   - Cons: color information becomes split across hex + alpha fields; donut top-cap needs a brand-new overlay concept.
   - Effort: Medium

2. **Replace gradient tuples with richer color-stop objects** — convert each state stop into an object like `{ hex, alpha }` and fold visual effects into a broader nested presentation schema.
   - Pros: cleaner long-term model; easier future extension if more visual controls arrive.
   - Cons: larger migration surface; breaks current resolver assumptions/tests; higher risk in admin update handlers and renderer adoption.
   - Effort: High

### Recommendation
Use **Additive Activity Analytics visual-effects contract**. It is the smallest safe path because it keeps the already-shipped `stateGradients` tuple contract intact, adds backward-compatible defaults in one resolver layer, and limits renderer changes to the two requested surfaces: grouped bars and donut. Concretely: keep the existing gradient tuples for hex color selection, add per-slot alpha alongside them, add separate `groupedBars` and `donut` effect objects for glow/blur/top-cap settings, and implement hex paste as a companion text field bound to the same slot instead of replacing the native color picker.

### Risks
- Current gradient defaults/resolvers accept only `#RRGGBB`, so any alpha support that overloads the same string field will break fallback behavior unless the contract stays additive or parsing is redesigned carefully.
- Donut top-cap does not exist today; the safest approximation is a small per-segment overlay arc, but very short segments may need clamping to avoid visual artifacts.
- `PropertyDock` currently relies on a globally narrow `w-14` label primitive with `whitespace-nowrap`; if that stays unchanged, the new controls will remain hard to use even if the data model is correct.
- Builder update handlers are currently simple tuple writes; nested effect objects will increase merge complexity and need focused regression tests to avoid wiping unrelated display options.
- The main spec currently describes state gradients but not manual blur/glow/top-cap controls, so proposal/spec work must explicitly keep this scoped to Activity Analytics and explicitly exclude KPI ring segmentation.

### Ready for Proposal
Yes — tell the user the smallest safe implementation is to keep the existing Activity Analytics state-gradient contract and add backward-compatible alpha/effect settings just for Activity Analytics, while explicitly leaving KPI-style ring segmentation out of scope.
