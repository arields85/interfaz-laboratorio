# Delta for loader-options-admin-settings

## ADDED Requirements

### Requirement: Ajustes tab exposes global temporal settings

The system MUST add an `Ajustes` tab that exposes one global `plantTimezone` setting and configurable shift definitions for HMI-wide visualization rules.

#### Scenario: Admin can edit plant timezone

- GIVEN Admin opens `GlobalSettingsDialog`
- WHEN Admin selects `Ajustes`
- THEN the dialog shows a global `plantTimezone` control

#### Scenario: Admin can define an overnight shift

- GIVEN Admin is editing `Ajustes`
- WHEN Admin saves a shift from `22:00` to `06:00`
- THEN the saved definition is accepted as one overnight shift rule

### Requirement: Saved temporal settings re-render current dashboards

The system MUST apply saved `plantTimezone` and shift changes to current-session dashboards immediately after save.

#### Scenario: Save propagates without reload

- GIVEN dashboards are visible in the current session
- WHEN Admin saves `Ajustes`
- THEN affected charts re-render without reopening the app

### Requirement: Temporal settings remain testable

The system MUST keep `Ajustes` draft preservation, save propagation, and read-only persistence observable through automated dialog and state-consumer tests.

#### Scenario: Automated settings checks verify propagation

- GIVEN representative temporal settings fixtures
- WHEN automated settings tests run
- THEN they can assert draft behavior and same-session re-render deterministically

## MODIFIED Requirements

### Requirement: Unsaved settings drafts survive tab switches

The system MUST preserve unsaved in-memory drafts for `Opciones`, `Conexion`, `Diseno`, and `Ajustes` while `GlobalSettingsDialog` remains open. Switching between those tabs SHALL NOT reset edited values or dirty state. Closing the dialog without saving MUST discard those in-memory drafts and SHALL keep persisted values unchanged.
(Previously: draft preservation covered only `Opciones`, `Conexion`, and `Diseno`.)

#### Scenario: Switching tabs keeps the draft

- GIVEN Admin edits a field in `Conexion`, `Diseno`, `Opciones`, or `Ajustes` without saving
- WHEN Admin switches to another settings tab and then returns
- THEN the edited values and unsaved dirty state are still present

#### Scenario: Closing without save discards preserved drafts

- GIVEN Admin has unsaved edits in one or more settings tabs
- WHEN the dialog is closed and reopened without saving
- THEN each tab shows the last persisted values

### Requirement: Persistence stays UI-local and read-only

The system MUST persist loader options and temporal settings as HMI UI configuration only. Saving those settings MUST NOT send plant/process control writes or any operational `POST`, `PUT`, or `DELETE` commands.
(Previously: read-only persistence only covered loader options.)

#### Scenario: Save persists UI config only

- GIVEN Admin saves loader options or temporal settings
- WHEN persistence completes
- THEN a future app session restores the same UI settings without plant-control writes
