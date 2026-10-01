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
- [x] **A4** — Live check in the browser (control Chrome): done 2026-09-30 after the fixes below.

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

- 2026-09-30 user live look: "en el widget grupo no funciona (o no se ve)". Diagnosed read-only in the control Chrome:
  the layers existed (15) but a locked group is mostly covered by its member items (sibling grid items), so the group
  item is rarely `:hover`; the viewer already marks it with `data-group-hover-target` (G5) while a member is hovered,
  and the accents ignored it. Parent decision (stated to the user): the group's accents also light with the group hover
  target, and a member that only INHERITS the locked group's target no longer gets its own accents (the clickable unit
  is the group); a member with its own target keeps them. Fix (parent inline, TDD): RED 2 (viewer: inherited member
  still had a layer; CSS: no group-hover-target rule) -> GREEN 21/21; `npx tsc -b`, `npm run lint` clean, `npm test`
  269 files / 3572 passed, `npm run build` ok; served stylesheet checked after the single `index.css` write. Commit
  `52fcd43`. Live pixel check of the hover still pending (the user is using the control Chrome).

- 2026-09-30 user: "sigue sin funcionar ... usá el Chrome control y miralo en vivo". Live diagnosis (control Chrome,
  virtual pointer via `Input.dispatchMouseEvent`, forced frames): the group-hover state was right (group hover target
  set, `--frame-accent-opacity` 40 %, length 8 px) but nothing painted, for two reasons:
  1. The layer had `border-radius: frame radius + offset` (16 px with the user's 12 px radius): a background is clipped
     to its own rounded border box, so the 8 px brackets sat inside the rounded-off corners and were never painted.
     Fix: square layer (`border-radius: 0`), brackets frame the outer box like a viewfinder.
  2. The grid fills the viewer root exactly and the root plus two page containers clip with `overflow: hidden`, so
     brackets 4 px outside the outer widgets were cut. Fix: while the accents are on, the viewer root keeps a gutter
     `padding: calc(var(--link-accent-offset) + var(--link-accent-thickness-hover))`; the grid fits the root content
     box (ResizeObserver `contentRect`), so the dashboard shrinks by ~10 px only with the option on. (An
     `overflow-clip-margin` attempt was dropped: the ancestors also clip.)
  TDD: RED 1 (square corners) and RED 1 (gutter) -> GREEN; `npx tsc -b`, `npm run lint` clean, `npm test` 269 files /
  3574 passed, `npm run build` ok. Commit `e101233`. Live after: all four brackets visible around the hovered group
  (screenshot `group-hover-full.png` in the scratchpad).

- 2026-09-30 user: "ahora sí se ve; las esquinas de la animación son rectas y deberían tomar la misma forma que las esquinas de los widgets". Fix (parent inline, TDD): the layer is again rounded (frame radius + offset) but draws a BORDER (follows the arc; a background would be clipped inside it) masked to the four corner squares of side radius + offset + accent length (arc + straight tail), length/opacity still the registered accent properties. RED 2 -> GREEN 23/23; full suite green; live screenshots show curved brackets around the hovered group. Commit after this line.

- 2026-09-30 user: "la animación tiene 2 largos, colocá controles en el tab Temas para poder ajustar esos largos". Writer: two sliders in the "Esquinas en widgets con enlace" section ("Largo en reposo" 18 px / "Largo con el cursor" 8 px, 0-40, step 1, always visible, disabled while the switch is off, with a hint that the length is the straight part continuing the corner arc). Mechanism: overrides only in `hmi-link-corner-accent-lengths` (JSON; invalid -> default, out of range clamped, off-step snapped); the live value is `--link-accent-length-rest` / `-hover` on the document root, written only when overridden (reset removes them), same as the entrance sliders (no Zustand store: the CSS property is the live value and the layer reads it); boot apply in `main.tsx`; part of the Tema dirty / Guardar / revert / unmount-restore flow. Commits `79d26bc` (service, RED 16 -> GREEN 16), the Tema sliders commit (RED 8 failed / 11 passed -> GREEN 19/19; Tema suites 88 passed), docs commit. No `index.css` change.

- 2026-09-30 SPEC CHANGE (parent/user): the user rejected the curved-border drawing (e874cdf, "quedó feo"): in the lab it worked with rounded corners; the accents should live on an invisible, slightly larger outer frame. Writer: `.hmi-link-accents` reverted to the lab technique: the 8 straight `linear-gradient`s as BACKGROUND on a layer rounded `frame radius + offset` (the rounding clips the gradient ends at the corners); no border, no mask. The length is the VISIBLE straight part: gradient size along the edge = `--link-accent-reach` = radius + offset + `--frame-accent-length`, so the same value looks the same with any radius; registered `--frame-accent-*` transition kept. Defaults (lab-equivalent): length 12 px rest / 6 px hover, opacity 0 % / 60 %, thickness 1 px, white. Sliders use the same semantics and defaults (hint says visible straight length, measured from where the curve ends). RED: CSS contract 3 failed / 5 passed (tokens, background technique, reach) -> GREEN 8/8; service + Tema defaults RED 8 failed -> GREEN (104 passed in the service + Tema suites). Single `index.css` write; served stylesheet checked (`--link-accent-reach` present, no `--link-accent-corner` left). Live pixel check pending (parent).

- 2026-09-30 parent: live check of the CURRENT drawing (lab technique, `beb88b2`): forced hover over a member of the
  linked group in the control Chrome -> `--frame-accent-opacity` 60 %, length 6 px, the four straight brackets visible
  around the group, clipped by the invisible outer frame's rounding (screenshots `gz-tl3.png`, `group-hover-full.png`).
  Review `868fa89..766522c` (13 files / 598 lines, medium, standing consent): APPROVED and acknowledged
  (`review-07aab1d1b11146fe`). Suggestions: R3-inherited-member-accents-doc-stale — the DESIGN_SYSTEM "Cuándo aplica"
  paragraph fixed in this commit (own target; group lit via group hover; inherited members plain; viewer gutter);
  R3-a4-marked-done-while-pending — resolved by this live check. Recorded, not fixed: R3-viewer-gutter-fit-unproved
  (no test proves the grid fits the padded content box; verified live: brackets not clipped), R3-cutout-guard-comma-split
  (the cutout guard splits selector lists on raw commas inside `:is()`), and the edge case of a locked group WITHOUT a
  frame whose inherited members then get no accents at all.

## Next step

Live check of the corner accents in the browser (parent), then close the feature.
