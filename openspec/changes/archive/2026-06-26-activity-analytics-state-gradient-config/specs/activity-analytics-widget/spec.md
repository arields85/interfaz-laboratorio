# Delta for activity-analytics-widget

## ADDED Requirements

### Requirement: Builder-controlled state gradients

The system MUST allow builders to configure Activity Analytics presentation gradients for each state: `prod`, `setup`, and `stopped`. Each state configuration MUST include a start color and an end color. These controls MUST be specific to Activity Analytics and MUST NOT create a generic cross-widget gradient editor.

#### Scenario: Builder configures all state gradients

- GIVEN Admin edits an Activity Analytics widget
- WHEN the builder sets start and end colors for `prod`, `setup`, and `stopped`
- THEN the widget stores one gradient pair for each state
- AND no process-control action, setpoint, or plant command is introduced

#### Scenario: Missing persisted gradients fall back safely

- GIVEN an existing Activity Analytics widget has no persisted state-gradient values
- WHEN default configuration or runtime rendering resolves the widget settings
- THEN every state receives a safe default start and end color
- AND the widget remains renderable without changing analytics results

### Requirement: State gradients drive Activity Analytics visuals only

The system MUST use the resolved state palette for the corresponding state across Activity Analytics state-coded presentation surfaces. Donut segments and grouped stacked-bar segments MUST use the resolved start→end gradient. Summary detail markers, grouped state legend markers, grouped hover/tooltip state indicators, grouped top-cap highlights, and comparison horizontal mini-bars MUST derive their state color from the same resolved state palette. Gradient configuration MUST affect presentation only and MUST NOT alter analytics classification, grouping, durations, KPIs, data fetching, control behavior, or read-only constraints.

#### Scenario: Configured state palette renders per state

- GIVEN resolved gradients exist for `prod`, `setup`, and `stopped`
- WHEN Activity Analytics renders donut, grouped bars, comparison mini-bars, and related state markers or highlights
- THEN each state-coded surface uses or derives from that state's resolved palette
- AND no state-coded surface keeps a separate hardcoded `prod`, `setup`, or `stopped` color

#### Scenario: Analytics and control behavior are unchanged

- GIVEN the same activity-series input, range, grouping, and widget size
- WHEN only state-gradient colors change
- THEN classification, grouping, durations, KPIs, stop count, and consumption stay unchanged
- AND the widget remains strictly read-only with no write controls
