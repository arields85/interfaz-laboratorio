# Apply Progress: activity-analytics

## Change
- Name: `activity-analytics`
- Work units completed: `PR 1 / Slice 1`, `PR 2 / Slice 2`, `PR 2 / Slice 2 review remediation`, `PR 3 / Slice 3`, `PR 3 / Slice 3 review remediation`, `PR 3 / Slice 3 fresh review findings follow-up`, `PR 4 / Slice 4`
- Current work unit: `PR 4 / Slice 4`
- Mode: `Strict TDD`
- Delivery: `stacked-to-main`
- Scope boundary: `Slice 4 performance/fluency optimization for activity-analytics calculation memoization, pure composition, and focused verification`

## Review Boundary Notes
- Completed plumbing, pure analytics/grouping, and Slice 3 widget wiring; custom dashboard date controls, ranking/table blocks, and final secondary chart polish remain out of scope.
- Slice 3 limits runtime work to safe first-release states plus minimal KPI/stacked-bar skeletons; richer visualization polish is intentionally deferred.
- The endpoint remains GET-only and can be disabled intentionally with an empty stored activity-series endpoint.
- Backend `summary` stays preserved in the contract for future internal use but is still hidden from final users.

## Completed Tasks
- [x] 1.1 Add `activity-series` config helpers/tests in `hmi-app/src/config/dataConnection.config.ts` and `hmi-app/src/config/dataConnection.config.test.ts`; empty endpoint now disables requests while defaulting to `/api/hmi-data/activity-series` when unset.
- [x] 1.2 Update `hmi-app/src/components/admin/ConnectionSettingsTab.tsx` and `hmi-app/src/components/admin/ConnectionSettingsTab.test.tsx`; builder config now edits `Endpoint Activity-Series`, previews `URL ACTIVITY-SERIES`, preserves empty disablement, and invalidates the future activity query key.
- [x] 1.3 Create `hmi-app/src/domain/activityAnalytics.types.ts`; extend `hmi-app/src/domain/admin.types.ts`, `hmi-app/src/domain/admin.types.test.ts`, and `hmi-app/src/domain/index.ts` with `activity-analytics` contracts, preset ranges, grouping options, and typed widget display options.
- [x] 1.4 RED then GREEN for `hmi-app/src/services/activitySeries.service.test.ts` and `hmi-app/src/adapters/activitySeries.adapter.test.ts`; covered GET serialization, preset-only validation, custom rejection, purpose enforcement, invalid window rejection, and sorted series behavior.
- [x] 1.5 Implement `hmi-app/src/services/activitySeries.service.ts`, `hmi-app/src/adapters/activitySeries.adapter.ts`, `hmi-app/src/queries/useActivitySeries.ts`, and `hmi-app/src/utils/activitySeriesQueryValidation.ts`; query key is `['data','activity-series',machineId,range,start,end]` with clear disabled/error boundaries.
- [x] 2.1 RED tests in `hmi-app/src/utils/activityAnalytics.test.ts` for threshold classification, delta durations, trailing cap, gaps, utilization denominator, stop counts, kWh, and coverage.
- [x] 2.2 Implement `hmi-app/src/utils/activityAnalytics.ts` as a pure analytics engine that normalizes negatives, validates `prod > setup`, keeps gaps as `no-data`, caps trailing duration, excludes `no-data` from utilization, integrates kWh from data-backed intervals, and blocks stop counts across gaps.
- [x] 2.3 RED tests in `hmi-app/src/utils/activityAnalyticsGrouping.test.ts` for deterministic shift/day/week/month grouping, overnight shifts, local day boundaries, and timezone fallback stability.
- [x] 2.4 Implement `hmi-app/src/utils/activityAnalyticsGrouping.ts` with deterministic timezone resolution, reusable temporal-settings semantics, and overnight shift grouping without browser-local drift or `temporalGrouping.ts` hardcoded shifts.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `hmi-app/src/config/dataConnection.config.test.ts` | Unit | N/A (new coverage for existing config file) | ✅ Written — new exports were referenced before implementation | ✅ Passed — `npm run test -- src/config/dataConnection.config.test.ts` | ✅ 3 cases — default URL, empty disablement, custom endpoint normalization | ✅ Clean — reused existing config helpers and storage conventions |
| 1.2 | `hmi-app/src/components/admin/ConnectionSettingsTab.test.tsx` | Integration | N/A (no pre-existing tab test) | ✅ Written — activity-series field/summary assertions failed before UI wiring | ✅ Passed — `npm run test -- src/components/admin/ConnectionSettingsTab.test.tsx` | ✅ 2 cases — default preview path and empty-endpoint save/invalidation path | ✅ Clean — moved saveRef wiring to an effect and kept initialization in lazy state |
| 1.3 | `hmi-app/src/domain/admin.types.test.ts` | Unit | ✅ 1/1 passing baseline — `npm run test -- src/domain/admin.types.test.ts` | ✅ Written — activity-analytics type imports failed before domain additions | ✅ Passed — `npm run test -- src/domain/admin.types.test.ts` | ✅ 2 cases — widget narrowing plus response/range contract coverage | ✅ Clean — domain additions stayed isolated to dedicated activity analytics types |
| 1.4 | `hmi-app/src/services/activitySeries.service.test.ts`, `hmi-app/src/adapters/activitySeries.adapter.test.ts` | Unit | N/A (new files) | ✅ Written — service/adapter imports failed before implementation | ✅ Passed — `npm run test -- src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts` | ✅ 3 + 3 cases — serializer, config error, custom rejection, purpose guard, window guard, sorted series | ✅ Clean — extracted query validation to keep service and query semantics aligned |
| 1.5 | `hmi-app/src/queries/useActivitySeries.test.tsx` | Unit | N/A (new file) | ✅ Written — hook import failed before implementation | ✅ Passed — `npm run test -- src/queries/useActivitySeries.test.tsx` | ✅ 2 cases — disabled boundary and enabled fetch/adapt boundary | ✅ Clean — hook mirrors existing history query patterns without touching analytics math |

