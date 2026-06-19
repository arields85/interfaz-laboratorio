# Archive Report: activity-analytics

## Summary

- Change `activity-analytics` archived after OpenSpec sync.
- Archive status: intentional-with-warnings.
- Verification verdict: `PASS WITH WARNINGS`.
- Tasks artifact validated: `16/16` complete, `0` unchecked.

## Specs Synced

| Domain | Action | Details |
|---|---|---|
| `node-red-binding` | Updated | Added 2 requirements for configured `activity-series` endpoint and legible read-only request failures. |
| `global-temporal-settings` | Updated | Added 3 requirements for deterministic analytics timezone/shift grouping. |
| `activity-analytics-widget` | Created | Added new full main spec with 5 requirements for the first-release read-only widget. |

## Archive Gate Validation

- `proposal.md` present.
- `design.md` present.
- `tasks.md` present and fully checked.
- `apply-progress.md` present.
- `verify-report.md` present.
- No CRITICAL verification issues found.

## Preserved Warnings / Exceptions

- Repo-wide `npm run lint` remains failing outside `activity-analytics` scope; this is a maintainer-approved external exception/waiver for task `4.2` and is intentionally preserved in the archive.
- Passing verification still emits pre-existing `DashboardBuilderPage.test.tsx` React `act(...)` warnings and existing jsdom canvas `getContext()` notices.
- Coverage percentages for broad shared files remain diluted by unrelated legacy branches (`dataConnection.config.ts`, `ConnectionSettingsTab.tsx`, `PropertyDock.tsx`, `WidgetRenderer.tsx`, `admin.types.ts`); this is preserved as a non-blocking warning, not treated as change-local failure.

## Notes

- No application code was modified during archive; only OpenSpec artifacts and archive movement were performed.
- Source-of-truth specs now include the activity analytics behavior and constraints.
