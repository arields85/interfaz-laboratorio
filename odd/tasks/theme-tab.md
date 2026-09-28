# Theme tab — visual styles for widget frames and buttons — ODD feature document

> ODD feature task (not SDD). Worktree `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\theme-tab`,
> branch `feat/theme-tab` from `main` `3790cbd` (runs in parallel with `feat/group-widget` in the
> main checkout). Engram mirror: topic `odd/theme-tab/tasks`; user choice and lab technique:
> Engram `backlog/hmi-theme-styles`.

## Objective

A new "Tema" tab in the admin general settings to choose the visual style of the widget frames
and the buttons, with separate rest and hover values, so the HMI can drop the generic glass look.
The first new theme is the one the user designed in the style lab.

## Problem and why

The current glass style (blur, 24 px radius, glow) reads as generic AI design and is repeated
everywhere. Radius and frame values are hardcoded (`.glass-panel` `border-radius: 1.5rem`), so
nothing can be restyled centrally.

## User's theme "Contorno" (from the lab, 2026-09-27)

- **Widgets** (outline base, transparent fill):
  - rest: radius 0, fill 0 %, border 15 %, blur 2 px, corner accent hidden with animation origin
    18 px length x 1 px thickness, white;
  - hover: radius 0, fill 4 %, border 25 %, blur 2 px, corner accent visible 8 px x 1 px white at
    40 %.
- **Buttons** (outline base): rest radius 0, fill 0 %, border 22 %; hover radius 0, fill 3 %,
  border 50 %; corner accent hidden in both states (origin 8 px x 1 px white).
- **Must keep:** the corner-accent animation. A hidden accent is opacity 0 but keeps its own
  length, thickness and color as the start of the rest -> hover transition (length 18 -> 8 px
  while opacity 0 -> 40 %).
- Fill and border percentages are white mixed into transparent over the variant base.

## Lab technique (reference implementation)

Artifact https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8. Registered `@property` custom
properties (`<length>`, `<percentage>`, `<color>`) switched between rest and hover values on
`:hover` and transitioned on the element; background = white overlay `color-mix(in srgb, #fff
var(--fill), transparent)` over the variant base; border = `color-mix(in srgb, #fff
var(--border), transparent)`; corner accent = `::after` with the state's border width and color,
masked to four corner squares whose size is the length variable; radius inherited;
`backdrop-filter: blur(var(--blur))`.

## Current evidence (mapping 2026-09-28)

- Tabs: `GlobalSettingsDialog.tsx:12-18` (`TABS`), per-tab dirty/status/save/revert maps, test
  `GlobalSettingsDialog.test.tsx:253-259` pins tab order/count.
- `DesignSettingsTab.tsx` writes tokens with `documentElement.style.setProperty`, persists
  `localStorage` `hmi-theme-fonts` / `hmi-theme-colors`, boot re-apply via exported
  `applyThemeOverrides()` called in `main.tsx:22`.
- Frame CSS in `index.css`: `.glass-panel` 595-615 (radius 1.5rem, blur 12px, overflow hidden),
  `.glass-panel-danger/-warning` 617-660 (semantic, keep), `.widget-state-warning/-critical`
  669-703 (self-contained, redeclare radius/blur; semantic colors keep).
- Renderer roots on `glass-panel`: ActivityAnalytics, AlertHistory, ConnectionStatus, InfoCard,
  MachineActivity, ProdTrend, ProduccionHistorica, Status, TrendChart, Kpi, MetricCard (+ group
  widget on the other branch). TextTitle is frameless by design. `KpiWidget.tsx:290` loading
  skeleton hardcodes `rounded-3xl`.
- Buttons: `AdminActionButton` (~64 uses), `HmiButton` (~26), `AdminIconToolbarButton` (~9),
  `.admin-accent-ghost` (`index.css:584`), widget segmented controls
  `WidgetHeaderTemporalControls.tsx` (6 uses); all `rounded-md` Tailwind.
- No `--radius-*` tokens in `@theme`; Tailwind 4.2.1.

## Open product questions

- Q1 (asked 2026-09-28): tab = preset selector only, or selector + in-app editor like the lab?
- Q2 (to ask): which buttons the theme restyles (admin actions, viewer buttons, widget segmented
  controls).

## Constraints

- Default theme ("Clásico") must reproduce today's look exactly (zero visual change until the
  user picks another theme).
- Warning/critical semantic frame colors keep working on top of any theme.
- Visible UI text in Spanish, usted register; code, comments, identifiers in English; tokens only.
- TDD: strict, source = global CLAUDE.md; runner = Vitest (`hmi-app`: `npx vitest run <files>`,
  `npm test`).
- ~400 authored lines per task is an advisory heuristic only.

## Tasks

- [ ] **TH1** — Frame theme engine: widget frame visuals (radius, fill, border, blur, corner
  accent) driven by rest/hover theme tokens with registered `@property` transitions, applied to
  `.glass-panel` and `.widget-state-*` without breaking semantic warning/critical colors;
  defaults = today's look; Kpi skeleton radius on the token. Route: delegated writer.
- [ ] **TH2** — Theme model, built-in presets ("Clásico" = current, "Contorno" = user's),
  persistence and boot re-apply (mirrors `applyThemeOverrides`). Route: same writer as TH1.
- [ ] **TH3** — Button theme engine on the primitives chosen in Q2.
- [ ] **TH4** — "Tema" tab UI in `GlobalSettingsDialog` (scope per Q1), dirty/save/revert like the
  other tabs.
- [ ] **TH5** — Docs (`docs/DESIGN_SYSTEM.md`) and live check by the user.

## Delivery

Forecast ~1,000–1,400 authored lines depending on Q1. Strategy: `feature-branch-chain`, same as
the group widget (commits on `feat/theme-tab`, slice reviews, one merge to `main` after the user's
live check).

## Checks

- Focused Vitest per task; at closure `npm test`, `npx tsc -b`, `npm run lint` (in `hmi-app/`).
- Live check by the user.

## Progress

- 2026-09-28: worktree, branch and feature document created; mapping done.

## Next step

Delegate TH1+TH2 (independent of Q1/Q2).