## Test Summary
- Total tests written: 15
- Total tests passing: 15 slice-specific / 46 focused including affected baselines
- Layers used: Unit (13), Integration (2), E2E (0)
- Approval tests: None — this slice added new behavior and contract wiring
- Pure functions created: 2 (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers)

## Verification
- ✅ `npm run test -- src/config/dataConnection.config.test.ts src/components/admin/ConnectionSettingsTab.test.tsx src/domain/admin.types.test.ts src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx src/services/dataHistory.service.test.ts src/adapters/dataHistory.adapter.test.ts src/queries/useDataHistory.test.tsx`
- ✅ `npx tsc -b`
- ✅ `npx eslint src/config/dataConnection.config.ts src/config/dataConnection.config.test.ts src/components/admin/ConnectionSettingsTab.tsx src/components/admin/ConnectionSettingsTab.test.tsx src/domain/activityAnalytics.types.ts src/domain/admin.types.ts src/domain/admin.types.test.ts src/domain/index.ts src/services/activitySeries.service.ts src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.ts src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.ts src/queries/useActivitySeries.test.tsx src/utils/activitySeriesQueryValidation.ts`
- ⚠️ `npm run lint` still reports pre-existing repo-wide issues outside this slice (for example `AdminNumberInput.tsx`, `DesignSettingsTab.tsx`, `useMachineActivity.ts`, `MachineActivityWidget.tsx`).

## Slice 1 Review Remediation
- Added service tests for sanitized upstream `400/500` JSON failures and explicit network-failure wrapping so UI consumers do not receive raw backend internals.
- Tightened adapter validation so invalid `machineId` / unsupported `range` fail as `ActivitySeriesAdapterError` instead of silently defaulting.
- Wrapped malformed `series` entries (`null`, primitives) in `ActivitySeriesAdapterError` instead of leaking raw `TypeError`.
- Sanitized query-facing `DataServiceError` messages by status code before returning them to future UI consumers.
- Hardened the normal Vitest command with `--allowOnly=false` so `test.only` cannot pass `npm run test` silently.
- Tightened response identity validation again so `machineId` must be a positive integer; finite decimal ids like `7.5` now fail fast in the adapter.

## TDD Cycle Evidence — Review Remediation
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.4 remediation | `hmi-app/src/services/activitySeries.service.test.ts`, `hmi-app/src/adapters/activitySeries.adapter.test.ts` | Unit | ✅ 6/6 passing baseline — `npm run test -- src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts` | ✅ Written — added failing cases for sanitized `400/500`, malformed identity, and malformed series entries before code changes | ✅ Passed — `npm run test -- src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts` | ✅ 6 cases — client/server JSON failures, network failure, invalid identity, invalid window with valid identity, malformed series entries | ✅ Clean — extracted status-based sanitization and guarded series entry validation without widening scope |
| 1.5 remediation | `hmi-app/src/queries/useActivitySeries.test.tsx` | Unit | ✅ 2/2 passing baseline — `npm run test -- src/queries/useActivitySeries.test.tsx` | ✅ Written — added failing query-consumer sanitization case before hook changes | ✅ Passed — `npm run test -- src/queries/useActivitySeries.test.tsx` | ✅ 3 cases — disabled query, successful fetch/adapt flow, sanitized UI-facing error flow | ✅ Clean — kept sanitization local to hook return mapping |
| Slice 1 fresh findings | `hmi-app/src/config/testCommandGuard.test.ts`, `hmi-app/src/adapters/activitySeries.adapter.test.ts` | Unit | ✅ 5/5 adapter baseline — `npm run test -- src/adapters/activitySeries.adapter.test.ts`; config script baseline N/A (new structural guard) | ✅ Written — added a failing script-guard assertion and a failing decimal `machineId` case before production changes | ✅ Passed — `npm run test -- src/config/testCommandGuard.test.ts src/adapters/activitySeries.adapter.test.ts` | ✅ 3 cases — valid integer identity, invalid missing identity, invalid decimal identity; config triangulation skipped because the script guard has one intentional output | ✅ Clean — introduced a small positive-integer helper and the smallest supported Vitest CLI guard |

