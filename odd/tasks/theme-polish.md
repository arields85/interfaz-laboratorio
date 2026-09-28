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
- [x] **P5** — Tags in the theme engine: `AdminTag` driven by theme tokens (style base glass/flat/
  outline, radius, fill, border and color tint using each tag's own color); Clásico and Contorno
  keep today's tag look exactly. Needed for the user's third style (below).
- [x] **P6** — The user's new style from the lab (2026-09-28) as a theme preset (name/placement
  pending the user's answer):
  - Widgets (glass): rest radius 3, fill 0 %, border 8 %, blur 3 px, accent hidden (origin 20 px
    x 1.5 px white); hover radius 3, fill 4 %, border 20 %, blur 12 px, accent 8 px x 1 px white at
    60 %.
  - Buttons with text (outline): rest radius 3, fill 0 %, border 22 %, accent hidden (8 x 1 white);
    hover radius 3, fill 3 %, border 50 %, accent hidden (8 x 1 white).
  - Icon-only buttons: rest radius 6, fill 0 %, border 0 %, accent hidden (origin 16 px x 1 px
    white); hover radius 3, fill 5 %, border 0 %, accent 5 px x 1 px white at 60 %.
  - Tags (flat): radius 3, fill 0 %, border 0 %, color tint 14 %.
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

- 2026-09-28: P5 + P6 + muted-tag fix (route: delegated writer) — `4ac0729` feat(theme): tags
  from theme tokens (`ThemeTagStyle`, optional with Clásico fallback; `AdminTag` renders
  `.theme-tag` + per-variant `--tc`); `47351ae` feat(theme): Instrumento preset (id
  `instrument`, third card in the Tema tab, values as recorded above); `2dc7447` fix(theme): the
  user found PLANTA/EQUIPO still bordered under Instrumento — parent confirmed via CDP
  (`theme-tag-muted` had a literal white/10 border and no tint); every variant now scales the
  shared tokens (`--tag-border-scale`/`--tag-fill-scale`: muted 0.25 border, admin 4x fill and
  0.75 border) so Clásico/Contorno stay identical; Clásico/Contorno tag style set to `outline`
  (avoids an unwanted 6px blur). RED first per step; `npx tsc -b` clean, `npm run lint` clean,
  `npm test` 2919/2919, `npx vite build` OK. Parent live re-measure (separate tab, theme
  `instrument`): TEMPLATE/ASIGNADO/Planta/PUBLISHED/Equipo all have a transparent border and 3px
  radius.

- 2026-09-28: slice review P5/P6 (base `95a733b`..`0065623`, 978 lines, medium, user granted):
  lineage `review-1cac84b786bdde95` APPROVED, acknowledged, authority burned. Advisory
  SUGGESTIONs only (R3-001 style lab line 990, R3-002 `index.css:993-994`).

- 2026-09-28: `b75c19d` fix(viewer): removed the thin frame around the dashboard canvas
  (`pages/Dashboard.tsx` wrapper had `rounded-xl border border-white/5`; parent found it via CDP
  measurement; test first, RED then GREEN 23/23).
- 2026-09-28: style lab: group container section (rest/hover "Base" opacity of the frame's own
  background and "Fondo" overlay) with a container holding two overlapping mini widgets
  (`ef34f87`, artifact v10). Next: the user tunes it; then the group background becomes theme tokens
  (P7).
- [ ] **P7** (pending the user's lab values) — group container background opacity as theme
  tokens (rest/hover), so the container stays subtle under its member widgets.

## Next step

User tunes the container in the lab; user's live check (P4, including the Instrumento theme);
then merge to main. Tags in the theme engine only if the user asks after
exploring them in the lab.
