# Delta for activity-analytics-widget

## MODIFIED Requirements

### Requirement: First-release widget contract and scope

The system MUST expose internal widget type `activity-analytics`, bind exactly one machine, default to `24h`, and expose only `24h`, `7d`, `30d`, and `12m` in user-facing range controls. It MUST normalize legacy `1h` to `24h`. It MUST keep `custom` internally supported and capped at 30 days, MUST NOT show a custom picker/editor in admin or runtime, MUST hide backend `summary`, SHALL use temporal settings, and MUST remain read-only. Allowed groups MUST be `24h -> Turno/Día`, `7d -> Turno/Día/Semana`, `30d -> Turno/Día/Semana/Mes`, `12m -> Turno/Semana/Mes`, `custom <=24h -> Turno/Día`, `custom <=7d -> Turno/Día/Semana`, `custom >7d -> Turno/Día/Semana/Mes`.
(Previously: `1h` was user-visible, `custom` could be described as user-facing, and long-range `Turno` was clamped away.)

#### Scenario: Builder defaults
- GIVEN Admin adds the widget
- WHEN default configuration is created
- THEN one machine binding and range `24h` are stored
- AND `1h` and write controls are absent

#### Scenario: Hide summary and keep long-range Turno
- GIVEN the backend response includes `summary` and the active range is `30d`
- WHEN the widget renders
- THEN only frontend-derived analytics are shown
- AND `Turno` remains offered without exposing `Detalle`

#### Scenario: Persisted custom stays internal
- GIVEN a saved widget has range `custom` with valid 10-day bounds
- WHEN runtime state hydrates
- THEN visible controls still omit `custom`
- AND shared rules preserve only duration-compatible grouping

### Requirement: Gap-aware analytics and ranking

The system MUST derive durations from timestamp deltas, cap the trailing delta at `bucketMs * 1.5`, and treat gaps `> bucketMs * 2` as `no-data`, excluded from coverage and utilization and never counted as stops. Utilization MUST equal `prodDuration / (prodDuration + setupDuration + stoppedDuration)`. Estimated `kWh` MUST sum `normalizedKW * durationHours` for data-backed durations only. Stop count MUST count only active-to-`stopped` transitions. `Turno` MUST resolve through the weekly schedule, default to `Resumen`, and aggregate into exactly three buckets (`Turno 1/2/3`). `Detalle` MUST appear only when the active preset range is `24h` or `7d` and grouping is `Turno`; it SHALL show chronological real shifts and the in-progress shift as a partial bar. `30d`, `12m`, and every `custom` window MUST keep `Turno` in `Resumen` only. Low coverage MUST show `sin datos`; invalid or uncovered schedule windows MUST show `sin turno`; best/worst periods MUST rank by `% Prod.` only.
(Previously: `Turno` lacked fixed 3-bar summary semantics, preset-only detail gating, and explicit summary-only treatment for long/custom windows.)

#### Scenario: Gap stays no-data
- GIVEN adjacent timestamps differ by more than `bucketMs * 2`
- WHEN analytics are calculated
- THEN the interval is treated as `no-data`
- AND utilization and stop count ignore that gap

#### Scenario: Stop counts once
- GIVEN consecutive data-backed states change from `prod` to `stopped`
- WHEN analytics are calculated
- THEN stopped duration increases
- AND stop count increments by one

#### Scenario: Truthful turno detail
- GIVEN grouping is `Turno`, range is `24h`, one shift is in progress, and another window lacks valid schedule coverage
- WHEN grouped analytics render in `Detalle`
- THEN the active shift appears as a partial in-progress bar
- AND invalid windows show `sin datos` or `sin turno`

#### Scenario: Custom turno stays summary-only
- GIVEN grouping is `Turno` and persisted custom bounds are compatible with `Turno`
- WHEN grouped analytics render
- THEN the widget stays in `Resumen`
- AND no `Detalle` toggle is shown

### Requirement: First-release outputs and states

The widget MUST use `Resumen` as the only hero summary and MUST NOT render a KPI strip, pseudo-card fills, or peer summary. `Resumen` MUST be a `prod-history`-style X/Y duration chart for `prod`, `setup`, and `stopped`; `Grupos` MUST be a real grouped chart on shared scale. `Resumen / Detalle` MUST appear only for `24h` or `7d` with `Turno`. Responsive density MUST follow `fit -> compress -> scroll`, with truthful text fallback only after charts become unreadable. Bars MUST keep semantic green/yellow/red. `Mejor` / `Peor` MUST use compact chart typography. Empty, error, coverage, and in-progress states MUST stay explicit.
(Previously: summary visuals were card-like, responsive fallback order was looser, and long-range `Turno` behavior was not aligned with the final chart contract.)

#### Scenario: Hero summary and detail
- GIVEN a valid machine, grouping `Turno`, and a constrained dashboard area
- WHEN the widget renders for `7d` and then for `30d`
- THEN `Resumen` shows the hero duration chart and `Grupos` shows comparative stacked bars
- AND charts compress before scrolling, with `Resumen / Detalle` only for `7d`

#### Scenario: Empty/error explicit
- GIVEN machine selection, endpoint configuration, or fetch results are invalid
- WHEN the widget renders
- THEN the widget shows a legible empty or error state
