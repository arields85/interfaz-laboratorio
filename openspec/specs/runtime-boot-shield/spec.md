# runtime-boot-shield Specification

## Purpose

Proteger boot y keyboard reload con un único shield root-owned para que la HMI no exponga frames intermedios corruptos, sin volver a cubrir una UI ya renderizada durante warm resume.

## Requirements

### Requirement: Root-owned shield continuity

The system MUST reuse the existing root-owned `#hmi-shield` as the only visual shield for boot and supported keyboard reload. The shield MUST NOT be revealed again for `visibilitychange`, window focus recovery, `pageshow`, or any other warm-resume event over an already-rendered UI. Boot and reload MUST preserve the approved #1088 loader sequence, minimum-visible timing, bounded timeout, stable-frame behavior, and final typewriter loader.

#### Scenario: Boot and reload behavior remains intact

- GIVEN the HMI boots or the user triggers the supported keyboard reload flow
- WHEN the shield lifecycle runs
- THEN the existing #1088 loader, timing, and root-owned ownership remain unchanged

#### Scenario: Warm resume does not re-cover live UI

- GIVEN a previously rendered viewer returns from hidden, unfocused, or `pageshow` recovery state
- WHEN the UI resumes without a full boot or reload
- THEN the root-owned shield does not become visible again over that live UI

### Requirement: Runtime typography-aligned readiness

The system MUST keep the boot/reload shield visible until the canonical runtime typography source for the viewer reports the active fonts are ready, or until the bounded timeout releases it as the safety net. Font readiness MUST come from a shared authoritative source or equivalent canonical runtime resolution, and MUST NOT depend on hook-local hardcoded font-name literals.

#### Scenario: Active viewer fonts gate shield exit

- GIVEN the viewer resolves its typography from the canonical runtime source
- WHEN boot or reload readiness is evaluated
- THEN shield exit waits for those active fonts instead of hook-local literal names

#### Scenario: Bounded fallback still applies

- GIVEN runtime font readiness never resolves or the browser lacks full font APIs
- WHEN the existing shield timeout is reached
- THEN the shield exits through the existing bounded fallback without changing loader ownership