## Verification — Review Remediation
- ✅ `npm run test -- src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx`
- ✅ `npx tsc -b`
- ✅ `npm run test -- src/config/testCommandGuard.test.ts src/adapters/activitySeries.adapter.test.ts`
- ✅ `npm run test -- src/config/allowOnly.guard.test.ts` fails with `Unexpected .only modifier` while the temporary verification file exists, proving the normal command blocks focused tests

## Slice 2: Pure Analytics + Grouping
- Implemented `buildActivityAnalytics()` and `classifyActivityAnalyticsPoint()` as pure utilities that classify one-machine activity points, accumulate durations by timestamp deltas, cap the trailing point at `bucketMs * 1.5`, isolate gaps as `no-data`, exclude `no-data` from utilization, and calculate stop counts/kWh/coverage from data-backed intervals only.
- Implemented `resolveActivityAnalyticsTimezone()` and `groupActivityAnalyticsIntervals()` for deterministic `shift` / `day` / `week` / `month` grouping using saved plant timezone when present, `window.timezone` otherwise, and `America/Argentina/Buenos_Aires` as the final fallback.
- Kept grouping independent from browser-local time and supported overnight shift assignment through anchored local shift dates.

## TDD Cycle Evidence — Slice 2
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 | `hmi-app/src/utils/activityAnalytics.test.ts` | Unit | N/A (new file) | ✅ Written — new utility import failed before implementation | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 5 cases — normalization, boundaries, invalid thresholds, delta/cap math, gaps/utilization/coverage, kWh | ✅ Clean — kept the API pure and interval-driven for later widget reuse |
| 2.2 | `hmi-app/src/utils/activityAnalytics.test.ts` | Unit | N/A (new file) | ✅ Written — analytics result expectations failed before implementation | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 5 cases — normal accumulation, trailing cap, gap isolation, stop-count blocking, data-backed kWh | ✅ Clean — extracted one-machine analytics result shape with explicit interval evidence |
| 2.3 | `hmi-app/src/utils/activityAnalyticsGrouping.test.ts` | Unit | N/A (new file) | ✅ Written — grouping utility import failed before implementation | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 4 cases — overnight shift, day boundary, week/month keys, timezone fallback | ✅ Clean — tests lock timezone behavior to explicit local calendar keys |
| 2.4 | `hmi-app/src/utils/activityAnalyticsGrouping.test.ts` | Unit | N/A (new file) | ✅ Written — grouping bucket expectations failed before implementation | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 4 cases — shift/day/week/month grouping with deterministic timezone precedence | ✅ Clean — reused temporal-settings validation helpers without reviving hardcoded `temporalGrouping.ts` behavior |

## Test Summary — Slice 2
- Total tests written: 24 cumulative (9 in Slice 2)
- Total tests passing: 24 slice-specific cumulative / 9 focused in Slice 2 verification
- Layers used: Unit (22), Integration (2), E2E (0)
- Approval tests: None — Slice 2 added new pure utilities
- Pure functions created: 4 cumulative (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers, `buildActivityAnalytics`, `groupActivityAnalyticsIntervals`)

## Verification — Slice 2
- ✅ `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts`
- ✅ `npx eslint src/utils/activityAnalytics.ts src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.ts src/utils/activityAnalyticsGrouping.test.ts`
- ✅ `npx tsc -b`

## Slice 2 Review Remediation
- Split grouped analytics intervals across `shift` / `day` / `week` / `month` bucket boundaries instead of assigning the entire interval to the start bucket only.
- Preserved stop-count semantics by assigning a transition contribution only to the first split segment while prorating duration and `estimatedKwh` by actual segment duration.
- Added edge coverage for `bucketMs <= 0`, exact `gap === bucketMs * 2`, empty series, and null/`NaN` points remaining `no-data`.
- Hardened adapter timestamp validation so backend timestamps must be ISO strings with `Z` or an explicit numeric offset, avoiding environment-local parsing drift.

## TDD Cycle Evidence — Slice 2 Review Remediation
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 remediation | `hmi-app/src/utils/activityAnalytics.test.ts` | Unit | ✅ 9/9 passing baseline — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ Written — added failing cases for exact-gap handling, null/`NaN`, empty series, and `bucketMs <= 0` before production changes | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 4 cases — exact gap boundary, null/`NaN` no-data, empty series, invalid bucket size | ✅ Clean — added a narrow bucket guard without changing interval math semantics |
| 2.3/2.4 remediation | `hmi-app/src/utils/activityAnalyticsGrouping.test.ts` | Unit | ✅ 9/9 passing baseline — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ Written — added failing single-interval day/shift boundary split cases before grouping changes | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 2 cases — local midnight split and overnight shift-boundary split with no duplicated stop counts | ✅ Clean — extracted segment splitting over existing bucket resolution instead of introducing browser-local fallback logic |
| 1.4 timestamp hardening | `hmi-app/src/adapters/activitySeries.adapter.test.ts` | Unit | ✅ 6/6 passing baseline — `npm run test -- src/adapters/activitySeries.adapter.test.ts` | ✅ Written — added failing window/series timestamp cases without `Z` or offset before adapter changes | ✅ Passed — `npm run test -- src/adapters/activitySeries.adapter.test.ts` | ✅ 2 cases — invalid window timestamp and invalid point timestamp without offset-bearing ISO format | ✅ Clean — isolated validation to a dedicated timestamp helper |

