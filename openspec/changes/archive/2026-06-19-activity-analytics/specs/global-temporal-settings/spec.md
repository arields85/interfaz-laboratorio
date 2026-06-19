# Delta for global-temporal-settings

## ADDED Requirements

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
