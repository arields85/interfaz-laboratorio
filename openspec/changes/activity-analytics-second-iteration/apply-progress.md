# Apply Progress: activity-analytics-second-iteration

## Change
- Name: `activity-analytics-second-iteration`
- Work unit: `final consistency batch`
- Mode: `Strict TDD`
- Delivery: `feature-branch-chain`
- Scope boundary: `Fix the remaining code/test inconsistencies after PR 4B behavior work, prove lint/build/tests are green, and stop before verify-report/archive work.`

## Review Boundary Notes
- Merged previous apply-progress context from Engram topic `sdd/activity-analytics-second-iteration/apply-progress` before writing this artifact.
- Preserved earlier batch context: weekly temporal-settings truth, custom-window persistence, shared display-rule clamps, and the existing hero-summary/grouped-chart runtime foundation.
- This feature-branch-chain slice stays autonomous: consistency-only fixes for delegated tests, defaults expectations, and lint/type safety, then stop before any historical chain-evidence reconstruction.

## Completed Tasks
- [x] 1.1 Create `hmi-app/src/utils/activityAnalyticsDisplayRules.ts` with the final range/group matrix, custom-duration rules, fallback group, and `Turno` detail eligibility.
- [x] 1.2 Update `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` to normalize legacy `1h -> 24h`, clamp invalid persisted groups, and reset unsupported `turnoMode` via shared rules.
- [x] 1.3 Update `hmi-app/src/components/admin/PropertyDock.tsx` so admin range/group controls never offer `1h` and always mirror the shared compatibility matrix.
- [x] 2.1 Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` runtime controls to remove `1h`, enforce the same matrix, and keep custom-window behavior truthful.
- [x] 2.2 Refine `ActivityAnalyticsWidget.tsx` so `Turno` defaults to `Resumen`, exposes `Detalle` only for `24h/7d`, and renders the current shift as a partial bar.
- [x] 2.3 Rework `ActivityAnalyticsWidget.tsx` and `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` to render one hero `Resumen`, compact `Mejor/Peor`, and real `prod-history`-style charts with `fit -> compress -> scroll`.
- [x] 3.1 Add unit coverage in `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` and new `activityAnalyticsDisplayRules.test.ts` for `1h` removal, matrix clamps, and custom-duration fallbacks.
- [x] 3.2 Update `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` for `Turno Resumen` non-scroll, `Turno Detalle` compression, and text fallback thresholds.
- [x] 3.3 Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` for hero-only summary, no KPI strip, dual-mode `Turno`, compact `Mejor/Peor`, truthful `sin datos/sin turno`, and runtime custom windows.
- [x] 4.1 Run targeted Vitest for `activityAnalyticsDisplayRules`, `activityAnalyticsWidgetDefaults`, `activityAnalyticsVisualLayout`, and `ActivityAnalyticsWidget`.

## Implementation Notes
- PropertyDock now uses the same display-rules resolver as runtime defaults, so admin never reintroduces `1h`, clears stale custom bounds when switching back to preset ranges, and clamps invalid persisted `groupBy` values immediately on range changes.
- The grouped visual-layout resolver now treats `Turno + Resumen` as an aggregated three-bucket view even if upstream callers still provide chronological counts, which prevents summary-mode scroll regressions while preserving detail-mode compression/scroll thresholds.
- Focused tests now lock admin/runtime parity and the final non-scroll Turno summary contract without widening the PR slice beyond the current work unit.
- Turno summary no longer renders partial outlines for aggregated buckets; the dashed expected-duration outline appears only in `Detalle`, which keeps the in-progress cue truthful instead of implying every aggregated shift bucket is still open.
- `Mejor/Peor` now reads from the visible grouped buckets and renders compact duration/productivity context rows instead of bare KPI-like labels, keeping the comparison panel aligned with the prod-history-style chart treatment.
- Final correction: shared range/group rules now keep `Turno` available for `30d`, `12m`, and long custom windows in `Resumen` only, while `Detalle` remains gated to `24h/7d + Turno`.
- Runtime view-state sync now clears local group overrides when persisted display options change range/window, so builder-driven updates still rehydrate the intended saved group before users apply a new runtime override.
- Final UI-contract correction: runtime no longer exposes the `custom` trigger/editor, but persisted `custom` windows still hydrate query bounds and grouping behavior internally.
- Admin already hid `custom`; the focused batch locked that contract with explicit builder expectations instead of reopening the control path.

