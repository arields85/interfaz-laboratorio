# Tasks: Activity Analytics Second Iteration

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Completed across PR 4A + PR 4B (~360-560) |
| 600-line budget risk | Medium |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 4A contract clamps -> PR 4B widget behavior + tests |
| Delivery strategy | interactive |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Shared range/group contract | PR 4A | base = tracker branch; completed with tests |
| 2 | Final widget charts and truthful states | PR 4B | base = PR 4A branch; completed with focused Vitest |

## Phase 1: Contract / Foundation

- [x] 1.1 Create `hmi-app/src/utils/activityAnalyticsDisplayRules.ts` for the final matrix: no visible `1h`, hidden `custom`, and `Turno` summary-only for `30d` / `12m` / persisted `custom`.
- [x] 1.2 Update `hmi-app/src/utils/activityAnalyticsWidgetDefaults.ts` to normalize legacy `1h -> 24h`, preserve persisted `custom` bounds, and clamp invalid stored groups/modes.
- [x] 1.3 Update `hmi-app/src/components/admin/PropertyDock.tsx` so admin exposes only visible preset ranges and mirrors the shared grouping rules.

## Phase 2: Widget Implementation

- [x] 2.1 Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` runtime controls to hide `custom`, remove `1h`, and keep persisted custom queries internal.
- [x] 2.2 Enforce `Turno` behavior in `ActivityAnalyticsWidget.tsx`: `Resumen` for `30d` / `12m` / `custom`, and `Detalle` only for `24h + Turno` and `7d + Turno`.
- [x] 2.3 Rework `ActivityAnalyticsWidget.tsx` and `hmi-app/src/utils/activityAnalyticsVisualLayout.ts` to keep one hero `Resumen`, compact `Mejor/Peor`, truthful states, and real `prod-history`-style charts with `fit -> compress -> scroll`.

## Phase 3: Tests / Evidence

- [x] 3.1 Add unit coverage in `hmi-app/src/utils/activityAnalyticsDisplayRules.test.ts` and `hmi-app/src/utils/activityAnalyticsWidgetDefaults.test.ts` for hidden `custom`, legacy `1h`, and matrix clamps.
- [x] 3.2 Update `hmi-app/src/utils/activityAnalyticsVisualLayout.test.ts` for `Turno Resumen` non-scroll, `Turno Detalle` compression, and text fallback thresholds.
- [x] 3.3 Update `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` for summary-only long-range `Turno`, hidden `custom`, compact `Mejor/Peor`, partial-bar detail mode, and truthful `sin datos` / `sin turno`.
- [x] 3.4 Run the focused Vitest sweep for display rules, defaults, visual layout, and widget behavior (`4.1` evidence captured in `apply-progress.md`).

## Phase 4: Closeout Blocker

- [ ] 4.2 Refresh `openspec/changes/activity-analytics-second-iteration/verify-report.md` only with real feature-branch-chain evidence for PR 4A / PR 4B; keep blocked until those refs or equivalent auditable evidence exist.
