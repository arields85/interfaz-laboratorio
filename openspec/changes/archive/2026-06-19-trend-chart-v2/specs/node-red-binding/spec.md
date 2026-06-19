# Delta for node-red-binding

## ADDED Requirements

### Requirement: History preset and custom query contract

The system MUST request read-only history using `range` values `1h`, `24h`, `7d`, `30d`, `12m`, or `custom`. Custom requests MUST include `start` and `end` and MAY include technical `maxPoints`. When a `trend-chart-v2` widget provides `historicalDensity`, the frontend SHALL map `low -> 400`, `normal -> 800`, and `high -> 1500` for both preset and custom queries; missing or invalid density values SHALL fall back to `normal`. Legacy saved ranges `minuto|hora|dia|semana|mes` SHALL remain readable through compatible frontend mapping.

#### Scenario: Preset query uses new range key

- GIVEN a V2 widget selects `7d` and `historicalDensity=high`
- WHEN history is requested
- THEN the request includes `range=7d`
- AND the request includes `maxPoints=1500`

#### Scenario: Custom query preserves density mapping

- GIVEN a V2 widget has effective `historicalDensity=low`
- WHEN drag-zoom issues a `custom` history request
- THEN the request includes `start`, `end`, and `maxPoints=400`

#### Scenario: Legacy range still resolves safely

- GIVEN a saved widget still stores `range=hora`
- WHEN history is requested
- THEN the frontend issues the compatible read-only request for `24h`

#### Scenario: Invalid density falls back before request emission

- GIVEN a V2 widget stores unsupported `historicalDensity=ultra`
- WHEN history is requested
- THEN the frontend emits the request with `maxPoints=800`

### Requirement: Backend safeguards remain authoritative

The system MUST treat frontend custom-window validation and `maxPoints` normalization/clamp as advisory read-only guardrails only. Node-RED SHALL remain authoritative for the history endpoint: it MUST keep history GET-only, require strict ISO UTC `start`/`end` for `range=custom`, enforce `start < end`, enforce a maximum custom duration of 365 days or a configured equivalent aligned with the frontend, apply `maxPoints` default `800` with minimum `100` and maximum `2000`, reject or clamp invalid or excessive requests before querying storage, and return safe errors for invalid requests. This dependency MUST NOT be interpreted as permission to add plant/process writes.

#### Scenario: Valid custom request still goes through authoritative backend checks

- GIVEN the frontend emits `GET history?range=custom&start=<iso>&end=<iso>&maxPoints=1500`
- WHEN Node-RED evaluates the request
- THEN Node-RED re-validates the read-only custom window and applies its own safe limits before querying storage

#### Scenario: Invalid custom request is rejected safely before storage access

- GIVEN a request uses non-ISO UTC timestamps or `start >= end`
- WHEN Node-RED evaluates the request
- THEN Node-RED rejects the request with a safe error and does not query storage

#### Scenario: Excessive request is clamped or rejected before storage access

- GIVEN a request exceeds the allowed custom duration or `maxPoints` ceiling
- WHEN Node-RED evaluates the request
- THEN Node-RED clamps or rejects the request before querying storage under its configured limits

### Requirement: Backward-compatible history responses

The system MUST accept history responses compatible with contract `1.0` and `1.1`, SHALL preserve optional `window.start`, `window.end`, `window.bucket`, `window.bucketMs`, and `window.timezone`, and MUST preserve null series values instead of collapsing them.

#### Scenario: Contract 1.0 response remains valid

- GIVEN a history response omits `window`
- WHEN the adapter normalizes the payload
- THEN the series and summary remain usable without synthetic write-side changes

#### Scenario: Contract 1.1 window metadata is preserved

- GIVEN a history response includes `window` and null-valued points
- WHEN the adapter normalizes the payload
- THEN window metadata and null points remain available to consumers

### Requirement: History compatibility stays verifiable

The system MUST keep preset/custom query serialization and `1.0`/`1.1` response adaptation observable through automated service, adapter, and query tests.

#### Scenario: Automated compatibility checks stay stable

- GIVEN representative legacy, preset, custom, `1.0`, and `1.1` fixtures
- WHEN automated history tests run
- THEN they can assert serialized params and adapted payload shapes deterministically

## MODIFIED Requirements

### Requirement: FR8 Configured read-only endpoint

The system MUST read the Node-RED base URL and configured history endpoint from existing environment/configuration, MUST issue GET-only overview and history requests against that configured location, and MUST NOT introduce POST/PUT/DELETE flows or plant-control writes.
(Previously: FR8 only required GET overview requests against the configured base URL.)

#### Scenario: Config-driven endpoint

- GIVEN `VITE_NODE_RED_BASE_URL` is set
- WHEN overview or history is requested
- THEN the client issues only GET calls against the configured Node-RED location

#### Scenario: Custom history query preserves configured endpoint

- GIVEN a custom history window is selected
- WHEN the history service builds the request
- THEN it keeps the configured base URL/history endpoint and appends only read-only query params
