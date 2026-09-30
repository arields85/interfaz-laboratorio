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

- [ ] **R1** — Radius override: domain/service/store (per preset, overrides only), applied to the frame radius tokens
  (rest and hover), live preview in the Tema tab, dirty/save/revert integration.
- [ ] **R2** — Tema UI: "Radio del marco" slider (px) with the current value, and a "Restablecer" button (disabled when
  there is no override); fix the stale "Forma del marco" copy.
- [ ] **R3** — Docs (`docs/DESIGN_SYSTEM.md` theme section) + live check.

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

## Next step

R1–R3 (delegated writer), then live check with the control Chrome.
