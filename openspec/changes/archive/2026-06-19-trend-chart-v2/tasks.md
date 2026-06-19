# Tasks: Trend Chart V2

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1,400-2,000 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No — resolved as `feature-branch-chain`
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | V2 types, catalog, density contract | PR 1 | standalone foundation; tests included |
| 2 | History/query pipeline + temporal settings | PR 2 | depends on PR 1 |
| 3 | Timestamp renderer, gaps, zoom/reset | PR 3 | depends on PR 2 |
| 4 | Shifts, summaries, simulation, polish | PR 4 | depends on PR 3 |

## Integration Dependency

- Frontend strict custom-window validation and `maxPoints` normalization/clamp are Slice 2-3 guardrails only.
- Final verification MUST NOT close the change on frontend evidence alone; it requires Node-RED contract validation evidence or explicit backend handoff evidence for the read-only history guardrails.
- Current backend handoff status: satisfied by importable Node-RED v5.3 evidence (`D:/Descargas/HMI - API History v5.3 importable.json`) covering static validation and direct history-function execution; live import/deployment in a running Node-RED instance remains an operational follow-up.

## Phase 1: Foundation

- [x] 1.1 RED: add `hmi-app/src/domain/dataContract.types.test.ts` and `hmi-app/src/domain/admin.types.test.ts` for V2 ranges, `custom`, `timestampMs`, `historicalDensity`, `plantTimezone`, and shift types.
- [x] 1.2 GREEN: update `hmi-app/src/domain/dataContract.types.ts` and `hmi-app/src/domain/admin.types.ts`; register `trend-chart-v2` while preserving legacy `trend-chart`.
- [x] 1.3 RED/GREEN: add `hmi-app/src/utils/widgetCapabilities.test.ts`, `hmi-app/src/widgets/WidgetRenderer.test.tsx`, `hmi-app/src/components/admin/WidgetCatalogRail.test.tsx`, then wire `WidgetRenderer.tsx`, `widgetCapabilities.ts`, `WidgetCatalogRail.tsx`, and `DashboardBuilderPage.tsx` for V2 insertion defaults.
- [x] 1.4 RED/GREEN: add `hmi-app/src/components/admin/PropertyDock.test.tsx`, then expose builder-only `Densidad histórica` in `PropertyDock.tsx` with `low|normal|high -> 400|800|1500`, fallback `normal`, hidden from dashboard operators.

## Phase 2: Data and Global Settings

- [x] 2.1 RED: add `hmi-app/src/utils/trendChartV2Density.test.ts`; GREEN: create `hmi-app/src/utils/trendChartV2Density.ts` for density normalization and `maxPoints` mapping.
- [x] 2.2 RED/GREEN: extend `hmi-app/src/services/dataHistory.service.test.ts`, `dataHistory.adapter.test.ts`, and `queries/useDataHistory.test.tsx`; then update `dataHistory.service.ts`, `dataHistory.adapter.ts`, and `useDataHistory.ts` for preset/custom GET queries, legacy-range compatibility, `window`, nulls, and configured endpoint preservation.
- [x] 2.3 RED: add `hmi-app/src/config/temporalSettings.config.test.ts` and `hmi-app/src/hooks/useTemporalSettings.test.tsx`; GREEN: create `src/config/temporalSettings.config.ts` and `src/hooks/useTemporalSettings.ts` with local config persistence and `hmi:temporal-settings-changed` re-render events.
- [x] 2.4 RED/GREEN: extend `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx`; create `TemporalSettingsTab.tsx`; update `GlobalSettingsDialog.tsx` for `Ajustes`, draft retention, configurable shifts, and immediate save propagation.

## Phase 3: V2 Renderer and Interaction

- [x] 3.1 RED: add `trendChartV2Time.test.ts`, `trendChartV2Segments.test.ts`, and `TrendChartV2Widget.test.tsx` window cases; GREEN: create `trendChartV2Time.ts`, `trendChartV2Segments.ts`, and `TrendChartV2Widget.tsx` for timestamp-domain rendering and gap/null segmentation.
- [x] 3.2 RED/GREEN: add `hmi-app/src/components/ui/TrendChartV2InteractionLayer.test.tsx`; create a V2-specific interaction layer for timestamp hover and drag-to-zoom instead of forcing `ChartHoverLayer.tsx`; keep legacy charts unchanged.
- [x] 3.3 GREEN: wire V2 drag-to-zoom custom GET refresh, loading-safe visible zoom state, and reset/back-to-preset behavior in `TrendChartV2Widget.tsx` and query params.

## Phase 4: Shifts, Summary, Simulation

- [x] 4.1 RED: add `trendChartV2Shifts.test.ts`; GREEN: create `trendChartV2Shifts.ts` for `auto|bands|lines`, midnight-crossing intervals, tooltip shift labels, and visible-shift `last|min|max|avg` summary.
- [x] 4.2 RED/GREEN: add `trendChartV2Simulation.test.ts`; create `trendChartV2Simulation.ts` or update `trendDataGenerator.ts` for deterministic, range-aware simulated history.

## Phase 5: Verification

- [x] 5.1 Run slice-scoped TDD checks before each GREEN step and final focused commands from `hmi-app/`: `npm run test -- dataHistory trendChart temporalSettings`, then focused eslint for touched files and `npx tsc -b`; keep repo-wide `npm run lint` as explicit pre-existing follow-up evidence, not Slice 4 completion evidence.
- [x] 5.2 Capture Node-RED contract validation or explicit backend handoff evidence for GET-only history, strict ISO UTC custom windows, `start < end`, `<=365d`, `maxPoints default 800 / min 100 / max 2000`, reject-or-clamp before storage, and safe invalid-request errors.
  - Validation status against Node-RED flow `D:/Descargas/HMI - API History v5.3 importable.json`: GET-only PASS, strict ISO UTC PASS, impossible-date round-trip rejection PASS, `start < end` PASS, custom duration `<=365d` PASS, `maxPoints` default/min/max PASS, reject/clamp before storage PASS, safe invalid-request errors PASS.
  - Evidence method: JSON parse, flow-structure inspection, and direct execution of the history function logic with runtime checks for valid custom requests, invalid local/no-`Z`/date-only/impossible dates, `end<=start`, `>365d`, and `maxPoints` default/min/max normalization.
  - Caveat: this session validated an importable handoff artifact, not a live import into a running Node-RED instance; operational deployment/import remains follow-up work outside this documentation update.
