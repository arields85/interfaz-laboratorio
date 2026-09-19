# PW-001 — save status in the footer of every Configuración general tab

## Intent and authorization

The user started PW-001 with the bounded option and answered four scope questions. Recorded
decisions:

1. **Flow:** ODD with one commit unit per tab. First the shared primitive plus the dialog
   generalization, then one unit per tab (CONEXIÓN, DISEÑO, OPCIONES, AJUSTES).
2. **`Guardando...` in the four synchronous tabs:** NOT shown. Those tabs write to
   `localStorage` synchronously, so they go from `dirty` straight to `saved`. `saving` stays
   reserved for VOZ, which really waits on the backend.
3. **AJUSTES' specific messages:** stay in the content area as form-validation errors; the
   footer carries the shared save status. No duplication, no lost detail.
4. **Guardar/status desync:** out of scope here; registered as its own pending item
   (`backlog/global-settings-save-button-scope-desync`, index row PW-004).

Reporting is in Spanish; this artifact stays in English per the repository language convention.

## Approved pattern to replicate (already implemented for VOZ)

- `hmi-app/src/components/admin/voiceSaveStatus.ts` — the type and the label/tone map:
  `dirty` → `Cambios sin guardar` (`text-status-warning`), `saving` → `Guardando...`
  (`text-admin-accent`), `saved` → `Guardado` (`text-status-normal`), `error` →
  `Error al guardar` (`text-status-critical`).
- `GlobalSettingsDialog.tsx:94-118` — the footer actions group renders the status as a `<p>`
  with `mr-2 text-sm` and the tone class, `aria-live="polite"` and `aria-atomic="true"`,
  immediately BEFORE the `Guardar` button. Positioning is test-locked by
  `expect(getSaveButton().previousElementSibling).toBe(status)`.
- The dialog owns the state; the tab pushes it through `onSaveStatusChange`. Showing it is a
  render condition on the active tab, so switching away hides it and returning restores the
  same value, and `handleClose` clears it.
- `VoiceSettingsTab.tsx:90,101-107,146-167,169-227,229-239` — the reference implementation of
  local status, dirty projection, save mapping and the `saveRef` wiring.

## Derived rules the implementation must follow

- **A validation failure is not `Error al guardar`.** In AJUSTES a blocked save leaves the
  in-content validation alert and the footer keeps reporting `Cambios sin guardar`, because
  nothing failed to persist. The critical tone is reserved for a real persistence failure.
- **`Error al guardar` must be reachable in tabs that currently have no error path.**
  CONEXIÓN, DISEÑO and OPCIONES write with bare `localStorage.setItem` / config writers and
  have no `try/catch`; each save path must gain one so the status can report a real failure.
- **Remove the dead channel.** `ConnectionSettingsTab.tsx:33` has a vestigial
  `onStatusChange?: (saved: boolean) => void` that the dialog never passes. Leaving a second,
  conflicting status channel next to the new one would be a defect; remove it in the CONEXIÓN
  unit.

## Invariants

1. The status `<p>` stays `Guardar`'s immediate previous sibling and carries
   `aria-live="polite"` and `aria-atomic="true"` in every tab.
2. No save status is ever rendered inside tab content.
3. Per-tab status survives switching away and back, and is cleared when the dialog closes.
4. VOZ behaviour is unchanged and its tests stay green: the dialog keeps a per-tab status,
   and the VOZ entry keeps producing exactly the same DOM, classes and lifecycle.
5. Tokens only, never raw colors (`docs/DESIGN_SYSTEM.md` "Regla de oro"); any scroll
   container keeps `hmi-scrollbar`.
6. Each tab keeps its own save logic; this change does not alter what a tab persists, nor the
   Guardar button's enablement, nor dirty semantics beyond projecting them.

## Work units (one commit each)

- **U1 — shared primitive + dialog generalization.** Generalize `voiceSaveStatus.ts` into a
  shared module exporting a `SaveStatus` type and the shared label/tone map (keep the labels,
  tones and the VOZ type name working, by re-export or alias, so VOZ and its tests do not
  churn). Replace the dialog's single `voiceSaveStatus` state with a per-tab status map keyed
  by tab id, and render the active tab's status in the same DOM position. No tab changes yet;
  VOZ must be byte-for-byte equivalent in rendered output and fully green.
  *Done when:* the dialog and VOZ tests pass unchanged, `tsc`/lint/build pass.
- **U2 — CONEXIÓN** (`ConnectionSettingsTab.tsx`): push `dirty` on edit, `saved` after the four
  writes plus the query invalidations succeed, `error` on a thrown failure (wrap the whole save
  in `try/catch`), remove the dead `onStatusChange` prop, and project the status upward.
  *Done when:* the tab's tests plus the dialog tests pass, including the footer position and
  tone assertions for CONEXIÓN.
- **U3 — DISEÑO** (`DesignSettingsTab.tsx`): same projection; `saved` after the two storage
  writes succeed; `error` on a thrown storage failure. Note this tab applies edits live to
  `documentElement` and is the only one the dialog reverts on close.
- **U4 — OPCIONES** (`LoaderOptionsSettingsTab.tsx`): same projection around its single write.
- **U5 — AJUSTES** (`TemporalSettingsTab.tsx`): same projection, keeping the in-content
  validation alert untouched; a real persistence failure maps to `error`, a validation block
  does not.

Every unit ends with the canonical gates green and a Conventional Commit on
`feat/prisma-telegram-credentials`, staged narrowly (no `.gitignore`).

## Gates (from `hmi-app/package.json`)

- `npm run test` (vitest run) plus the focused files while iterating.
- `npx tsc -b`, `npm run lint`, `npm run build`.
- Coverage: the repository enforces 70/70 globally; do not regress it.

## Non-goals

- Guardar button enablement and save scope (registered as PW-004).
- Giving the four tabs real dirty comparison against persisted values (their flags stay
  one-way; recorded as a known limitation of this cycle).
- Any change to what a tab persists, to the backend, or to VOZ's contract.
- `BackgroundSettingsTab.tsx` is not part of this dialog.

## Risks observed during mapping

1. Footer DOM adjacency is test-locked; wrapping the status or adding a sibling node breaks
   three existing assertions.
2. The five dialog tests mock the tabs with only the props they declare, so a widened prop
   contract is invisible to them until the mocks are extended.
3. CONEXIÓN writes four independent keys plus four invalidations: a mid-way failure is a
   partial save, and the new `error` status would report it while some values did persist.
4. DISEÑO applies changes live, so `Guardado` means "persisted", not "applied".
5. OPCIONES normalizes durations silently on save, so the persisted value can differ from what
   the user typed while the footer says `Guardado`.

## Tasks

- [ ] U1 — Shared primitive plus dialog generalization; VOZ unchanged and green.
- [ ] U2 — CONEXIÓN projects the shared status.
- [ ] U3 — DISEÑO projects the shared status.
- [ ] U4 — OPCIONES projects the shared status.
- [ ] U5 — AJUSTES projects the shared status, keeping its validation alert.
- [ ] U6 — Reconcile `docs/PENDING_WORK.md` and Engram at closure.

## Evidence ledger

| Unit | Gates | Commit |
|---|---|---|
| U1 | pending | pending |
| U2 | pending | pending |
| U3 | pending | pending |
| U4 | pending | pending |
| U5 | pending | pending |
