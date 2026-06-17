# shield-reveal-profiles Specification

## Purpose

Define one product contract for `long` and `short` shield reveals across the HMI.

## Requirements

### Requirement: Long profile uses one restored ceremonial contract

The system MUST treat every reveal requested with the `long` profile as the same premium sequence: fonts -> WebGL first draw -> stable frames -> minimum visible -> hide. This contract SHALL apply to boot, keyboard reload, admin/logout, and any other `long` reveal unless the no-content safety exception applies.

#### Scenario: Boot and reload use the restored long contract

- GIVEN boot or keyboard reload starts a `long` reveal
- WHEN the reveal lifecycle completes its default path
- THEN it follows the restored original sequence before hiding

#### Scenario: Admin or other explicit long reveals stay consistent

- GIVEN admin/logout or another explicit reveal requests `long`
- WHEN the shield becomes visible
- THEN the same restored original sequence is used

### Requirement: Short profile remains an independent fast path

The system MUST keep `short` independent from `long`. A `short` reveal SHALL complete from its own cosmetic budget and MUST NOT wait on long-only gates such as font readiness, first draw, stable frames, generic viewer-readiness, or repeat-cycle orchestration.

#### Scenario: Short transition hides without long-only waits

- GIVEN a reveal requests the `short` profile
- WHEN destination data is still resolving
- THEN the shield hides after the short visual budget without inheriting long waits

#### Scenario: Short is unaffected by long exception logic

- GIVEN another route would qualify for a `long` no-content extension
- WHEN the active reveal uses `short`
- THEN the short reveal still follows only its fast path

### Requirement: No-content safety exception is narrow

The system MAY extend a `long` reveal beyond the restored original sequence only when the destination cannot render a useful, stable, recognizable visual structure. Mounted loading, empty, and error states count as content and SHALL allow the `long` reveal to hide. Blank, broken, or unmounted destinations MUST keep the shield visible until coherent structure exists or a bounded fallback ends the wait.

#### Scenario: Mounted loading state counts as content

- GIVEN the destination mounts a coherent loading, empty, or error layout
- WHEN the restored original `long` sequence finishes
- THEN the shield hides even if data continues resolving

#### Scenario: Blank destination allows extension

- GIVEN the destination is blank, broken, or unmounted
- WHEN the restored original `long` sequence finishes
- THEN the shield may remain visible until recognizable structure appears or fallback releases it

### Requirement: Long duration is not driven by generic orchestration

The system MUST NOT change `long` duration because of generic viewer-readiness signals, repeated typewriter cycles, or repeat-cycle orchestration. Those signals MAY only support the narrow no-content safety decision and MUST NOT redefine the default `long` timeline.

#### Scenario: Late viewer-ready signal does not prolong normal long hide

- GIVEN a `long` reveal already has coherent destination content
- WHEN a generic viewer-ready signal arrives after the restored original sequence
- THEN the shield hide timing is unchanged

#### Scenario: Repeated long cycles are prohibited

- GIVEN a `long` reveal is waiting only on normal default gates
- WHEN generic orchestration would restart or repeat the cycle
- THEN the system does not add another long cycle
