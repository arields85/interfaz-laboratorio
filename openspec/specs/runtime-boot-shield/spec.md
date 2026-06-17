# runtime-boot-shield Specification

## Purpose

Proteger boot y keyboard reload con un único shield root-owned para que la HMI no exponga frames intermedios corruptos, sin volver a cubrir una UI ya renderizada durante warm resume.

## Requirements

### Requirement: Root-owned shield continuity

The system MUST reuse the existing root-owned `#hmi-shield` as the only visual shield for boot and supported keyboard reload. The shield MUST NOT be revealed again for `visibilitychange`, window focus recovery, `pageshow`, or any other warm-resume event over an already-rendered UI. Boot and supported keyboard reload MUST enter through the static pre-hydration `long` shield and continue the normal boot path once runtime takes over. Persisted runtime loader options MUST NOT suppress that initial pre-hydration shield because app config is unavailable then.

#### Scenario: Initial boot ignores runtime disable

- GIVEN persisted runtime settings disable `long`
- WHEN the browser loads or reloads the app from the static HTML shield
- THEN the initial pre-hydration shield still appears and boot continues through the normal boot path

#### Scenario: Warm resume does not re-cover live UI

- GIVEN a previously rendered viewer returns from hidden, unfocused, or `pageshow` recovery state
- WHEN the UI resumes without a full boot or reload
- THEN the root-owned shield does not become visible again over that live UI

### Requirement: Runtime typography-aligned readiness

The system MUST keep the boot/reload shield visible until the canonical runtime typography source for the viewer reports the active fonts are ready, and the restored original `long` sequence then continues through first draw, stable frames, minimum visible, and hide, or until the bounded timeout releases it as the safety net. Boot/reload MUST NOT stay visible longer because of generic viewer-readiness signals or repeated long-cycle orchestration once those restored original gates have completed.

#### Scenario: Active viewer fonts gate the start of shield exit

- GIVEN the viewer resolves its typography from the canonical runtime source
- WHEN boot or reload readiness is evaluated
- THEN the restored `long` sequence waits for those active fonts instead of hook-local literal names

#### Scenario: Late viewer-ready does not delay default long hide

- GIVEN fonts, first draw, stable frames, and minimum visible have completed
- WHEN a generic viewer-ready signal is still unresolved
- THEN boot or reload still hides on the restored default long timeline

#### Scenario: Bounded fallback still applies

- GIVEN runtime font readiness or other restored original gates never resolve
- WHEN the existing shield timeout is reached
- THEN the shield exits through the existing bounded fallback without changing root-owned ownership
