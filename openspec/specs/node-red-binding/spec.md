# node-red-binding Specification

## Purpose

Enable read-only real bindings backed by Node-RED while preserving legacy simulated and asset-based dashboards.

## Domain Types

```ts
export interface NodeRedOverviewResponse { machines: NodeRedMachineRaw[]; fetchedAt?: string }
export interface NodeRedMachineRaw { unitId: number; name: string; values?: Record<string, NodeRedMetricRaw | null | undefined> }
export interface NodeRedMetricRaw { value: number | string | boolean | null; unit?: string; timestamp?: string; quality?: 'good' | 'bad' | 'unknown' }

export interface NodeRedMachineOption { machineId: number; name: string; variableKeys: string[] }
export interface NodeRedMetricSnapshot { machineId: number; variableKey: string; value: number | string | boolean | null; unit?: string; timestamp?: string; quality: 'good' | 'bad' | 'unknown' }
export interface NodeRedOverview { machines: NodeRedMachineOption[]; metrics: Record<string, NodeRedMetricSnapshot> }

export type BindingVersion = 'legacy-asset' | 'node-red-v1'
export interface WidgetBinding {
  mode: 'real_variable' | 'simulated_value';
  assetId?: string; machineId?: number; variableKey?: string; bindingVersion?: BindingVersion;
  formatter?: string; unit?: string; catalogVariableId?: string; lastKnownValueAllowed?: boolean;
  staleTimeout?: number; simulatedValue?: number | string | boolean;
}
```

## Data Flow

- Admin/builder: Node-RED GET overview -> service -> adapter -> query hook -> PropertyDock machine/variable selects.
- Viewer/runtime: Node-RED GET overview -> service -> adapter -> query hook -> bindingResolver -> widget render.
- URL MUST come from env/config (`VITE_NODE_RED_BASE_URL`); browser code MUST NOT hardcode hostnames or bypass TLS checks.

## Requirements

### Requirement: FR1 Machine selector for real origin
The system MUST, when `origin = Variable Real`, populate the machine selector from adapted Node-RED machines.

#### Scenario: Real origin loads machines
- GIVEN the overview query returns machines
- WHEN the user selects `Variable Real`
- THEN the machine selector lists Node-RED machine names/ids

### Requirement: FR2 Variable selector depends on machine
The system MUST populate the variable selector only from the selected machine's available variable keys.

#### Scenario: Machine-scoped variables
- GIVEN a selected machine with values
- WHEN the variable selector opens
- THEN only that machine's keys are shown

### Requirement: FR3 Invalid variable resets on machine change
The system MUST clear `variableKey` when a machine change makes the current variable unavailable.

#### Scenario: Variable becomes invalid
- GIVEN a saved variable not present on the new machine
- WHEN the machine changes
- THEN the binding clears `variableKey`

### Requirement: FR4 Real binding persistence
The system MUST persist real bindings as `machineId + variableKey + bindingVersion: 'node-red-v1'` and MUST keep legacy `assetId` bindings readable.

#### Scenario: Save mixed dashboards
- GIVEN a dashboard with legacy and Node-RED widgets
- WHEN it is persisted and reloaded
- THEN each widget keeps its original binding shape and mode

### Requirement: FR5 Runtime real value rendering
The system MUST render the latest adapted Node-RED value for `node-red-v1` real bindings.

#### Scenario: Value resolves from Node-RED
- GIVEN a widget bound to an existing machine/key
- WHEN overview data contains that metric
- THEN the widget shows the real value and unit if present

### Requirement: FR6 Safe fallback
The system MUST show `--` when Node-RED is unavailable, returns no data, or the bound variable is missing, and MUST NOT break rendering.

#### Scenario: Upstream failure or miss
- GIVEN query failure, empty machines, empty values, or missing machine/key
- WHEN the widget renders
- THEN it shows `--` and remains interactive

### Requirement: FR7 Zero regression for simulated mode
The system SHALL preserve existing simulated behavior exactly for `simulated_value` bindings.

#### Scenario: Simulated dashboard unchanged
- GIVEN a simulated widget before the change
- WHEN the dashboard renders after the change
- THEN the rendered value and interactions are unchanged

### Requirement: FR8 Configured read-only endpoint
The system MUST read the Node-RED base URL and configured history endpoint from existing environment/configuration, MUST issue GET-only overview and history requests against that configured location, and MUST NOT introduce POST/PUT/DELETE flows or plant-control writes.

#### Scenario: Config-driven endpoint
- GIVEN `VITE_NODE_RED_BASE_URL` is set
- WHEN overview or history is requested
- THEN the client issues only GET calls against the configured Node-RED location

#### Scenario: Custom history query preserves configured endpoint
- GIVEN a custom history window is selected
- WHEN the history service builds the request
- THEN it keeps the configured base URL/history endpoint and appends only read-only query params

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

### Requirement: NFR1-NFR4 Robust polling and typing
Polling SHOULD be configurable with a default near 5 seconds; network errors MUST NOT freeze UI; graceful degradation MAY expose stale state but MUST still show `--`; all contracts MUST remain strict TypeScript-safe.

#### Scenario: Polling and failure tolerance
- GIVEN the default polling config and a transient network error
- WHEN refetch occurs
- THEN the UI stays responsive, fallback output is stable, and types compile without `any`

## Edge Cases

- Empty `machines`: machine selector shows empty state; widgets show `--`.
- Machine with no `values`: variable selector empty; existing invalid key clears on edit.
- Previously bound machine/key removed upstream: persisted binding remains but resolves to `--`.
- Multiple widgets may share the same `machineId/variableKey` without duplication errors.
- Mixed simulated/legacy/Node-RED dashboards MUST coexist in one layout.
