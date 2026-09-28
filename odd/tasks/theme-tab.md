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

- Q1 ANSWERED (user, 2026-09-28): preset selector only for now. The style lab stays as a separate
  dev tool to keep improving (`tools/style-lab/`), not inside the HMI.
- Q2 ANSWERED (user, 2026-09-28): all three button groups — admin actions (`AdminActionButton`,
  `AdminIconToolbarButton`, `.admin-accent-ghost`), viewer buttons (`HmiButton`) and widget
  segmented controls (`WidgetHeaderTemporalControls`).

## Constraints

- Default theme ("Clásico") must reproduce today's look exactly (zero visual change until the
  user picks another theme).
- Warning/critical semantic frame colors keep working on top of any theme.
- Visible UI text in Spanish, usted register; code, comments, identifiers in English; tokens only.
- TDD: strict, source = global CLAUDE.md; runner = Vitest (`hmi-app`: `npx vitest run <files>`,
  `npm test`).
- ~400 authored lines per task is an advisory heuristic only.

## Tasks

- [x] **TH1** — Frame theme engine: widget frame visuals (radius, fill, border, blur, corner
  accent) driven by rest/hover theme tokens with registered `@property` transitions, applied to
  `.glass-panel` and `.widget-state-*` without breaking semantic warning/critical colors;
  defaults = today's look; Kpi skeleton radius on the token. Route: delegated writer.
