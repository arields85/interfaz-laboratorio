# Design: Trend Chart V2

## Technical Approach

Implement `Trend-Chart-V2` as a new widget path that reuses the existing read-only `service -> adapter -> query -> renderer` pipeline, but adds V2-only contracts, time utilities, interaction logic, temporal settings consumers, and an admin-friendly `historicalDensity` setting. Legacy `trend-chart` stays insertable and untouched except for shared low-risk plumbing. V2 resolves its visible window from `response.window`, else custom query, else preset metadata, always renders by `timestampMs`, and translates `historicalDensity` into the technical `maxPoints` query hint without exposing that parameter to operators. Frontend strict custom-window validation and `maxPoints` normalization/clamp remain preflight guardrails only; Node-RED stays authoritative for rejecting or clamping unsafe read-only history requests before storage access.

## Architecture Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Widget boundary | Refactor legacy / separate widget | Separate `trend-chart-v2` | Protects existing dashboards, keeps review slices smaller, and isolates risky hover/zoom/gap logic. |
| Temporal settings state | LocalStorage-only reads / persisted Zustand / config + event hook | `temporalSettings.config` + `useTemporalSettings()` | Matches current config-module patterns (`dataConnection`, `loaderOptions`) while enabling immediate same-session re-render via a DOM event subscription. |
| Chart interaction layer | Reuse `ChartHoverLayer` / patch it heavily / V2-specific overlay | V2-specific overlay | Current hover is index-column based; V2 needs timestamp inversion, drag selection, and nearest-point lookup without risking `prod-history` or legacy trend charts. |
| Historical query UX | Raw `maxPoints` field / operator-exposed density / admin-only friendly density | Admin-only `historicalDensity` -> `maxPoints` mapping | Keeps technical transport details out of runtime UI, gives builders a product-level knob, and preserves backend ownership of clamping/validation. |
| History compatibility | Replace old ranges / frontend mapping | Keep legacy mapping in adapter/query boundary | Preserves saved widgets and lets V2 speak `1h|24h|7d|30d|12m|custom` without breaking `minuto|hora|dia|semana|mes`. |
| History load guardrails | Frontend-only enforcement / duplicated checks / backend-authoritative validation with frontend preflight | Backend-authoritative validation with frontend preflight | Preserves the read-only HMI boundary, protects storage from direct or malformed requests, and makes Slice 3 safe only when the external Node-RED dependency is explicit. |

## Data Flow

```text
TrendChartV2Widget
  -> resolve historicalDensity (`low|normal|high|fallback normal`)
  -> map density to `maxPoints` hint (`400|800|1500`)
  -> useTemporalSettings() -> resolved timezone/shifts
  -> useDataHistory(historyQuery)
  -> fetchDataHistory(GET baseUrl+historyEndpoint+query)
  -> adaptDataHistory(window + timestampMs + nulls)
  -> build chart model (domain, segments, intervals, summaries)
  -> SVG renderer + interaction overlay
```

```text
TemporalSettingsTab -> saveTemporalSettingsConfig()
  -> localStorage
  -> document "hmi:temporal-settings-changed"
  -> subscribed widgets re-render immediately
```

```text
PropertyDock/Admin builder -> widget.displayOptions.historicalDensity
  -> TrendChartV2Widget query builder
  -> GET history?range=preset|custom&...&maxPoints=<mapped>
  -> frontend preflight blocks invalid custom windows and normalizes `maxPoints`
  -> Node-RED enforces GET-only read-only contract, validates/clamps again, rejects unsafe requests before storage query, returns safe errors
```

## File Changes