## Test Summary — Slice 2 Review Remediation
- Total tests written: 32 cumulative (8 new in this remediation)
- Total tests passing: 32 slice-specific cumulative / 23 focused in remediation verification
- Layers used: Unit (30), Integration (2), E2E (0)
- Approval tests: None — this remediation changed specified utility/adapter behavior under TDD
- Pure functions created: 5 cumulative (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers, `buildActivityAnalytics`, `groupActivityAnalyticsIntervals`, bucket segment splitter)

## Verification — Slice 2 Review Remediation
- ✅ `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts src/adapters/activitySeries.adapter.test.ts`
- ✅ `npx eslint src/utils/activityAnalytics.ts src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.ts src/utils/activityAnalyticsGrouping.test.ts src/adapters/activitySeries.adapter.ts src/adapters/activitySeries.adapter.test.ts`
- ✅ `npx tsc -b`

## Slice 2 Reliability Test Gap Remediation
- Added explicit week-boundary and month-boundary split-allocation assertions for a single grouped interval so grouped durations, `estimatedKwh`, and one-time stop-transition attribution stay protected beyond day/shift splits.
- Expanded the non-positive `bucketMs` guardrail to cover a direct negative duration bucket input, not just `0`.
- No production implementation changes were required; the existing analytics/grouping utilities already satisfied the stricter reliability expectations.

