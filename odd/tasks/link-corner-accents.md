# Link corner accents — ODD feature document

> ODD feature task (not SDD). Branch `feat/tab-frame-charts` (kept on purpose: no branch switch while the dev server
> runs). Engram mirror `odd/link-corner-accents/tasks`.

## Objective

Make the Contorno theme's hover corner-accent effect available in the Clásico theme as an OPTION (switch in
Configuración general → Tema), shown only on widgets that have a navigation link, and drawn a few pixels OUTSIDE the
widget's border instead of on it.

## User request (2026-09-30)

"¿Recordás el efecto/animación de las esquinas de los widgets en hover en el tema Contorno? Quisiera que también esté
disponible en el tema Clásico pero opcional, con un toggle en el tab de Temas. Pero con una modificación: que ese
efecto de las esquinas solo se aplique a los widgets que tienen enlace asignado. Y además que no actúen sobre el
borde/contorno del widget sino unos píxeles más afuera."

## Current effect (verified in code)

Contorno widget frame accent (`themeStyle.service.ts`): rest length 18 px, thickness 1 px, white, opacity 0 %; hover
length 8 px, thickness 1 px, white, opacity 40 %; drawn by `.glass-panel::after` on the frame edge, animated with the
registered accent custom properties.

## Parent assumptions (stated to the user, adjustable)

- Same values and animation as Contorno (18 px -> 8 px, 1 px, white 0 % -> 40 %), timing identical.
- Offset outside the border: token, default 4 px.
- Switch "Esquinas en widgets con enlace" (wording to refine), default OFF, persisted, part of the Tema dirty / Guardar /
  revert flow; takes effect with the Clásico preset (say so in the section when another preset is active).
- Viewer only (links navigate only there), not the builder.
- "Has a link" = the EFFECTIVE navigation target (`resolveEffectiveNavigationTarget`: own target, or the locked group's
  inherited one), i.e. exactly the widgets that navigate on click.
- Both frame shapes: accents around the widget's outer box.

## Constraints

- The frame clips its overflow (`.glass-panel` `overflow: clip`), so the accents cannot live inside the widget: a
  sibling layer at the viewer item surface (like `ViewerEntranceFrameOverlays`), positioned at the surface inset minus
  the offset, reacting to hover on the item.
- Do not change the Contorno/Instrumento presets' own accents, nor `.glass-panel::after` for other widgets.
- Respect `prefers-reduced-motion` like the other accent/entrance animations.
- Tokens only; UI copy Spanish "usted"; strict TDD (global user config), Vitest.

## Tasks

- [ ] **A1** — Setting (service/store/persistence, default off) + Tema switch with the "applies with Clásico" note +
  dirty/save/revert.
- [ ] **A2** — Viewer layer: accents outside the frame for widgets with an effective link, hover animation with the
  Contorno values, offset token, reduced motion; not in the builder.
- [ ] **A3** — Docs + live check (control Chrome).

## Acceptance criteria

- Clásico + option on: hovering a widget with a link (own or inherited) shows the four corner brackets 4 px outside
  its border, animating like Contorno; widgets without a link: nothing. Option off, other presets, builder: as today.
- `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Progress

- 2026-09-30: document created; route: delegated writer (writer trigger: 2+ non-trivial files).

## Next step

A1–A3 (delegated writer), then live check.
