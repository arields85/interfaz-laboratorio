# Delta for canvas-bounds

## MODIFIED Requirements

### Requirement: Shared canvas reference

Canvas dimensions MUST derive from runtime-measured usable viewport space after subtracting topbar, header, and paddings. The canvas MUST fit `16:9`, `21:9`, or `4:3` without stretching; leftover space MUST be letterboxed. Builder and viewer MUST use the same shared canvas primitive. The shared primitive MUST expose whether a first valid measurement has been observed. Until that first valid measurement exists, frame-dependent builder/viewer layout MUST NOT render from zero or unusable metrics and SHOULD render a neutral shell instead. When restore, resume, or resize emits a transient invalid measurement after at least one valid measurement already exists, the shared primitive MUST keep publishing the last valid metrics instead of zero or unusable dimensions. Once a later stable valid measurement arrives, it MUST replace the cached metrics for all consumers. Widget renderers MUST NOT require widget-specific layout patches to survive these transitions.

(Previously: the shared primitive preserved the last valid metrics after a valid measurement existed, but it did not expose first-valid readiness for fresh mounts.)

#### Scenario: Runtime fit with letterboxing

- GIVEN a viewport and measured chrome heights or paddings
- WHEN the dashboard renders with aspect `16:9`, `21:9`, or `4:3`
- THEN the canvas fits within usable space and any sobrante appears as neutral margins

#### Scenario: Shared parity source

- GIVEN the same dashboard and viewport measurements
- WHEN builder and viewer compute canvas dimensions
- THEN both produce the same canvas width and height

#### Scenario: Fresh mount waits for first valid measurement

- GIVEN builder or viewer has not yet published any valid shared canvas measurement
- WHEN initial runtime metrics are still zero or otherwise invalid
- THEN frame-dependent layout does not render from those metrics and a neutral shell is shown instead

#### Scenario: Transient restore collapse is ignored

- GIVEN builder or viewer already published a valid shared canvas measurement
- WHEN a restore, resume, or resize cycle briefly reports zero or otherwise invalid dimensions
- THEN the shared primitive keeps the prior valid metrics and consumers do not publish the transient collapse

#### Scenario: Stable restored size replaces the cache

- GIVEN the shared primitive is holding a prior valid measurement during a restore, resume, or resize cycle
- WHEN a later stable valid measurement is observed
- THEN that new measurement replaces the cached metrics for builder and viewer without widget-specific corrections

#### Scenario: Admin logout lands in a stable viewer shell

- GIVEN an admin logout transitions the app back to the viewer before the first valid canvas measurement is available
- WHEN the viewer route mounts
- THEN the user does not see a malformed or collapsed layout before valid shared metrics arrive
