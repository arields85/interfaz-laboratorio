# Theme polish: Contorno buttons, widget frame toggle, handle offset — ODD feature document

> ODD feature task (not SDD). Branch `feat/theme-polish` from `main` `821373b` (main checkout;
> the user's dev server serves it). Engram mirror `odd/theme-polish/tasks`. Follows
> `odd/tasks/theme-tab.md` and `odd/tasks/group-widget.md` (both merged).

## Objective

Fix three things the user found testing the "Contorno" theme on main (2026-09-28).

## Decisions (user, 2026-09-28)

- **P1 buttons:** in "Contorno" the buttons must look like "Clásico": NO border; the hover
  background uses the theme radius (0 in Contorno). Applies to every themed button group
  (admin actions, icon toolbar buttons, catalog rail buttons, viewer buttons, widget segmented
  controls) for consistency — the user may exempt the segmented controls later.
- **P2 frame toggle:** every widget type that can be placed in a header slot
  (`isHeaderCompatibleWidgetType`) gets a property-panel option to show/hide its background and
  frame, built with the project skill `.opencode/skills/widget-property-panel/SKILL.md`. It
  applies both in the header and in the grid. Unset keeps today's look per location (grid:
  frame shown; header: frameless); an explicit value overrides both locations.
- **P3 resize handles:** with Contorno the handles sit glued to the corners; they must keep the
  same visual separation from the frame in any theme (rounded or square), group containers
  included.

## Tasks

- [ ] **P1** — Contorno button preset = Clásico look (no border, hover fill) with the theme radius.
- [ ] **P2** — Frame/background toggle for header-capable widgets (panel + renderers + header).
- [ ] **P3** — Resize handle offset independent of the theme radius.
- [ ] **P4** — Docs (DESIGN_SYSTEM themes section, WIDGET_AUTHORING/ADMIN_CONVENTIONS as needed) and
  the user's live check.

## Constraints

- Visible text Spanish usted; code/comments English; tokens only; reuse primitives.
- TDD strict (global CLAUDE.md), Vitest.

## Progress

- 2026-09-28: document created, branch created.

## Next step

Delegate P1–P3 (one writer).
