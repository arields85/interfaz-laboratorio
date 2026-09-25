# Credential rows independence + in-progress caret — ODD feature tracker

> ODD feature task (not SDD). Branch `fix/credential-rows` (worktree
> `Interfaz-HMI-worktrees\credential-rows`, from main `d9455ed`). Regression of
> the same class T15 already fixed for Verificar
> (`odd/tasks/prisma-channel-a-corrections.md`), reported from the user's live
> test on 2026-09-25.

## Objective

Fix two regressions in `hmi-app/src/components/admin/VoiceCredentialSettings.tsx`
(Configuración general -> Prisma credential rows: Proveedor de voz / Canal A /
Canal B):

- **F4**: clicking "Guardar" (or "Eliminar") in one row disables the OTHER
  rows' Guardar/Eliminar/Verificar buttons (and their inputs), as if the three
  rows shared one lock. Rows must be fully independent.
- **F5**: while a row is saving/verifying/deleting, its trailing info area
  (where the model name / bot `@username` normally sits) shows nothing
  informative for a noticeable time. Show the in-progress action as text with
  a blinking caret, reusing the existing `.widget-runtime-state-caret` /
  `widget-runtime-state-caret-blink` mechanism (`index.css`,
  `hmi-app/src/components/ui/WidgetRuntimeState.tsx`'s "Cargando_").

## Root cause (F4)

`hmi-app/src/hooks/usePrismaCredentialAdministration.ts`'s `runOperation`
(used by `saveCredential`/`deleteCredential`/`applyTelegram`/`applyChannelA`)
guards ALL THREE providers behind one single `operationRef`/`generationRef`/
`pendingAction` (`useState<string | null>`), unlike `runVerify` (T15), which
is already scoped per provider (`verifyOperationsRef`/`verifyGenerationRef`/
`verifyingProviders`). `VoiceCredentialSettings.tsx`'s `disabled` (L450) reads
`administration.pendingAction !== null` and feeds every row's Save/Delete
button AND (via `providerDisabled`/the shared `disabled` param) every row's
Verificar button and credential input. So a save/delete in ANY row makes
`pendingAction` non-null, which the component reads as "some row is busy" and
disables literally every row, not just the pending one.

## Caret mechanism research (F5)

Two independent blinking-underscore mechanisms exist in this codebase:

1. `.widget-runtime-state-caret` / `@keyframes widget-runtime-state-caret-blink`
   in `hmi-app/src/index.css` (~L401-415), used by
   `hmi-app/src/components/ui/WidgetRuntimeState.tsx` for widget "Cargando_".
   A small reusable CSS class applied to an inline `<span>_</span>` next to
   arbitrary text -- exactly what an in-row trailing info area needs.
2. The boot shield's own short-profile caret (`data-hmi-shield-short-caret`,
   `@keyframes short-caret-blink`), defined inline in `hmi-app/index.html`
   (not in `index.css`) and driven imperatively by
   `hmi-app/src/hooks/useBootShield.ts`. This is what the viewer -> builder
   transition (`Topbar.tsx`'s `handleAdminNavigation` ->
   `requestShieldReveal({ profileId: 'short', ... })`, confirmed by reading
   `Topbar.tsx` L121-130) actually shows ("CARGANDO"). It is a singleton
   full-page overlay effect (`#hmi-shield`) with its own DOM-construction
   functions, custom properties and typing animation -- not designed to be
   dropped into arbitrary inline text, and extracting it would mean creating
   new CSS, which the instruction explicitly rules out.

**Decision**: reuse mechanism (1), `.widget-runtime-state-caret` /
`widget-runtime-state-caret-blink`, since it is the only one of the two built
as a small reusable primitive for inline text and is already used exactly
this way by `WidgetRuntimeState`. The viewer->builder transition's own caret
(mechanism 2) is a bespoke full-page overlay effect that cannot be reused here
without inventing new CSS.

## Scope and constraints

- Read-only plant constraint unaffected (HMI configuration only).
- Tokens only (STATUS_TONE_CLS, no hardcoded colors); no new animation.
- Formal usted register for all new/changed copy.
- Icon-only buttons keep `aria-label` accessible names (unchanged).
- Out of scope: no fourth "Probar" button exists in the component today (only
  Verificar/Guardar/Borrar) -- the coordinator brief's "Probar" verb and
  "Probando_" string have no corresponding control to attach to; flagged back
  to the coordinator as a decision gap rather than invented.

## TDD

Strict TDD: enabled (session config). Runner: `cd hmi-app && npx vitest run`
(focused: `npx vitest run <file>`).

