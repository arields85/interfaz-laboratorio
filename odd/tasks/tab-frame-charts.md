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

- [x] **C1** — Style lab: sample chart widget (title, icon, scale selector, chart area) with the A/B/C switch and the
  adjustments; "Copiar elección" includes the chosen alternative and its values; README updated; republish. Done
  2026-09-30, commit `07cc7a3` (`feat(style-lab): ...`, +477/-17 in `tools/style-lab/style-lab.html` and
  `README.md`); republished to the same artifact URL (version 14). Route: delegated writer (preparation trigger).
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

- 2026-09-30 C1 done (`07cc7a3`). Controls added (section "Gráfico con selector", remembered in the viewer's storage
  with the rest of the lab): alternative A/B/C, "Mostrar las tres juntas" (compare view, default on), selector style
  (píldora / subrayado), gap between strip elements (0-24 px, default 8), selector scale (70-110 %), sample width
  (220-720 px, shortcuts Angosto 280 / Ancho 560), title text, and "Restablecer la pestaña a los valores aceptados".
  Sample: title + dot, TrendingUp icon (24 px at 90 %, pinned top-right, right 0, top 0), selector with the real
  options 1h 24h 7d 30d 12m (uppercase, like `WidgetHeaderTemporalControls`), Y scale 0-100, dashed grid, line and
  area drawn in inline SVG from the measured plot box. It reuses the lab's layers, `shapePath` and tokens; alternative
  C adds `twoTabPath` (mirrored right tab, same slope and radius). B and C ignore the body cut (0); A honors it. With
  the Estándar shape the sample shows today's header (title, selector, icon in one row).
  Lab changes beyond the sample: `TF_DEFAULT` now holds the accepted app tokens (tab cut 19, body cut 0; was 15 / 37)
  and the tab cut scales with the tab height (constant slope, like `scaleTabFrameCut`) for ALL lab widgets; a viewer's
  stored tuning still wins (the reset button loads the accepted values).
  "Copiar elección" appends ` · Gráfico con selector | alternativa elegida: <rule of A, B or C in prose> | separación
  entre elementos de la franja: N px | selector: estilo píldora o subrayado, escala N % (alto ≈ H px, opciones ...) |
  ancho de la muestra: N px | título de la muestra: "..." | pestaña usada: alto, corte (definido a alto 25, pendiente
  constante), corte de cuerpo, ícono 24 px al 90 % pegado arriba a la derecha`, plus a note when Estándar is active.
  Verification: page script extracted and `node --check` OK; loaded in headless Chrome (real render, no script errors)
  with a scripted pass over A/B/C at 460 / 280 / 560 px, pill and underline, gap 8 / 16, Estándar shape, single view and
  the Contorno preset, checking selector, icon and tab rectangles, title truncation and path output; visual check by
  screenshots (rest, hover text, narrow, underline). Not verified: light theme (the lab is single dark by design), hover
  by a real pointer, alert states on the sample (none), phone width.
  Republish: succeeded, https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8 (version 14).

- 2026-09-30 Native review of C1 (slice `9f01d25..80366a5`, 5 files / 599 lines, tier medium, lens review-reliability,
  consent granted by the user on 2026-09-30): APPROVED and acknowledged, lineage `review-877de77ca63001ea`. Three
  advisory findings:
  - `R3-narrow-width-two-tab-degenerate`: fixed in `b066440`. The width slider minimum is now 280 (matches "Angosto")
    and the sample width never drops below what the strip needs for the selector, the icon and the gaps (computed from
    the measured selector width; worst case alternative C: cut + end padding + selector + icon + 2 gaps, 286 px at gap 24
    and scale 110; the readout shows "(mínimo)"). A title tab with less than 12 px of room is hidden (label
    `visibility: hidden`, silhouette without the title tab, body top-left corner stays convex) instead of being drawn
    under the selector or the second tab.
  - `R3-stored-cw-unvalidated`: fixed in `b066440`. `sanitizeCw` whitelists `alt` and `selStyle`, requires a boolean
    `compare`, clamps `gap` / `selScale` / `width` to the control ranges (numbers only) and falls back per field to
    `CW_DEFAULT` (a non-string title too).
  - `R3-stored-tuning-masks-accepted-defaults`: not changed on purpose. Stored tab tuning is the viewer's own; the
    reset button ("Restablecer la pestaña a los valores aceptados") stays the way to get the accepted values.
- 2026-09-30 Fix `b066440` (`fix(style-lab): keep the chart sample valid at narrow widths and validate its stored
  state`, +55/-12, `tools/style-lab/style-lab.html` only). Verification: extracted script `node --check` OK; headless
  Chrome with a scripted pass at slider 280, gap 24, scale 110 for A, B and C (width raised to 286, selector inside the
  card in all three, title tab hidden in B and C and visible in A, correct rounded silhouette) and at 280 with defaults
  (A and B show the title, C hides it); screenshot check of the minimum case; stored-state cases (invalid enums, string
  numbers, out-of-range numbers, non-string title, `cw: null`, a stored width of 220) all load clamped or defaulted with
  no script errors. Not verified: phone width (the card is capped at 100 % of the stage, so below the floor the title
  tab still degrades but the selector can overflow the card). Republished to the same URL, version 15.

## Next step

C2: the user compares A/B/C in the lab (narrow and wide, rest and hover) and picks one with values; then C3 is refined.