## TDD Cycle Evidence — Slice 2 Reliability Test Gap Remediation
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1 reliability gaps | `hmi-app/src/utils/activityAnalytics.test.ts` | Unit | ✅ 15/15 passing baseline — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ Written first — negative `bucketMs` coverage was added before execution; implementation was already compliant so no failing production gap remained | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 2 invalid bucket paths — `0` and direct negative `bucketMs` | ➖ None needed — test-only guardrail |
| 2.3/2.4 reliability gaps | `hmi-app/src/utils/activityAnalyticsGrouping.test.ts` | Unit | ✅ 15/15 passing baseline — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ Written first — week/month single-interval split scenarios were added before execution; implementation was already compliant so no production change was needed | ✅ Passed — `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ 2 new boundary paths — week split and month split with prorated metrics and single stop attribution | ➖ None needed — test-only guardrail |

## Verification — Slice 2 Reliability Test Gap Remediation
- ✅ `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts`
- ✅ `npx tsc -b`

## Remaining Tasks
- [ ] 4.1-4.3 Full slice verification and manual builder/runtime checks.

## Slice 3: Widget Wiring and First Release Renderer
- Registered `activity-analytics` across widget capabilities, builder catalog, default dashboard creation, admin config defaults, and runtime renderer dispatch.
- Added dedicated PropertyDock controls for machine selection, preset range, grouping, display mode, and guarded `setup` / `prod` thresholds with clear validation feedback.
- Implemented a first-release `ActivityAnalyticsWidget` skeleton that consumes the dedicated query + analytics utilities, renders KPI cards plus minimal stacked grouped bars, and protects loading / missing machine / endpoint disabled / invalid threshold / empty data / sanitized error states.
- Kept the widget strictly read-only and continued to hide backend `summary` from runtime UI.

## TDD Cycle Evidence — Slice 3
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `hmi-app/src/utils/widgetCapabilities.test.ts`, `hmi-app/src/components/admin/WidgetCatalogRail.test.tsx`, `hmi-app/src/pages/admin/DashboardBuilderPage.test.tsx` | Unit + Integration | ✅ 23/23 passing baseline — `npm run test -- src/utils/widgetCapabilities.test.ts src/components/admin/WidgetCatalogRail.test.tsx src/pages/admin/DashboardBuilderPage.test.tsx` | ✅ Written — new activity-analytics capability/catalog/default assertions failed before implementation | ✅ Passed — `npm run test -- src/utils/widgetCapabilities.test.ts src/components/admin/WidgetCatalogRail.test.tsx src/pages/admin/DashboardBuilderPage.test.tsx` | ✅ 4 cases — capabilities, catalog button, dashboard default size, builder default config | ✅ Clean — extracted shared widget defaults to a dedicated utility |
| 3.2 | `hmi-app/src/components/admin/PropertyDock.test.tsx` | Integration | ✅ 33/33 passing baseline — `npm run test -- src/components/admin/PropertyDock.test.tsx` | ✅ Written — dedicated analytics controls and invalid-threshold guard assertions failed before dock changes | ✅ Passed — `npm run test -- src/components/admin/PropertyDock.test.tsx` | ✅ 3 cases — dedicated controls, machine/range/group updates, invalid threshold warning path | ✅ Clean — activity-analytics path stays isolated from generic binding/unit controls |
| 3.3 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | N/A (new file) | ✅ Written — runtime state expectations referenced a non-existent renderer before implementation | ✅ Passed — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 7 cases — missing machine, endpoint disabled, loading, invalid thresholds, empty data, connection error, backend error | ✅ Clean — state rendering stayed small and deterministic |
| 3.4 | `hmi-app/src/widgets/WidgetRenderer.test.tsx`, `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration + Component | ✅ 2/2 passing baseline — `npm run test -- src/widgets/WidgetRenderer.test.tsx`; renderer file N/A (new) | ✅ Written — dispatch plus runtime KPI assertions failed before renderer wiring | ✅ Passed — `npm run test -- src/widgets/WidgetRenderer.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 3 cases — renderer dispatch, populated KPI rendering, backend summary hidden | ✅ Clean — minimal KPI + stacked-bar skeleton deferred polish while keeping state handling complete |

## Test Summary — Slice 3
- Total tests written: 43 cumulative (11 new in Slice 3)
- Total tests passing: 43 slice-specific cumulative / 72 focused in Slice 3 verification
- Layers used: Unit (31), Integration (9), Component (3), E2E (0)
- Approval tests: None — Slice 3 added new behavior without refactoring legacy output contracts
- Pure functions created: 6 cumulative (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers, `buildActivityAnalytics`, `groupActivityAnalyticsIntervals`, bucket segment splitter, `resolveActivityAnalyticsDisplayOptions`)

## Verification — Slice 3
- ✅ `npm run test -- src/utils/widgetCapabilities.test.ts src/components/admin/WidgetCatalogRail.test.tsx src/pages/admin/DashboardBuilderPage.test.tsx src/components/admin/PropertyDock.test.tsx src/widgets/WidgetRenderer.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx eslint src/utils/activityAnalyticsWidgetDefaults.ts src/utils/widgetCapabilities.ts src/components/admin/WidgetCatalogRail.tsx src/pages/admin/DashboardBuilderPage.tsx src/components/admin/PropertyDock.tsx src/widgets/WidgetRenderer.tsx src/widgets/renderers/ActivityAnalyticsWidget.tsx src/utils/widgetCapabilities.test.ts src/components/admin/WidgetCatalogRail.test.tsx src/pages/admin/DashboardBuilderPage.test.tsx src/components/admin/PropertyDock.test.tsx src/widgets/WidgetRenderer.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx tsc -b`
- ⚠️ Focused test output still includes pre-existing `DashboardBuilderPage.test.tsx` React `act(...)` warnings and existing canvas `getContext()` jsdom notices unrelated to this slice's implementation.

## Slice 3 Review Remediation
- Removed the deferred `kpis-bars-and-secondary` mode from the first-release activity analytics schema and PropertyDock so Slice 3 no longer exposes a no-op secondary-chart configuration.
- Hardened `resolveActivityAnalyticsDisplayOptions()` so legacy persisted configs with unsupported display modes normalize back to the supported first-release mode `kpis-and-bars`.
- Added focused tests that lock the first-release contract to a single supported display mode and verify the admin dock no longer exposes the deferred layout control.

## TDD Cycle Evidence — Slice 3 Review Remediation
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.2/3.4 remediation | `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts`, `hmi-app/src/components/admin/PropertyDock.test.tsx` | Unit + Integration | ✅ 57/57 passing baseline — `npm run test -- src/components/admin/PropertyDock.test.tsx src/domain/admin.types.test.ts src/pages/admin/DashboardBuilderPage.test.tsx src/widgets/WidgetRenderer.test.tsx` | ✅ Written — added failing assertions for supported display modes only and hidden deferred layout control before code changes | ✅ Passed — `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/components/admin/PropertyDock.test.tsx src/domain/admin.types.test.ts src/pages/admin/DashboardBuilderPage.test.tsx src/widgets/WidgetRenderer.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 3 cases — supported mode list, legacy normalization fallback, dock no longer exposes deferred layout control | ➖ None needed — remediation stayed small after type narrowing and default normalization |

## Test Summary — Slice 3 Review Remediation
- Total tests written: 45 cumulative (2 new in this remediation)
- Total tests passing: 45 slice-specific cumulative / 66 focused in remediation verification
- Layers used: Unit (33), Integration (9), Component (3), E2E (0)
- Approval tests: None — this remediation changed specified first-release widget configuration behavior
- Pure functions created: 6 cumulative (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers, `buildActivityAnalytics`, `groupActivityAnalyticsIntervals`, bucket segment splitter, `resolveActivityAnalyticsDisplayOptions`)

## Verification — Slice 3 Review Remediation
- ✅ `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/components/admin/PropertyDock.test.tsx src/domain/admin.types.test.ts src/pages/admin/DashboardBuilderPage.test.tsx src/widgets/WidgetRenderer.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx tsc -b`
- ⚠️ Focused test output still includes pre-existing `DashboardBuilderPage.test.tsx` React `act(...)` warnings and existing canvas `getContext()` jsdom notices unrelated to this remediation.

