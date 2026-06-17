# loader-options-admin-settings Specification

## Purpose

Define Admin-managed loader settings for UI-only behavior in the read-only HMI.

## Requirements

### Requirement: Opciones tab exposes loader controls

The system MUST add an Admin tab labeled `Opciones` with separate `long` and `short` sections. Each section SHALL expose an enable/disable control and a duration input. The duration input MUST be enabled only while its loader is enabled. The UI MUST show helper text indicating `0.2s` minimum and `15s` maximum.

#### Scenario: Enabled loader allows duration editing

- GIVEN Admin opens `Opciones`
- WHEN `short` is enabled
- THEN the `short` duration input is enabled and the helper text is visible

#### Scenario: Disabled loader locks duration editing

- GIVEN Admin opens `Opciones`
- WHEN `long` is disabled
- THEN the `long` duration input is disabled

### Requirement: Durations normalize to bounded defaults

The system MUST default loader durations to `short=2s` and `long=8s`, with both loaders enabled by default to preserve current behavior. Persisted or submitted duration values SHALL stay within `0.2s..15s`. Invalid, missing, or non-numeric values MUST fall back to the loader default.

#### Scenario: Valid saved value is retained

- GIVEN Admin saves `short=1.5s`
- WHEN settings are reloaded
- THEN `short` resolves to `1.5s`

#### Scenario: Invalid value falls back to default

- GIVEN persisted `long` duration is negative or non-numeric
- WHEN settings are loaded
- THEN `long` resolves to `8s`

### Requirement: Restore defaults updates draft only

The system MUST provide a restore-defaults action that resets form fields to the default enabled states and default durations without persisting until the user saves.

#### Scenario: Restore defaults changes draft

- GIVEN unsaved custom loader settings
- WHEN Admin selects restore defaults
- THEN the form fields show the default values before save

#### Scenario: Closing without save preserves persisted values

- GIVEN restore defaults was used but not saved
- WHEN the dialog is dismissed and reopened
- THEN the previously persisted values remain

### Requirement: Unsaved settings drafts survive tab switches

The system MUST preserve unsaved in-memory drafts for `Opciones`, `Conexion`, and `Diseno` while `GlobalSettingsDialog` remains open. Switching between those tabs SHALL NOT reset edited values or dirty state. Closing the dialog without saving MUST discard those in-memory drafts and SHALL keep persisted values unchanged.

#### Scenario: Switching tabs keeps the draft

- GIVEN Admin edits a field in `Conexion`, `Diseno`, or `Opciones` without saving
- WHEN Admin switches to another settings tab and then returns
- THEN the edited values and unsaved dirty state are still present

#### Scenario: Closing without save discards preserved drafts

- GIVEN Admin has unsaved edits in one or more settings tabs
- WHEN the dialog is closed and reopened without saving
- THEN each tab shows the last persisted values

### Requirement: Persistence stays UI-local and read-only

The system MUST persist loader options as HMI UI configuration only. Saving loader options MUST NOT send plant/process control writes or any operational `POST`, `PUT`, or `DELETE` commands.

#### Scenario: Save persists UI config only

- GIVEN Admin saves loader options
- WHEN persistence completes
- THEN a future app session restores the same UI settings without plant-control writes
