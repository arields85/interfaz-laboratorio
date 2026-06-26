# Proposal: Activity Analytics Visual Effects Controls

## Intent

Add manual, Activity Analytics-specific presentation controls so builders can tune pasted gradient hex values, per-stop transparency, and separate donut/grouped-bar effects without changing analytics, data flow, or read-only HMI constraints.

## Scope

### In Scope
- Pasteable `#RRGGBB` hex fields beside existing color pickers for `prod`, `setup`, and `stopped` gradient stops.
- Per-color-stop alpha controls from `0..100%`, resolved with backward-compatible defaults.
- Independent grouped-bars and donut controls for glow, blur, top-cap visibility, and local top-cap glow.
- Less cramped Activity Analytics builder layout/labels for the expanded visual controls.
- Focused tests for resolver fallback, builder updates, and renderer-only presentation effects.

### Out of Scope
- KPI ring segmentation or dynamic ring-gradient behavior.
- Generic cross-widget visual-effects editor.
- Analytics, classification, grouping, fetching, persistence outside display options, or any process-control write.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `activity-analytics-widget`: extend Activity Analytics presentation requirements with manual hex, alpha, glow, blur, top-cap, and label-layout controls.

## Approach

Keep the shipped `stateGradients` hex tuple contract. Add parallel Activity Analytics-only display settings for per-stop alpha plus separate `groupedBars` and `donut` visual effect objects. Resolve/clamp all missing or invalid values in `activityAnalyticsWidgetDefaults`, then consume only the resolved settings in the Activity Analytics renderer. Rework the Activity Analytics Visualización controls as a compact grouped form rather than widening global admin label primitives unless necessary.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/domain/admin.types.ts` | Modified | Activity Analytics display-option contract. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modified | Defaults, validation, clamping, legacy fallback. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modified | Hex text inputs, alpha/effect controls, layout labels. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modified | Donut/grouped-bar visual effects only. |
| `*.test.tsx?` beside affected modules | Modified | Focused regression coverage. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Alpha support breaks legacy hex tuple resolution | Med | Keep alpha parallel and fallback-tested. |
| Nested builder updates wipe sibling settings | Med | Centralize merge helpers and test partial updates. |
| Donut top-cap artifacts on small segments | Med | Clamp overlay arcs and allow disabling. |
| Builder controls become harder to scan | Med | Group controls by state/surface with clearer labels. |

## Rollback Plan

Revert the display-option additions, resolver defaults, PropertyDock controls, renderer effect consumption, and delta spec. Existing widgets remain safe because legacy `stateGradients` tuples are preserved.

## Dependencies

- Existing `activity-analytics-widget` spec and renderer.
- Reference-only visual patterns from Production History bar caps and Gauge glow.

## Success Criteria

- [ ] Builders can paste valid hex values and still use color pickers for all Activity Analytics gradient stops.
- [ ] Each stop alpha resolves within `0..100%` and affects presentation only.
- [ ] Grouped bars and donut expose independent glow, blur, top-cap, and top-cap glow behavior.
- [ ] Builder labels/layout remain usable without `Prod.`/`Det.`/`Ini.` cramped abbreviations.
- [ ] KPI ring segmentation remains excluded.
