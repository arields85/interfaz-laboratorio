# Delta for canvas-bounds

## MODIFIED Requirements

### Requirement: Shared canvas reference

For this change, builder and viewer MUST keep using the same shared canvas primitive while restore, resume, or resize transiently destabilize measurements. When an invalid measurement arrives after at least one valid measurement already exists, the shared primitive MUST keep publishing the last valid metrics instead of zero or unusable dimensions. Once a later stable valid measurement arrives, it MUST replace the cached metrics for all consumers. Widget renderers MUST NOT require widget-specific layout patches to survive these transitions.
(Previously: the shared primitive did not explicitly filter transient invalid restore measurements after a valid size had already been published.)

#### Scenario: Shared parity source

- GIVEN the same dashboard and viewport measurements
- WHEN builder and viewer compute canvas dimensions
- THEN both produce the same canvas width and height

#### Scenario: Transient restore collapse is ignored

- GIVEN builder or viewer already published a valid shared canvas measurement
- WHEN a restore/resume cycle briefly reports zero or otherwise invalid dimensions
- THEN the shared primitive keeps the prior valid metrics and consumers do not publish the transient collapse

#### Scenario: Stable restored size replaces the cache

- GIVEN the shared primitive is holding a prior valid measurement during a restore/resume cycle
- WHEN a later stable valid measurement is observed
- THEN that new measurement replaces the cached metrics for builder and viewer without widget-specific corrections