## Tasks

- [x] **T1** Scope `usePrismaCredentialAdministration.ts`'s `runOperation` /
  `pendingAction` per provider (`pendingActions: Record<CredentialProvider,
  string | null>`), mirroring T15's `runVerify` pattern exactly. Update
  `saveCredential`/`deleteCredential`/`applyTelegram`/`applyChannelA` and both
  reset effects. Route: direct (single file + its test, already understood).
- [x] **T2** `VoiceCredentialSettings.tsx`: drop `pendingAction` from the
  shared `disabled` flag; derive each row's own pending flag from
  `administration.pendingActions[provider]`; scope `retryDisabled` to
  `stopRetryProvider`'s own pending state. Route: direct (same file as T1,
  understood together).
- [x] **T3** F5: add `caret?: boolean` to `ResultGlyph`, an
  `actionProgressResult(kind)` helper for 'saving'/'verifying'/'deleting' ->
  "Guardando_"/"Verificando_"/"Borrando_", wire it into both
  `renderGeminiProvider` and `renderTelegramFamilyProvider`'s `resultGlyph`
  (progress takes precedence over the resting/verification-result display),
  render the caret span with the existing `.widget-runtime-state-caret` class
  in `ResultDisplay`, and add `role="status" aria-live="polite"` on the result
  area while a progress state is showing. Route: direct (same file).
- [x] **T4** Regression tests: hook-level (cross-provider save/delete
  independence, mirroring the existing T15 verify tests) and component-level
  (clicking Guardar/Eliminar in one row leaves the other rows' Guardar/
  Eliminar/Verificar/input enabled; the pressed row's own trailing area shows
  "Guardando_"/"Borrando_"/"Verificando_" with the caret span and
  `role="status"`). Route: direct (same files).

## Acceptance criteria

1. Saving, deleting or verifying in one row never disables another row's
   Guardar/Eliminar/Verificar buttons or its credential input.
2. The pressed row's own Guardar/Eliminar/Verificar still disable themselves
   while that row's own operation is in flight (no regression of the
   double-submit guard).
3. While a row is saving/verifying/deleting, its trailing info area shows
   "Guardando_" / "Verificando_" / "Borrando_" (exact strings) with a blinking
   caret using `.widget-runtime-state-caret`, `role="status"`,
   `aria-live="polite"`.
4. Full suite, `tsc -b`, `lint` stay green.

## Coordinator clarification (2026-09-25, mid-task)

1. **F4 scope**: cover every row x every action combination (Verificar,
   Guardar, Borrar, "Probar") against every OTHER row, table-driven, plus
   concurrent actions in two rows at once. Resolution: this component has
   only THREE real controls per row -- Guardar, Eliminar (Borrar) and
   Verificar (confirmed by reading the whole file: no "Probar" string or
   button exists anywhere). "Probar" is the coordinator's own name for the
   existing Verificar action (see point 2). The matrix below therefore covers
   3 actions x 3 rows = 9 combinations, plus one dedicated concurrent-two-rows
   test.