- [x] **TH2** — Theme model, built-in presets ("Clásico" = current, "Contorno" = user's),
  persistence and boot re-apply (mirrors `applyThemeOverrides`). Route: same writer as TH1.
- [x] **TH3** — Button theme engine on all three groups (Q2): `AdminActionButton`,
  `AdminIconToolbarButton`, `.admin-accent-ghost`, `HmiButton`, `WidgetHeaderTemporalControls`;
  defaults = today's look; primary/accent semantics preserved.
- [x] **TH4** — "Tema" tab UI in `GlobalSettingsDialog`: preset selector only (Q1), with a preview
  of each preset if an existing primitive fits; dirty/save/revert like the other tabs.
- [x] **TH4b** — Review follow-ups on the Tema tab: dirty must clear when the selection returns
  to the saved theme; an unsaved preview must not leak when the tab unmounts; the mini-preview
  span must not reintroduce the transition collision.
- [ ] **TH6** — Integration with the group widget (now on main): the builder selection frames
  (`GridSelectionFrame`, `HeaderSelectionFrame`) hardcode a 1.5rem radius, so with "Contorno"
  (radius 0) the selection ring stays rounded around square widgets; they must follow the live
  theme frame radius (rest/hover). Route: delegated writer.
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
- 2026-09-28: Q1 answered (selector only). Style lab source saved to `tools/style-lab/` with a
  README (user asked to keep it and keep improving it).

- 2026-09-28: TH1+TH2 done (route: delegated writer) — `877a0c3` feat(theme): drive widget
  frames from rest and hover theme tokens (registered `--frame-radius/-fill/-border/-blur/
  -accent-length/-thickness/-color/-opacity` on `.glass-panel` and `.widget-state-*`, rest/hover
  pairs `--frame-*-rest/-hover`, base token `--frame-base-background`, accent `::after` drawn with
  8 L-segment gradients on the 4 corners, `overflow: clip` + `overflow-clip-margin: 2px` instead
  of `overflow: hidden`, semantic danger/warning untouched, defaults in `:root` = today's look,
  Kpi skeleton on the radius token, reduced-motion respected); `04f6e6f` feat(theme): add theme
  presets with persistence and boot apply (`domain/themeStyle.types.ts`, presets `classic` /
  `outline`, `services/themeStyle.service.ts` maps to `--frame-*`/`--button-*`, localStorage
  `hmi-theme-style`, `applyThemeStyleOverrides()` at boot in `main.tsx`).
  RED/GREEN: service + CSS-contract tests failing first, then 23/23. Writer: `npx tsc -b` clean,
  `npm run lint` clean, `npm test` 2637/2637, `npx vite build` OK (CSS contains the tokens).
  Parent spot check: 23/23. Note: Clásico button values are placeholders (radius 6, fill 0,
  border 0) — TH3 must derive them from today's real button styles.

- 2026-09-28: slice review TH1–TH2 (base `3790cbd`..`cf1c892`, 1949 lines incl. the lab, medium,
  user granted): lineage `review-028de1d211ce1728` APPROVED, acknowledged, authority burned;
  boundary advances to `cf1c892`. Advisory: R3-hover-no-longer-overrides-variants (WARNING,
  `index.css:721-728` — check danger/warning hover still intensifies as before),
  R3-overflow-clip-margin-bleed (WARNING, `index.css:703-707` — content may paint 2 px outside
  the frame), R3-overflow-clip-no-fallback (WARNING, `index.css:706` — add `overflow: hidden`
  fallback before `overflow: clip`), R3-spy-restore-not-guaranteed (SUGGESTION,
  `themeStyle.service.test.ts:144-162`). Folded into TH3 as TH3a.

- 2026-09-28: TH3a + TH3 done (route: delegated writer) — `98c3f7d` fix(theme): keep semantic
  frame hovers and clip content inside the frame (removed `overflow-clip-margin`, `overflow:
  hidden` fallback before `clip`, semantic hover locked by a CSS-contract test, spy restore in
  try/finally); `b56ff0a` feat(theme): drive buttons and segmented controls from theme tokens
  (`--button-*` registered tokens + `--button-base-strength`: Clásico 100 % keeps each variant's
  own color exactly, Contorno 0 % fades it so the shared outline recipe shows; shared
  `.theme-button` class + color-only variant classes; applied in `AdminActionButton`,
  `AdminIconToolbarButton`, `HmiButton`, `WidgetHeaderTemporalControls` pill segments incl.
  `aria-pressed`; primary/critical mix toward their own hue); `f07d611` docs comment follow-up.
  Only pixel deviation in Clásico: `AdminIconToolbarButton` gains a 1px transparent border.
  RED/GREEN per file. Writer: `npx tsc -b` clean, `npm run lint` clean, `npm test` 2655/2655,
  `npx vite build` OK. Parent spot check: service + CSS contract 36/36.

- 2026-09-28: slice review TH3 (base `cf1c892`..`c1807af`, 705 lines, medium, user granted):
  lineage `review-4d8dc52f070c5575` APPROVED, acknowledged, authority burned; boundary advances to
  `c1807af`. Advisory: R3-button-transition-cascade-collision (WARNING, `index.css:801-804` — a
  later `transition` declaration on a button class/utility can override the theme token
  transitions); folded into TH4.

- 2026-09-28: TH4a + TH4 done (route: delegated writer) — `e9e8b7c` fix(theme): keep color and
  token transitions together on buttons (single merged `transition` on `.theme-button`, variant
  transitions and conflicting `transition-colors` utilities removed); `6351be2` feat(theme): add
  the Tema tab to pick a visual theme (`ThemeSettingsTab`, SwatchBook icon next to Diseño,
  radiogroup of Clásico/Contorno cards with scoped mini-preview, live app preview via
  `previewThemeStyleOnDocument`, Guardar -> `setActiveThemeStyle`, revert to the last saved id,
  dirty/status wiring, tab-order test = 6); `7af70bd` comment fix.
  RED/GREEN per test. Writer: `npx tsc -b` clean, `npm run lint` clean, `npx vite build` OK,
  `npm test` 2666/2667 — the failure is `Topbar.test.tsx` (admin navigation timing), outside the
  change and passing in isolation. Parent spot check: ThemeSettingsTab + CSS contract + Topbar
  isolated 44/44.

- 2026-09-28: TH5 docs — section "Temas visuales" in `docs/DESIGN_SYSTEM.md` (model, service,
  frame and button tokens, accent semantics, rules, style lab). Live check still pending.

- 2026-09-28: slice review TH4+docs (base `c1807af`..`724ab41`, 650 lines, medium, user granted):
  lineage `review-b0462f8f29f39663` APPROVED, acknowledged, authority burned; boundary advances to
  `724ab41`. Advisory: R3-theme-dirty-not-cleared-on-return-to-saved (WARNING,
  `ThemeSettingsTab.tsx:69-78`), R3-theme-preview-leaks-on-unmount (WARNING, `:73`),
  R3-preview-span-reintroduces-transition-collision (SUGGESTION, `:162`) -> TH4b.

- 2026-09-28: TH4b done (route: delegated writer) — `f96e13c` fix(theme): dirty = selection differs
  from the saved id; unmount restores the saved theme only when a preview was left dirty (no
  double apply after save/revert); preview span guarded against transition utilities (no live
  bug found, regression test added). RED: 2 genuine failures; GREEN 14/14. Writer: `npx tsc -b`
  clean, `npm run lint` clean, `npm test` 2672/2672. Parent spot check: ThemeSettingsTab 14/14.

  Review assess (base 724ab41): medium, 131 lines, `under_budget` — pending in the slice.

- 2026-09-28: group widget merged to main (`1859cd1`); `feat/theme-tab` rebased onto it. One
  conflict in `index.css` (the group hover selector `[data-group-hover-target="true"]
  .glass-panel` vs the theme's token-swap hover): resolved keeping the theme hover body plus the
  group selector; CSS contract test regex updated (`06e92da`). Rebased branch: `npx tsc -b`
  clean, `npm run lint` clean, `npm test` 2856 (2 contract failures fixed by `06e92da`).
  Found TH6 while checking the combination.

## Next step

TH6 (writer), then merge to main (user wants to test the theme on main with the group widget);
previous: Live check (TH5) from the main checkout after the group widget merge: rebase `feat/theme-tab`
onto the new `main`, then the single merge to `main`.
 live check after the group widget merge (the dashboards
live in the 5173 origin's localStorage, so the theme is tested from the main checkout once
`feat/theme-tab` is rebased onto the new `main`).
