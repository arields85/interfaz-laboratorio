# Proposal: Activity Analytics

## Intent

Add an `activity-analytics` widget for utilization, stops, and energy from the validated read-only `GET /api/hmi-data/activity-series` contract, with explicit gap/no-data handling and plant-time grouping.

## Scope

### In Scope
- One-machine-per-widget first release with preset ranges (`1h`, `24h`, `7d`, `30d`, `12m`).
- Builder/runtime support for `activity-analytics`, including `Endpoint Activity-Series` and URL summary.
- Frontend-derived KPIs/charts from `series` only: durations, utilization, kWh, stop count, grouped views (`shift`, `day`, `week`, `month`), and best/worst by `% Prod.`; consumption stays secondary.
- First-release gap/no-data guardrails from omitted backend buckets, timezone/shift-stable grouping, and clear empty/error states.

### Out of Scope
- Custom date picker or dashboard custom-range workflow.
- Ranking/table, multi-machine comparison, and exposing backend `summary`.
- Any plant/process-control write or `POST`/`PUT`/`DELETE` flow.

## Capabilities

### New Capabilities
- `activity-analytics-widget`: Widget and analytics for `/activity-series`.

### Modified Capabilities
- `node-red-binding`: Add optional `activity-series` endpoint and GET contract.
- `global-temporal-settings`: Analytics grouping uses saved timezone/shifts, including overnight shifts.

## Approach

Build a dedicated `activity-series` service -> adapter -> domain -> query -> UI pipeline aligned to the validated Node-RED flow `C:\Users\Ariel\Desktop\Interfaz\Flujos Node-RED\v2\HMI - API Activity-Series v1.json`; do not reuse `/history`, `useDataHistory`, or `temporalGrouping.ts`. The adapter preserves `purpose`, `window`, and sorted `series`, but the UI derives analytics from `series` only and MUST NOT display backend `summary`. Because the backend uses `aggregateWindow(every: bucket, fn: mean, createEmpty: false)`, missing buckets are frontend gaps/no-data, not stopped time. Duration math uses consecutive deltas, caps the last point at `bucketMs * 1.5`, treats gaps `> bucketMs * 2` as `no-data`, excludes them from the utilization denominator, and blocks stop transitions across gaps. Group by saved global timezone/shifts when configured, fall back deterministically, and never use browser-local time for analytics grouping.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/config/dataConnection.config.ts`, `src/components/admin/ConnectionSettingsTab.tsx` | Modified | Optional endpoint config/UI |
| `hmi-app/src/{domain,services,adapters,queries,utils}` | New/Modified | Contract, analytics math, grouping helpers |
| `hmi-app/src/{widgets,components/admin}` | Modified | Widget wiring and presentation |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Misclassifying gaps as stopped time | Med | Delta math, capped trailing point, no-data exclusion, tests |
| Shift/timezone grouping drift | Med | Global timezone/shifts only, overnight support, no `temporalGrouping.ts`, tests |
| Backend/frontend contract drift | Low | Treat validated Node-RED flow JSON as proposal source of truth until specs are written |
| Review scope exceeds 600 lines | High | Phase delivery before apply |

## Rollback Plan

Remove widget registration and builder endpoint wiring, keep existing widgets/endpoints unchanged, and revert the dedicated activity-series pipeline if rollout fails.

## Dependencies

- Validated Node-RED flow JSON `C:\Users\Ariel\Desktop\Interfaz\Flujos Node-RED\v2\HMI - API Activity-Series v1.json`
- Existing backend endpoint `/api/hmi-data/activity-series`
- Global temporal settings for timezone and configurable shifts

## Success Criteria

- [ ] Admin can configure the activity-series endpoint and add the widget without affecting history widgets.
- [ ] The widget calculates utilization/stops/kWh from `series` without counting omitted backend buckets as stopped time or utilization loss.
- [ ] Grouped analytics stay stable across saved global timezone/shifts, day boundaries, and midnight-crossing shifts without browser-local grouping.
- [ ] Backend `summary` stays internal to the contract and is not displayed to final users.