2. **F5 wording**: "Guardando credencial_", "Borrando credencial_" (fixed,
   every row), and for Verificar/"Probar" wording matching what that button
   actually tests per row, checked against its real behavior/aria-label:
   Verificar is a non-sending check (never starts/stops/restarts anything;
   T13's own contract) of the stored credential -- "Probando voz_" for
   Proveedor de voz (tests the Gemini API key), "Probando bot_" for Canal A
   and Canal B (tests a Telegram bot token).

Final F5 strings (verbatim, before the blinking caret's trailing `_`):
- "Guardando credencial_" -- all three rows, while Guardar is in flight.
- "Borrando credencial_" -- all three rows, while Eliminar is in flight.
- "Probando voz_" -- Proveedor de voz row, while Verificar is in flight.
- "Probando bot_" -- Canal A and Canal B rows, while Verificar is in flight.

## Progress

- 2026-09-25: T1 done. `usePrismaCredentialAdministration.ts`'s `runOperation`
  scoped from one global `operationRef`/`generationRef`/`pendingAction` to
  per-provider `operationRefs`/`generationRefs`/`pendingActions` (mirroring
  `runVerify`'s existing per-provider pattern exactly); `saveCredential`/
  `deleteCredential`/`applyTelegram`/`applyChannelA` and both reset effects
  updated to match. RED: 10 tests failed (renamed `pendingAction` ->
  `pendingActions` broke every existing assertion reading it, `TypeError:
  Cannot read properties of undefined`) before the hook change; 3 new
  cross-provider independence tests added at the same time. GREEN: 35/35
  hook tests pass after implementing. Commit `26e95ce` (GGA PASSED after one
  stale-comment cleanup round; GGA's first pass came back ambiguous
  format-wise on an otherwise-passing review, non-blocking).
- 2026-09-25: T2 done. `VoiceCredentialSettings.tsx`'s shared `disabled`
  dropped `administration.pendingAction !== null`; each row now derives its
  own pending flag from `administration.pendingActions[provider]`
  (`geminiPending`/`providerPending`), and `retryDisabled` is scoped to
  `stopRetryProvider`'s own pending state instead of the global flag.
- 2026-09-25: T3 done. Added `caret?: boolean` to `ResultGlyph`,
  `actionProgressResult`/`SAVE_DELETE_PROGRESS_TEXT`/`verifyProgressText`
  helpers, wired into both `renderGeminiProvider` and
  `renderTelegramFamilyProvider`'s `resultGlyph` (progress takes precedence
  over the resting/verification-result display); `ResultDisplay` renders the
  `.widget-runtime-state-caret` span and sets `role="status"
  aria-live="polite"` only while a progress state is showing.
  `channelAConnectionResult`/`telegramConnectionResult` dropped their now-dead
  `pending` parameter (the in-flight save/delete window is handled one level
  up before they are even called).
- 2026-09-25: T4 done, expanded per the coordinator's mid-task clarification.
  Hook-level: 3 new tests (`saving one provider never blocks another
  provider's save/delete`, `deleting one provider never blocks another
  provider's save/delete`, same-provider concurrent save still rejected).
  Component-level: a 9-case `it.each` F4 matrix (3 rows x
  save/delete/verify) asserting every OTHER row's Guardar/Eliminar/Verificar/
  input stay enabled while the pressed row's own controls correctly
  self-disable (all three for save/delete; only Verificar for verify, per
  T15's explicit same-row-mutation-during-verify allowance); one dedicated
  concurrent-two-rows test (Gemini save + Canal A delete truly simultaneous,
  Canal B untouched); 2 existing verify-in-flight tests updated from the old
  textual "Verificando…" assertion to the new caret-based result area
  (`toHaveTextContent('Probando voz_'/'Probando bot_')`,
  `role="status"`/`aria-live="polite"`, `.widget-runtime-state-caret`
  present); 6 new tests (3 rows x save/delete) for "Guardando credencial_"/
  "Borrando credencial_". RED (first round, before implementing T2/T3):
  9 failures, all text-content mismatches (old "Guardando"/"Verificando"/
  "Borrando" without "credencial" suffix, verify not yet using
  "Probando voz/bot") -- the F4 matrix tests (button-state only) already
  passed at this point, since T1/T2's independence fix predates the wording
  change. GREEN: 99/99 component tests pass after implementing T3's exact
  wording.
- 2026-09-25: GGA review on the T2/T3/T4 commit flagged a real regression:
  the delete-confirmation dialog's "Confirmar eliminación" button used
  `disabled={disabled}`, which no longer carries any pending state after the
  F4 fix, so a user could double-click it and re-enter `deleteCredential`
  while the first call was still in flight (silently rejected as
  `ADMIN_CREDENTIAL_OPERATION_PENDING`, mapped to a generic error message).
  Added a regression test (RED: button stayed enabled after the first click,
  confirmed with a hung `deleteCredential` mock), then scoped its guard to
  `administration.pendingActions[deleteProvider]` specifically. GREEN: 99/99.
  Commit `b47b1b3` (GGA PASSED, one optional non-blocking readability note).
- 2026-09-25: full verification. `cd hmi-app && npx vitest run`: 221 files /
  2571 tests pass (baseline 221/2551 + 20 new tests: 3 hook + 17 component).
  `npx tsc -b`: clean. `npm run lint`: clean.
- 2026-09-25: visual check attempted per the writer brief -- started an
  isolated Vite dev server from this worktree on port 5199 (own PID, stopped
  cleanly afterward), opened it as a new tab in the user's control Chrome via
  CDP (`/json/new`), then closed only that tab (`/json/close/<id>`). Admin
  mode requires an authenticated session and this fresh origin/port has none
  (confirmed by the writer brief's own warning: admin auth is per-origin
  localStorage/session); skipped further inspection rather than attempting
  any bypass, per the brief's explicit instruction. No visual confirmation of
  the rendered rows was obtained; the 2571-test suite plus the exact-string/
  caret/role assertions above are the evidence of record instead.

Commits (work units): `26e95ce` (hook, T1), `d7bbd4e` (component, T2+T3+T4),
`b47b1b3` (component, GGA double-submit fix).

## Second coordinator correction (2026-09-25, same day)

The coordinator withdrew the "Probar" wording as a mistake: there is no
separate test action, Verificar is the only such control. Final F5 set,
uniform across all three rows: **"Guardando credencial_"**,
**"Verificando credencial_"**, **"Borrando credencial_"**.

Also required: compare the boot shield's actual short-profile caret (the
real viewer->builder "CARGANDO_" mechanism, `index.html` /
`useBootShield.ts`) against `.widget-runtime-state-caret`'s blink
timing/shape, and either extract a shared class or state the identity with
evidence. Read both CSS blocks in full:

```css
/* index.html, [data-hmi-shield-short-caret]'s blink component */
@keyframes short-caret-blink {
  0%, 49% { color: var(--hmi-shield-ink); }
  50%, 100% { color: var(--color-industrial-bg, #05070a); }
}
/* animation: ..., short-caret-blink 0.6s steps(1) var(--hmi-shield-short-caret-blink-delay) infinite; */

/* index.css, .widget-runtime-state-caret */
@keyframes widget-runtime-state-caret-blink {
  0%, 49% { color: var(--color-industrial-muted); }
  50%, 100% { color: var(--color-industrial-bg); }
}
/* animation: widget-runtime-state-caret-blink 0.6s steps(1) infinite; */
```

**Verdict**: the blink TIMING/SHAPE is identical (0.6s, `steps(1)` hard cut,
same 0%/49%/50%/100% duty split, infinite). The only differences are (a) the
shield's blink starts after a 620ms delay because it is sequenced behind
that profile's own typewriter reveal (`short-caret-move`/`short-caret-idle`,
absolute-positioned to walk across text as it "types") -- choreography this
plain inline row caret has no use for; and (b) the "on" color token
(`--hmi-shield-ink` vs `--color-industrial-muted`, each correct for its own
context). Kept `.widget-runtime-state-caret` (already the same shape/timing)
instead of extracting a new shared class -- the shield's markup/CSS must
render before any app CSS loads and stays untouched in `index.html` /
`useBootShield.ts`. Evidence recorded inline above `ResultDisplay` in
`VoiceCredentialSettings.tsx`.

RED: 2 tests failed (`Received: Probando voz_` / `Probando bot_` vs expected
`Verificando credencial_`) before collapsing `SAVE_DELETE_PROGRESS_TEXT`/
`verifyProgressText` into one uniform `ACTION_PROGRESS_TEXT` record covering
saving/verifying/deleting. GREEN: 99/99 component tests. Full suite: 221
files / 2571 tests pass; `tsc -b` clean; `lint` clean. Commit `e719e9f` (GGA
PASSED, one optional non-blocking note about `progressKindFromPendingAction`
parsing the hook's action-string prefix instead of a typed field).

## F8 — close the delete dialog on confirm (live retest, 2026-09-25)

User report (worktree `credential-delete`, branch
`fix/credential-delete-dialog`): the "ELIMINAR CREDENCIAL" confirmation
dialog stays open for the whole deletion, with a disabled "Confirmar
eliminación" button covering the page, so the row's own F5 "Borrando
credencial_" progress text (already implemented and tested above) is never
visible to the user.

- [ ] **F8** `VoiceCredentialSettings.tsx`'s `remove(provider)`: close the
  confirmation dialog immediately on confirm (before awaiting
  `administration.deleteCredential`), instead of only closing it from the
  `finally` block once the delete settles. The row's own per-provider
  pending state (F4's `administration.pendingActions[provider]`) already
  disables that row's Eliminar/Guardar/Verificar and drives the F5 "Borrando
  credencial_" caret independent of the dialog, so success/error feedback
  keeps showing in the row exactly as Guardar/Verificar already do. Keep the
  double-submit guard: the row's own Eliminar stays disabled while its
  delete is in flight (so the dialog cannot be reopened for that row), and
  the hook's own synchronous `operationRefs` lock
  (`usePrismaCredentialAdministration.ts`'s `runOperation`) still rejects a
  concurrent same-provider delete regardless. Other rows stay fully
  independent (unchanged, F4). Expected simplification: once the dialog
  closes synchronously at confirm-click time, the `finally`-block's
  `dialogRevisionRef`-guarded conditional close (added earlier to stop a
  stale delete from closing a freshly reopened dialog) becomes structurally
  unreachable dead code and should be removed together with
  `dialogRevisionRef` itself, not left in place. Route: direct (single file
  + its test, already understood from F1-F5 above).