| File | Action | Description |
|---|---|---|
| `hmi-app/src/widgets/renderers/TrendChartV2Widget.tsx` | Create | V2 renderer, zoom state, tooltip, reset/back-to-preset, shift overlays, summary. |
| `hmi-app/src/components/admin/TemporalSettingsTab.tsx` | Create | `Ajustes` tab with timezone and shift draft editing. |
| `hmi-app/src/config/temporalSettings.config.ts` | Create | Normalized storage, defaults, save/read helpers, change event dispatch. |
| `hmi-app/src/hooks/useTemporalSettings.ts` | Create | Subscriber hook for same-session re-render and cross-tab sync. |
| `hmi-app/src/utils/trendChartV2Density.ts` | Create | Centralize `historicalDensity` defaults/fallbacks and `maxPoints` mapping for preset/custom queries. |
| `hmi-app/src/utils/trendChartV2Time.ts` | Create | Timezone precedence, preset windows, label formatting, visible-domain resolution. |
| `hmi-app/src/utils/trendChartV2Segments.ts` | Create | Null/gap splitting and SVG segment derivation. |
| `hmi-app/src/utils/trendChartV2Shifts.ts` | Create | Midnight-crossing intervals, auto density, tooltip labels, frontend shift summaries. |
| `hmi-app/src/utils/trendChartV2Simulation.ts` | Create | Seeded, range-aware simulated series. |
| `hmi-app/src/domain/dataContract.types.ts` | Modify | Add V2 range/query/window types and `timestampMs`. |
| `hmi-app/src/domain/admin.types.ts` | Modify | Add widget type/config, `historicalDensity` display option, and global temporal settings types. |
| `hmi-app/src/services/dataHistory.service.ts` | Modify | Serialize preset/custom GET queries, including density-derived `maxPoints`, using configured history URL only. |
| `hmi-app/src/adapters/dataHistory.adapter.ts` / `src/queries/useDataHistory.ts` | Modify | Preserve `window`, legacy-range mapping, richer query key. |
| `hmi-app/src/widgets/WidgetRenderer.tsx`, `src/components/admin/WidgetCatalogRail.tsx`, `src/pages/admin/DashboardBuilderPage.tsx`, `src/components/admin/PropertyDock.tsx`, `src/components/admin/GlobalSettingsDialog.tsx` | Modify | Register V2, expose admin-only density labels, preserve legacy coexistence, and keep operator views free of density controls. |

## Interfaces / Contracts

```ts
type HistoryRangeV2 = '1h' | '24h' | '7d' | '30d' | '12m' | 'custom';
interface HistoryWindow { start: string; end: string; timezone?: string; bucket?: string; bucketMs?: number; }
interface HistoryDataPoint { timestamp: string; timestampMs: number; value: number | null; }
type HistoricalDensity = 'low' | 'normal' | 'high';
interface TrendChartV2DisplayOptions { historicalDensity?: HistoricalDensity; }
interface ShiftDefinition { id: string; label: string; start: string; end: string; }
interface TemporalSettingsConfig { plantTimezone: string | null; shifts: ShiftDefinition[]; }
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | query serialization, density fallback/mapping, timezone precedence, gap splitting, shift interval assignment, shift summary, seeded simulation | Strict TDD in `utils/`, `services/`, `adapters/`. |
| Integration | `useDataHistory` keys, `Ajustes` draft/save propagation, immediate re-render event, V2 zoom/reset behavior, admin-only density editing | RTL + Vitest with mocked query/service boundaries. |
| E2E / external contract | Node-RED read-only history guardrails (`custom` ISO UTC, `start < end`, `<=365d`, `maxPoints` default/min/max, reject-or-clamp before storage, safe errors) | Verify with backend contract evidence or explicit handoff during final verify; frontend tests alone are insufficient. |

## External Contract Evidence Status

Importable Node-RED v5.3 handoff evidence is now available via `D:/Descargas/HMI - API History v5.3 importable.json`. Validation passed by JSON parse, flow-structure inspection, and direct execution of the history function logic: GET-only/read-only PASS, strict ISO UTC custom-window validation PASS, impossible-date round-trip rejection PASS, `start < end` PASS, `<=365d` custom-duration guard PASS, `maxPoints` default/min/max PASS, reject-or-clamp-before-storage PASS, and safe invalid-request errors PASS. This is sufficient backend handoff evidence for OpenSpec planning/verification closure, but it is not live-environment proof because the flow was not imported into a running Node-RED instance in this session.

## Migration / Rollout

No data migration required. Roll out in four review-safe slices under the 400-line budget: (1) domain/contracts + catalog wiring, (2) service/adapter/query + density utilities, (3) renderer/interactions/gaps, (4) `Ajustes` + shifts + summary. Frontend maps `historicalDensity` to `maxPoints` (`400|800|1500`) and treats returned points as authoritative; Node-RED retains default/clamp ownership (`800`, `100..2000`) plus custom-window validation ownership. Legacy `trend-chart` remains insertable until a future change hides it from the catalog and later removes its renderer after explicit dashboard migration. Final verification may close on the documented v5.3 backend handoff evidence; live Node-RED import/deployment remains an operational follow-up outside this change.

## Open Questions

None.
