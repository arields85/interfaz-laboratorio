# Delta for loader-options-admin-settings

## ADDED Requirements

### Requirement: Weekly schedule validation and legacy draft compatibility

The `Ajustes` editor MUST prevent save when a shift has no selected weekdays, when saved order is ambiguous, or when weekly windows overlap after overnight expansion. Legacy persisted shifts without weekday applicability SHOULD load as every-weekday drafts until Admin saves explicit applicability.

#### Scenario: Missing weekdays blocks save
- GIVEN Admin edits a shift with no selected weekdays
- WHEN save is attempted
- THEN the dialog blocks persistence with a clear validation error

#### Scenario: Legacy draft stays editable
- GIVEN persisted temporal settings predate weekday applicability
- WHEN Admin opens `Ajustes`
- THEN the dialog shows those shifts as every-weekday drafts

## MODIFIED Requirements

### Requirement: Ajustes tab exposes global temporal settings

The system MUST add an `Ajustes` tab that exposes one global `plantTimezone` setting and an editable HMI-wide weekly shift schedule for shared visualization rules. The editor SHALL let Admin define each shift label, local start time, local end time, the weekdays on which that shift starts, and the shared weekly sequence order. These settings MUST apply to the whole HMI and MUST NOT be dashboard-specific.
(Previously: `Ajustes` exposed plant timezone and generic global shift definitions without explicit weekday applicability or shared weekly sequencing.)

#### Scenario: Admin can edit plant timezone
- GIVEN Admin opens `GlobalSettingsDialog`
- WHEN Admin selects `Ajustes`
- THEN the dialog shows a global `plantTimezone` control

#### Scenario: Admin can define an overnight shift
- GIVEN Admin is editing `Ajustes`
- WHEN Admin saves a shift from `22:00` to `06:00`
- THEN the saved definition is accepted as one overnight shift rule

#### Scenario: Admin can define a Monday-to-Friday weekly sequence
- GIVEN Admin is editing `Ajustes`
- WHEN Admin marks the night shift as starting on Monday through Friday only
- THEN the shared schedule stores that applicability for the whole HMI
