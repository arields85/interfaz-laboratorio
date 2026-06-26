# Design: Activity Analytics State Gradient Configuration

## Technical Approach

Add Activity Analytics-only state gradient configuration to `displayOptions`, resolve it through the existing defaults utility, expose six color inputs in `PropertyDock`, and pass the resolved palette to the existing Activity Analytics renderer. Donut/grouped-bar segments use gradients; comparison mini-bars, legends, tooltip/highlight indicators, summary detail markers, and top caps derive solid/highlight colors from the same palette. This is presentation-only: analytics computation, grouping, thresholds, data fetching, persistence callbacks, and read-only behavior remain unchanged.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Config location | Add `stateGradients?: Partial<Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient>>` to `ActivityAnalyticsDisplayOptions` in `hmi-app/src/domain/admin.types.ts`. | Generic widget gradient config; separate widget-level field. | Keeps the contract typed, Activity Analytics-specific, and inside the existing display-options persistence path. |
| Defaults/fallback | Add `DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS` and a palette-only `resolveActivityAnalyticsStateGradients()` helper in `activityAnalyticsWidgetDefaults.ts`; `createDefault...()` stores full defaults and `resolveActivityAnalyticsDisplayOptions()` calls the helper and returns a required full map. | Renderer-only fallback. | Keeps one source of truth for new widgets, legacy persisted widgets, and partial/invalid state entries. |
| Affected visual surfaces | Donut and grouped stacked-bar segments use start→end gradients; summary detail markers, group legends, comparison mini-bars, tooltip/highlight indicators, and top caps derive from the resolved state palette. | Limit to donut/grouped bars only; use gradient everywhere. | These are the widget's state-coded bar/marker surfaces, so keeping separate hardcoded colors would contradict builder-selected state colors. Tiny marks read better as solid derived colors. |
| Scope | Modify existing Activity Analytics files/tests only; no new generic color editor. | Shared color editor extraction. | Minimum safe implementation and avoids widening the slice. |

## Data Flow

```text
PropertyDock color inputs
  -> widget.displayOptions.stateGradients
  -> resolveActivityAnalyticsDisplayOptions()
       -> resolveActivityAnalyticsStateGradients()
  -> ActivityAnalyticsWidget resolved state palette
  -> donut/grouped gradients + derived markers/mini-bars/highlights/top caps
```

## File Changes

| File | Action | Description |
|---|---|---|
| `hmi-app/src/domain/admin.types.ts` | Modify | Add `ActivityAnalyticsStateGradientKey`, `[start,end]` tuple type, and optional `stateGradients` field. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modify | Add default palette and resolver; include `stateGradients` in default/resolved options. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modify | Add Activity Analytics-specific color controls under a visual/color section and a nested gradient update handler. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modify | Replace local hardcoded state colors/gradients with resolved palette and derived colors for donut, grouped bars, comparison mini-bars, legends, tooltip/highlight indicators, summary detail markers, and top caps. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` | Modify | Cover default, legacy missing, partial, and invalid gradient fallback. |
| `hmi-app/src/components/admin/PropertyDock.test.tsx` | Modify | Cover six color controls and nested `stateGradients` updates. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Modify | Cover renderer consumption and no analytics drift. |

## Interfaces / Contracts

```ts
export type ActivityAnalyticsStateGradientKey = 'prod' | 'setup' | 'stopped';
export type ActivityAnalyticsStateGradient = [string, string];

export interface ActivityAnalyticsDisplayOptions {
  // existing fields...
  stateGradients?: Partial<Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient>>;
}
```

Resolution naming is deliberate: `resolveActivityAnalyticsStateGradients(rawStateGradients)` is the palette-only normalizer; `resolveActivityAnalyticsDisplayOptions(displayOptions)` is the end-to-end display-options resolver and is the path used by `PropertyDock` and `ActivityAnalyticsWidget`. It calls the palette helper and returns a required `stateGradients` map. Each state falls back per-slot to defaults when the tuple is missing, malformed, or contains blank/non-string values. Defaults should use existing Activity/MachineActivity token language where possible; user changes persist as color-input hex strings.

## PropertyDock Controls

Add a dedicated Activity Analytics color section with rows for `Producción`, `Setup`, and `Detenida`. Each row has two `<input type="color">` controls with accessible labels like `Producción inicio` and `Producción fin`. The handler resolves the current full palette first, updates only the selected tuple slot, then writes `displayOptions.stateGradients` while preserving range, grouping, thresholds, and `groupBarWidth`.

## Renderer Consumption

`ActivityAnalyticsWidget` derives a visual palette from `activeDisplayOptions.stateGradients`. Summary donut `<linearGradient>` stops and grouped stacked-bar state rects use `[start,end]`; `noData` remains muted. Summary detail markers, grouped legends, tooltip series markers, hover highlight colors, and comparison mini-bars use the resolved `end` color as the compact solid representative. Top caps use a white-mixed highlight derived from `end`. Geometry, stacking order, and comparison ranking stay unchanged.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Defaults/fallbacks | Assert full default map and safe resolution for missing/partial/invalid state gradients. |
| Component | PropertyDock controls | Render Activity Analytics, verify six color inputs, change colors, assert nested `stateGradients` update only. |
| Renderer | Visual use/no drift | Render with custom gradients; assert donut/grouped gradients use them, summary markers/legends/comparison/tooltip-highlight/top caps derive from them, and `computeActivityAnalytics` inputs/results are unchanged when only colors differ. |

## Migration / Rollout

No migration required. Legacy widgets omit `stateGradients`; runtime/default resolution supplies safe defaults. Rollback is a normal revert because the field is optional presentation data.

## Open Questions

None.
