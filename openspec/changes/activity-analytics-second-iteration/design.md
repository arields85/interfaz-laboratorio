# Design: Activity Analytics Second Iteration

## Technical Approach

Keep the read-only pipeline unchanged: `useActivitySeries` fetches the window, `computeActivityAnalytics` derives totals and grouped buckets, and `useTemporalSettings` resolves weekly shift semantics. The final contract is enforced at the widget boundary through one shared display-rules layer used by defaults, admin controls, and runtime controls.

Visible controls expose only `24h`, `7d`, `30d`, and `12m`. Persisted `custom` windows remain internally supported: hydration keeps `start/end`, queries still send `range=custom`, and grouping compatibility is derived from the effective custom duration. `Turno` stays visible for every supported or persisted range, but `Detalle` exists only for `24h + Turno` and `7d + Turno`; `30d`, `12m`, and every `custom` window stay in `Resumen`.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|------|--------|-------------------------|-----------|
| User-facing range contract | Hide `1h` and `custom` in admin/runtime, while keeping internal `custom` support and normalizing legacy `1h -> 24h` | Narrow domain/backend types; expose custom picker | The widget contract changed, not the transport contract. Boundary normalization avoids churn and preserves persisted custom windows. |
| Shared compatibility matrix | Compute `allowedGroups`, fallback group, and detail eligibility in one utility | Duplicate conditions across widget/admin/tests | One source of truth prevents drift, especially for hidden custom windows and long-range `Turno`. |
| Turno semantics | `Resumen` always aggregates to exactly 3 buckets (`Turno 1/2/3`); `Detalle` is allowed only for `24h` and `7d` when `groupBy='shift'` | Chronological detail for every range | Long/custom windows would imply false precision. Summary-only preserves truthful comparison while keeping `Turno` available. |
| Responsive behavior | Keep `fit -> compress -> scroll`, then text fallback only when charts are unreadable | Scroll-first or card fallback | Reuses `prod-history` conventions and protects chart truthfulness in constrained dashboard cells. |

## Data Flow

```text
Persisted displayOptions
  -> resolveActivityAnalyticsDisplayOptions()
  -> resolveActivityAnalyticsDisplayRules(range, start, end, groupBy)
  -> useActivitySeries(range | custom+start+end)
  -> computeActivityAnalytics(series, shifts, timezone)
  -> buildTurnoSummaryBuckets() when group=shift and detail is not eligible
  -> resolveActivityAnalyticsVisualLayout(width, height, groupCount, turnoMode)
  -> SummaryChart -> ComparisonPanel -> GroupsChart
```

`Resumen` always uses full-window durations. `Grupos` uses the visible grouped dataset. `Mejor/Peor` ranks only visible buckets with non-null `% Prod.`. In-progress shift outlines appear only in `Detalle`; invalid schedule coverage remains `sin turno`; low coverage remains `sin datos`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `hmi-app/src/utils/activityAnalyticsDisplayRules.ts` | Create | Centralize visible ranges, duration-based custom grouping, fallback group selection, and `Turno` detail gating. |
| `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` | Modify | Normalize persisted `1h`, preserve persisted `custom` bounds, and clamp invalid stored groups through the shared rules. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modify | Hide custom from controls, keep persisted custom queries internal, show `Turno` for `30d/12m/custom`, and render `Resumen/Detalle` only for `24h/7d + Turno`. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modify | Offer only visible preset ranges and filter group options from the same matrix used at runtime. |
| `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` | Modify | Keep `Turno` summary fixed to 3 bars and let chronological detail compress before scrolling. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Modify | Lock hidden-custom behavior, long-range `Turno` visibility, detail gating, 3-bar `Resumen`, and truthful partial-shift rendering. |

## Interfaces / Contracts

```ts
type ActivityAnalyticsSupportedRange = '24h' | '7d' | '30d' | '12m' | 'custom';

interface ActivityAnalyticsDisplayRules {
  range: ActivityAnalyticsSupportedRange;
  allowedGroups: ActivityAnalyticsGroupBy[];
  fallbackGroup: ActivityAnalyticsGroupBy;
  groupBy: ActivityAnalyticsGroupBy;
  turnoDetailEligible: boolean; // only shift + 24h/7d
}
```

Compatibility matrix: `24h -> shift/day`, `7d -> shift/day/week`, `30d -> shift/day/week/month`, `12m -> shift/week/month`, `custom <=24h -> shift/day`, `custom <=7d -> shift/day/week`, `custom >7d -> shift/day/week/month`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Shared compatibility matrix, hidden-custom normalization, legacy `1h` fallback | `activityAnalyticsDisplayRules.test.ts`, `activityAnalyticsWidgetDefaults.test.ts` |
| Unit | Layout thresholds for fit/compress/scroll/text fallback | `activityAnalyticsVisualLayout.test.ts` |
| Integration | Admin/runtime hide `custom` but hydrate persisted custom queries with explicit bounds | RTL with mocked query hook |
| Integration | `Turno` stays visible in `30d/12m/custom`, while `Detalle` exists only for `24h/7d` | RTL control assertions |
| Integration | `sin datos`, `sin turno`, in-progress outline, and 3-bar `Turno` summary remain explicit | RTL grouped fixtures |

## Migration / Rollout

No data migration required. Legacy `1h` dashboards normalize to `24h` on read. Persisted `custom` windows continue working without exposing custom editors. Invalid stored groups clamp on read and persist naturally on the next display-options save.

## Open Questions

- [ ] None blocking design; final compression thresholds should still be checked against real `11x9` dashboard cells during apply.
