# Design: Activity Analytics Production History Bar Behavior

## Technical Approach

Apply the Producción Histórica bar-sizing model inside Activity Analytics `Grupos` only. Keep the analytics pipeline unchanged (`useActivitySeries` → `computeActivityAnalytics` → grouped buckets → renderer), add one display option for presentation, and make the existing visual-layout utility scroll later by allowing narrower compressed slots. Label sampling stays index-based over the final `displayGrouped` array: every bucket still renders one stack, while sampling may omit only the secondary text label.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Config field | Add `groupBarWidth?: number` to `ActivityAnalyticsDisplayOptions`; default/clamp in `resolveActivityAnalyticsDisplayOptions()` to `1` within `0.5..1.5`; clamp again in `PropertyDock` and renderer. | Reuse `productionBarWidth`; add global chart config. | Field is scoped to Activity Analytics grouped bars and stays backward-compatible for persisted widgets without the value. Double clamping mirrors Prod History safety. |
| Width formula | Port Prod History formula: `barW = max((plotWidth / groupCount) * 0.35 * safeFactor, 6)`, with `padX = barW`, `usableW = plotWidth - 2*padX`, and centers spaced across `usableW`. Single group centers in the plot. | Keep current `step * 0.56/0.7` ratios; create shared primitive. | This is the smallest behavior match. A shared primitive is out of scope and current ratios are the source of oversized bars. |
| Responsive thresholds | Keep `fit` at current roomy threshold, lower compressed scroll floors to narrow-bar floors (`42px` normal, `28px` Turno detail), and keep text fallback height/width guards unchanged. | Remove scroll entirely like Prod History. | Activity Analytics can render many stacked buckets; scroll remains a last resort, but 6 groups at ~480px should compress instead of scroll. |
| Label sampling | Compute sampled labels from real rendered group centers and bucket labels after Turno summary/detail filtering. Do not create synthetic tick labels or aggregate buckets for labels. | Sample calendar ticks independently from rendered buckets. | This keeps labels truthful: a shown label always maps to a rendered `activity-analytics-group-stack`, and omitted labels do not remove bars, tooltip targets, or data. |
| Stacked meaning | Preserve segment ordering, colors, heights, tooltip series, and hover highlights. Apply only narrower x/width positioning and a Prod History-like compact top cap/rounding on the top visible segment, not a production-only overlay. | Use one gradient bar like Prod History. | A single visual treatment would blur `prod/setup/stopped/noData` semantics. Geometry can match without changing state meaning. |

## Data Flow

```text
ActivityAnalyticsDisplayOptions.groupBarWidth
        └─ resolveActivityAnalyticsDisplayOptions() default/clamp
             ├─ PropertyDock slider persists displayOptions.groupBarWidth
             └─ ActivityAnalyticsWidget passes factor to GroupedStackedBarsChart
                    ├─ grouped durations render with prod-history-like width math
                    └─ label sampler hides text only; stacks remain 1:1 with displayGrouped
```

## File Changes

| File | Action | Description |
|---|---|---|
| `hmi-app/src/domain/admin.types.ts` | Modify | Add documented `ActivityAnalyticsDisplayOptions.groupBarWidth?: number`. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modify | Add default constant and clamp resolver output to `0.5..1.5`. |
| `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` | Modify | Lower compressed scroll floors while preserving fit/text fallback behavior. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modify | Thread `groupBarWidth` into `GroupedStackedBarsChart` and replace bar width/position math only. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modify | Add Activity Analytics `Ancho barra` slider in the existing `Agrupación` section. |
| Existing matching `*.test.ts(x)` files | Modify | Extend focused tests only; no new production modules. |

## Interfaces / Contracts

```ts
export interface ActivityAnalyticsDisplayOptions {
  // existing fields...
  /** Grouped stacked bar width factor in [0.5, 1.5], default 1. */
  groupBarWidth?: number;
}
```

`ActivityAnalyticsPersistedDisplayPatch` is unchanged because runtime controls persist range/window only; builder persistence already writes `displayOptions` through `PropertyDock`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Default and invalid `groupBarWidth` values resolve to `1`, clamp low/high to `0.5/1.5`. | Extend `activityAnalyticsWidgetDefaults.test.ts`. |
| Unit | 6 grouped buckets at ~480px compress before scroll; Turno detail still scrolls only after the new floor. | Extend `activityAnalyticsVisualLayout.test.ts`. |
| Integration | Slider defaults to `×1.0`, persists `groupBarWidth`, and clamps bounds. | Extend `PropertyDock.test.tsx`. |
| Renderer | Truthful label sampling under compression. | Extend `ActivityAnalyticsWidget.test.tsx` with enough buckets to sample labels; assert every shown bucket label belongs to a rendered group, all bucket stacks still render, omitted labels do not remove stacks, and tooltip targets remain per real bucket. |
| Renderer | Width-only analytics invariance. | Render the same activity-series fixture at `groupBarWidth` `0.5`, `1`, and `1.5`; assert only SVG rect widths/centers change while classification inputs, grouped assignment, KPI values, coverage, stop count, consumption, segment count/heights, tooltip series, and absence of process-write controls remain unchanged. |

## Migration / Rollout

No migration required. Missing persisted `groupBarWidth` resolves to `1`; invalid persisted values are clamped at read/render time.

## Open Questions

None.