## Notes
- Repo-wide lint is not green due pre-existing unrelated issues; touched files lint clean.
- Backend `summary` remains preserved in the domain response but is not rendered because renderer work is intentionally deferred to later slices.
- Slice 3 keeps the renderer intentionally skeletal: KPI cards and minimal stacked grouped bars are present, while richer chart polish and any secondary visualizations remain out of scope for the next slice.

## Bugfix Remediation — Invalid activity-series machine binding
- Reproduced the stuck loading path with strict TDD by simulating persisted `binding.machineId` values that were no longer valid for the current contract (`'FT2000'` equipment key and stale numeric ids).
- Hardened `ActivityAnalyticsWidget` so it normalizes legacy numeric-string ids, blocks non-numeric/stale machine bindings before loading, and shows `Seleccione una máquina válida` instead of leaving the widget pending.
- Hardened `useActivitySeries` so disabled/invalid queries never report loading and backend `400` validation failures do not retry, surfacing the sanitized error state immediately.

## TDD Cycle Evidence — Bugfix Remediation
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| activity widget invalid machine remediation | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | ✅ 7/7 passing baseline — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/queries/useActivitySeries.test.tsx` | ✅ Written — added failing invalid-machine cases before production changes | ✅ Passed — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/queries/useActivitySeries.test.tsx` | ✅ 3 state paths — non-numeric key, stale numeric id, valid loading path stays intact | ✅ Clean — extracted binding normalization/state resolution without widening widget scope |
| activity query loading/retry remediation | `hmi-app/src/queries/useActivitySeries.test.tsx` | Unit | ✅ 3/3 passing baseline — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/queries/useActivitySeries.test.tsx` | ✅ Written — added failing disabled-loading and 400-retry cases before hook changes | ✅ Passed — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/queries/useActivitySeries.test.tsx` | ✅ 3 cases — disabled pending query, 400 no-retry, 500 retry | ✅ Clean — kept sanitization local to hook state mapping and retry policy |

## Verification — Bugfix Remediation
- ✅ `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/queries/useActivitySeries.test.tsx`
- ✅ `npm run test -- src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx tsc -b`

## Bugfix Remediation — Legacy machine binding + typography compliance
- Reproduced the `Reiner` runtime regression under strict TDD by simulating a legacy `binding.machineId` persisted as the machine display name instead of the numeric contract `unitId`.
- Hardened `ActivityAnalyticsWidget` so legacy name-based machine bindings resolve against the current contract metadata before querying `activity-series`, preventing false invalid bindings for previously saved widgets.
- Replaced the generic runtime fallback with clearer sanitized states for invalid activity-series contract payloads and invalid processing windows.
- Aligned activity-analytics warning panels, KPI labels/values, grouped labels, and grouped summaries with Builder Design typography categories instead of hardcoded widget-local font sizing.
- Documented the typography rule in `hmi-app/src/widgets/WIDGET_AUTHORING.md` so future widgets must consume the Builder typography tokens.

## TDD Cycle Evidence — Legacy machine binding + typography compliance
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| activity widget legacy binding remediation | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | ✅ 9/9 passing baseline — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Written — added failing legacy `machineId='Reiner'` coverage before production changes | ✅ Passed — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — legacy name binding resolves, stale non-numeric key still stays invalid | ✅ Clean — legacy-name fallback stays local to activity-analytics binding normalization |
| activity widget invalid-contract state remediation | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | ✅ 9/9 passing baseline — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Written — added failing invalid-contract state assertion before production changes | ✅ Passed — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — adapter contract failure and processing-window sanitization share actionable state handling | ✅ Clean — centralized error classification without widening query/service scope |
| activity widget typography compliance | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | ✅ 9/9 passing baseline — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Written — added failing typography-token assertions before styling changes | ✅ Passed — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — warning panel body typography and populated KPI label/value typography | ✅ Clean — typography tokens are centralized in local style constants and guidance doc |

## Verification — Legacy machine binding + typography compliance
- ✅ `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx eslint src/widgets/renderers/ActivityAnalyticsWidget.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx tsc -b`

## Bugfix Remediation — Fresh review findings follow-up
- Clarified `WIDGET_AUTHORING.md` so the typography ban applies to text-size / font / tracking utilities, not semantic text color utilities like `text-industrial-muted`.
- Sanitized `activitySeries.service.ts` network failures to a fixed service-facing message, preventing raw transport or proxy details from leaking through future consumers.
- Replaced the latest activity-analytics card/container hardcoded `bg-black/10`, `bg-white/5`, and `border-white/5` utilities with semantic industrial token-based surfaces while preserving the existing visual hierarchy.

