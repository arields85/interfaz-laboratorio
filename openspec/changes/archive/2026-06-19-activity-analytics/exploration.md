## Exploration: activity-analytics

### Current State
Widgets are registered through the `WidgetType` union, the builder catalog rail, default widget creation in `DashboardBuilderPage`, typed `displayOptions` in `domain/admin.types.ts`, and runtime dispatch in `widgets/WidgetRenderer.tsx`. The closest functional precedent is `machine-activity` for configurable setup/prod semantics and `trend-chart-v2` for real history fetching, strict range validation, timezone precedence, shift overlays, gap-aware series handling, and reusable SVG chart primitives. Connection settings currently persist only base URL + snapshot endpoint + history endpoint in localStorage, and the existing history stack is tightly coupled to `/history` plus `variableKey`, so `activity-analytics` needs a dedicated endpoint/config/query path rather than a thin alias.

### Affected Areas
- `hmi-app/src/domain/admin.types.ts` — add `activity-analytics` to `WidgetType`, define typed display options/config, and likely add a dedicated response/query domain model under `src/domain/`.
- `hmi-app/src/widgets/WidgetRenderer.tsx` — register the new renderer.
- `hmi-app/src/components/admin/WidgetCatalogRail.tsx` — expose the widget in the builder catalog.
- `hmi-app/src/pages/admin/DashboardBuilderPage.tsx` — provide default widget title, size, binding, and display options.
- `hmi-app/src/components/admin/PropertyDock.tsx` — reuse/adapt machine/variable/unit controls and add analytics-specific options.
- `hmi-app/src/config/dataConnection.config.ts` — add a third configurable read-only endpoint for activity-series.
- `hmi-app/src/components/admin/ConnectionSettingsTab.tsx` — add the new endpoint field and URL summary row.
- `hmi-app/src/services/*.ts`, `hmi-app/src/queries/*.ts`, `hmi-app/src/adapters/*.ts`, `hmi-app/src/domain/*.ts` — introduce a dedicated activity-series fetch/adapter/query/domain pipeline.
- `hmi-app/src/hooks/useTemporalSettings.ts`, `hmi-app/src/config/temporalSettings.config.ts`, `hmi-app/src/utils/trendChartV2Shifts.ts`, `hmi-app/src/utils/trendChartV2Time.ts` — existing timezone + shift logic is reusable for grouping and shift assignment.
- `hmi-app/src/components/ui/ChartTooltip.tsx`, `hmi-app/src/utils/chartHelpers.ts`, `hmi-app/src/widgets/renderers/TrendChartV2Widget.tsx` — reusable chart interaction and presentation patterns.

### Validated Backend Contract
- Authoritative source for this frontend contract: `C:\Users\Ariel\Desktop\Interfaz\Flujos Node-RED\v2\HMI - API Activity-Series v1.json`.
- Flow tab label: `HMI - API Activity-Series`; endpoint: `GET /api/hmi-data/activity-series`; purpose: `activity-analytics`.
- Backend constants confirmed: fixed `TIMEZONE = America/Argentina/Buenos_Aires`, `DEFAULT_RANGE = 24h`, `VARIABLE_KEY = Total kW`, `UNIT = kW`, and custom range max `365 days` with strict ISO UTC validation.
- Preset aliases and buckets are backend-defined (`minuto -> 1h`, `hora -> 24h`, `dia -> 30d`, `semana -> 7d`, `mes -> 12m`) and custom buckets step from `10s` up to `1h` by duration.
- Flux uses `aggregateWindow(every: bucket, fn: mean, createEmpty: false)`, so missing intervals are omitted entirely. Frontend planning MUST treat those omissions as gaps/no-data, not implicit stopped time.
- Response fields confirmed: `contractVersion`, `machineId`, `variableKey`, `range`, `unit`, `purpose`, `window`, `series`, `summary`; backend errors also return structured JSON.
- Product decision for this change: frontend may consume `window` and `series`, but MUST NOT display backend `summary` to final users.
- Temporal implication: backend timezone is fixed to `America/Argentina/Buenos_Aires`, but analytics grouping still needs HMI global temporal settings when configured and MUST avoid browser-local grouping.

### Approaches
1. **Dedicated activity-series stack** — create a new service/adapter/query/domain model for `/activity-series`, then build analytics-specific pure calculators and renderer on top.
   - Pros: matches the endpoint contract, avoids forcing `variableKey`, keeps `/history` untouched, makes tests and errors explicit.
   - Cons: more files up front.
   - Effort: Medium

2. **Reuse history stack with branching** — extend `useDataHistory`/`fetchDataHistory`/history domain types to optionally hit `/activity-series` and ignore `variableKey`.
   - Pros: fewer new entry points.
   - Cons: mixes two contracts, fights current validations, increases regression risk for trend widgets, and hides endpoint-specific semantics.
   - Effort: Medium/High

### Recommendation
Use a dedicated `activity-series` pipeline, but deliberately reuse existing temporal utilities and chart primitives from `trend-chart-v2`. Reuse `machine-activity` only for naming/default semantics (`setup`, `prod`, threshold ordering), not for the calculation engine itself. Treat the validated Node-RED flow JSON above as the authoritative contract reference, keep omitted buckets as explicit gaps/no-data, preserve global temporal settings as the grouping source, and keep backend `summary` hidden from end users. This keeps the endpoint contract honest, preserves existing history behavior, and contains the review scope.

### Risks
- `useDataHistory` and `fetchDataHistory` currently require `variableKey` and serialize `/history` semantics, so reusing them directly would be a design mismatch.
- `machine-activity` today is live-point classification with hysteresis/confirmation, not duration analytics over timestamped series.
- `temporalGrouping.ts` is hardcoded to fixed 6/14/22 shift logic and local `Date`; it is not suitable for configurable cross-midnight shift analytics.
- The requested analytics need a new domain contract for `purpose`, `window`, `series`, `summary`, gap/no-data treatment, and frontend-derived KPIs.
- A single slice can easily exceed the 600-line review budget unless split into endpoint/config plumbing first, then pure analytics, then renderer/admin wiring.

### Ready for Proposal
Yes — tell the user the codebase already has strong reuse points for timezone, shifts, chart primitives, and widget registration, but the data contract should be implemented as a new read-only activity-series pipeline instead of piggybacking on the existing history endpoint stack.
