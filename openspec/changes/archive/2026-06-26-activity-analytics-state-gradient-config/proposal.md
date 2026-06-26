# Proposal: Activity Analytics State Gradient Configuration

## Intent

Allow builders to configure presentation gradients for Activity Analytics states so each state can match the intended HMI visual language without changing analytics, grouping, or read-only behavior.

## Scope

### In Scope
- Add typed per-state gradient config for `prod`, `setup`, and `stopped`, each with start and end colors.
- Provide default gradients for new and legacy Activity Analytics widgets.
- Expose dedicated Activity Analytics controls in the admin property dock.
- Apply configured state colors to the Activity Analytics state-coded visuals: summary donut segments, summary detail markers, grouped stacked-bar segments, grouped state legend markers, grouped hover/tooltip state indicators, grouped top-cap highlights, and comparison horizontal mini-bars.
- Add focused tests for defaults, admin controls, and renderer usage.

### Out of Scope
- Generic reusable gradient editor for all widgets.
- Changes to analytics classification, grouping, durations, KPIs, or bar geometry.
- Any process-control writes, setpoints, or plant commands.
- Summary redesign or unrelated Activity Analytics presentation work.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `activity-analytics-widget`: Adds builder-controlled per-state presentation gradients for Activity Analytics visuals while preserving analytics semantics and read-only scope.

## Approach

Extend the Activity Analytics widget config with a small typed gradient map, following the reusable `MachineActivity` `[from, to]` tuple pattern. Add defaults in `activityAnalyticsWidgetDefaults`, render dedicated controls in `PropertyDock`, and replace renderer-local hardcoded state colors with resolved config values. Donut and grouped stacked-bar segments use start→end gradients; compact state markers, comparison mini-bars, tooltip/highlight indicators, and top-cap highlights derive from the same resolved state palette. Keep fallbacks backward-compatible for persisted widgets without gradient settings.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/domain/admin.types.ts` | Modified | Add Activity Analytics state gradient config types. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modified | Provide default state gradients. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modified | Add dedicated controls for three state gradients. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modified | Use configured state palette across donut, grouped bars, comparison mini-bars, legends, tooltip/highlight indicators, and top-cap highlights. |
| Focused tests | Modified | Cover config defaults, controls, and visual color application. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legacy widgets miss gradient config | Medium | Resolve defaults at runtime and in default factory. |
| Color controls widen into generic editor work | Medium | Keep controls Activity Analytics-specific for this slice. |
| Visual update affects analytics semantics | Low | Test that configuration affects presentation only. |

## Rollback Plan

Revert the config type/default/control/renderer changes and related tests. Existing persisted widgets remain safe because the change only adds optional presentation fields with defaults.

## Dependencies

- Existing Activity Analytics widget spec and renderer.
- Existing admin `PropertyDock` color input patterns.
- `MachineActivity` gradient tuple pattern as reference.

## Success Criteria

- [ ] Builder can configure start/end colors for Producción, Setup, and Detenida.
- [ ] Donut segments and grouped stacked bars use the configured gradients per state.
- [ ] State markers, comparison mini-bars, tooltip/highlight indicators, and top-cap highlights derive from the same resolved state palette.
- [ ] Missing config falls back to stable defaults.
- [ ] Analytics outputs, grouped-bar behavior, and read-only constraints remain unchanged.
