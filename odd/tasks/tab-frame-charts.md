# Tab frame for chart widgets — ODD feature document

> ODD feature task (not SDD). Branch `feat/tab-frame-charts` from local `main` `9f01d25` (main checkout; the
> user's dev server serves it). Engram mirror `odd/tab-frame-charts/tasks`. Follows `odd/tasks/tab-frame-shape.md`
> (F1–F10, merged to local `main` by fast-forward on 2026-09-30 with the user's OK; push still the user's decision).

## Objective

Bring the "Pestaña" frame shape to the chart widgets that have a scale/period selector in their header
(`WidgetHeaderTemporalControls`): `trend-chart`, `trend-chart-v2`, `prod-trend`, `prod-history`, `activity-analytics`.
Today they keep the STANDARD frame even when Pestaña is selected (user decision of 2026-09-29).

## Problem and why

With the tab shape the title moves into the tab and the icon into the top strip; these widgets also carry the
scale selector in the header row, and it is not decided where it goes. The user wants to SEE and ADJUST alternatives
in the style lab before the app is touched (user, 2026-09-30).

## Alternatives to build in the style lab (proposed by the parent, accepted as the set to compare)

- **A — selector in the body**: stays in the body's first row, right-aligned (minimal change; the row is almost
  empty and takes height from the chart).
- **B — selector in the tab strip**: moves up to the top strip, right side, between the tab and the icon; the chart
  gains that row. Risk: narrow widgets truncate the title sooner. Parent recommendation.
- **C — second tab on the right**: selector + icon in a mirrored tab flush with the right edge, slanted side to the
  left. Most distinctive, most loaded.

Lab controls: A/B/C switch on a sample chart widget, plus spacing, selector height and widget width (narrow case).

## Constraints

- Lab first: no app code (`hmi-app/`) changes until the user picks an alternative in the lab.
- The lab is `tools/style-lab/style-lab.html` (+ `README.md`), published at
  https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8 (republish to the SAME url).
- Same tokens and rules as the accepted tab shape: tab height 25 px, cut 19 px (constant slope), fill white 15 %,
  text white 70 % -> 100 % on hover, icon pinned top-right at 90 %, body cut 0, radius from the preset.
- When the app is implemented: strict TDD (source: global user config), runner Vitest (`npx vitest run <file>` in
  `hmi-app/`); Estándar must stay exactly as today; tokens only.

## Tasks

- [ ] **C1** — Style lab: sample chart widget (title, icon, scale selector, chart area) with the A/B/C switch and the
  adjustments; "Copiar elección" includes the chosen alternative and its values; README updated; republish.
- [ ] **C2** — User compares in the lab and picks one (with values).
- [ ] **C3** — Implement the chosen alternative in the app for the five chart widgets (scope and tasks refined after C2).
- [ ] **C4** — Live look, native review (RDD per work-unit commit), merge on the user's OK.

## Acceptance criteria

- C1: the lab shows the three alternatives on the same sample widget, switchable, at a narrow and a wide width, in
  rest and hover, and the copied summary names the alternative.
- C3 (to refine): with Pestaña, the five chart widgets take the tab shape with the chosen selector placement; with
  Estándar nothing changes; `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Delivery

Forecast: C1 ~300–500 authored lines in one HTML file (tooling, not app). C3 forecast after C2. Strategy
`ask-on-risk`. RDD on: work-unit commits assessed `--committed-only` from the last reviewed boundary (first boundary
`9f01d25`; the last reviewed boundary of the previous feature is `b35a532`, the commits after it are docs).

## Progress

- 2026-09-30: user accepted the tab shape live ("quedó perfecto"), asked for the chart widgets and agreed to compare
  alternatives in the lab; `feat/tab-frame-shape` fast-forwarded into local `main` (`9f01d25`) on the user's OK
  ("sí, hacé el merge"); push not done (the user's answer named only the merge). Read-only look at the header:
  `components/ui/WidgetHeader.tsx` (`trailing` slot) and `components/ui/WidgetHeaderTemporalControls.tsx` (pill /
  underline variants). Route for C1: delegated writer (preparation trigger: the lab file is ~92 KB and must be read
  before writing).

## Next step

C1 in progress (delegated writer), then republish the lab and hand it to the user (C2).
