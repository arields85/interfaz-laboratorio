# Delta for activity-analytics-widget

## MODIFIED Requirements

### Requirement: Builder-controlled state gradients

The system MUST allow builders to configure Activity Analytics presentation gradients for each state: `prod`, `setup`, and `stopped`. Each state configuration MUST include a start color and an end color, and each color stop MUST expose both a color picker and a pasteable `#RRGGBB` hex field. Each color stop MUST expose alpha from `0..100%`; missing or invalid persisted alpha values MUST resolve to safe defaults. Activity Analytics visual controls MUST use usable, Activity Analytics-specific labels and grouped layout that avoids cramped abbreviations. These controls MUST be specific to Activity Analytics and MUST NOT create a generic cross-widget gradient editor.
(Previously: builders configured only start/end state-gradient colors through Activity Analytics-specific controls.)

#### Scenario: Builder configures all state gradients

- GIVEN Admin edits an Activity Analytics widget
- WHEN the builder sets start and end colors for `prod`, `setup`, and `stopped`
- THEN the widget stores one gradient pair for each state
- AND no process-control action, setpoint, or plant command is introduced

#### Scenario: Missing persisted gradients fall back safely

- GIVEN an existing Activity Analytics widget has no persisted state-gradient or alpha values
- WHEN default configuration or runtime rendering resolves the widget settings
- THEN every state receives safe default colors and alpha values within `0..100%`
- AND the widget remains renderable without changing analytics results

#### Scenario: Hex fields and alpha are editable beside color pickers

- GIVEN Admin edits Activity Analytics visual settings
- WHEN a valid `#RRGGBB` value is pasted and alpha is set within `0..100%`
- THEN the matching color stop uses the pasted color and alpha
- AND the control remains paired with its color picker for the same stop

#### Scenario: Activity Analytics labels remain scannable

- GIVEN the expanded gradient and effects controls are visible
- WHEN Admin scans the Activity Analytics builder panel
- THEN controls are grouped by Activity Analytics state or surface
- AND labels avoid unclear abbreviations such as `Prod.`, `Det.`, or `Ini.` where full labels are needed

### Requirement: State gradients drive Activity Analytics visuals only

The system MUST use the resolved state palette and alpha for the corresponding state across Activity Analytics state-coded presentation surfaces. Donut segments and grouped stacked-bar segments MUST use the resolved start→end gradient. Summary detail markers, grouped state legend markers, grouped hover/tooltip state indicators, grouped top-cap highlights, and comparison horizontal mini-bars MUST derive their state color from the same resolved state palette. Grouped bars and donut MUST expose independent presentation-only controls for glow, blur, top-cap visibility, and local top-cap glow. Effect controls MUST affect only their selected surface and MUST NOT alter analytics classification, grouping, durations, KPIs, data fetching, control behavior, or read-only constraints. KPI ring segmentation and dynamic ring-gradient behavior MUST remain excluded from Activity Analytics.
(Previously: gradients drove Activity Analytics visuals only, without alpha or independent grouped-bar/donut effect controls.)

#### Scenario: Configured state palette renders per state

- GIVEN resolved gradients exist for `prod`, `setup`, and `stopped`
- WHEN Activity Analytics renders donut, grouped bars, comparison mini-bars, and related state markers or highlights
- THEN each state-coded surface uses or derives from that state's resolved palette
- AND no state-coded surface keeps a separate hardcoded `prod`, `setup`, or `stopped` color

#### Scenario: Analytics and control behavior are unchanged

- GIVEN the same activity-series input, range, grouping, and widget size
- WHEN only state-gradient colors, alpha, or visual effects change
- THEN classification, grouping, durations, KPIs, stop count, and consumption stay unchanged
- AND the widget remains strictly read-only with no write controls

#### Scenario: Grouped bars and donut effects are independent

- GIVEN Admin configures Activity Analytics grouped-bar and donut effects differently
- WHEN the widget renders both surfaces
- THEN glow, blur, top-cap visibility, and top-cap glow follow each surface's own settings
- AND changing one surface does not mutate the other surface's settings

#### Scenario: KPI ring segmentation stays excluded

- GIVEN Activity Analytics visual effect controls are available
- WHEN Admin edits donut or grouped-bar effects
- THEN no KPI ring segmentation or dynamic ring-gradient control is shown
- AND the Activity Analytics donut remains a static circular presentation surface
