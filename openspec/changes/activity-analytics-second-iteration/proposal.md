# Proposal: Activity Analytics Second Iteration

## Intent

Consolidate `activity-analytics` into one final truthful direction: remove unsupported `1h`, align grouping with the selected window, and make `Turno` understandable as either aggregated summary or guarded chronological detail.

## Scope

### In Scope
- Keep `24h`, `7d`, `30d`, `12m`, and `custom`; remove `1h`.
- Limit runtime grouping by window: `24h -> Turno/Día`, `7d -> Turno/Día/Semana`, `30d -> Día/Semana/Mes`, `12m -> Semana/Mes`, `custom` -> matching effective duration rules.
- Keep `custom` read-only with persisted `start/end` and the existing 30-day guardrail.
- Make `Turno` dual-mode: default `Resumen` = 3 aggregated bars (`Turno 1/2/3`); `Detalle` only for `24h` and `7d`, using chronological real shifts and a partial current in-progress shift bar.
- Make `Resumen` and `Grupos` real X/Y charts in the `prod-history` visual language; bars must fit first, compress second, and scroll only as fallback.
- Keep one primary visual summary only: `Resumen` is the hero summary, `Grupos` is the comparative detail layer, and `Mejor/Peor` uses compact chart typography.
- Preserve truthful states: `sin datos`, `sin turno`, coverage semantics, in-progress labeling, runtime grouping, and custom-window behavior.

### Out of Scope
- Reintroducing KPI-strip duplication or pseudo-card fills.
- Allowing `Turno + Detalle` for `30d`, `12m`, or unsupported custom spans.
- Multi-machine analytics or any write/control flow.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `activity-analytics-widget`: final range matrix, grouping compatibility, dual-mode `Turno`, real-chart-only summary/detail, truthful states.
- `global-temporal-settings`: reusable weekly shift applicability/sequence for truthful `Turno` grouping.
- `loader-options-admin-settings`: central `Ajustes` management of shift rules.
- `node-red-binding`: read-only custom `activity-series` windows with existing validation.

## Approach

Keep the read-only `activity-series` pipeline and saved temporal settings. Reuse the `prod-history` SVG/chart pattern so `Resumen` always communicates selected-window totals, `Grupos` communicates bucket comparison, and responsive density follows fit -> compress -> scroll without hiding uncertainty.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx`, `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` | Modified | Final chart presentation, responsive density, `Turno` mode gating |
| `hmi-app/src/utils/activityAnalytics.ts`, `hmi-app/src/utils/activityAnalyticsGrouping.ts` | Modified | Truthful grouped buckets, `sin turno`, in-progress shift detail |
| `hmi-app/src/components/admin/TemporalSettingsTab.tsx`, `hmi-app/src/services/activitySeries.service.ts`, `hmi-app/src/queries/useActivitySeries.ts` | Modified | Weekly shift rules and validated custom windows |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Dense widgets crowd labels | Med | Reuse `prod-history` spacing, compact typography, and compression thresholds |
| Aggregated `Turno` is confused with chronological detail | Med | Show `Detalle` only for `24h`/`7d` and label it explicitly |
| Low coverage looks overstated | Med | Keep `sin datos`, `sin turno`, coverage, and in-progress semantics visible |

## Rollback Plan

Revert the second-iteration visual/range rules to the prior shipped presentation while preserving read-only endpoint and temporal-settings contracts.

## Dependencies

- `/api/hmi-data/activity-series` GET endpoint, saved `Ajustes` shift rules, and `prod-history` chart conventions/primitives.

## Success Criteria

- [ ] The widget never offers `1h` and only offers grouping options allowed by the active range or effective custom duration.
- [ ] `Turno + Resumen` always shows 3 aggregated bars; `Detalle` appears only for `24h`/`7d` and includes a partial active shift when applicable.
- [ ] `Resumen` and `Grupos` are real `prod-history`-style X/Y charts with fit -> compress -> scroll behavior and no duplicated KPI strip.
- [ ] `Resumen` stays the hero summary, `Grupos` stays the comparative layer, and `Mejor/Peor` uses compact chart typography.
- [ ] Uncertainty remains explicit through `sin datos`, `sin turno`, coverage semantics, in-progress labeling, and preserved custom-window behavior.
