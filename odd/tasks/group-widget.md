# Group / container widget — ODD feature document

> ODD feature task (not SDD). Branch `feat/group-widget` from `main` `3790cbd`, main checkout.
> Engram mirror: topic `odd/group-widget/tasks` (project `interfaz-laboratorio`). Design
> decisions: Engram `decision/group-widget-design`; builder facts: `discovery/group-widget-builder-facts`.

## Objective

A new dashboard widget that groups other widgets into one clickable card: same outer frame and
hover as every widget, header with text + icon, and a configurable navigation target, so that
opening a machine dashboard means clicking the machine's card instead of its title text.

## Problem and why

Today the only way to open a machine dashboard from an area overview is clicking the title text
widget, because it is the only one with `navigationTargetDashboardId` set. That is not intuitive.

## Decisions (user, 2026-09-27)

- **D1 membership:** closing the lock groups the widgets COMPLETELY inside the container bounds at
  that moment; partially overlapping widgets stay out; opening the lock releases all members. To
  add or remove a member: unlock, rearrange, lock again.
- **D2 build rules:** property panel follows the project skill
  `.opencode/skills/widget-property-panel/SKILL.md`; header text + icon follow the established
  `WidgetHeader`; reuse existing components and primitives as much as possible (`glass-panel`,
  `WidgetHoverActions`, the "Navegación" option, `DockSection`, ...). Also read
  `.agent/skills/interfaz-widget/SKILL.md` and `hmi-app/src/widgets/WIDGET_AUTHORING.md`.
- **D3 click priority (viewer):** a click anywhere in the group, including over members, navigates
  to the container target; interactive controls inside members keep working (existing
  `NAVIGATION_INTERACTIVE_SELECTOR`); a member with its own `navigationTargetDashboardId` wins.
- **D4 builder editing while locked:** dragging the container moves all members together; members
  stay selectable for their properties but cannot be dragged or resized individually; the
  container can be resized but never smaller than its members' bounding box; the container is
  always stacked below its members regardless of creation order.
- **D5 copy/delete:** copy while locked duplicates the whole group (container + members, already
  grouped, new ids); copy while unlocked duplicates only the empty container; deleting the
  container deletes only the container (members stay in place, released); deleting a member
  removes it from the group; no nesting (a container is never a member of another group).
- **Undo:** every group operation is exactly one history step (one `set` on `useHistoryState`;
  see `ADMIN_CONVENTIONS.md` section 2.0).

## Current evidence

- Layout: custom CSS grid, `WidgetLayout {widgetId,x,y,w,h}` (`admin.types.ts:183`); overlap is
  allowed; no z-index field, stacking = `dashboard.widgets` order.
- Drag/resize in `BuilderCanvas.tsx` + `utils/widgetInteraction.ts`; commit once on pointerup.
- Widget union `WidgetConfig` (`admin.types.ts:776`) + `switch` in `WidgetRenderer.tsx`.
- Navigation wrapper for any widget: `WidgetRenderer.tsx:281-325`.
- Copy/delete actions: `WidgetHoverActions` from `BuilderCanvas.tsx:554`.
- Widget ids are remapped on view duplication and portable export/import
  (`dashboardViews.ts` `remapDashboardHeaderConfig*`, `dashboardPortabilityService.ts`): member
  ids must be remapped the same way.
- No multi-select, grouping, parent/child relation or panel widget exists today.

## Constraints

- Read-only plant rules unaffected (navigation only).
- Visible UI text in Spanish, usted register; code, comments, identifiers in English.
- Tokens only; reuse existing primitives; no ad-hoc patches.
- TDD: strict, source = global CLAUDE.md; runner = Vitest (`hmi-app`: `npx vitest run <files>`,
  full suite `npm test`).
- ~400 authored lines per task is an advisory planning heuristic only.

## Tasks

- [x] **G1** — Domain + renderer + catalog + property panel: `group` widget config (title, icon,
  `memberWidgetIds`, `locked`), renderer on the shared frame with `WidgetHeader`, catalog entry,
  PropertyDock section per the skill, inherited navigation; member ids remapped on view
  duplication and portable export/import.
- [x] **G2** — Builder lock: lock/unlock action next to copy/delete; D1 membership (fully inside,
  never other groups); container moved below its members in stacking order; locked members not
  draggable/resizable; one history step. Plus membership sanitation (review follow-ups): non-array
  `memberWidgetIds` treated as empty, no self-membership, no group as member.
- [x] **G3** — Group move and resize: dragging a locked container moves all members in one commit;
  resize clamped to the members' bounding box.
- [x] **G4** — Copy/delete semantics (D5) and no nesting.
- [x] **G5** — Viewer: D3 click priority for members without their own link; group hover (the
  container shows its hover while the pointer is anywhere over the group; members keep their own).
