# trend-chart-v2-widget Specification

## Purpose

Define `Trend-Chart-V2` as a read-only history widget with true time rendering, zoom, shifts, and deterministic simulated behavior.

## Requirements

### Requirement: Catalog coexistence and manual migration

The system MUST expose `Trend-Chart-V2` as a new insertable widget, SHALL keep legacy `trend-chart` insertable, and MUST NOT auto-migrate dashboards.

#### Scenario: Builder shows both widgets

- GIVEN Admin opens the widget catalog
- WHEN trend widgets are listed
- THEN `Trend-Chart-V2` and legacy `trend-chart` are both available

#### Scenario: Existing dashboards stay on legacy widget

- GIVEN a dashboard already uses `trend-chart`
- WHEN the dashboard is reopened after V2 ships
- THEN the widget stays legacy until manually replaced

### Requirement: Time-faithful window and label rendering

The system MUST position X by timestamp, MUST format labels/tooltips in the resolved visualization timezone, and SHALL resolve the window from `window.start/end`, else custom `start/end`, else preset, else series bounds.

#### Scenario: Backend window drives the visible timeline

- GIVEN a response includes `window.start`, `window.end`, and `window.timezone`
- WHEN `Trend-Chart-V2` renders
- THEN points, labels, and tooltip times use that window and timezone

#### Scenario: Local fallback still renders correctly

- GIVEN a response omits `window`
- WHEN the widget renders a preset or custom range
- THEN the chart uses fallback windowing without index spacing

### Requirement: Gaps and nulls remain visible

The system MUST preserve null points and SHALL break line/area continuity when a point is null or when adjacent timestamps exceed the effective gap threshold from `bucketMs` or range fallback.

#### Scenario: Null value cuts the series

- GIVEN a series contains a null value between valid points
- WHEN the widget renders
- THEN the chart shows separate visual segments across that null

#### Scenario: Large timestamp gap cuts the series

- GIVEN adjacent points exceed the effective gap threshold
- WHEN the chart renders
- THEN the chart does not draw a continuous segment across the gap

### Requirement: Drag zoom and recovery

The system MUST support drag-to-zoom, MUST request a read-only `custom` range for the selected window, SHALL preserve the widget's effective historical density across preset and custom refreshes, and MUST show a reset or back-to-preset action while zoom is active. Temporary visual zoom MAY be shown while loading.

#### Scenario: Drag issues a custom-range refresh

- GIVEN a preset range is visible
- WHEN the user drags and releases a time selection
- THEN the widget refreshes using `range=custom` plus the selected `start` and `end`
- AND the refreshed query keeps the widget's effective historical density

#### Scenario: User returns to the preset view

- GIVEN a custom zoom is active
- WHEN the user selects reset or back-to-preset
- THEN the chart returns to the prior preset range

### Requirement: Shift overlays and summary

The system MUST support shift display modes `auto`, `bands`, and `lines`; MUST handle midnight-crossing shifts; MUST show the point's shift label in the tooltip when enabled; and MUST compute `last`, `min`, `max`, and `avg` per visible shift from the visible series only.

#### Scenario: Overnight shift stays intact

- GIVEN a visible window intersects a shift that crosses midnight
- WHEN shifts are shown
- THEN the overlay and tooltip label the overnight shift correctly

#### Scenario: Summary uses only visible data

- GIVEN the visible window contains points from multiple shifts
- WHEN shift summary is enabled
- THEN each visible shift shows `last`, `min`, `max`, and `avg` from only the points inside the visible window

### Requirement: Historical density is admin-configured and operator-hidden

The system MUST support widget configuration key `historicalDensity` with values `low`, `normal`, and `high`. The system SHALL default missing or invalid values to `normal`. Admin/builder UI MUST label this control `Densidad histórica` with options `Baja`, `Normal`, and `Alta`. Operator/dashboard views MUST NOT expose or allow editing this option.

#### Scenario: Admin selects a friendly density option

- GIVEN Admin edits a `Trend-Chart-V2` widget in the builder
- WHEN Admin selects `Alta` in `Densidad histórica`
- THEN the widget configuration stores `historicalDensity=high`

#### Scenario: Invalid density falls back without operator controls

- GIVEN a widget configuration is missing or contains an unsupported `historicalDensity`
- WHEN the widget loads in builder or dashboard view
- THEN the effective density resolves to `normal`
- AND dashboard operators are not shown any density editor

### Requirement: Deterministic simulated history

The system MUST generate simulated history with timestamps and density appropriate to the selected range, and SHALL produce the same series for the same widget/binding/range inputs.

#### Scenario: Stable preview

- GIVEN the same widget, binding, and selected range
- WHEN simulated mode renders twice
- THEN both renders show the same timestamps and values

#### Scenario: Range change changes the simulated window

- GIVEN simulated mode is visible
- WHEN the user switches from `1h` to `30d`
- THEN the simulated timestamps and sampling window match the new range
