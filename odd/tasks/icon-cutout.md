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

- [x] **I1** — Setting: service/store/persistence (default off), Tema switch with the note about when it applies,
  dirty/save/revert. Commit `10ee286` (+417/-6).
- [x] **I2** — Frame mechanism: opt-in cutout layer on eligible grid widget frames (background moved to a masked
  layer), icon center measured per widget, tokens (margin 6 px, feather 0, ring on), ring with border/alert color,
  rest and hover; builder and viewer. Commit `8b8682a` (+766/-1).
- [x] **I3a** — `docs/DESIGN_SYSTEM.md` section "Calado del ícono". Commit `b3e957e` (+19).
- [ ] **I3b** — Live check in the control Chrome (parent).

## Acceptance criteria

- Clásico + Estándar + option on: every grid widget with a header icon shows a transparent circle behind the icon
  (hard edge, 6 px margin, ring), content unchanged; off, other presets or Pestaña: identical to today.
- `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Progress

- 2026-09-30: document created from the user's lab choice; route: delegated writer (writer trigger: 2+ non-trivial files).

- 2026-09-30 (writer): I1, I2 and I3a done, route delegated (writer trigger). Strict TDD (global config), runner Vitest.
  - RED/GREEN I1: `iconCutout.service.test.ts` RED (module missing, 0 tests) -> GREEN 14/14; `ThemeSettingsTab.test.tsx`
    RED 10 failed / 59 passed -> GREEN 69/69.
  - RED/GREEN I2: `iconCutout.test.ts`, `useIconCutoutActive.test.tsx`, `WidgetFrame.iconCutout.test.tsx` RED (modules
    missing) -> GREEN 24/24; `iconCutout.css.test.ts` RED 10 failed -> GREEN (with `index.css.test.ts` and
    `tabFrame.css.test.ts`: 69/69).
  - Verification in `hmi-app/`: `npx tsc -b`: clean; `npm run lint`: clean; `npm test`: 264 files / 3512 tests passed;
    `npm run build`: built (only the existing chunk-size warning).
  - Headless check (isolated Chrome profile, static harness with the app CSS): the masked circle, the hard edge, the
    ring and the alert variants render as in the lab (screenshot in the writer scratchpad, not committed).

## Mechanism (as built)

- Setting: `hmi-icon-cutout` = `true` (only the override is stored; off removes the key). `store/iconCutout.store.ts`
  (live value), `services/iconCutout.service.ts` (read/write/preview/boot re-apply in `main.tsx`). The Tema tab keeps
  it in its dirty / Guardar / Descartar / unmount-restore flow and shows "Ahora no se aplica: requiere el tema Clásico y
  la forma de marco Estándar." while the current selection (local preset + shape) does not admit it; the switch stays.
- Active preset: new `store/themeStylePreset.store.ts` (`classic` flag), written by `previewThemeStyleOnDocument` only
  when the target is the document root (preset cards are scoped elements and never write it).
- Eligibility: `useIconCutoutActive(widgetType)` = setting + Clásico + Estándar + grid scope + `supportsIconCutout`
  (tab-frame list without `group`, whose frame already uses `::before`). Header-slot widgets and widgets outside the
  list never qualify. `WidgetFrame` calls it in the standard branch only.
- Geometry: `useIconCutoutGeometry` finds the icon (`data-header-icon`, added in `WidgetHeader`), measures its center
  against the frame border box (scale-aware for the builder zoom) and sets `data-icon-cutout`, `--icon-cutout-x/-y/-half`
  on the frame element directly (no React state). ResizeObserver on frame + icon and a MutationObserver
  (childList/subtree/characterData) re-measure before paint; unchanged values publish nothing. No icon or no box: the
  frame is not opted in.
- CSS (`index.css`, inside `@layer utilities`, opt-in by `[data-icon-cutout]`): the frame's fill, blur and border move
  to a masked `::before`; `::after` (corner accent) gets the same mask; the ring is the top background layer of the
  `::before` (no extra DOM); alert states move their 12 % gradient and 2 px border to the `::before`. Base
  `.glass-panel` untouched.
- Tokens (`:root`): `--icon-cutout-margin: 6px`, `--icon-cutout-feather: 0px`, `--icon-cutout-ring: 1`,
  `--icon-cutout-ring-width: 1px` (2 px in alert, set by the state rule).

## Decisions and deviations

- The ring lives inside the circle radius (band `[R - w, R]`, like the lab) and is a background layer of the `::before`
  instead of the lab's separate `.cut-ring` element, to avoid adding DOM children to every frame.
- `overflow-clip-margin` (1 px, 2 px alert) on the opt-in frame only, because `.glass-panel` uses `overflow: clip`, which
  would otherwise cut the `::before` border that sits over the border area. Safari does not support it (border of the
  `::before` clipped there; fill and circle unaffected).
- The alert glow (`box-shadow`) stays on the frame: it is outside the box, so it never enters the circle.
- Alert ring color changes on hover without a transition (the alert border does transition); minor.
- `group` is excluded (its own `::before` base) and stays as today.

## Needs the browser (parent live check)

- Viewer and builder with Clásico + Estándar + option on: circle behind the icon on kpi, metric-card, info-card,
  machine-activity and the five chart types; icon position right / left / centered; resize of a widget; hover
  transition; warning/critical metric-card (ring and border in the state color); builder zoom.
- Option off, other presets, Pestaña: identical to before.

## Next step

I3b: live check (parent), then the feature is ready for review.
