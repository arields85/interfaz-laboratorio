# Delta for node-red-binding

## ADDED Requirements

### Requirement: Activity-series custom query contract

The system MUST request read-only activity-series data with `range` values `1h`, `24h`, `7d`, `30d`, `12m`, or `custom`. `range=custom` MUST include `start` and `end` ISO timestamps and MUST preserve the configured Node-RED base URL plus configured activity-series endpoint. The frontend MUST reject missing bounds, `start >= end`, and windows longer than 30 days before emitting the request. It MUST NOT coerce invalid custom windows into a different range. Activity-series requests MUST remain schedule-agnostic and runtime-grouping-agnostic, and MUST NOT serialize weekly shift applicability, shared temporal settings, selected runtime grouping, or dashboard-specific shift metadata into Node-RED query params.

#### Scenario: Valid custom activity-series request keeps configured endpoint
- GIVEN a widget selects a valid custom window
- WHEN activity-series data is requested
- THEN the request uses `range=custom` with `start` and `end`
- AND the configured activity-series URL is preserved

#### Scenario: Too-wide custom window is blocked locally
- GIVEN a selected custom window exceeds 30 days
- WHEN the request is validated
- THEN no request is emitted
- AND a clear validation error is returned

#### Scenario: Weekly schedule stays frontend-owned
- GIVEN activity analytics uses a saved weekly temporal schedule
- WHEN the widget requests activity-series data
- THEN the request includes only machine and time-window parameters
- AND no shift schedule or runtime grouping metadata is sent to Node-RED

## MODIFIED Requirements

### Requirement: Read-only activity-series request failures are legible

The system MUST call the activity endpoint with GET-only requests and MUST surface legible errors for missing endpoint configuration, frontend custom-window validation failures, connection failure, and backend `400` or `500` JSON responses. Query validation MUST remain explicit for machine id, supported ranges, and custom-window failures, without introducing any write flow. Backend rejection of a custom request SHALL be shown as a validation-focused error, not misreported as a connection failure.
(Previously: the requirement covered missing endpoint, connection failure, supported ranges, and backend-rejected custom windows, but not explicit frontend custom-window validation or error distinction.)

#### Scenario: Structured backend validation error is shown clearly
- GIVEN the backend responds with a JSON `400` for invalid `machineId`, `range`, `start`, or `end`
- WHEN the widget request fails
- THEN the user sees a clear validation error state

#### Scenario: Connection failure is distinguished from validation failure
- GIVEN the activity endpoint cannot be reached
- WHEN the widget request fails
- THEN the user sees a connection-focused error state

#### Scenario: Frontend custom validation stops the request early
- GIVEN `start` is after `end` for `range=custom`
- WHEN the frontend validates the query
- THEN the request is not sent
- AND the user sees a validation-focused error