## Verification Evidence
- Safety net: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`31` baseline tests passing before this consistency batch).
- RED check: `npm run test -- src/widgets/WidgetRenderer.test.tsx` ❌ (`3` stale expectations failing: visible `Custom`, standalone `% Prod.` matcher, and invalid `24h -> Semana/Mes` runtime assumptions).
- RED check: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts` ❌ (`1` stale long-custom expectation failing: `10d custom + shift` now remains compatible instead of clamping to `day`).
- GREEN check: `npm run test -- src/widgets/WidgetRenderer.test.tsx` ✅ (`5` tests passing after aligning the delegated runtime expectations with the final hidden-custom/runtime-matrix contract).
- GREEN check: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts` ✅ (`3` tests passing after aligning custom-duration compatibility expectations).
- Lint RED: `npm run lint` ❌ (unused `ACTIVITY_ANALYTICS_RUNTIME_RANGE_OPTIONS` import in `ActivityAnalyticsWidget.tsx`).
- Typecheck RED: `npx tsc -b` ❌ (nullability mismatch for `comparison.best` / `comparison.worst` in `createComparisonEntry(...)`).
- Lint GREEN: `npm run lint` ✅.
- Typecheck GREEN: `npx tsc -b` ✅.
- Focused regression sweep: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/widgets/WidgetRenderer.test.tsx src/utils/activityAnalyticsWidgetDefaults.test.ts` ✅ (`39` focused tests passing).
- Full suite: `npm run test` ✅ (`112` files / `809` tests passing; existing jsdom canvas warnings and unrelated `act(...)` warnings remain non-blocking and pre-existing).
- Safety net: `npm run test -- src/components/admin/PropertyDock.test.tsx` ✅ (`36` baseline tests passing before RED changes).
- Safety net: `npm run test -- src/utils/activityAnalyticsVisualLayout.test.ts` ✅ (`6` baseline tests passing before RED changes).
- Safety net: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`30` baseline tests passing before GREEN verification in this slice).
- RED check: `npm run test -- src/components/admin/PropertyDock.test.tsx` ❌ (`1` failing admin-parity expectation: `1 hora` was still offered and range changes did not prove clamped grouping).
- RED check: `npm run test -- src/utils/activityAnalyticsVisualLayout.test.ts` ❌ (`1` failing expectation: `Turno + Resumen` still resolved to a scrollable grouped layout instead of staying non-scroll by definition).
- GREEN / regression check: `npm run test -- src/components/admin/PropertyDock.test.tsx` ✅ (`37` tests passing).
- GREEN / regression check: `npm run test -- src/utils/activityAnalyticsVisualLayout.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`37` tests passing).
- Focused PR4B sweep: `npm run test -- src/components/admin/PropertyDock.test.tsx src/utils/activityAnalyticsVisualLayout.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`74` focused tests passing).
- Safety net: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/utils/activityAnalyticsVisualLayout.test.ts` ✅ (`37` baseline tests passing before this batch's RED changes).
- RED check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ❌ (`3` failing expectations: Turno summary was still showing partial outlines, custom shift windows were still implying detail-state progress, and Mejor/Peor lacked compact duration/productivity context).
- GREEN / regression check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`32` widget tests passing after the behavior changes).
- Focused PR4B re-check: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`46` focused tests passing).
- Safety net: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` ✅ (`73` baseline tests passing before this correction batch).
- RED check: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` ❌ (`4` failing expectations: long-range Turno was still clamped away in shared rules, runtime hid Turno for `30d/12m`, and PropertyDock mirrored the old restriction).
- GREEN / regression check: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` ✅ (`73` focused tests passing after the contract correction and runtime-sync fix).
- Safety net: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` ✅ (`73` focused tests passing before hiding the custom UI path).
- RED check: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` ❌ (`4` failing widget expectations: persisted custom windows still rendered the Custom button/editor and the runtime row still reserved space for it).
- GREEN / regression check: `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` ✅ (`72` focused tests passing after removing the visible custom path and updating coverage to the new contract).

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `hmi-app/src/utils/activityAnalyticsDisplayRules.test.ts` | Unit | N/A (new) | ✅ Written first against a missing module and legacy `1h`/custom-duration expectations | ✅ Passed — focused utility run | ✅ 4 cases — preset ranges, long-range clamps, and custom-duration branches | ✅ Kept the contract pure and centralized |
| 1.2 | `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` | Unit | ✅ 2/2 — `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts` | ✅ Added clamp expectations before changing defaults | ✅ Passed — focused utility run | ✅ Covered legacy `1h` and invalid custom `shift` persistence | ✅ Reused the shared rules utility instead of duplicating guards |
| 1.3 | `hmi-app/src/components/admin/PropertyDock.test.tsx` | Integration | ✅ 36/36 — `npm run test -- src/components/admin/PropertyDock.test.tsx` | ✅ Added admin parity expectations for hidden `1h`, range-driven group clamps, and filtered grouping choices before changing the dock | ✅ Passed — focused dock run | ✅ Covered preset range options, `12m` fallback-to-`week`, and filtered `Semana/Mes` choices | ✅ Moved admin range/group decisions onto the shared display-rules utility |
| 2.1 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ 30/30 — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Added runtime-control expectations for hidden `1h`, filtered groups, and persisted clamp behavior | ✅ Passed — focused widget run | ✅ Covered invalid persisted `24h + week`, runtime `Turno`, `30d` clamp, and custom-window clamp refresh | ✅ Removed duplicated runtime rules in favor of one contract |
| 3.1 | `hmi-app/src/utils/activityAnalyticsDisplayRules.test.ts` + `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` | Unit | ✅ Utility safety net recorded above | ✅ New clamp tests existed before production changes | ✅ Passed — focused utility run | ✅ Matrix + fallback + custom-duration branches covered | ✅ Kept assertions on behavior, not implementation details |
| 3.2 | `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` | Unit | ✅ 6/6 — `npm run test -- src/utils/activityAnalyticsVisualLayout.test.ts` | ✅ Added a failing `Turno + Resumen` non-scroll assertion before touching layout code | ✅ Passed — focused layout run | ✅ Covered non-scroll summary, detail compression, and preserved text fallback thresholds | ✅ Introduced an effective grouped-count clamp only for summary mode |
| 2.2 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ 37/37 — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/utils/activityAnalyticsVisualLayout.test.ts` | ✅ Added failing assertions that Turno summary/custom windows must NOT show partial outlines while `Detalle` must still reveal the active partial shift | ✅ Passed — focused widget run | ✅ Covered preset `24h` Turno summary/detail and custom `shift` windows staying locked to `Resumen` | ✅ Scoped partial-outline rendering to `Detalle` only |
| 2.3 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ 37/37 — same safety net above | ✅ Added a failing compact comparison expectation for visible grouped productivity + duration context | ✅ Passed — focused widget run | ✅ Covered compact Mejor/Peor rows alongside the existing hero-summary/no-KPI/fit-compress-scroll assertions | ✅ Reworked comparison rendering without changing the chart contract |
| 3.3 | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ 37/37 — same safety net above | ✅ Added widget-behavior assertions before implementation changes | ✅ Passed — `32` widget tests green after the new cases landed | ✅ New cases cover Turno summary/detail truthfulness, custom runtime windows, and compact Mejor/Peor context | ✅ Kept assertions behavioral instead of style/class-coupled |
| 4.1 | `hmi-app/src/utils/activityAnalyticsDisplayRules.test.ts` + `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` + `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` + `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Unit + Integration | ✅ Focused safety nets recorded above | ✅ Verification expectations existed before GREEN | ✅ Passed — prior PR4A sweep `43` focused tests, prior PR4B sweep `74`, and this batch's final `46` focused tests for the remaining widget behavior | ✅ Shared contract, layout, defaults, and runtime paths all exercised together | ➖ No broader verify-report refresh in this slice |

### Focused Correction Batch
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| Contract correction | `hmi-app/src/utils/activityAnalyticsDisplayRules.test.ts` + `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` + `hmi-app/src/components/admin/PropertyDock.test.tsx` | Unit + Integration | ✅ 73/73 — `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` | ✅ Wrote failing expectations for `30d/12m` Turno visibility, no long-range `Detalle`, and admin/runtime parity before touching production code | ✅ Passed — same focused command finished green with `73` tests | ✅ Covered shared-rule, runtime-control, persisted-rerender, and PropertyDock paths for both `30d` and `12m` plus long custom windows | ✅ Tightened runtime sync so external display-option changes clear stale local group overrides |
| Custom UI hidden | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` + `hmi-app/src/components/admin/PropertyDock.test.tsx` | Integration | ✅ 73/73 — `npm run test -- src/utils/activityAnalyticsDisplayRules.test.ts src/widgets/renderers/ActivityAnalyticsWidget.test.tsx src/components/admin/PropertyDock.test.tsx` | ✅ Replaced runtime-custom tests with failing expectations that persisted custom windows must stay internal and no `Custom` control/editor may render | ✅ Passed — same focused command finished green with `72` tests after removing obsolete UI-path assertions | ✅ Covered persisted custom query hydration, builder rerenders, runtime control composition, and admin range visibility | ✅ Removed the viewer-only custom editor state and kept the persisted custom data path intact |
| Final consistency batch | `hmi-app/src/widgets/WidgetRenderer.test.tsx` + `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` | Integration + Unit | ✅ 31/31 widget safety net — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Captured stale delegated-runtime and long-custom expectations before changes (`3` widget-renderer failures + `1` defaults failure) | ✅ Passed — `5` renderer tests + `3` defaults tests green after aligning the final contract and fixing lint/type blockers | ✅ Covered hidden custom controls, `24h` effective grouping matrix, and long custom `shift` compatibility | ✅ Removed the unused runtime-range import and widened `createComparisonEntry()` to accept nullable comparison targets |

