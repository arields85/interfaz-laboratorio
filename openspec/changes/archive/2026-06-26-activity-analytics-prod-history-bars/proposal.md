# Proposal: Activity Analytics Production History Bar Behavior

## Intent

Make the `Grupos` bars in `ActivityAnalytics` feel consistent with `Producción Histórica`: narrow, responsive, builder-adjustable, and visually aligned, while preserving stacked state semantics and the read-only HMI contract.

## Scope

### In Scope
- Port the `Producción Histórica` bar width behavior into `ActivityAnalytics` layout calculations.
- Add a builder-controlled Activity Analytics bar-width parameter with equivalent range/default behavior.
- Keep stacked `Prod.`, `Setup`, `Detenida`, and related state rendering semantics unchanged.
- Cover layout utility, renderer, defaults, domain config, and property panel behavior with focused tests.

### Out of Scope
- Creating a shared chart primitive between widgets.
- Changing analytics classification, grouping, data fetching, or state-duration semantics.
- Adding write/control actions or process commands.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `activity-analytics-widget`: grouped stacked bars must use Production History-like width/responsive behavior and expose a builder bar-width configuration.

## Approach

Port the relevant visual sizing model rather than reusing a nonexistent shared primitive. Add a safe Activity Analytics width factor, compute bar width from available plot width and group count with shrink-before-scroll behavior, preserve label sampling, and thread the builder property through defaults, domain config, and `PropertyDock`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modified | Apply responsive stacked bar width and visual shape alignment. |
| `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` | Modified | Port width calculation and scroll thresholds. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modified | Add default bar-width factor. |
| `hmi-app/src/domain/admin.types.ts` | Modified | Add typed builder configuration field. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modified | Expose adjustable Activity Analytics bar width. |
| `*.test.ts(x)` for the above | Modified | Add regression coverage for sizing, config, and UI control. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Stacked states visually regress while changing bar geometry | Med | Assert state segments remain present and proportional. |
| Builder field diverges from Production History semantics | Med | Match range `0.5..1.5` and default `1`. |
| Responsive scroll threshold changes unexpectedly | Med | Unit-test shrink-before-scroll behavior across group counts. |

## Rollback Plan

Revert the Activity Analytics config field, layout calculation, renderer changes, property panel control, defaults, and related tests. Existing analytics data and persisted read-only behavior remain unaffected.

## Dependencies

- Existing `ProduccionHistorica` sizing behavior as reference.
- Existing `activity-analytics-widget` OpenSpec capability.

## Success Criteria

- [ ] `ActivityAnalytics` grouped bars shrink/grow before scroll like `Producción Histórica`.
- [ ] Builder exposes an Activity Analytics bar-width control with matching range/default.
- [ ] Stacked state semantics and read-only constraints remain unchanged.
- [ ] Focused tests cover layout math, defaults/types, property panel, and renderer behavior.