## TDD Cycle Evidence — Fresh review findings follow-up
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| service network sanitization | `hmi-app/src/services/activitySeries.service.test.ts` | Unit | ✅ 6/6 passing baseline — `npm run test -- src/services/activitySeries.service.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Written — added failing expectations for sanitized network failures before service changes | ✅ Passed — `npm run test -- src/services/activitySeries.service.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — `Error` rejection and non-`Error` rejection both sanitize to the same safe message | ✅ Clean — promoted the network error text to a single constant and removed raw message interpolation |
| widget semantic surface compliance | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | ✅ 12/12 passing baseline — `npm run test -- src/services/activitySeries.service.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Written — added failing assertions for semantic border/surface classes before renderer changes | ✅ Passed — `npm run test -- src/services/activitySeries.service.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 3 paths — grouped panel, KPI card, and grouped bucket all use semantic surfaces | ✅ Clean — extracted shared card/panel class constants to keep styling local and consistent |
| widget authoring wording clarification | `N/A (docs)` | Docs | N/A | ✅ Written — wording target identified before doc edit | ✅ Passed — manual review confirms guidance now distinguishes typography utilities from semantic text colors | ➖ Single — one wording clarification only | ➖ None needed |

## Verification — Fresh review findings follow-up
- ✅ `npm run test -- src/services/activitySeries.service.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx eslint src/services/activitySeries.service.ts src/services/activitySeries.service.test.ts src/widgets/renderers/ActivityAnalyticsWidget.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx tsc -b`

## Bugfix Remediation — Activity-series contract consumption
- Reproduced the stuck `Cargando actividad…` behavior under strict TDD by comparing the activity-series adapter/query path against the working Trend Chart V2 history-consumption pattern.
- Relaxed `activitySeries.adapter.ts` to derive `timestampMs` from the endpoint ISO timestamp when the backend omits the denormalized millisecond field, matching the tolerant contract-consumption pattern already used by the history adapter.
- Hardened `useActivitySeries.ts` so adapter contract failures do not retry, allowing the widget to leave the loading state promptly and surface the sanitized invalid-contract UI instead of sitting pending.
- Kept the frontend contract clean: GET `baseNodeRedUrl + endpointActivitySeries` with `machineId` + preset `range`, analytics derived from `series` only, and no Node-RED flow logic copied into the frontend.

## TDD Cycle Evidence — Activity-series contract consumption
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| adapter timestamp fallback remediation | `hmi-app/src/adapters/activitySeries.adapter.test.ts` | Unit | ✅ 8/8 passing baseline — `npm run test -- src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Written — added a failing case where the backend omits `timestampMs` but still returns a valid ISO `timestamp` | ✅ Passed — `npm run test -- src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — explicit `timestampMs` still works and timestamp-derived fallback now works | ✅ Clean — extracted a narrow timestamp fallback helper without loosening other contract guards |
| query retry remediation | `hmi-app/src/queries/useActivitySeries.test.tsx` | Unit | ✅ 5/5 passing baseline — `npm run test -- src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx` | ✅ Written — added a failing no-retry contract-error case before query changes | ✅ Passed — `npm run test -- src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — backend 4xx remains non-retry and adapter contract failures now also stop retrying | ✅ Clean — retry policy stayed local to query behavior |

## Verification — Activity-series contract consumption
- ✅ `npm run test -- src/services/activitySeries.service.test.ts src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx eslint src/adapters/activitySeries.adapter.ts src/adapters/activitySeries.adapter.test.ts src/queries/useActivitySeries.ts src/queries/useActivitySeries.test.tsx`
- ✅ `npx tsc -b`

## Slice 4: Performance / Fluency Optimization
- Extracted a pure `computeActivityAnalytics()` composition helper so the widget now performs KPI + grouping computation in one testable utility instead of recomputing inline on every render.
- Memoized analytics computation in `ActivityAnalyticsWidget` with stable dependencies tied to real calculation inputs (`data`, thresholds, grouping, timezone, shifts) so title/class/layout/editor-only rerenders do not trigger full recomputation.
- Split KPI and grouped-row rendering into memoized child components so unchanged analytics payloads stay lightweight during Builder interaction.

## TDD Cycle Evidence — Slice 4
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| slice 4 pure computation seam | `hmi-app/src/utils/activityAnalyticsComputation.test.ts` | Unit | N/A (new file) | ✅ Written — imported a non-existent `computeActivityAnalytics()` helper before implementation | ✅ Passed — `npm run test -- src/utils/activityAnalyticsComputation.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 cases — representative grouped output plus changed thresholds/grouping/timezone/shifts/window inputs | ✅ Clean — kept composition pure and reused existing analytics/grouping utilities |
| slice 4 render recompute guard | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Component | ✅ 13/13 passing baseline — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts` | ✅ Written — added failing spy-based recompute expectations before memoization changes | ✅ Passed — `npm run test -- src/utils/activityAnalyticsComputation.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ 2 paths — unrelated title/layout/class rerender stays memoized, relevant calculation inputs trigger recomputation | ✅ Clean — moved heavy processing behind `useMemo` and memoized presentational subtrees |

## Test Summary — Slice 4
- Total tests written: 49 cumulative (4 new in Slice 4)
- Total tests passing: 49 slice-specific cumulative / 40 focused in Slice 4 verification
- Layers used: Unit (35), Integration (9), Component (5), E2E (0)
- Approval tests: None — Slice 4 changed calculation orchestration and render memoization behavior under strict TDD
- Pure functions created: 7 cumulative (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers, `buildActivityAnalytics`, `groupActivityAnalyticsIntervals`, bucket segment splitter, `resolveActivityAnalyticsDisplayOptions`, `computeActivityAnalytics`)

