# activity-analytics-widget Specification

## Purpose

Define a read-only `activity-analytics` widget that derives utilization, state durations, stops, and estimated consumption from the validated `/activity-series` series contract.

## Requirements

### Requirement: First-release widget contract and scope

The system MUST expose internal widget type `activity-analytics` and SHALL show label `Análisis de Actividad` unless project localization conventions require another runtime label. Each widget MUST bind exactly one machine. It MUST expose visible preset ranges `7d`, `30d`, and `12m`, SHALL default to `7d`, and MUST keep persisted legacy/internal ranges such as `24h`, `1h`, or `custom` behind compatibility normalization rather than visible builder/runtime controls. The first release MUST NOT expose a dashboard custom date picker, ranking block, compact table, or backend `summary`. The widget MUST remain strictly read-only and MUST NOT expose process-control writes.

#### Scenario: Builder creates the first-release widget
- GIVEN Admin adds an `activity-analytics` widget
- WHEN default configuration is created
- THEN the widget stores one machine binding and range `7d`
- AND no `1h`, `24h`, `custom`, ranking, or write controls are shown

#### Scenario: Runtime hides backend summary
- GIVEN the backend response includes `summary`
- WHEN the widget renders for final users
- THEN only frontend-derived analytics are shown

### Requirement: Threshold-based state classification

The system MUST reuse logical names `setup` and `prod`. `prod` MUST be greater than `setup`, and invalid threshold configuration MUST be prevented or surfaced clearly. Classification MUST use `normalizedValue = Math.max(0, value)`. Values `>= prod` MUST classify as `prod`; values `>= setup` and `< prod` MUST classify as `setup`; all other values MUST classify as `stopped`.

#### Scenario: Negative value normalizes safely
- GIVEN a point value below zero
- WHEN state classification runs
- THEN the normalized value becomes `0`
- AND the point classifies as `stopped`

#### Scenario: Invalid thresholds are rejected clearly
- GIVEN `prod <= setup`
- WHEN Admin saves or runtime validates the widget
- THEN the invalid configuration is blocked or shown as a clear error

### Requirement: Gap-aware analytics and ranking

The system MUST derive durations from timestamp deltas between consecutive points. The trailing point duration MUST be capped at `bucketMs * 1.5`. Gaps greater than `bucketMs * 2` MUST be treated as `no-data`, MUST be excluded from coverage and from the utilization denominator, and MUST NOT create stop counts. Utilization MUST equal `prodDuration / (prodDuration + setupDuration + stoppedDuration)`. Estimated `kWh` MUST equal the sum of `normalizedKW * durationHours` for data-backed durations only. Stop count MUST count transitions from active (`prod` or `setup`) to `stopped`, excluding gap boundaries. Best and worst production periods MUST rank by `% Prod.` only; consumption MUST remain secondary.

#### Scenario: Large gap does not become stopped time
- GIVEN adjacent timestamps differ by more than `bucketMs * 2`
- WHEN analytics are calculated
- THEN the interval is treated as `no-data`
- AND utilization and stop count ignore that gap

#### Scenario: Active-to-stopped transition counts once
- GIVEN consecutive data-backed states change from `prod` to `stopped`
- WHEN analytics are calculated
- THEN stopped duration increases
- AND stop count increments by one

### Requirement: First-release outputs and states

The widget MUST present the summary area as a compact `Distribución` layout, MUST NOT render KPI strip/cards, and MUST NOT wrap the summary in an inner framed container. The donut MUST remain the hero visual with unchanged center semantics. Summary details MUST appear to the right of the donut in one vertically centered block ordered `Producción`, `Setup`, `Detenida`; each section MUST show exactly one inline `% - hours` value string. Coverage and value strings MUST use technical/mono typography tokens; section titles MUST use general typography tokens. Donut thickness MUST scale responsively with available size while the production segment remains 1.5x thicker than the other segments. The main chart MUST render stacked bars for `prod`, `setup`, and `stopped` by selected grouping. Secondary charts for `% Prod.` and `kWh` by group MAY be included. The widget MUST provide clear empty and error states for missing machine, missing endpoint configuration, empty series, connection failure, and backend errors. This change MUST NOT alter analytics, grouping, data fetching, persisted configuration, state semantics, read-only constraints, or process-control behavior.

#### Scenario: Populated widget shows distribution summary and grouped analytics
- GIVEN a valid machine and non-empty grouped analytics
- WHEN the widget renders
- THEN subtitle `Distribución`, the donut hero, and the grouped stacked chart are visible
- AND no KPI strip/cards or inner framed summary container are rendered

#### Scenario: Summary details are ordered and compact
- GIVEN summary durations for production, setup, and stopped states
- WHEN the distribution summary renders
- THEN right-side details are vertically centered and ordered `Producción`, `Setup`, `Detenida`
- AND each section shows one inline `% - hours` value string

