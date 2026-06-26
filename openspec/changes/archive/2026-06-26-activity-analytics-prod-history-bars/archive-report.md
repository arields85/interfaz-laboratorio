# Archive Report: activity-analytics-prod-history-bars

## Status

- Archive status: archive-ready
- Verification verdict: PASS WITH WARNINGS
- Intentional partial archive: No
- Stale checkbox reconciliation: No

## Task Completion Gate

- `tasks.md` reviewed before archive
- Implementation tasks complete: 11/11
- Unchecked implementation tasks: 0

## Source Artifacts Reviewed

- `openspec/changes/activity-analytics-prod-history-bars/proposal.md`
- `openspec/changes/activity-analytics-prod-history-bars/specs/activity-analytics-widget/spec.md`
- `openspec/changes/activity-analytics-prod-history-bars/design.md`
- `openspec/changes/activity-analytics-prod-history-bars/tasks.md`
- `openspec/changes/activity-analytics-prod-history-bars/apply-progress.md`
- `openspec/changes/activity-analytics-prod-history-bars/verify-report.md`

## Spec Sync Summary

| Domain | Action | Details |
|---|---|---|
| `activity-analytics-widget` | Updated | Added 3 requirements for Production History-like grouped bar sizing, builder-controlled grouped bar width, and stacked-state analytics invariance. |

## Verification Evidence Preserved

- Focused runtime suite passed: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/utils/activityAnalyticsVisualLayout.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` -> 100 tests passed.
- `npm run lint` passed.
- `npx tsc -b` passed.
- No CRITICAL issues were reported in `verify-report.md`.

## Final Warnings

- `hmi-app/src/components/admin/PropertyDock.tsx` remains below the whole-file changed-file 80% coverage heuristic (77.31% lines / 77.03% branches), although the new grouped-bar slider slice is exercised.

## Archive Outcome

Main specs were synced before archival, verification warnings were preserved, and the change folder was moved to `openspec/changes/archive/2026-06-26-activity-analytics-prod-history-bars/` as the immutable audit trail.