## Verification — Slice 4
- ✅ `npm run test -- src/utils/activityAnalytics.test.ts src/utils/activityAnalyticsGrouping.test.ts src/utils/activityAnalyticsComputation.test.ts src/queries/useActivitySeries.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx eslint src/utils/activityAnalyticsComputation.ts src/utils/activityAnalyticsComputation.test.ts src/widgets/renderers/ActivityAnalyticsWidget.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`
- ✅ `npx tsc -b`
- ⚠️ Full repo `npm run lint` and manual builder/runtime verification remain pending in Phase 4 tasks `4.2` and `4.3`.

## Phase 4 Completion Check
- Ran the required focused verification command: `npm run test -- activitySeries activityAnalytics useActivitySeries ActivityAnalyticsWidget widgetCapabilities` → 9 files / 65 tests passed.
- Ran `npx tsc -b` from `hmi-app/` → passed.
- Ran full `npm run lint` from `hmi-app/` → failed on pre-existing unrelated repo issues outside `activity-analytics` scope; maintainer-approved waiver recorded for task `4.2`.
- User explicitly deferred fixing those repo-wide lint failures because they are outside the `activity-analytics` scope; this batch records `4.2` as a maintainer-approved external exception so verification can proceed without falsely claiming global lint is green.
- Manual/runtime evidence available for `4.3`:
  - ✅ User-confirmed runtime evidence: Activity Analytics displays real data.
  - ✅ User-confirmed Builder evidence: fluency improved after Slice 4.
  - ✅ Endpoint disable-empty state is covered by `ConnectionSettingsTab.test.tsx` and `ActivityAnalyticsWidget.test.tsx`.
  - ✅ Default `24h` range is locked by `activityAnalyticsWidgetDefaults.ts` and related tests.
  - ✅ Timezone-stable grouping is covered by `activityAnalyticsGrouping.test.ts`.
  - ✅ Backend `summary` stays hidden in runtime via `ActivityAnalyticsWidget.test.tsx`.
  - ✅ Deferred UI remains absent because display mode is narrowed to `kpis-and-bars` only.
  - ✅ No write flows were introduced; `activitySeries.service.ts` issues GET-only requests.

## TDD Cycle Evidence — Phase 4 Completion Check
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 4.1 verification run | `src/adapters/activitySeries.adapter.test.ts`, `src/services/activitySeries.service.test.ts`, `src/queries/useActivitySeries.test.tsx`, `src/utils/activityAnalytics*.test.ts`, `src/utils/widgetCapabilities.test.ts`, `src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Verification | ✅ Existing focused suites already green in prior slices | ➖ Verification-only task — no new production behavior | ✅ Passed — `npm run test -- activitySeries activityAnalytics useActivitySeries ActivityAnalyticsWidget widgetCapabilities` (65/65) | ✅ Multiple paths exercised across adapter/service/query/analytics/widget coverage | ➖ None needed |
| 4.2 quality gates | `N/A` | Verification | ✅ `npx tsc -b` safety net passed before reporting | ➖ Verification-only task — no new production behavior | ⚠️ Waived by maintainer-approved external exception — `npx tsc -b` passed, `npm run lint` failed on unrelated pre-existing repo issues | ➖ Single verification scope — repo-wide lint + typecheck | ➖ None needed |
| 4.3 manual/runtime evidence | `src/config/dataConnection.config.test.ts`, `src/utils/activityAnalyticsGrouping.test.ts`, `src/widgets/renderers/ActivityAnalyticsWidget.test.tsx`, user-confirmed runtime evidence | Verification | ✅ Prior focused tests and user-confirmed runtime behavior available | ➖ Evidence-gathering task — no new production behavior | ✅ Satisfied by combined automated + user-confirmed evidence | ✅ Covered disable-empty, default `24h`, timezone stability, hidden `summary`, no deferred UI, GET-only flow | ➖ None needed |

## Test Summary — Phase 4 Completion Check
- Total tests written: 49 cumulative (no new tests required for verification-only tasks)
- Total tests passing: 65/65 in the required focused Phase 4 command
- Layers used: Unit, Integration, Component
- Approval tests: None — no refactor behavior changed in this verification batch
- Pure functions created: 7 cumulative (`validateAndNormalizeActivitySeriesQueryParams`, adapter normalization helpers, `buildActivityAnalytics`, `groupActivityAnalyticsIntervals`, bucket segment splitter, `resolveActivityAnalyticsDisplayOptions`, `computeActivityAnalytics`)

## Remaining Tasks
- None for `activity-analytics`. Task `4.2` is closed as a maintainer-approved external exception; repo-wide lint remediation remains a separate follow-up outside this change.

## External Deferred Blockers / Exceptions
- `4.2` is intentionally not being fixed in this change. The blocking `npm run lint` failures are repo-wide and pre-existing in unrelated files, so they were waived by explicit user decision for this change only and recorded in Engram plus this apply-progress artifact.
