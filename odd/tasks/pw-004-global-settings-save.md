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

- [ ] S1 — Write/extend `GlobalSettingsDialog.test.tsx`: Guardar enablement reflects only the
      active tab; inactive-tab dirty indicator (accessible, name-preserving); footer status uses
      `text-xs`; observe RED.
- [ ] S2 — Write/extend the same file: close confirmation dialog (Cerrar/Escape/backdrop),
      cancel path keeps drafts, confirm path discards (including Diseño revert) and clears
      status; update the pre-existing `Cerrar`-while-dirty tests to go through the confirm step;
      observe RED.
- [ ] S3 — Implement: `dirtyByTab`/`activeTabDirty`/`anyTabDirty`, Guardar `disabled` on
      `activeTabDirty`, tab dirty indicator, confirm-close state machine, `text-xs` footer fix.
      Observe GREEN.
- [ ] S4 — Full verification gates (`vitest run`, `tsc -b`, `lint`) plus a real-browser visual
      check of the dialog where auth allows.

## Checks

- `cd hmi-app && npx vitest run` (baseline: 221 files / 2531 tests)
- `npx tsc -b`
- `npm run lint`