- [x] **G5b** — Promoting a member of a locked group to the header releases it from the group
  (today it is only filtered at read time). One history step. Plus review follow-ups: a widget
  belongs to at most one locked group (exclude widgets already in another locked group at lock
  time; sanitize on read); resize preview must match the committed clamp; restore the weakened
  BuilderCanvas test helper.
- [ ] **G7** — Live check 1 fixes (user, 2026-09-28): (a) the lock action icon is inverted
  (unlocked shows a closed lock), so the user toggled it the wrong way — icon must show the STATE
  (LockOpen when unlocked, Lock when locked); (b) containers must ALWAYS paint beneath the other
  widgets, locked or not, in builder and viewer — root cause: `BuilderCanvas` renders
  `visibleLayout` order while the G2 reorder only touched `widgets`; (c) clearing the title leaves
  the container without header text (no 'Contenedor' fallback in `GroupWidget.tsx:81`);
  (d) integration tests with the REAL `BuilderCanvas` (the page tests mock it, which hid all of
  this): add container, lock, drag -> members move, render order.
- [ ] **G6** — Docs (`WIDGET_AUTHORING.md`, `ADMIN_CONVENTIONS.md`) and live check by the user.

## Delivery forecast

About 1,500 authored changed lines in total (above the ~400 line budget). Strategy (user,
2026-09-27): `feature-branch-chain` — every task is committed on `feat/group-widget` and reviewed
in slices as the running count reaches the budget; `main` receives the whole feature in one merge
after the user's live check. Slice boundaries are recorded under Progress.

## Acceptance criteria

1. The user builds the "Area compresión" machine cards with a container per machine, locks them,
   moves each card as a unit, and a click anywhere on a card opens that machine's dashboard.
2. The container looks and hovers like any other widget and shows its header text + icon.
3. Lock, move, resize, copy and delete follow D1–D5 and each undoes in one step.
4. View duplication and dashboard export/import keep groups intact.

## Checks

- Focused Vitest per task; at closure `npm test`, `npx tsc -b`, `npm run lint` (in `hmi-app/`).
- Live check by the user.

## Progress

- 2026-09-27: feature document created; branch created.
- 2026-09-27: G1 done (route: delegated writer, trigger 2+ non-trivial files) — `c738216`
  feat(widgets): add the group container widget; `be1ff84` refactor(widgets): tighten the group
  widget icon map and config comments; `b21b404` fix(dashboard): keep group members through view
  duplication and export. Model: type `'group'`, `GroupWidgetConfig` with top-level optional
  `memberWidgetIds` (default `[]`) and `locked` (default `false`), `displayOptions.icon`; title via
  `widget.title`; renderer `widgets/renderers/GroupWidget.tsx` (glass-panel + WidgetHeader, empty
  body); catalog "Contenedor" (Lucide `Group`), default size 10x10; PropertyDock General
  (Título + Ícono) + generic Navegación; `normalizeWidget` defaults legacy groups. Remap: single
  point `cloneDashboardViewsWithRemappedIds` (used by dashboard duplication and portable import)
  remaps members and drops ids absent from the view.
  RED: 7 test files failing (type did not exist); GREEN 173/173 focused. Writer: `npx tsc -b`
  clean, `npm run lint` clean, `npm test` 2633/2633 (one unrelated flaky Topbar/AdminLayout run,
  clean on rerun). Parent spot check: GroupWidget + dashboardViews tests 20/20.
  Note for G2: stacking is DOM order, the group must precede its members in `view.widgets`.
  Slice review (base 3790cbd..0f85192, 686 lines, medium, user granted): native lineage
  `review-437d0c4d0ddc189c` APPROVED, acknowledged, authority burned; reviewed boundary advances to
  `0f85192`. Advisory: R3-group-member-ids-shape (WARNING, `dashboardViews.ts:289` — a malformed
  imported `memberWidgetIds` that is not an array would throw), R3-group-self-membership
  (SUGGESTION — a group listing itself). Both folded into G2 as membership sanitation.

- 2026-09-28: G2+G3 done (route: delegated writer, trigger 2+ non-trivial files) — `06b809e`
  feat(widgets): add group membership, sanitation and rigid-move helpers (pure
  `utils/groupWidget.ts`: sanitize, fully-inside membership, reorder container before earliest
  member, bounding box, rigid move-delta clamp, resize clamp to members; `normalizeWidget` and
  the view-clone remap now sanitize members — closes the G1 review warnings); `acd1e2f`
  feat(builder): lock, move and resize a group container as one unit (Lock/LockOpen hover action
  "Agrupar widgets"/"Desagrupar widgets"; locked members select but never drag, no resize
  handles; members follow the container live while dragging; one `setDraft({coalesce:false})`
  per lock toggle and per group commit). Commits split by layer (pure logic vs canvas wiring)
  because G2 and G3 share one interaction state machine.
  RED/GREEN: groupWidget 22/22, dashboardViews 17/17 (incl. the `.map is not a function` crash),
  BuilderCanvas 32/32 (7/8 new failing first), page tests verified RED by unwiring then GREEN.
  Writer: `npx tsc -b` clean, `npm run lint` clean, `npm test` 2670/2670. Parent spot check:
  groupWidget + BuilderCanvas 54/54.
  Items handed to G4: duplicating a locked group today deep-copies `locked`/`memberWidgetIds`
  (copy would share members) — D5 must remap; drag-preview placeholder rect `{w:0,h:0}` for a
  member without layout (harmless, tighten); header-promoted widgets: parent decision — they are
  never group members (excluded from D1 membership and from group moves), since they do not live
  on the canvas.

