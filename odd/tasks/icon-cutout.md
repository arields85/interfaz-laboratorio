# Icon cutout ("Calado del ícono") — ODD feature document

> ODD feature task (not SDD). Branch `feat/tab-frame-charts` (kept on purpose: no branch switch while the dev server
> runs). Engram mirror `odd/icon-cutout/tasks`. Lab reference: `tools/style-lab/style-lab.html` ("Calado del ícono",
> L1 in `odd/tasks/tab-frame-charts.md`), artifact https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8.

## Objective

Port the lab's icon cutout to the app: the widget's background is transparent inside a circle centered on the header
icon, so the icon does not sit on the glass fill; with a thin ring on the circle's edge. Enabled by an option in
Configuración general → Tema.

## User decisions (2026-09-30)

- Lab values chosen (screenshot): **Calado del ícono on, Margen 6 px, Suavizado 0 px (hard edge), Anillo en el borde on**.
- "Colocá una opción para habilitarlo en el tab Temas".
- Scope from the lab: applies with the **Clásico** preset and the **Estándar** frame shape (in Pestaña the icon is
  already outside the body, nothing to cut).

## Parent assumptions (stated to the user, adjustable)

- The Tema option is a switch "Calado del ícono" (default OFF: a fresh install and current users see today's frames),
  persisted like the other visual settings and part of the Tema dirty / Guardar / revert flow; it takes effect only
  while Clásico + Estándar are active, and the section says so when it is not in effect.
- Margin 6 px, hard edge and ring become tokens with those defaults (not user controls in the app for now).

## Constraints

- Do NOT change the base `.glass-panel` rule used by dialogs/pages: the cutout is opt-in on grid widget frames only
  (same eligibility spirit as the tab frame: widgets with a header icon inside a dashboard grid).
- Implement with a CSS mask on the BACKGROUND layer only (fill, blur/backdrop, border, corner accents, glow), never
  on the content: the icon, title and data stay untouched. Circle radius = half the icon size + margin; center = the
  icon's measured center (the icon moves with the header; measure it, don't assume it).
- The ring uses the frame border color (alert color on warning/critical cards).
- Estándar with any other preset and Pestaña in any preset: exactly as today.
- Tokens only; UI copy Spanish "usted"; strict TDD (global user config), Vitest.

## Tasks

- [ ] **I1** — Setting: service/store/persistence (default off), Tema switch with the note about when it applies,
  dirty/save/revert.
- [ ] **I2** — Frame mechanism: opt-in cutout layer on eligible grid widget frames (background moved to a masked
  layer), icon center measured per widget, tokens (margin 6 px, feather 0, ring on), ring with border/alert color,
  rest and hover; builder and viewer.
- [ ] **I3** — Docs + live check (control Chrome).

## Acceptance criteria

- Clásico + Estándar + option on: every grid widget with a header icon shows a transparent circle behind the icon
  (hard edge, 6 px margin, ring), content unchanged; off, other presets or Pestaña: identical to today.
- `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Progress

- 2026-09-30: document created from the user's lab choice; route: delegated writer (writer trigger: 2+ non-trivial files).

## Next step

I1–I3 (delegated writer), then live check.
