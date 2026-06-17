# Delta for shield-reveal-profiles

## ADDED Requirements

### Requirement: Saved loader changes apply to future requests only

The system MUST resolve `long` and `short` settings per new reveal request. Saving Admin loader options MUST affect only requests created after the save and MUST NOT change a loader that is already visible or already running.

#### Scenario: Save does not alter active loader

- GIVEN a `long` reveal is already visible
- WHEN Admin saves new loader options
- THEN the active `long` reveal continues with its original settings

#### Scenario: Next request uses saved config

- GIVEN Admin saved `short` as disabled
- WHEN a later flow requests `short`
- THEN that new request skips visualization immediately

## MODIFIED Requirements

### Requirement: Long profile uses one restored ceremonial contract

The system MUST treat every runtime reveal requested with the `long` profile as one configurable contract. When `long` is enabled, the reveal SHALL keep the same premium sequence and use the configured minimum visible duration. When `long` is disabled for runtime, the request MUST show nothing and continue immediately. This runtime contract SHALL apply to admin/logout and other post-load `long` requests unless the boot-shield limitation or the no-content safety exception applies.
(Previously: Every `long` request always used one fixed restored sequence.)

#### Scenario: Admin or other explicit long reveals stay consistent

- GIVEN a post-load flow requests `long` and `long` is enabled
- WHEN the shield becomes visible
- THEN the same restored sequence is used with the configured duration

#### Scenario: Disabled runtime long skips visualization

- GIVEN a post-load flow requests `long` and `long` is disabled
- WHEN the request is executed
- THEN no loader is shown and the flow continues immediately

### Requirement: Short profile remains an independent fast path

The system MUST keep `short` independent from `long`. When `short` is enabled, a `short` reveal SHALL use its configured minimum visible duration and MUST NOT wait on long-only gates such as font readiness, first draw, stable frames, generic viewer-readiness, or repeat-cycle orchestration. When `short` is disabled, the request MUST show nothing and continue immediately.
(Previously: `short` always used a fixed fast-path duration.)

#### Scenario: Short transition hides without long-only waits

- GIVEN a reveal requests `short` and `short` is enabled
- WHEN destination data is still resolving
- THEN the shield hides after the configured short budget without long waits

#### Scenario: Disabled short skips visualization

- GIVEN a reveal requests `short` and `short` is disabled
- WHEN the request is executed
- THEN no loader is shown and navigation continues immediately
