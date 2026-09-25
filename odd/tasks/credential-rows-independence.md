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

## Progress

(filled in as work proceeds)