## Test Summary
- **Total tests written**: `21` cumulative new/updated focused cases across display-rules, defaults, PropertyDock, visual-layout, final widget behavior coverage, the hidden-custom correction batch, and this final consistency batch.
- **Total tests passing**: latest focused consistency sweep `39` tests (`31` activity widget + `5` renderer + `3` defaults); full suite `809` tests.
- **Layers used**: Unit (`3` files), Integration (`2` files), E2E (`0`).
- **Approval tests**: None — this slice finalizes changed contract behavior rather than preserving legacy output.
- **Pure functions created**: `2` shared pure helpers remain central in the final contract — `normalizeActivityAnalyticsRange()` and `resolveActivityAnalyticsDisplayRules()`.

## Focused Correction Batch Status
- [x] Runtime no longer renders a `Custom` button or custom-window editor in `ActivityAnalyticsWidget.tsx`.
- [x] Persisted `custom` windows still query `/activity-series` with explicit `start/end` bounds and preserve internal grouping clamps.
- [x] Activity-analytics admin controls continue to hide `custom`, now with explicit regression coverage.

## Remaining Tasks
- [ ] 4.2 Refresh `openspec/changes/activity-analytics-second-iteration/verify-report.md` only with real PR 4A/4B evidence; this remains blocked until historical chain refs or new execution evidence exists.

