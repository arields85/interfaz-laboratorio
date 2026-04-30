# canvas-bounds Specification

## Purpose

Define a bounded, aspect-aware dashboard canvas so builder and viewer render the same logical layout. The capability guarantees predictable coordinates, bounded interactions, persistent grid visibility, and a hard reset of incompatible legacy storage.

## Requirements

### Requirement: Shared canvas reference
Canvas dimensions MUST derive from runtime-measured usable viewport space after subtracting topbar, header, and paddings. The canvas MUST fit `16:9`, `21:9`, or `4:3` without stretching; leftover space MUST be letterboxed. Builder and viewer MUST use the same shared canvas primitive. The shared primitive MUST expose whether a first valid measurement has been observed. Until that first valid measurement exists, frame-dependent builder/viewer layout MUST NOT render from zero or unusable metrics and SHOULD render a neutral shell instead. When restore, resume, or resize emits a transient invalid measurement after at least one valid measurement already exists, the shared primitive MUST keep publishing the last valid metrics instead of zero or unusable dimensions. Once a later stable valid measurement arrives, it MUST replace the cached metrics for all consumers. Widget renderers MUST NOT require widget-specific layout patches to survive these transitions.

#### Scenario: Runtime fit with letterboxing
GIVEN a viewport and measured chrome heights/paddings
WHEN the dashboard renders with aspect `16:9`, `21:9`, or `4:3`
THEN the canvas fits within usable space and any sobrante appears as neutral margins

#### Scenario: Shared parity source
GIVEN the same dashboard and viewport measurements
WHEN builder and viewer compute canvas dimensions
THEN both produce the same canvas width and height

#### Scenario: Fresh mount waits for first valid measurement
GIVEN builder or viewer has not yet published any valid shared canvas measurement
WHEN initial runtime metrics are still zero or otherwise invalid
THEN frame-dependent layout does not render from those metrics and a neutral shell is shown instead

#### Scenario: Transient restore collapse is ignored
GIVEN builder or viewer already published a valid shared canvas measurement
WHEN a restore/resume cycle briefly reports zero or otherwise invalid dimensions
THEN the shared primitive keeps the prior valid metrics and consumers do not publish the transient collapse

#### Scenario: Stable restored size replaces the cache
GIVEN the shared primitive is holding a prior valid measurement during a restore/resume cycle
WHEN a later stable valid measurement is observed
THEN that new measurement replaces the cached metrics for builder and viewer without widget-specific corrections

#### Scenario: Admin logout lands in a stable viewer shell
GIVEN an admin logout transitions the app back to the viewer before the first valid canvas measurement is available
WHEN the viewer route mounts
THEN the user does not see a malformed or collapsed layout before valid shared metrics arrive

### Requirement: Grid resolution
The grid MUST use `MAX_COLS = 20`. A new dashboard MUST default to `rows = 12`. `cols` MUST be computed from available width against `MIN_COL_WIDTH` and MUST NOT exceed `20`.

#### Scenario: New dashboard defaults
GIVEN a newly created dashboard
WHEN it is initialized
THEN it starts with `rows = 12` and a computed `cols <= 20`

### Requirement: Logical widget positioning
Every widget MUST persist `x`, `y`, `w`, and `h` as integer logical grid units. Rendering MUST place widgets by `(x, y)` and span `(w, h)`, not by array order. Builder and viewer MUST produce pixel-identical layouts for the same dashboard.

#### Scenario: Array order does not change placement
GIVEN two dashboards with identical widget coordinates but different layout array order
WHEN each dashboard is rendered
THEN the widget positions are visually identical

### Requirement: Aspect metadata
Each dashboard MUST store `aspect` as one of `16:9`, `21:9`, or `4:3`. Changing aspect MUST recompute canvas dimensions on next render without migrating widgets; existing widgets MUST instead be clamped to the new bounds. Templates MUST also store `aspect` and `rows`.

#### Scenario: Aspect change clamps existing layout
GIVEN a dashboard with widgets near the current edges
WHEN the aspect changes and the dashboard re-renders
THEN the canvas uses the new aspect and any out-of-bounds widgets are clamped within it

### Requirement: Drag and resize commit rules
During drag or resize, a widget MAY visually overflow the canvas. On pointer release, position and size MUST be clamped so `x` is within `[0, cols - w]`, `y` within `[0, rows - h]`, `w >= 1`, `h >= 1`, and no committed overflow remains. If release would produce an invalid state, the last valid position before release MUST be committed.

#### Scenario: Overflow while interacting
GIVEN a widget being dragged or resized past the canvas edge
WHEN the pointer is still down
THEN overflow MAY be shown visually and no invalid state is committed yet

#### Scenario: Clamp on release
GIVEN an interaction that ends outside valid bounds
WHEN the pointer is released
THEN the committed widget uses the last valid in-bounds position and size

### Requirement: Visible grid toggle
The builder MUST expose a grid visibility toggle in the `contextBarPanel`. Toggling MUST immediately show or hide both major and minor grid lines. The preference MUST persist in `localStorage` and MUST be restored on later loads.

#### Scenario: Persistent grid preference
GIVEN a user turns the grid off or on
WHEN the builder reloads later
THEN the previous visibility choice is restored automatically

### Requirement: Template aspect enforcement
Applying a template to a dashboard with a different `aspect` MUST fail before any widget is copied. The failure MUST name both aspects and suggest changing dashboard aspect or choosing another template. Mismatched templates SHOULD appear disabled with a tooltip. Matching templates MUST copy widgets with `x/y/w/h` unchanged.

#### Scenario: Mismatch is blocked early
GIVEN a `21:9` template and a `16:9` dashboard
WHEN the user tries to apply the template
THEN no widget is copied and the user sees a message naming both aspects and the two remedies

#### Scenario: Matching template preserves coordinates
GIVEN a template whose aspect matches the dashboard
WHEN the template is applied
THEN copied widgets keep their original `x`, `y`, `w`, and `h`

### Requirement: Storage reset and cleanup
On first load of the new version, legacy dashboard, template, and variable-catalog storage keys MUST be removed from `localStorage`. All three services MUST use new keys. Legacy data MUST be wiped rather than migrated. Any code reference to `gridVersion` or `migrateLayoutWidth` MUST NOT remain.

#### Scenario: First bootstrap after version change
GIVEN a browser with legacy storage entries
WHEN the new version boots for the first time
THEN old keys are removed, only new-version keys remain, and no migration path runs

### Requirement: Non-interference
The dashboard viewer MUST NOT vertically scroll for a well-formed dashboard whose widgets are within canvas bounds. Toggling grid visibility SHOULD affect only the grid overlay and SHOULD NOT require widget content to re-render.

#### Scenario: Well-formed dashboard stays within viewport
GIVEN a dashboard whose widgets all fit within computed bounds
WHEN it is viewed
THEN the canvas is fully visible without vertical scrolling

## Observable outcomes

- Builder and viewer show the same layout from the same saved dashboard.
- Grid visibility survives reloads.
- Drag and resize feel permissive during interaction but always commit bounded results.
- Aspect-mismatched templates are blocked before they can corrupt a dashboard.