- 2026-09-28: G2+G3 slice review: user granted, but START was refused with
  `stale_target_identity` because the G4/G5 writer committed on the same branch in between.
  Lesson: never let a writer commit on a branch between the review preflight and START. The
  slice is re-derived as G2–G5 (base `7fc7893`).
- 2026-09-28: G4+G5 done (route: delegated writer) — `83ce076` refactor(widgets): extend group
  helpers for copy, delete and navigation; `8702109` feat(builder): copy and delete group
  containers as whole units (locked copy = whole group with new ids, offset below, rigid clamp,
  one step; unlocked copy = empty container; member copy is never a member; member delete
  strips its id in the same step; container delete releases members; header-promoted widgets
  excluded from membership, lock, move, resize and duplicate; `{w:0,h:0}` placeholder removed);
  `bb0d86e` feat(viewer): open the group target from anywhere in the group (pure
  `resolveEffectiveNavigationTarget` — own target wins, else the locked group's; DashboardViewer
  passes an effective widget so WidgetRenderer's click/keyboard/interactive-selector logic is
  unchanged; group hover via `{groupId, sourceWidgetId}` state and
  `[data-group-hover-target="true"] .glass-panel` added to the existing hover rule).
  RED/GREEN: groupWidget 39/39, BuilderCanvas 34/34, DashboardBuilderPage 52/52, DashboardViewer
  15/15 (new tests failing first). Writer: `npx tsc -b` clean, `npm run lint` clean, `npm test`
  2698/2698. Parent spot check: groupWidget + DashboardViewer 54/54.
  Follow-up G5b (gap reported by the writer): promoting a locked member to the header after
  locking leaves it in `memberWidgetIds`; parent decision: promotion releases membership.

- 2026-09-28: slice review G2–G5 (base `7fc7893`..`7371f57`, 2060 lines, medium, user granted):
  lineage `review-c8a17332c8ab136e` APPROVED, acknowledged, authority burned; reviewed boundary
  advances to `7371f57`. Advisory: R3-group-double-membership (WARNING, `groupWidget.ts:57-78`),
  R3-resize-preview-commit-mismatch (SUGGESTION, `BuilderCanvas.tsx:292-307`),
  R3-test-helper-weakened (SUGGESTION, `BuilderCanvas.test.tsx:154`) — folded into G5b.

- 2026-09-28: G5b + G6 docs done (route: delegated writer) — `e5002f9` fix(builder): keep each
  widget in a single group and release promoted members; `1a7bb4a` fix(builder): only let a
  LOCKED group claim cross-group membership; `9aa936a` fix(builder): match the locked-group
  resize preview to its commit clamp; `3bc917e` docs(widgets): document the group container
  widget (`WIDGET_AUTHORING.md`, `ADMIN_CONVENTIONS.md`). Header promotion releases membership in
  the same step; lock excludes widgets of other locked groups; normalize/clone dedup keeps the
  first locked group in view order; BuilderCanvas test helper restored to fail-fast.
  RED/GREEN: 11 new tests failing first. Writer: `npx tsc -b` clean, `npm run lint` clean,
  `npm test` 2710/2710. Parent spot check: groupWidget + dashboardViews 65/65.

- 2026-09-28: slice review G5b+docs (base `3fb4a73`..`490e035`, 490 lines, medium, user granted):
  lineage `review-daa0306c8c619b5b` APPROVED, acknowledged, authority burned; boundary advances
  to `490e035`. Advisory SUGGESTIONs only (kept as optional later work):
  R3-assign-header-button-path-untested (`DashboardBuilderPage.tsx:864`),
  R3-assign-header-stale-slots (`:824-839`), R3-resize-preview-grid-snap
  (`BuilderCanvas.tsx:696-698`).

- 2026-09-28: live check 1 FAILED on point 2 (lock): container looked locked on creation, lock
  did not group, container always on top and blurring the widgets below, title could not be
  cleared. Root causes confirmed in code (see G7).

## Next step

G7 (writer), then the user's live check again, then the single merge to `main`.