#### Scenario: Typography follows semantic token families
- GIVEN the distribution summary renders coverage and state detail text
- WHEN presentation classes are evaluated
- THEN coverage and value strings use technical/mono typography tokens
- AND detail titles use general typography tokens

#### Scenario: Donut emphasis scales without semantic drift
- GIVEN the widget renders at constrained and expanded sizes
- WHEN donut stroke thickness is resolved
- THEN thickness scales responsively with available size
- AND the production segment remains 1.5x thicker with unchanged center semantics

#### Scenario: Empty or invalid runtime state is explicit
- GIVEN machine selection, endpoint configuration, or fetch results are invalid
- WHEN the widget renders
- THEN the widget shows a legible empty or error state

#### Scenario: Presentation refresh preserves analytics and control behavior
- GIVEN the same activity-series input, range, and widget configuration
- WHEN the refreshed summary presentation renders
- THEN derived analytics, grouped values, state semantics, and data requests stay unchanged
- AND the widget remains strictly read-only with no process write controls

### Requirement: Analytics logic stays testable

The system MUST keep analytics, gap handling, grouping assignment, and endpoint/query validation observable through automated tests, and strict TDD SHALL cover negative value normalization, utilization denominator rules, stop counting near gaps, `kWh` integration, midnight-crossing shifts, day boundaries, and timezone-stable grouping.

#### Scenario: Regressions are caught automatically
- GIVEN representative fixtures for ranges, gaps, and timezone boundaries
- WHEN automated tests run
- THEN analytics outputs remain deterministic and verifiable

### Requirement: Production History-like grouped bar sizing

The system MUST size Activity Analytics grouped stacked bars with Production History-like shrink-before-scroll behavior. Bar width MUST be derived from available plot width, group count, and the configured width factor before horizontal overflow is introduced. Label sampling MUST remain truthful to the rendered groups and MUST NOT imply hidden or aggregated groups that are not present.

#### Scenario: Bars shrink before scroll

- GIVEN the `Grupos` chart has more grouped bars than comfortably fit at the current widget width
- WHEN the chart layout is calculated
- THEN each grouped stacked bar narrows within the allowed sizing model before horizontal scrolling is required
- AND all rendered groups remain reachable when scrolling is eventually needed

#### Scenario: Label sampling remains truthful

- GIVEN the chart samples labels because available horizontal space is limited
- WHEN labels are rendered for the visible grouped bars
- THEN shown labels correspond to real rendered groups
- AND omitted labels do not remove or merge the underlying grouped bars

### Requirement: Builder-controlled Activity Analytics bar width

The system MUST expose a builder configuration parameter for Activity Analytics grouped bar width with Production History-equivalent semantics: default `1`, minimum `0.5`, maximum `1.5`. The parameter MUST affect only grouped bar presentation and MUST preserve valid existing widget behavior when absent from persisted configuration.

#### Scenario: Default width is applied safely

- GIVEN an Activity Analytics widget has no persisted grouped bar-width value
- WHEN default configuration or runtime rendering resolves the widget settings
- THEN grouped bars use width factor `1`
- AND no analytics values or grouped durations change

#### Scenario: Builder adjusts presentation only

- GIVEN Admin edits an Activity Analytics widget
- WHEN the grouped bar-width parameter is set within `0.5..1.5`
- THEN the rendered grouped stacked bars use the selected visual width factor
- AND the stored configuration does not introduce any process-control action

### Requirement: Stacked state and analytics invariance

The system MUST preserve the semantic meaning, ordering, and proportional duration representation of stacked `prod`, `setup`, and `stopped` segments while changing grouped bar geometry. The change MUST NOT alter analytics classification, grouping assignment, data fetching, derived durations, KPI values, or any read-only constraint.

#### Scenario: Stacked state proportions remain intact

- GIVEN grouped analytics contain `prod`, `setup`, and `stopped` durations for a group
- WHEN the grouped bar renders with any valid bar-width factor
- THEN the stacked segments retain their state meaning and relative duration proportions
- AND the visual width change does not change group totals

#### Scenario: No analytics or control behavior changes

- GIVEN the same activity-series input and widget range
- WHEN grouped bar sizing configuration changes
- THEN classification, grouping, KPIs, coverage, stop count, and consumption outputs stay unchanged
- AND the widget remains strictly read-only with no process write controls

### Requirement: Builder-controlled state gradients

The system MUST allow builders to configure Activity Analytics presentation gradients for each state: `prod`, `setup`, and `stopped`. Each state configuration MUST include a start color and an end color, and each color stop MUST expose both a color picker and a pasteable `#RRGGBB` hex field. Each color stop MUST expose alpha from `0..100%`; missing or invalid persisted alpha values MUST resolve to safe defaults. Activity Analytics visual controls MUST use usable, Activity Analytics-specific labels and grouped layout that avoids cramped abbreviations. These controls MUST be specific to Activity Analytics and MUST NOT create a generic cross-widget gradient editor.

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
