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

- [x] **A1** — Setting (service/store/persistence, default off) + Tema switch with the "applies with Clásico" note +
  dirty/save/revert.
- [x] **A2** — Viewer layer: accents outside the frame for widgets with an effective link, hover animation with the
  Contorno values, offset token, reduced motion; not in the builder.
- [x] **A3** — Docs (`docs/DESIGN_SYSTEM.md`, done).
- [ ] **A4** — Live check in the browser (control Chrome) — left for the parent.

## Acceptance criteria

- Clásico + option on: hovering a widget with a link (own or inherited) shows the four corner brackets 4 px outside
  its border, animating like Contorno; widgets without a link: nothing. Option off, other presets, builder: as today.
- `npx tsc -b`, `npm run lint`, `npm test`, `npm run build` green.

## Progress

- 2026-09-30: document created; route: delegated writer (writer trigger: 2+ non-trivial files).

- 2026-09-30 (writer): A1-A3 done.
  - `f781684` feat(theme): setting + Tema switch (441 +, 7 -). RED: service suite failed to load (module missing); Tema suite 10 failed / 16 passed (others green). GREEN: Tema tabs 80 passed.
  - `a324e18` feat(theme): viewer layer + CSS (357 +, 1 -). RED: DashboardViewer.linkAccents 7 failed / 5 passed; CSS contract 6 failed. GREEN: 12 and 6 passed.
  - `98273d2` docs(theme): DESIGN_SYSTEM section (18 +).
  - Mechanism: `ViewerLinkCornerAccents` is a sibling layer in the item surface (aria-hidden, pointer-events none), `inset: calc(<surface inset> - var(--link-accent-offset))`; the viewer item gets `hmi-link-accents-host` and `.hmi-link-accents-host:hover .hmi-link-accents` switches the registered `--frame-accent-*` properties from the `--link-accent-*-rest` to the `-hover` tokens (same 0.2s ease transition and 8-gradient drawing as `.glass-panel::after`); radius = `--frame-radius-rest` + offset; reduced motion disables the transition.
  - Tokens (`:root` in index.css): `--link-accent-offset` 4px, `-length-rest/-hover` 18px/8px, `-thickness-*` 1px, `-color-*` #ffffff, `-opacity-rest/-hover` 0%/40%.
  - Setting: key `hmi-link-corner-accents`, store + service + `useLinkCornerAccentsActive` (setting + Clasico); Tema section after "Calado del ícono" with the "Ahora no se aplica: requiere el tema Clásico." note.
  - Decisions: hover host is the whole viewer item, so the accents also react over the gutter between widgets (needed so they do not flicker when the pointer is on them); builder is untouched (the layer is only rendered by `DashboardViewer`); works with both frame shapes (outer box).
  - Verification (hmi-app): `npx tsc -b`: clean; `npm run lint`: clean; `npm run build`: built; `npm test`: 3566 passed, 1 failed (known flaky Topbar "continues admin navigation immediately when runtime short is disabled", passes in isolation, 16/16).
  - Needs the browser: pixel check of the brackets 4 px outside the border (rounded corner clipping, both frame shapes, group container with link, inherited member link, reduced motion).
- 2026-09-30 (review): native review of 6fb69eb..868fa89 (28 files / 1181 lines) APPROVED, lineage review-5133e19ceb066437; suggestions R3-link-accents-tab-shape-unproved and R3-cutout-glass-panel-guard-removed covered by 26ac07b (test-only characterization tests, no RED expected).

## Next step

Live check of the corner accents in the browser (parent), then close the feature.
