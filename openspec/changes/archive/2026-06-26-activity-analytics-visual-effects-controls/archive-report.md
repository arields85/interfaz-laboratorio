# Archive Report: activity-analytics-visual-effects-controls

## Status

- Archive status: archive-ready
- Verification verdict: PASS WITH WARNINGS
- Intentional partial archive: No
- Stale checkbox reconciliation: No

## Task Completion Gate

- `tasks.md` reviewed before archive
- Implementation tasks complete: 14/14
- Unchecked implementation tasks: 0

## Source Artifacts Reviewed

- `openspec/changes/activity-analytics-visual-effects-controls/proposal.md`
- `openspec/changes/activity-analytics-visual-effects-controls/specs/activity-analytics-widget/spec.md`
- `openspec/changes/activity-analytics-visual-effects-controls/design.md`
- `openspec/changes/activity-analytics-visual-effects-controls/tasks.md`
- `openspec/changes/activity-analytics-visual-effects-controls/apply-progress.md`
- `openspec/changes/activity-analytics-visual-effects-controls/verify-report.md`

## Spec Sync Summary

| Domain | Action | Details |
|---|---|---|
| `activity-analytics-widget` | Updated | Modified 2 requirements to add pasteable hex + per-stop alpha controls, clearer Activity Analytics labels/layout, independent donut/grouped-bar effects, and explicit KPI segmentation exclusion. |

## Verification Evidence Preserved

- Focused runtime suite passed: `npm run test -- src/utils/activityAnalyticsWidgetDefaults.test.ts src/components/admin/PropertyDock.test.tsx src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` -> 106 tests passed.
- `npm run lint` passed.
- `npx tsc -b` passed.
- No CRITICAL issues were reported in `verify-report.md`.

## Final Warnings

- `npm run test:coverage` still exits non-zero because of two full-suite issues outside the focused archive-readiness scope: a `WidgetRenderer.test.tsx` runtime-grouping assertion and a coverage-only timeout in `PropertyDock.test.tsx`.
- `hmi-app/src/components/admin/PropertyDock.tsx` remains below the stricter changed-file 80% coverage heuristic (78.66% lines / 76.86% branches), although the new Activity Analytics visual-controls behavior is covered.

## Archive Outcome

Main specs were synced before archival, verification warnings were preserved, and the change folder was moved to `openspec/changes/archive/2026-06-26-activity-analytics-visual-effects-controls/` as the immutable audit trail.
