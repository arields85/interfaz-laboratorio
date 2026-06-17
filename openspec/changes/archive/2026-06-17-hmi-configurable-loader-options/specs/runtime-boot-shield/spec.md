# Delta for runtime-boot-shield

## MODIFIED Requirements

### Requirement: Root-owned shield continuity

The system MUST reuse the existing root-owned `#hmi-shield` as the only visual shield for boot and supported keyboard reload. The shield MUST NOT be revealed again for `visibilitychange`, window focus recovery, `pageshow`, or any other warm-resume event over an already-rendered UI. Boot and supported keyboard reload MUST enter through the static pre-hydration `long` shield and continue the normal boot path once runtime takes over. Persisted runtime loader options MUST NOT suppress that initial pre-hydration shield because app config is unavailable then.
(Previously: Boot and reload always used the restored default `long` contract with no runtime configuration limitation.)

#### Scenario: Initial boot ignores runtime disable

- GIVEN persisted runtime settings disable `long`
- WHEN the browser loads or reloads the app from the static HTML shield
- THEN the initial pre-hydration shield still appears and boot continues through the normal boot path

#### Scenario: Warm resume does not re-cover live UI

- GIVEN a previously rendered viewer returns from hidden, unfocused, or `pageshow` recovery state
- WHEN the UI resumes without a full boot or reload
- THEN the root-owned shield does not become visible again over that live UI
