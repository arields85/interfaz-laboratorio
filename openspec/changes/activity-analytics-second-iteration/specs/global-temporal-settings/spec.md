# Delta for global-temporal-settings

## ADDED Requirements

### Requirement: Legacy shift settings normalize safely

Saved temporal settings that omit weekday applicability or weekly order SHOULD remain readable by normalizing each legacy shift as active on every weekday in its saved order until Admin saves an explicit weekly schedule. The system MUST reject schedules that leave a shift with no applicable weekday or that create overlapping weekly windows after overnight expansion.

#### Scenario: Legacy shifts stay readable
- GIVEN persisted shifts have only start and end hours
- WHEN temporal settings are loaded
- THEN each legacy shift is treated as active every weekday in saved order

#### Scenario: Invalid weekly overlap is rejected
- GIVEN two saved weekly shift windows overlap on the same local timeline
- WHEN validation runs before persistence
- THEN the schedule is rejected with a clear error

## MODIFIED Requirements

### Requirement: Single global plant timezone and shift definitions

The system MUST provide one HMI-wide `plantTimezone` setting and one HMI-wide weekly shift schedule from `Ajustes`, and saving them MUST re-render open dashboards in the current session without requiring a page reload. Each saved shift definition SHALL include a label, local start time, local end time, and the weekdays on which that shift starts. Saved order SHALL define the weekly sequence reused across dashboards and sessions. Overnight shifts MUST continue into the next local date without requiring a duplicate second-day rule.
(Previously: global temporal settings stored generic shift definitions without explicit weekday applicability or ordered weekly sequencing.)

#### Scenario: Saving timezone refreshes dashboards immediately
- GIVEN dashboards are open in the current session
- WHEN Admin saves a new `plantTimezone`
- THEN visible dashboard timestamps and shift calculations re-render immediately

#### Scenario: Saving shifts refreshes current charts
- GIVEN a chart with shifts enabled is visible
- WHEN Admin saves updated shift definitions
- THEN that chart re-renders using the saved shifts in the same session

#### Scenario: Friday night shift continues into Saturday morning
- GIVEN the weekly schedule includes a Friday shift from `22:00` to `06:00`
- WHEN the saved schedule is resolved across the week boundary
- THEN the Friday shift remains active until Saturday `06:00`

### Requirement: Activity analytics honors saved shifts, including overnight shifts

Activity analytics MUST use the saved global weekly shift schedule, SHALL support shifts that cross midnight, and MUST NOT rely on fixed hardcoded shift boundaries that bypass HMI settings. Group assignment MUST remain stable at midnight transitions and MUST keep gap handling separate from shift boundaries. Any timestamp outside the configured weekly sequence MUST resolve to `sin turno` instead of being coerced into the nearest shift.
(Previously: activity analytics used saved global shift definitions and overnight support, but no explicit weekly-sequence or `sin turno` rule existed.)

#### Scenario: Overnight shift remains one logical shift
- GIVEN a saved shift runs from `22:00` to `06:00`
- WHEN grouped analytics include points before and after midnight
- THEN those points can belong to one overnight shift

#### Scenario: Midnight boundary does not reclassify data incorrectly
- GIVEN valid points on both sides of local midnight
- WHEN day and shift grouping are calculated
- THEN each point stays in the correct local group without browser-local drift

#### Scenario: Out-of-schedule time becomes sin turno
- GIVEN the weekly schedule has no active shift for Sunday 10:00
- WHEN activity analytics assigns a shift label
- THEN the label is `sin turno`
