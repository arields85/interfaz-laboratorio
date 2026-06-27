# Design: Activity Analytics Summary Presentation Refresh

## Technical Approach

Implement this as a renderer-only presentation slice in `ActivityAnalyticsWidget.tsx`, with focused RTL coverage in `ActivityAnalyticsWidget.test.tsx`. Set `WidgetHeader.subtitle` to `Distribución` for this slice, then reshape only the summary presentation. Keep `useActivitySeries`, `computeActivityAnalytics`, `displayGrouped`, `GroupedAnalyticsPanel`, and `GroupedStackedBarsChart` unchanged so data requests, grouping, bar geometry, state semantics, and read-only behavior cannot drift.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Remove KPI strip safely | Delete `KpiPanel` usage/model and render the top region without KPI cards. | Hide KPI cards with CSS. | Removing the subtree makes tests prove absence and avoids dead presentation state. |
| Compact distribution layout | Make `WidgetHeader.subtitle` the literal `Distribución`; make `SummaryPanel` unframed content with coverage, donut hero, and right-side details. | Keep the machine name as the header subtitle and place `Distribución` only inside `SummaryPanel`. | The approved proposal/spec define `Distribución` as the widget subtitle, and the spec forbids an inner summary frame. |
| Preserve analytics flow | Build detail rows only from `analytics.durationsMs`, `utilizationRatio`, and `coverageRatio`. | Recompute from raw series in the component. | Reusing computed analytics avoids semantic drift. |
| Donut thickness | Resolve base stroke from available donut size with clamp, then set production stroke to `base * 1.5`. | Keep fixed `8/12` strokes. | Responsive thickness improves constrained/expanded rendering while preserving production emphasis. |

## Data Flow

    /activity-series -> useActivitySeries -> computeActivityAnalytics
        -> analytics.durationsMs/ratios -> SummaryPanel presentation only
        -> displayGrouped unchanged -> GroupedStackedBarsChart unchanged

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modify | Set `WidgetHeader.subtitle` to `Distribución`, remove KPI panel, replace summary inner frame with compact donut/detail layout, add typed detail rows and responsive donut stroke helper. |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Modify | Update presentation expectations and add invariance coverage. |

No domain, query, service, adapter, persistence, admin-control, or grouped-bar utility files should change.

## Interfaces / Contracts

`WidgetHeader.subtitle` MUST be the literal `Distribución` for this slice. Do not keep the selected machine name in `WidgetHeader.subtitle`, and do not treat `Distribución` as only an inner summary heading.

Right-side detail layout uses one flex row inside `SummaryPanel`: donut container `shrink-0`, details container `flex flex-col justify-center`, and parent `items-center`, keeping details vertically centered relative to the donut.

Inline values are local presentation data, not a domain type:

```ts
type SummaryDetailKey = 'prod' | 'setup' | 'stopped';
type SummaryDetailRow = Readonly<{
  key: SummaryDetailKey;
  title: 'Producción' | 'Setup' | 'Detenida';
  durationMs: number;
  percentLabel: string;
  hoursLabel: string;
  valueLabel: `${string} - ${string}`;
}>;
```

`percentLabel` is `durationMs / max(prod + setup + stopped, 1)` formatted with existing `formatPercent`; `hoursLabel` uses existing `formatDurationHours`; `valueLabel` is `${percentLabel} - ${hoursLabel}`. Order is `prod`, `setup`, `stopped`.

Typography mapping stays on existing style constants: coverage and `valueLabel` use `TECHNICAL_TYPOGRAPHY_STYLE` (`--font-mono`, `--font-weight-mono`, `--font-size-mono`, `--tracking-mono`); detail titles use `GENERAL_TYPOGRAPHY_STYLE` (`--font-system`, `--font-weight-system`, `--font-size-system`, `--tracking-system`). Donut center value remains `WIDGET_VALUE_TEXT_STYLE`.

Donut stroke helper stays local to the renderer:

```ts
base = clamp(Math.min(width, donutRegionHeight) * 0.06, 6, 12);
prod = base * SUMMARY_RING_PROD_THICKNESS_MULTIPLIER;
```

Use the base stroke for track/setup/stopped and subtract the production stroke when resolving safe radius/inner clear space so the emphasized segment is never clipped.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit/RTL | Header subtitle and no KPI strip/cards or inner summary frame | Assert `WidgetHeader.subtitle` renders `Distribución`, while `activity-analytics-kpis` and the old framed summary test id are absent. |
| Unit/RTL | Detail ordering and inline strings | Assert `Producción`, `Setup`, `Detenida` order and one `% - hours` value per row for known durations. |
| Unit/RTL | Vertical centering/typography | Assert detail container centering classes/test id and style token families for coverage/value/title text. |
| Unit/RTL | Dynamic donut thickness | Emit constrained/expanded resize sizes; assert stroke widths change within clamp and `prod === base * 1.5`. |
| Regression | No analytics drift | Spy `computeActivityAnalytics`/`useActivitySeries` inputs stay unchanged; assert grouped chart segments, labels, bar widths, and read-only controls remain as current tests expect. |

## Migration / Rollout

No migration required. Existing persisted `displayMode: 'kpis-and-bars'` may remain tolerated as an implementation detail only; it must not expand behavior or reintroduce KPI rendering.

## Open Questions

None.
