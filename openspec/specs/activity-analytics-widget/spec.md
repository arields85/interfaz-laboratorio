# activity-analytics-widget Specification

## Purpose

Define a read-only `activity-analytics` widget that derives utilization, state durations, stops, and estimated consumption from the validated `/activity-series` series contract.

## Requirements

### Requirement: First-release widget contract and scope

The system MUST expose internal widget type `activity-analytics` and SHALL show label `Análisis de Actividad` unless project localization conventions require another runtime label. Each widget MUST bind exactly one machine. It MUST support preset ranges `1h`, `24h`, `7d`, `30d`, and `12m`, and SHALL default to `24h`. The first release MUST NOT expose a dashboard custom date picker, ranking block, compact table, or backend `summary`. The widget MUST remain strictly read-only and MUST NOT expose process-control writes.

#### Scenario: Builder creates the first-release widget
- GIVEN Admin adds an `activity-analytics` widget
- WHEN default configuration is created
- THEN the widget stores one machine binding and range `24h`
- AND no custom-range, ranking, or write controls are shown

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

The widget MUST show KPI cards for `% Prod.`, production time, setup time, stopped time, estimated consumption, and stop count. It MAY also show operating time and coverage when space allows. The main chart MUST render stacked bars for `prod`, `setup`, and `stopped` by selected grouping. Secondary charts for `% Prod.` and `kWh` by group MAY be included in the first release. The widget MUST provide clear empty and error states for missing machine, missing endpoint configuration, empty series, connection failure, and backend errors.

#### Scenario: Populated widget shows grouped analytics
- GIVEN a valid machine and non-empty grouped analytics
- WHEN the widget renders
- THEN KPI cards and the stacked state chart are visible

#### Scenario: Empty or invalid runtime state is explicit
- GIVEN machine selection, endpoint configuration, or fetch results are invalid
- WHEN the widget renders
- THEN the widget shows a legible empty or error state

### Requirement: Analytics logic stays testable

The system MUST keep analytics, gap handling, grouping assignment, and endpoint/query validation observable through automated tests, and strict TDD SHALL cover negative value normalization, utilization denominator rules, stop counting near gaps, `kWh` integration, midnight-crossing shifts, day boundaries, and timezone-stable grouping.

#### Scenario: Regressions are caught automatically
- GIVEN representative fixtures for ranges, gaps, and timezone boundaries
- WHEN automated tests run
- THEN analytics outputs remain deterministic and verifiable
