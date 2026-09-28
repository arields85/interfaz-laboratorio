# Theme polish: Contorno buttons, widget frame toggle, handle offset — ODD feature document

> ODD feature task (not SDD). Branch `feat/theme-polish` from `main` `821373b` (main checkout;
> the user's dev server serves it). Engram mirror `odd/theme-polish/tasks`. Follows
> `odd/tasks/theme-tab.md` and `odd/tasks/group-widget.md` (both merged).

## Objective

Fix three things the user found testing the "Contorno" theme on main (2026-09-28).

## Decisions (user, 2026-09-28)

- **P1 buttons (final scope after two user corrections):** in "Contorno" ONLY icon-only buttons
  (no visible text) become borderless like "Clásico", with the hover background using the theme
  radius. Buttons with text keep the current Contorno bordered look; widget segmented selectors
  (7D/30D, TURNO/DÍA) keep their current look in every theme.
- **P2 frame toggle:** every widget type that can be placed in a header slot
  (`isHeaderCompatibleWidgetType`) gets a property-panel option to show/hide its background and
  frame, built with the project skill `.opencode/skills/widget-property-panel/SKILL.md`. It
  applies both in the header and in the grid. Unset keeps today's look per location (grid:
  frame shown; header: frameless); an explicit value overrides both locations.
- **P3 resize handles:** with Contorno the handles sit glued to the corners; they must keep the
  same visual separation from the frame in any theme (rounded or square), group containers
  included.

## Tasks

- [x] **P1** — Contorno button preset = Clásico look (no border, hover fill) with the theme radius.
- [x] **P2** — Frame/background toggle for header-capable widgets (panel + renderers + header).
- [x] **P3** — Resize handle offset independent of the theme radius.
- [ ] **P4** — Docs (DESIGN_SYSTEM themes section, WIDGET_AUTHORING/ADMIN_CONVENTIONS as needed) and
  the user's live check.

## Constraints

- Visible text Spanish usted; code/comments English; tokens only; reuse primitives.
- TDD strict (global CLAUDE.md), Vitest.

## Progress

- 2026-09-28: document created, branch created.

- 2026-09-28: P1–P3 done (route: delegated writer; P1 scope corrected twice mid-run) —
  `7c3b6ab` P1: `ThemeButtonStyle.icon` + `--button-icon-*` tokens consumed only by
  `.theme-button-icon-neutral` (`AdminIconToolbarButton`: catalog rail, view toolbar,
  undo/redo); text buttons and segmented controls untouched; Clásico identical. `e9b3012` +
  `8ced9d1` P2: `displayOptions.showFrame?: boolean` on `status` and `connection-status` (the only
  header-compatible types), shared `resolveWidgetFrameVisible` (`utils/widgetFrameVisibility.ts`)
  + `getWidgetFrameOption`, used by both renderers and `HeaderWidgetCanvas`; PropertyDock toggle
  "Mostrar fondo y marco" via `DockToggleField`. `72d5ee3` P3: handle offset adds
  `max(0px, (classic radius - --frame-radius-rest) * (1 - cos45°))`, anchored to the Clásico
  preset value; groups included. RED first per task. Writer: `npx tsc -b` clean, `npm run lint`
  clean, `npx vite build` OK, `npm test` 2891/2892 (Topbar flake, 16/16 isolated). Parent spot
  check: CSS contract + frame visibility + HeaderWidgetCanvas 48/48.

- 2026-09-28: slice review (base `821373b`..`95a733b`, 724 lines, medium, user granted): lineage
  `review-784eef22f2a0d14c` APPROVED, acknowledged, authority burned. Advisory:
  R3-icon-style-required-shape (WARNING, `themeStyle.service.ts:170-172` — a theme object without
  the `icon` block would throw; today only built-in presets exist, so latent), SUGGESTIONs
  R3-reset-icon-tokens-unasserted and R3-tautological-p3-tests. Queued with the live-check fixes.

- 2026-09-28: review follow-up (inline, parent — two mechanical files + test):
  `ThemeButtonStyle.icon` optional; `buttonStyleToCssProperties` falls back to the shared
  rest/hover/base strength so every theme still emits the full `--button-icon-*` set; reset test
  now asserts the icon tokens are removed (closes R3-icon-style-required-shape and
  R3-reset-icon-tokens-unasserted). RED: `Cannot read properties of undefined (reading 'rest')`;
  GREEN 22/22; `npx tsc -b` clean, `npm run lint` clean, `npm test` 2893/2893.
- 2026-09-28: style lab extended (user request): icon-only buttons section (rest/hover, radius,
  fill, border, accent) with a catalog rail and builder view toolbar preview, and a tags section
  (radius, fill, border, color tint) with ASIGNADO/PLANTA/EQUIPO/PUBLISHED/DRAFT; preset
  "Contorno (HMI)" = the current Contorno theme. `fba6610`; artifact republished (v8).

## Next step

User's live check (P4), then merge to main. Tags in the theme engine only if the user asks after
exploring them in the lab.
