# Proposal: Trend Chart V2

## Intent

Deliver `Trend-Chart-V2` as a safer historical-analysis widget that fixes temporal fidelity, zoom querying, and timezone/shift consistency while preserving legacy `trend-chart` as an insertable backup during the transition.

## Scope

### In Scope
- New `trend-chart-v2` widget, visible in the builder catalog from phase one, with real timestamp X-axis, visible data gaps, deterministic simulated mode, shift bands/lines/summary, drag-to-zoom plus reset-to-preset, and widget-admin-controlled historical density.
- New `Ajustes` settings surface for global `plantTimezone` and shift configuration; saving MUST re-render dashboards immediately in the current session.
- Read-only history contract updates for preset ranges (`1h|24h|7d|30d|12m`) and `custom` queries with `start`, `end`, optional technical `maxPoints`, and optional `window` metadata, while remaining backward-compatible with legacy ranges and `1.0` responses. Frontend validation/clamp behavior is a guardrail only; backend/Node-RED remains authoritative.

### Out of Scope
- Automatic migration, retirement, or hiding of legacy `trend-chart`.
- Hardcoded endpoints, Node-RED write/control flows, or any plant/process `POST`/`PUT`/`DELETE` behavior.
- Backend-owned shift summaries; phase one summary remains frontend-derived from the visible series.

## Capabilities

### New Capabilities
- `trend-chart-v2-widget`: historical trend analysis with faithful time scale, gaps, zoom, shift overlays/summary, and admin-controlled historical density.
- `global-temporal-settings`: admin-managed `plantTimezone` and shift definitions for HMI-wide visualization rules.

### Modified Capabilities
- `node-red-binding`: read-only history queries accept preset/custom ranges, optional `window` metadata, and density-derived `maxPoints` hints.
- `loader-options-admin-settings`: Global Settings adds `Ajustes`, preserves drafts, and propagates saved temporal settings immediately.

## Approach

Introduce `TrendChartV2Widget` as a separate widget path. Reuse the existing read-only service/adapter/query pipeline, extend typed history contracts with compatibility mapping for legacy ranges, translate widget `historicalDensity` (`low|normal|high`) into technical `maxPoints` hints (`400|800|1500`) for preset and custom queries, and isolate V2 interaction/rendering changes from legacy `trend-chart`. Deliver in review-safe slices under the 400-line budget: (1) V2 registration + typed contracts, (2) true time scale + null gaps, (3) drag-to-zoom/custom query + reset, (4) `Ajustes` + shifts + summary.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/widgets/renderers/TrendChartWidget.tsx` | Modified | Keep legacy widget stable while sharing safe helpers only if low-risk. |
| `hmi-app/src/widgets/renderers/TrendChartV2Widget.tsx` | New | New V2 renderer and interaction surface. |
| `hmi-app/src/components/admin/PropertyDock.tsx` | Modified | Expose `Densidad histórica` for admins/builders without surfacing raw `maxPoints` to operators. |
| `hmi-app/src/services/dataHistory.service.ts` | Modified | Read-only preset/custom history query support. |
| `hmi-app/src/adapters/dataHistory.adapter.ts` | Modified | Backward-compatible response/window adaptation. |
| `hmi-app/src/components/admin/GlobalSettingsDialog.tsx` | Modified | Add `Ajustes` for timezone and shifts. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Hover/zoom logic assumes uniform spacing | Med | Isolate V2 interaction layer and cover with TDD. |
| Timezone/shift precedence becomes inconsistent | Med | Centralize precedence and use one shared settings source. |
| Density hint diverges from backend throughput limits | Med | Keep frontend mapping centralized, document it as a guardrail only, and require Node-RED to enforce authoritative read-only validation/clamps before storage queries. |
| Work exceeds review budget | Med | Ship the four slices above; keep each slice independently reversible. |

## Rollback Plan

Remove V2 catalog/renderer/settings wiring and revert history-contract extensions while leaving legacy `trend-chart` and existing dashboards untouched.

## Dependencies

- Node-RED MUST support read-only GET history queries for preset and `custom` ranges and MAY return `window.timezone`.
- Node-RED/backend is the authoritative guardrail owner for history load safety: `range=custom` MUST require strict ISO UTC `start/end`, enforce `start < end`, enforce a maximum custom duration of 365 days or a configured equivalent aligned with frontend rules, apply `maxPoints` default `800` with min `100` and max `2000`, reject or clamp invalid/excessive requests before querying storage, and return safe errors for invalid requests.
- This dependency is a backend integration requirement for a read-only endpoint; it MUST NOT be interpreted as permission to add plant/process writes.
- Global settings persistence remains HMI UI configuration only.

## Success Criteria

- [ ] Builder shows both `Trend-Chart-V2` and legacy `trend-chart`; existing dashboards remain unchanged.
- [ ] V2 uses real timestamps, preserves null gaps, and drag-zoom issues a new GET `range=custom&start&end` request with reset/back-to-preset.
- [ ] Admin/builder config shows `Densidad histórica` (`Baja|Normal|Alta`) backed by `historicalDensity`; operator views do not expose raw `maxPoints` or density editing.
- [ ] Preset and custom history queries translate `historicalDensity` to `maxPoints` (`400|800|1500`) with invalid/missing values falling back to `normal=800`; frontend validation/clamp logic is documented as a guardrail only, while Node-RED keeps authoritative backend validation/clamps (`default 800`, `min 100`, `max 2000`).
- [ ] `Ajustes` saves HMI-wide `plantTimezone` and shifts, immediately re-rendering dashboards with precedence `window.timezone` -> `plantTimezone` -> browser local -> `America/Argentina/Buenos_Aires`.
- [ ] Shift bands, lines, and frontend-derived `last/min/max/avg` summary reflect the visible series only.
- [ ] Final verification includes either Node-RED contract validation evidence for the read-only history guardrails or explicit backend handoff evidence that records ownership of those constraints.
