# Dashboard builder undo/redo — ODD feature document

> ODD feature task (not SDD). Branch `feat/builder-undo-redo` from `main` `31d9ff4`, main checkout.
> Engram mirror: topic `odd/builder-undo-redo/tasks` (project `interfaz-laboratorio`).

## Objective

Add classic undo/redo to the admin dashboard builder so a mistaken edit (deleted widget, broken
configuration, bad move) can be reverted instead of rebuilt by hand.

## Problem and why

The builder has no history at all. The user has lost complete widget configurations and had to
rebuild them manually. Undo/redo is also the safety net for the upcoming group/container widget
(Engram `decision/group-widget-design`), whose group move/copy operations are large; the user
agreed (2026-09-27) to build undo/redo first so the container is born integrated with the history.

## Current evidence

- `hmi-app/src/pages/admin/DashboardBuilderPage.tsx:107-108` keeps the whole working copy in one
  `useState<Dashboard | null>` named `draft` (plus `originalConfig` for dirty detection); about 19
  `setDraft` call sites.
- No undo/redo exists anywhere in `hmi-app/src` or `docs/`.

## Scope (authorized by the user 2026-09-27)

- Two buttons in the builder context bar next to "Guardar", using the existing toolbar button
  primitive (`AdminIconToolbarButton`), Lucide icons.
- Shortcuts: Ctrl+Z undo; Ctrl+Y and Ctrl+Shift+Z redo. Native text undo inside inputs, textareas
  and contenteditable elements must keep working (the shortcuts do not hijack them).
- One history step per meaningful change: a complete drag or resize is one step (never one per
  pixel); rapid consecutive edits (typing in a property field) coalesce into one step.
- History lives for the builder session: reset when a dashboard is loaded, kept across Save, lost
  when leaving the page. Bounded size.
- Dirty state keeps working: undoing back to the saved state makes the dashboard clean again.
- Selection stays valid: if an undo removes the selected widget, the selection is cleared.

Out of scope: history of staged catalog variables (`stagedVariables`), persistence of history,
the group widget itself.

## Constraints

- Read-only plant rules unaffected (admin UI configuration only).
- Visible UI text in Spanish, usted register; code, comments and identifiers in English.
- Tokens only (no hardcoded colors/fonts); reuse existing admin primitives.
- TDD: strict, source = global CLAUDE.md ("Strict TDD Mode: enabled"); runner = Vitest
  (`hmi-app`: `npx vitest run <files>`, full suite `npm test`).

## Tasks

- [x] **T1** — Pure, tested history primitive (hook or reducer) for the builder draft: set/push,
  undo, redo, redo cleared on new change, bounded size, time-based coalescing, reset.
  Route: delegated direct (writer), together with T2.
- [x] **T2** — Wire the history into `DashboardBuilderPage`: all draft mutations go through it,
  drag/resize commit as one step, buttons in the context bar with disabled states, keyboard
  shortcuts that skip editable targets, selection cleanup; page tests.
  Route: delegated direct (writer) — trigger: 2+ non-trivial files.
- [x] **T2b** — Review follow-ups: (a) deleting a catalog variable is persisted and irreversible,
  but undo can restore a draft whose widgets still bind the deleted `catalogVariableId`
  (`DashboardBuilderPage.tsx:579-599`); the deletion must apply to every history entry, not
  only the current one; (b) the editable-target shortcut test also has a dialog open, so it
  does not prove the editable guard on its own. Route: delegated direct (writer).
- [x] **T3** — Docs: mention undo/redo in `hmi-app/src/components/admin/ADMIN_CONVENTIONS.md`
  (or the builder section that fits) and close the feature. Route: inline (mechanical).

## Acceptance criteria

1. Deleting, moving, resizing, adding, duplicating a widget and editing a property can each be
   undone and redone from the buttons and the shortcuts.
2. A full drag/resize undoes in one step; typing a title undoes as one step, not per character.
3. Buttons are disabled when there is nothing to undo/redo.
4. Ctrl+Z inside a text field undoes the text, not the dashboard.
5. Undoing to the saved state clears the dirty indicator.

## Checks

- Focused: `npx vitest run` on the new primitive test and `DashboardBuilderPage.test.tsx`.
- At closure: `npm test`, `npx tsc -b`, `npm run lint` (in `hmi-app/`).
- Live check in the builder by the user.

## Progress

- 2026-09-27: feature document created; branch created.
- 2026-09-27: T1 done — `9914665` feat(builder): add undoable draft history primitive
  (`hmi-app/src/hooks/useHistoryState.ts` + 18 tests). RED: module not found; GREEN 18/18.
- 2026-09-27: T2 done — `2d5010f` feat(builder): add undo and redo to the dashboard builder,
  `84fd54c` fix(builder): guard undo/redo against an in-flight save. RED 8/9 new tests failing;
  GREEN 42/42 page tests.
  Design: `Object.is` equality (every setDraft site returns a new object), 500 ms coalescing only
  for property-panel and header text edits; discrete actions (add/delete/duplicate/view ops/layout
  commit) are hard steps; BuilderCanvas commits drag/resize once on pointerup; Save/Publish resync
  via `replaceCurrent` (no phantom step); existing effects already clear stale selection; buttons
  and shortcuts disabled while saving.
  Verification (writer): `npx tsc -b` clean; `npm run lint` clean; `npm test` 2610/2610 (222 files).
  Parent spot check: `npx vitest run src/hooks/useHistoryState.test.ts
  src/pages/admin/DashboardBuilderPage.test.tsx` 60/60.
  Review assess (base 31d9ff4, committed-only): medium, review_due slice_budget_reached (807 lines);
  consent envelope relayed to the user; user granted. Native review lineage
  `review-fd21f7a6e2a3ab2f` (1 lens, reliability): APPROVED, acknowledged, authority burned.
  Advisory (non-blocking): R3-undo-variable-deletion (WARNING), R3-editable-guard-unproved
  (WARNING), R3-dock-discrete-coalesce (SUGGESTION, `DashboardBuilderPage.tsx:1308`). Reviewed
  boundary advances to `84fd54c`. The two warnings were accepted as T2b.

- 2026-09-27: T2b done — `a8ffadb` fix(builder): drop deleted catalog variables from every undo
  step (new `useHistoryState.mapAll`, deletion records no step and scrubs past/current/future);
  `46e06dc` test(builder): prove undo/redo review follow-ups (editable guard proven with no dialog;
  the guard itself needed no change). RED: `mapAll is not a function` + deletion left Deshacer
  enabled; GREEN 20/20 hook, 11/11 page undo tests. Writer: `npx tsc -b` clean, `npm run lint`
  clean, `npm test` 2614/2614. Parent spot check: focused files 64/64.
  Review assess (base 84fd54c, committed-only): medium, 160 lines, review_due false
  (`under_budget`) — pending in the slice.
- 2026-09-27: T3 done — section 2.0 "Historial del builder" in
  `hmi-app/src/components/admin/ADMIN_CONVENTIONS.md` (docs commit below).

## Next step

Live check by the user in the builder (branch `feat/builder-undo-redo`); then merge/push decision
(user). Group widget (Engram `decision/group-widget-design`) builds on this history: one group
operation = one `set`.
