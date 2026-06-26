# Delta for activity-analytics-widget

## ADDED Requirements

### Requirement: Production History-like grouped bar sizing

The system MUST size Activity Analytics grouped stacked bars with Production History-like shrink-before-scroll behavior. Bar width MUST be derived from available plot width, group count, and the configured width factor before horizontal overflow is introduced. Label sampling MUST remain truthful to the rendered groups and MUST NOT imply hidden or aggregated groups that are not present.

#### Scenario: Bars shrink before scroll

- GIVEN the `Grupos` chart has more grouped bars than comfortably fit at the current widget width
- WHEN the chart layout is calculated
- THEN each grouped stacked bar narrows within the allowed sizing model before horizontal scrolling is required
- AND all rendered groups remain reachable when scrolling is eventually needed

#### Scenario: Label sampling remains truthful

- GIVEN the chart samples labels because available horizontal space is limited
- WHEN labels are rendered for the visible grouped bars
- THEN shown labels correspond to real rendered groups
- AND omitted labels do not remove or merge the underlying grouped bars

### Requirement: Builder-controlled Activity Analytics bar width

The system MUST expose a builder configuration parameter for Activity Analytics grouped bar width with Production History-equivalent semantics: default `1`, minimum `0.5`, maximum `1.5`. The parameter MUST affect only grouped bar presentation and MUST preserve valid existing widget behavior when absent from persisted configuration.

#### Scenario: Default width is applied safely

- GIVEN an Activity Analytics widget has no persisted grouped bar-width value
- WHEN default configuration or runtime rendering resolves the widget settings
- THEN grouped bars use width factor `1`
- AND no analytics values or grouped durations change

#### Scenario: Builder adjusts presentation only

- GIVEN Admin edits an Activity Analytics widget
- WHEN the grouped bar-width parameter is set within `0.5..1.5`
- THEN the rendered grouped stacked bars use the selected visual width factor
- AND the stored configuration does not introduce any process-control action

### Requirement: Stacked state and analytics invariance

The system MUST preserve the semantic meaning, ordering, and proportional duration representation of stacked `prod`, `setup`, and `stopped` segments while changing grouped bar geometry. The change MUST NOT alter analytics classification, grouping assignment, data fetching, derived durations, KPI values, or any read-only constraint.

#### Scenario: Stacked state proportions remain intact

- GIVEN grouped analytics contain `prod`, `setup`, and `stopped` durations for a group
- WHEN the grouped bar renders with any valid bar-width factor
- THEN the stacked segments retain their state meaning and relative duration proportions
- AND the visual width change does not change group totals

#### Scenario: No analytics or control behavior changes

- GIVEN the same activity-series input and widget range
- WHEN grouped bar sizing configuration changes
- THEN classification, grouping, KPIs, coverage, stop count, and consumption outputs stay unchanged
- AND the widget remains strictly read-only with no process write controls
