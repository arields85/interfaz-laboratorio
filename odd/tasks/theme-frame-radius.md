# Theme frame radius control — ODD feature document

> ODD feature task (not SDD). Branch `feat/tab-frame-charts` (kept on the same branch on purpose: switching branches
> in the checkout the dev server serves leaves a stale stylesheet, see `odd/tasks/tab-frame-charts.md`). Engram
> mirror `odd/theme-frame-radius/tasks`.

## Objective

In Configuración general → Tema, add a control for the corner radius of the widget frames, on top of the selected
theme preset, plus a button that restores the preset's own radius. Also fix the stale copy of the "Forma del marco"
section.

## User decisions (2026-09-30)

- "Agregá un regulador de radio y además un botón que permita restablecer al por defecto" (screenshot of the Tema tab).
- Asked "¿el regulador de radio es para las esquinas del marco de los widgets, por encima del tema elegido, y
  Restablecer vuelve al radio propio de ese tema?" — user: "sí".

## Stale copy observed (Tema tab screenshot)

- Forma del marco description: "los gráficos con selector de período conservan el marco estándar" — false since
  C3 (the five chart widgets take the tab shape, selector in the strip).
- Pestaña card: "la esquina superior derecha se recorta, con el ícono en el corte" — false since F6 (body cut 0, the
  icon sits in the strip at the top right).

## Constraints

- Only the widget FRAME radius (`--frame-radius-rest` and the hover radius of the preset); buttons, tags and the
  group container follow their own tokens unless they already derive from the frame radius.
- The override is per preset (each preset remembers its own adjusted radius or none); "Restablecer" clears the
  override so the preset's own radius applies again. Persisted like the other visual settings (overrides only) and
  integrated in the Tema tab's dirty / Guardar / revert-on-close flow.
- Everything that derives from the frame radius must follow (tab silhouette, builder rings/ghosts, entrance overlays,
  WidgetFrame shell) — they already read the token; verify.
- Tokens only; UI copy in Spanish with "usted"; strict TDD (global user config), Vitest (`npx vitest run <file>` in
  `hmi-app/`). Property/Tema panel conventions: `components/admin/ADMIN_CONVENTIONS.md`.

## Tasks

- [x] **R1** — Radius override: domain/service/store (per preset, overrides only), applied to the frame radius tokens
  (rest and hover), live preview in the Tema tab, dirty/save/revert integration.
- [x] **R2** — Tema UI: "Radio del marco" slider (px) with the current value, and a "Restablecer" button (disabled when
  there is no override); fix the stale "Forma del marco" copy.
- [x] **R3** — Docs (`docs/DESIGN_SYSTEM.md` theme section) done; the live check with the browser is still pending (see Next step).

## Acceptance criteria

- Moving the slider changes every widget frame's corners live (both frame shapes); Guardar persists it; closing
  without saving reverts it; "Restablecer" returns to the preset's radius; switching presets shows each preset's own
  value. Presets untouched when no override exists (existing tests green).
- `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Delivery

Forecast ~300–500 authored lines with tests. Work-unit commits; RDD with the user's standing consent; merge and push
are the user's decisions.

## Progress

- 2026-09-30: document created; route: delegated writer (writer trigger: 2+ non-trivial files).

- 2026-09-30: R1-R3 implemented by the delegated writer (TDD, Vitest).
  - `439a65d` feat(theme): service override (+222/-9). RED: 11 failed / 41 passed; GREEN: 52/52.
  - `395d82a` feat(theme): Tema slider + Restablecer + copy fix (+393/-14). RED: 15 failed / 43 passed; GREEN: 58/58.
  - `4df28fb` docs(theme): DESIGN_SYSTEM.md (+1/-0, one long bullet).
  - Mechanism: `themeStyle.service.ts` keeps the override as `{ [presetId]: px }` in `localStorage`
    (`hmi-theme-frame-radius`), only radii that differ from the preset's own (absent = preset radius); invalid
    values (corrupt JSON, unknown preset, non-number) are dropped, out-of-range clamped to 0-24, off-step snapped.
    `previewThemeStyleOnDocument(id, target, radiusPx?)` applies the preset and then writes `--frame-radius-rest`
    and `--frame-radius-hover` with the same value (also for Clasico, which otherwise only resets); `setActiveThemeStyle`
    takes the same optional radius; `applyThemeStyleOverrides()` (boot) reapplies the stored override of the stored
    preset, including Clasico. The Tema tab holds all overrides in state (snapshot ref for dirty/revert/unmount), so
    each preset keeps its own value while switching; the slider shows `override ?? preset radius`; a value equal to
    the preset radius counts as no override; Restablecer deletes the selected preset's override (disabled without one).
    Guardar writes the overrides map; the preset cards' mini previews also show the adjusted radius.
  - Frame derivatives verified to read the token (no code change): `WidgetFrame` tab shell (`border-radius` and the
    silhouette from the computed radius), `GridSelectionFrame`/`HeaderSelectionFrame`/`BuilderCanvas`
    rings/ghosts, `ViewerEntranceFrameOverlays`, entrance CSS (`rx/ry`). Added characterization test
    `WidgetFrame.radius.test.tsx` (passed immediately, no behavior change needed).
  - Copy fixed: Forma del marco description (charts take the tab shape, selector in the strip or, if it does not fit, in
    a row inside the body) and the Pestaña card (icon at the top right of the tab strip, no cut).
  - Decisions: slider range 0-24 px step 1; rest and hover share the override value; the override affects only the
    frame radius tokens (buttons, tags, group container untouched).
  - Verification (hmi-app): `npx tsc -b` clean; `npm run lint` clean; `npm test` 259 files / 3451 tests passed;
    `npm run build` ok (chunk-size warning only).

- 2026-09-30 parent: live check in the control Chrome (user's view in Estándar): previewing 16 px on the page root
  moved every standard frame from 24 px to 16 px (screenshot), restored after; the Tema dialog itself was not driven
  (to avoid changing the user's saved settings); the tab silhouette with a changed radius is covered by
  `WidgetFrame.radius.test.tsx`. Review `96b218c..ac2f1a2` (lab L1 + R1-R3 + C4c; 14 files / 986 lines, medium,
  standing consent): APPROVED and acknowledged (`review-3f0dc8d8ec471f8b`). Findings: WARNING
  R3-read-keeps-preset-equal-override — fixed in `a28e619` (the read path drops a stored value that lands on the preset
  radius after clamping/snapping; RED 1 -> GREEN); SUGGESTION R3-radius-test-ambiguous-selector — fixed in the same
  commit (the test reads the surface layer by test id). `npm test` 259 files / 3452 passed, tsc/lint/build clean.

## Next step

Live check in the browser (control Chrome): move the slider per preset in both frame shapes (tab silhouette, builder
rings, entrance overlays), Guardar, close without saving, Restablecer; then user review.
