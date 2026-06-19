# global-temporal-settings Specification

## Purpose

Define HMI-wide temporal rules for visualization timezone and shift schedules used by read-only dashboards.

## Requirements

### Requirement: Single global plant timezone and shift definitions

The system MUST provide one HMI-wide `plantTimezone` setting and configurable shift definitions from `Ajustes`, and saving them MUST re-render open dashboards in the current session without requiring a page reload.

#### Scenario: Saving timezone refreshes dashboards immediately

- GIVEN dashboards are open in the current session
- WHEN Admin saves a new `plantTimezone`
- THEN visible dashboard timestamps and shift calculations re-render immediately

#### Scenario: Saving shifts refreshes current charts

- GIVEN a chart with shifts enabled is visible
- WHEN Admin saves updated shift definitions
- THEN that chart re-renders using the saved shifts in the same session

### Requirement: Visualization timezone precedence

The system MUST resolve visualization timezone in this order: backend `window.timezone`, global `plantTimezone`, browser local timezone, then `America/Argentina/Buenos_Aires`.

#### Scenario: Backend timezone overrides HMI timezone

- GIVEN `plantTimezone` is saved and a history response includes `window.timezone`
- WHEN a chart renders that response
- THEN labels and shift calculations use `window.timezone`

#### Scenario: Final fallback remains deterministic

- GIVEN neither backend nor HMI nor browser timezone is available
- WHEN temporal formatting is required
- THEN the system uses `America/Argentina/Buenos_Aires`

### Requirement: Shift intervals support midnight crossing

The system MUST build visible shift intervals from the saved global definitions, SHALL support shifts that cross midnight, and MAY reduce dense visual overlays in `auto` mode without changing tooltip or summary assignment.

#### Scenario: Overnight shift spans two dates

- GIVEN a shift is configured from `22:00` to `06:00`
- WHEN a visible window crosses midnight
- THEN that shift is treated as one continuous overnight interval

#### Scenario: Auto mode reduces clutter only visually

- GIVEN a long visible range uses `auto` shift display
- WHEN overlays are reduced for readability
- THEN tooltip shift labels and summary grouping still follow the saved shift rules

### Requirement: Temporal settings stay HMI-local and read-only

The system MUST persist temporal settings as HMI UI configuration only and MUST NOT send plant/process control writes or operational `POST`, `PUT`, or `DELETE` requests to industrial control systems.

#### Scenario: Saving temporal settings remains non-operational

- GIVEN Admin saves `plantTimezone` or shifts
- WHEN persistence completes
- THEN only HMI configuration is updated and no plant-control write is issued

### Requirement: Activity analytics grouping uses deterministic plant time

Activity analytics MUST group by local time in the resolved analytics timezone, not incidental browser-local time. It MUST use the saved global timezone when one exists and SHALL fall back to `America/Argentina/Buenos_Aires` when no global timezone is configured. Grouping for `shift`, `day`, `week`, and `month` MUST stay stable across reloads and user browsers.

#### Scenario: Saved global timezone drives grouping
- GIVEN `plantTimezone` is configured
- WHEN activity analytics groups points near a day boundary
- THEN the groups use that timezone consistently

#### Scenario: Deterministic fallback avoids browser drift
- GIVEN no global timezone is configured
- WHEN two browsers render the same activity series
- THEN both group results use `America/Argentina/Buenos_Aires`

### Requirement: Activity analytics honors saved shifts, including overnight shifts

Activity analytics MUST use the saved global shift definitions, SHALL support shifts that cross midnight, and MUST NOT rely on fixed hardcoded shift boundaries that bypass HMI settings. Group assignment MUST remain stable at midnight transitions and MUST keep gap handling separate from shift boundaries.

#### Scenario: Overnight shift remains one logical shift
- GIVEN a saved shift runs from `22:00` to `06:00`
- WHEN grouped analytics include points before and after midnight
- THEN those points can belong to one overnight shift

#### Scenario: Midnight boundary does not reclassify data incorrectly
- GIVEN valid points on both sides of local midnight
- WHEN day and shift grouping are calculated
- THEN each point stays in the correct local group without browser-local drift

### Requirement: Temporal grouping remains testable and shared-rule compatible

The system MUST keep activity-analytics grouping observable through automated tests and SHALL remain compatible with shared temporal rules already used by the HMI instead of introducing a separate fixed-shift behavior for this widget.

#### Scenario: Shared temporal contract stays verifiable
- GIVEN fixtures for timezone changes and overnight shifts
- WHEN automated grouping tests run
- THEN the widget grouping behavior remains deterministic
