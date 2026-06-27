# Delta for activity-analytics-widget

## MODIFIED Requirements

### Requirement: First-release outputs and states

The widget MUST present the summary area as a compact `Distribución` layout, MUST NOT render KPI strip/cards, and MUST NOT wrap the summary in an inner framed container. The donut MUST remain the hero visual with unchanged center semantics. Summary details MUST appear to the right of the donut in one vertically centered block ordered `Producción`, `Setup`, `Detenida`; each section MUST show exactly one inline `% - hours` value string. Coverage and value strings MUST use technical/mono typography tokens; section titles MUST use general typography tokens. Donut thickness MUST scale responsively with available size while the production segment remains 1.5x thicker than the other segments. The main chart MUST render stacked bars for `prod`, `setup`, and `stopped` by selected grouping. Secondary charts for `% Prod.` and `kWh` by group MAY be included. The widget MUST provide clear empty and error states for missing machine, missing endpoint configuration, empty series, connection failure, and backend errors. This change MUST NOT alter analytics, grouping, data fetching, persisted configuration, state semantics, read-only constraints, or process-control behavior.
(Previously: the summary rendered KPI cards for `% Prod.`, production/setup/stopped time, estimated consumption, and stop count, with optional operating time and coverage.)

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
