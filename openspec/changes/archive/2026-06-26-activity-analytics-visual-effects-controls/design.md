# Design: Activity Analytics Visual Effects Controls

## Technical Approach

Implement this as an additive Activity Analytics display-options extension. Keep the existing `stateGradients` hex tuple contract, add parallel alpha tuples plus nested Activity Analytics-only `visualEffects`, resolve everything in `activityAnalyticsWidgetDefaults`, and make `ActivityAnalyticsWidget` consume only resolved presentation values. Analytics computation, grouping, fetching, persistence outside `displayOptions`, and KPI ring segmentation remain unchanged.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Replace gradient tuples with rich stop objects | Cleaner shape but risky for existing persisted widgets and color inputs | Keep `stateGradients` as `[startHex, endHex]`; add `stateGradientAlphas` in parallel. |
| Generic visual-effects editor | Reusable but expands scope across widgets | Add only `ActivityAnalyticsDisplayOptions.visualEffects`. |
| Validate in renderer and dock | Duplicates fallback rules | Centralize defaults/clamps in `activityAnalyticsWidgetDefaults`; UI and renderer read resolved values. |
| Widen global dock labels | Could disturb all widget inspectors | Use Activity Analytics-specific visual cards with full labels. |

## Data Flow

```text
PropertyDock visual cards ──updates──> widget.displayOptions
        │                                  │
        └──── resolved defaults/clamps ◄───┘
                         │
             ActivityAnalyticsWidget renderer
                         │
      donut SVG effects and grouped-bar SVG effects
```

## File Changes

| File | Action | Description |
|---|---|---|
| `hmi-app/src/domain/admin.types.ts` | Modify | Add alpha and visual-effect display-option types. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modify | Add defaults, hex fallback, alpha/effect clamps, resolved return type. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modify | Replace compact gradient row with Activity Analytics visual cards, hex fields, alpha and effects controls. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modify | Apply resolved alpha/effects to donut and grouped bars only. |
| Existing focused tests | Modify | Extend resolver, PropertyDock, and renderer coverage. |

## Interfaces / Contracts

```ts
export type ActivityAnalyticsStateGradientKey = 'prod' | 'setup' | 'stopped';
export type ActivityAnalyticsStateGradient = [string, string]; // #RRGGBB start/end
export type ActivityAnalyticsAlphaPair = [number, number]; // 0..100 start/end

export interface ActivityAnalyticsSurfaceEffects {
  glow: number;        // 0..100 intensity
  blur: number;        // 0..8 SVG stdDeviation px
  topCap: boolean;     // show local cap/highlight overlay
  topCapGlow: number;  // 0..100 cap-only glow intensity
}

export interface ActivityAnalyticsDisplayOptions {
  stateGradients?: Partial<Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient>>;
  stateGradientAlphas?: Partial<Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair>>;
  visualEffects?: {
    groupedBars?: Partial<ActivityAnalyticsSurfaceEffects>;
    donut?: Partial<ActivityAnalyticsSurfaceEffects>;
  };
}
```

Defaults: all alpha pairs are `[100, 100]`. `groupedBars` defaults preserve current bars: `{ glow: 0, blur: 0, topCap: true, topCapGlow: 100 }`. `donut` defaults preserve current glow and avoid new caps by default: `{ glow: 100, blur: 2.5, topCap: false, topCapGlow: 0 }`.

Fallbacks/clamps: hex must match trimmed `#RRGGBB`; invalid or missing slots fall back per slot to `DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS`. Alpha, glow, and top-cap glow clamp to `0..100`; missing/non-finite values fall back to defaults. Blur clamps to `0..8`; missing/non-finite values fall back to defaults.

Renderer consumption: gradients use `stopColor` plus `stopOpacity={alpha / 100}`. Derived markers, legends, tooltips, highlights, and comparison mini-bars use the end-stop color and end-stop alpha. Grouped bars read only `visualEffects.groupedBars`; donut reads only `visualEffects.donut`. Surface glow/blur create separate SVG filter ids per surface. Grouped top caps use `groupedBars.topCap` and `groupedBars.topCapGlow`; donut caps, when enabled, use donut-local overlay arcs and `donut.topCapGlow` only.

PropertyDock layout: keep existing dock primitives, but render visual controls as Activity Analytics cards instead of `DockFieldRow` rows. Each state card has full labels (`Production`, `Setup`, `Stopped`), two stop rows (`Start color`, `End color`), a color picker beside a pasteable hex text field, and alpha next to that stop. Hex text keeps a local draft and commits only valid `#RRGGBB` values; invalid drafts show an error style and reset on blur without mutating persisted options. The color picker and hex field update the same tuple slot.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Defaults, clamps, malformed persisted values | Extend `activityAnalyticsWidgetDefaults.test.ts`. |
| Component | Hex paste, picker coexistence, alpha/effects updates, sibling preservation, readable labels | Extend `PropertyDock.test.tsx`. |
| Renderer | Independent grouped/donut glow, blur, top-cap, top-cap-glow and alpha application | Extend `ActivityAnalyticsWidget.test.tsx`. |
| Regression | Analytics unchanged | Assert palette/effect-only rerenders do not call `computeActivityAnalytics` again and KPI segmentation controls are absent. |

## Migration / Rollout

No migration required. Existing widgets without the new fields resolve safely at runtime.

## Open Questions

None.
