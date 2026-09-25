# PW-004 — Guardar scope, dirty indicator and close confirmation in Configuración general

## Objective

`GlobalSettingsDialog.tsx` currently enables `Guardar` from the OR of all five tabs' dirty
flags, but `handleSave` and the footer status only ever act on the active tab. Closing the
dialog (`Cerrar`, Escape, backdrop click) silently discards every unsaved tab without asking.
This task implements the user's decided option A to remove the desync and the silent-discard
gap, and fixes an unrelated arbitrary-size defect found in the same footer status text.

## Decision (user-authorized, option A)

1. `Guardar`'s enabled state and the footer status reflect ONLY the active tab (drop the
   five-way OR for enablement; the footer status projection was already active-tab-only from
   PW-001 and stays that way).
2. Inactive tabs with unsaved changes show a small dirty indicator on their tab button — a
   `bg-status-warning` dot, `aria-hidden`, paired with a sibling `sr-only` text "Cambios sin
   guardar" linked via `aria-describedby` so the tab button's accessible NAME (used by existing
   exact-string `getByRole` queries throughout the test suite) is untouched.
3. Closing the dialog (`Cerrar`, Escape, backdrop) while ANY tab is dirty opens a confirmation
   dialog before discarding. Cancel keeps the dialog and all drafts intact. Confirm runs the
   existing discard path (including Diseño's live-preview revert).
   - Confirmation copy (formal usted): title `¿Descartar los cambios?`, body `Hay cambios sin
     guardar en esta ventana. Si continúa, se perderán.`, buttons `Cancelar` (secondary) /
     `Descartar cambios` (critical).
   - Built directly from the `AdminDialog` primitive (the minimal-confirm pattern already used
     in `DashboardBuilderPage.tsx` for its `dialogMessage` dialog), not `AdminDestructiveDialog`:
     that primitive is shaped for deletions with an "affected items" list, which does not apply
     to a discard-unsaved-changes prompt.
4. Footer status texts (`Cambios sin guardar`, `Guardando...`, `Guardado`, `Error al guardar`,
   defined in `saveStatus.ts`) currently render with a hardcoded `text-sm` class, which resolves
   to a different rendered size (`calc(var(--font-size-system) * 7/6)` ≈ 12.83px) than the
   neighboring `Guardar`/`Cerrar` buttons, which declare no size class and inherit `body`'s
   `font-size: var(--font-size-system)` (11px). Fix: replace `text-sm` with `text-xs` (token
   `--text-xs: var(--font-size-system)`) in `GlobalSettingsDialog.tsx`'s footer status paragraph
   — the single place that composes the class for all four status strings — so the rendered size
   matches the buttons exactly instead of relying on an accidental mismatch.

Out of scope (explicitly, per the residual already recorded in PW-001's closure): the four
migrated tabs' one-directional dirty flags stay as they are.

## TDD mode

Strict TDD (session configuration: "Strict TDD Mode: enabled"). Tests written first against the
unchanged component, RED observed for the new assertions (and for the `Cerrar`-while-dirty tests
updated to expect a confirmation step), then the component is changed to GREEN. Runner: vitest
(`npx vitest run` from `hmi-app/`).

## Tasks

- [x] S1 — Write/extend `GlobalSettingsDialog.test.tsx`: Guardar enablement reflects only the
      active tab; inactive-tab dirty indicator (accessible, name-preserving); footer status uses
      `text-xs`; observe RED.
- [x] S2 — Write/extend the same file: close confirmation dialog (Cerrar/Escape/backdrop),
      cancel path keeps drafts, confirm path discards (including Diseño revert) and clears
      status; update the pre-existing `Cerrar`-while-dirty tests to go through the confirm step;
      observe RED.
- [x] S3 — Implement: `dirtyByTab`/`activeTabDirty`/`anyTabDirty`, Guardar `disabled` on
      `activeTabDirty`, tab dirty indicator, confirm-close state machine, `text-xs` footer fix.
      Observe GREEN.
- [x] S4 — Full verification gates (`vitest run`, `tsc -b`, `lint`); real-browser visual check
      marked pending (admin area requires a real login and no credentials/dev bypass exist).

## Checks

- `cd hmi-app && npx vitest run` — GREEN: 221 files / 2537 tests (baseline 221/2531 + 6 new
  tests: Guardar-active-tab-only, tab indicator, cancel-keeps-drafts, closes-clean-immediately,
  Escape-confirms, backdrop-confirms).
- `npx tsc -b` — clean, no output.
- `npm run lint` — clean, no output.

## RED evidence (before implementation, tests added against the unchanged component)

13 of 21 tests in `GlobalSettingsDialog.test.tsx` failed for the expected reasons:
- `enables Guardar based only on the active tab...` — `toBeDisabled()` failed, button was still
  enabled (five-way OR still in effect).
- `shows an accessible unsaved-changes indicator...` — the `sr-only` indicator was absent.
- Footer-status tests (`text-xs` assertions) — received `mr-2 text-sm text-status-warning`.
- All `Cerrar`-while-dirty tests (Conexión/Diseño/Opciones/Ajustes/error/discard-all) — failed
  with `Unable to find an accessible element with the role "dialog" and name "¿Descartar los
  cambios?"` (no confirmation dialog existed yet).
- New confirm-flow tests (cancel, Escape, backdrop) — same missing-dialog failure.
After implementation, all 21 passed; the sibling `GlobalSettingsDialog.voice.integration.test.tsx`
had one matching failure (`discards unsaved effect, orb, and preview-only drafts when Close
unmounts the tab`, same missing-confirm-dialog reason) — updated the same way, then GREEN (9/9).

## Implementation summary

`hmi-app/src/components/admin/GlobalSettingsDialog.tsx`:
- `dirtyByTab` (per-tab lookup), `activeTabDirty` (drives `Guardar`'s `disabled`), `anyTabDirty`
  (drives the close-confirmation gate) replace the single five-way-OR `dirty` variable.
- Tab buttons: an inactive+dirty tab renders a `bg-status-warning` dot (`aria-hidden`) plus a
  sibling `sr-only` "Cambios sin guardar" span, linked via `aria-describedby` — the sibling
  placement (not nested text) keeps the button's accessible NAME unchanged, which several
  pre-existing tests rely on via exact-string `getByRole` queries.
- `discardAndClose` (the former `handleClose`, unchanged body) now only runs after confirmation
  or when nothing is dirty; `handleRequestClose` (wired to `AdminDialog`'s `onClose` — covering
  Escape and backdrop click — and to `Cerrar`) opens the confirm dialog when `anyTabDirty`, and
  is a no-op while the confirm dialog is already open (prevents the outer dialog's own
  Escape/backdrop listener from re-opening the confirm dialog the instant Escape cancels it,
  since both `ModalBackdrop` instances share a global `keydown` listener while both are mounted).
  `handleCancelDiscard` closes the confirm dialog only, leaving the outer dialog and every draft
  untouched.
- A second `AdminDialog` (not `AdminDestructiveDialog` — see decision 3) renders the confirmation,
  title `¿Descartar los cambios?`, body `Hay cambios sin guardar en esta ventana. Si continúa, se
  perderán.`, actions `Cancelar` (secondary) / `Descartar cambios` (critical, matching the
  `critical` variant `AdminDestructiveDialog` already uses for its own destructive action).
- Footer status paragraph: `text-sm` → `text-xs`, matching `--text-xs: var(--font-size-system)`,
  the same token `body` uses and that `AdminActionButton` (`Guardar`/`Cerrar`) inherits since it
  declares no size class of its own.

Also updated (pre-existing tests, behavioural change authorized by the decision, not touched
otherwise): `GlobalSettingsDialog.test.tsx` (4 per-tab status tests + the save-errors test + the
discard-all-tabs test, each gained one `Descartar cambios` click after `Cerrar`) and
`GlobalSettingsDialog.voice.integration.test.tsx` (one test, same addition). Two other tests that
click `Cerrar` while nothing is globally dirty (`HmiNameSettings`/credential drafts are tracked
outside `onDirtyChange`) needed no change and stayed green throughout.

## Visual check

Pending. The dialog lives under `/admin`, which requires a real login; no dev/test auth bypass
exists in the codebase (checked `store/auth.store.ts` and `services/adminAuth.service.ts` call
sites). Per the isolation instructions, auth was not bypassed, so no real-browser screenshot was
taken. All behaviour is covered by the RTL test suite above (21/21 + 9/9 green).
