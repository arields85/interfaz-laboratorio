# runtime-boot-shield Specification

## Purpose

Proteger boot, reload y resume con un único shield root-owned para que la HMI no exponga frames intermedios corruptos.

## Requirements

### Requirement: Root-owned shield continuity

The system MUST reuse the existing root-owned `#hmi-shield` as the only visual shield for boot, keyboard reload, and resume triggered by `visibilitychange`, window focus recovery, or `pageshow`. Resume handling MUST reveal that same shield before corrupted intermediate frames can become visible, MUST hide it only after the shared readiness gates complete, and MUST NOT replace or weaken the approved #1088 boot/reload behavior.

#### Scenario: Boot and reload behavior remains intact

- GIVEN the HMI boots or the user triggers the supported keyboard reload flow
- WHEN the shield lifecycle runs
- THEN the existing #1088 loader, timing, and root-owned ownership remain unchanged

#### Scenario: Resume from hidden tab or restored window is shielded

- GIVEN a previously rendered viewer returns from hidden, unfocused, or `pageshow` recovery state
- WHEN transient malformed layout, shader, or typography frames would otherwise appear
- THEN the existing root-owned shield becomes visible first and covers those intermediate frames

### Requirement: Runtime typography-aligned readiness

The system MUST keep the shield visible until the runtime typography tokens and resolved fonts actually used by the viewer are ready. Readiness MUST NOT depend on obsolete legacy font names that are no longer authoritative for the viewer. If runtime font readiness cannot be confirmed, the bounded timeout MAY release the shield as the safety net.

#### Scenario: Active viewer fonts gate shield exit

- GIVEN the viewer currently resolves its typography tokens to the active runtime font stack
- WHEN boot or resume readiness is evaluated
- THEN shield exit waits for those active fonts instead of unrelated historical font names

#### Scenario: Bounded fallback still applies

- GIVEN runtime font readiness never resolves or the browser lacks full font APIs
- WHEN the existing shield timeout is reached
- THEN the shield exits through the existing bounded fallback without changing loader ownership
