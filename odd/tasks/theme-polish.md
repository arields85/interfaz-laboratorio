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
- [x] **P8** — Builder copy placement (user decision 2026-09-28; builder UX found during this
  live session, kept on this branch): clicking copy starts a placement mode — a ghost of the copy
  follows the mouse snapped to the grid; one click drops it there; Escape cancels (nothing
  created); OVERLAP IS ALLOWED (no invalid state); the ghost is clamped inside the grid bounds so
  a copy can never land outside; the copy ends selected; one history step; works for a locked
  group copy too. Also fixes the current bug where a duplicate can land outside the grid.
- [x] **P4** — Docs (DESIGN_SYSTEM themes section, WIDGET_AUTHORING/ADMIN_CONVENTIONS as needed) and
  the user's live check.
- [x] **P9** — Copy placement review advisories R3-001..R3-003 (last P8 review, 2026-09-28).

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
- [x] **P7** — group container background as theme tokens (user values 2026-09-28): rest base
  20 %, fill 0 %; hover base 40 %, fill 0 % ("base" = opacity of the frame's own background,
  "fill" = white overlay); every other container parameter follows the widget frame. Applied to
  the three presets (the group widget has no legacy look to preserve in Clásico/Contorno).

- 2026-09-28: P7 done (route: delegated writer) — `37faf00` feat(theme): optional `group` block
  (`DEFAULT_GROUP_STYLE` rest base 20 % / fill 0 %, hover base 40 % / fill 0 %) on all three
  presets, `--group-*` tokens with registered `--group-base`/`--group-fill`, `.glass-panel-group`
  draws the frame base on `::before` with the tuned opacity; hover under the frame's three
  selectors. RED 11 / GREEN 82 focused; `npx tsc -b` clean, `npm run lint` clean, `npm test`
  2931/2931, build OK. Parent live measure (viewer tab): container `::before` opacity 0.2, fill
  0 %.

- 2026-09-28: P8 done (route: delegated writer) — `cb13789` feat(builder): copy placement mode
  (ghost top-left under the pointer, snapped and clamped to the grid, overlap allowed, click drops
  one history step and selects the copy, Escape / re-click / source removal cancel;
  `duplicateLockedGroup` takes an explicit target position, closing the out-of-grid duplicate
  bug); `d24c76f` comment fix. RED/GREEN per suite; `npx tsc -b` clean, `npm run lint` clean,
  `npm test` 2943/2943. Parent spot check: groupWidget tests green.
- 2026-09-28: user approved the branch (P1-P7, viewer frame) in the live check (P4); P8 was
  finished at session close and still needs its live check (next session).
- 2026-09-28: user approved the copy placement mode (P8) in the live check.

- 2026-09-28: final slice review (base `dacde8c`..`2159aa6`, 1167 lines, medium, user granted):
  lineage `review-2cb306d00888f75a` APPROVED, acknowledged, authority burned. Advisory, pending
  for the next session: R3-001 WARNING `BuilderCanvas.tsx:1015-1023` (placement commit on a
  widget's onPointerDown), R3-002 WARNING `DashboardBuilderPage.tsx:252-256` (Escape handling
  order for placement vs edit mode), R3-003 SUGGESTION `BuilderCanvas.tsx:1170-1193`.

- 2026-09-28: P9 done (route: delegated writer) — the three P8-review advisories:
  - **R3-001** (confirmed bug): `commitPlacementAt` committed `placementGridPosition`, updated
    only by a window `pointermove` listener, so a click/tap with no prior move landed the copy at
    the stale last-tracked cell instead of the cell under the pointer. RED: extended the existing
    "drops the copy on top of an existing widget…" test (`BuilderCanvas.test.tsx`) to assert the
    committed position — pressing on widget-2 at (650, 320) with no prior move committed
    `{x: 2, y: 1}` (widget-1's seeded position) instead of `{x: 10, y: 5}`, confirmed via plain
    `userEvent.pointer` (no `fireEvent` fallback needed — it did not mask the bug). Fix: both the
    pointermove tracking and `commitPlacementAt` now resolve the clamped grid cell through one
    shared helper, `resolvePointerGridCell`, off the event's own `clientX`/`clientY`. GREEN
    11/11 (P8 suite), 79/79 (full file). Commit `1f8097f`.
  - **R3-002** (coverage-only, no bug): added a `DashboardBuilderPage.test.tsx` test with a
    locked group in D6 pencil edit mode AND a pending placement both active — asserts the first
    Escape cancels only the placement (undo stays disabled, no history step, edit mode stays
    active) and the second Escape exits edit mode. Passed immediately against the existing
    source; verified the test was not vacuous by temporarily swapping the two `if` branches'
    order (fault injection) — the test then failed as expected — before reverting. Mock updated
    to expose `placementSourceWidgetId` as a data attribute. Commit `33a00d9`.
  - **R3-003** (confirmed bug + suggestion applied): the placement ghost's container rect passed
    `radius={getWidgetCornerRadius(type)}` to `GridSelectionFrame`, but a member ghost omitted
    `radius`, so e.g. a square `text-title` member showed a rounded ghost. RED: new test asserted
    a text-title member's ghost frame had `borderRadius: 'calc(0px)'`; it received
    `'calc(var(--frame-radius-rest) + 0px)'` instead. Fix: extracted the duplicated
    container/member ghost-rect markup into one `PlacementGhostRect` helper that always resolves
    radius from the member's own type, hoisted `getWidgetCornerRadius` to module scope. Also
    added a test for a header-promoted (hidden) member producing no ghost — passed immediately,
    `resolveVisibleGroupMemberIds` already filtered it. Follow-up polish from the pre-commit
    review: `px` prop typed as the existing `WidgetPixelBounds` instead of an inline duplicate.
    GREEN 81/81 (full file). Commit `f4c3b49` (includes the polish, amended).
  - Verification: `npx vitest run BuilderCanvas.test.tsx DashboardBuilderPage.test.tsx` 147/147;
    `npx tsc -b` clean; `npm run lint` clean (0 warnings — the pointermove effect's dependency
    array was kept granular, `cellWidth`/`rowHeight`, to avoid a new exhaustive-deps warning from
    passing the whole `metrics` object into the shared helper); `npm test` 2952/2952 (233 files).
  - Docs: removed the PW-016 row from `docs/PENDING_WORK.md` (resolved; Git keeps history).

## Next step

Merged to main at session close. P8 live check approved (2026-09-28). The P8-review advisories
(R3-001..R3-003, P9) are done; no open advisories remain on this branch. Pending: user review of
this branch and merge to main.
