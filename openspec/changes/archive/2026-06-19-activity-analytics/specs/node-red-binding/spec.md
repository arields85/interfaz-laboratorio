# Delta for node-red-binding

## ADDED Requirements

### Requirement: Configured activity-series endpoint

The system MUST expose `Endpoint Activity-Series` in connection configuration, SHALL default it to `/api/hmi-data/activity-series`, and MAY allow it to be empty to disable activity analytics intentionally. The final request URL MUST combine the configured Node-RED base URL with this endpoint. Connection summaries MUST include `URL ACTIVITY-SERIES`. Activity analytics MUST use this endpoint exclusively and MUST NOT query `/api/hmi-data/history` for its contract.

#### Scenario: Admin sees configured activity-series URL
- GIVEN a Node-RED base URL is configured
- WHEN Admin opens connection settings
- THEN `Endpoint Activity-Series` defaults to `/api/hmi-data/activity-series`
- AND the summary shows `URL ACTIVITY-SERIES`

#### Scenario: Empty endpoint disables the feature
- GIVEN `Endpoint Activity-Series` is saved as empty
- WHEN an activity-analytics widget requests data
- THEN no activity-series request is emitted
- AND the widget shows the endpoint-not-configured state

### Requirement: Read-only activity-series request failures are legible

The system MUST call the activity endpoint with GET-only requests and MUST surface legible errors for missing endpoint configuration, connection failure, and backend `400` or `500` JSON responses. Query validation MUST remain explicit for machine id, supported ranges, and backend-rejected custom windows, without introducing any write flow.

#### Scenario: Structured backend validation error is shown clearly
- GIVEN the backend responds with a JSON `400` for invalid `machineId` or `range`
- WHEN the widget request fails
- THEN the user sees a clear validation error state

#### Scenario: Connection failure is distinguished from validation failure
- GIVEN the activity endpoint cannot be reached
- WHEN the widget request fails
- THEN the user sees a connection-focused error state
