# Proposal: Activity Analytics Summary Presentation Refresh

## Intent

Reintroduce the approved Activity Analytics summary presentation refresh as a separate, reviewable slice after isolating grouped-bar parity. This change improves summary density and hierarchy without changing analytics, data fetching, or read-only behavior.

## Scope

### In Scope
- Remove the KPI strip/cards from Activity Analytics.
- Rename the widget subtitle to `Distribución`.
- Remove the inner framed summary container so the summary uses space compactly.
- Keep the donut summary as the hero visual and preserve donut center behavior.
- Move summary details to the right of the donut in a vertically centered block.
- Order detail sections as `Producción`, `Setup`, `Detenida`, each showing one inline `% - hours` value string.
- Use technical/mono typography tokens for coverage and values; use general typography tokens for section titles.
- Scale donut thickness dynamically with available size, with the production segment remaining 1.5x thicker.

### Out of Scope
- Grouped-bar parity, bar-width controls, or grouped chart behavior.
- Analytics, grouping, data-fetching, persistence, admin controls, or process writes.
- Changing donut center semantics, state colors, or read-only constraints.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `activity-analytics-widget`: summary presentation contract changes from KPI-strip/card framing to a compact donut-led distribution layout while preserving analytics semantics.

## Approach

Update only the Activity Analytics renderer and focused tests. Treat the current analytics outputs as immutable inputs, reshape the summary view structure, and derive responsive donut stroke thickness from available render size using the same visual intent as the KPI circular widget while preserving the 1.5x production emphasis.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.tsx` | Modified | Summary layout, subtitle, typography tokens, donut stroke scaling |
| `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` | Modified | Behavioral coverage for no KPI strip, compact distribution layout, ordering, and preserved donut semantics |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Visual refactor accidentally changes analytics semantics | Med | Assert existing derived values and read-only behavior remain unchanged |
| Responsive donut becomes too thin/thick in constrained widgets | Med | Clamp dynamic thickness and cover small/large render cases |
| Typography assertions become style-coupled | Low | Prefer semantic/behavioral tests; inspect token classes only where typography contract matters |

## Rollback Plan

Revert the renderer/test changes for this change folder only, restoring the previous Activity Analytics summary presentation. No data migration or backend rollback is required.

## Dependencies

- Existing Activity Analytics frontend-derived summary totals and current donut center behavior.
- Existing design tokens from Tailwind v4 `@theme`.

## Success Criteria

- [ ] Activity Analytics renders no KPI strip/cards and subtitle `Distribución`.
- [ ] The donut remains the hero, with unchanged center behavior and responsive thickness.
- [ ] Right-side sections are vertically centered and ordered `Producción`, `Setup`, `Detenida`.
- [ ] Each section shows exactly one inline `% - hours` value string with approved typography token usage.
- [ ] Analytics outputs, state semantics, grouped bars, and read-only behavior remain unchanged.