## Final Consistency Batch Status
- [x] `WidgetRenderer.test.tsx` now matches the final hidden-custom/runtime-matrix contract.
- [x] `activityAnalyticsWidgetDefaults.test.ts` now reflects effective-duration compatibility for persisted custom windows.
- [x] `ActivityAnalyticsWidget.tsx` is lint-clean and type-safe for nullable comparison entries.
- [ ] 4.2 remains blocked; this batch did not fabricate historical chain evidence.

## Turno Summary Contract Blocker
- [x] `Turno + Resumen` now aggregates by stable shift identity derived from shift bucket keys / configured shift ids instead of fragile display-label parsing.
- [x] Free-text admin labels (`Mañana`, `Tarde`, `Noche`, `A`, `C`) now stay aggregated correctly in summary mode.
- [x] `Turno + Detalle` still renders chronological real shifts, including dated labels and in-progress markers.
- [x] Summary mode no longer degrades back to chronological output when only one or two shift types are visible.

### Turno Summary Contract Evidence
- Safety net: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`31` baseline tests passing before the blocker fix).
- RED check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ❌ (`2` new failures proving free-text labels and 1–2 visible shift buckets still degraded summary mode to chronological output).
- GREEN / regression check: `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` ✅ (`33` widget tests passing after switching summary aggregation to stable shift identity and preserving chronological detail in `Detalle`).

### TDD Cycle Evidence — Turno Summary Blocker
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| Turno summary contract blocker | `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Integration | ✅ 31/31 — `npm run test -- src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | ✅ Added failing assertions for free-text labels and 1–2 visible shift-type windows before touching production code | ✅ Passed — same focused command finished green with `33` tests | ✅ Covered free-text labels, legacy `Turno 1/2/3`, 1–2 visible shift types, and chronological detail-only date/in-progress labels | ✅ Replaced fragile label parsing with stable shift-id aggregation while preserving `Detalle` chronology |
