# Prisma channel A corrections — ODD feature tracker

> ODD feature task (not SDD). Branch: `fix/prisma-channel-a-corrections` (from `main` c14fdaa).
> PW-003 semantic query work is parked by user decision (2026-09-23).

## Objective

Fix six user-reported defects in the Prisma channel A / launcher / admin experience.

## Problem and evidence

1. Abrupt launcher close (terminal X, shutdown) leaves `process-manifest.json` with
   `developmentOwnership` and dead processes. Next `start-local.ps1` throws
   "partial or ambiguous manifest"; `dev.mjs` continues with Vite only and the proxy spams
   `ECONNREFUSED 127.0.0.1:5057`. `Prune-PrismaProcessManifest` skips manifests with
   `developmentOwnership`. Observed 2026-09-23 (owner 5708, processes 3696/27844 dead);
   stale manifest removed manually after verification. This reverses the PW-005 exclusion
   of abrupt recovery by explicit user request.
2. Topbar pairing popover shows "No se pudo obtener el estado del emparejamiento." when the
   runtime is down (proxy non-JSON error -> `PrismaChannelAPairingError('unavailable')` ->
   phase `error`). User wants a clear, simple "Prisma could not start"-style message.
3. Launcher prints "Prisma Local presentation is ready at ..."; user wants "Prisma is ready at ...".
4. Channel A shows "Cambio pendiente de aplicar / Ejecución detenida" after every start:
   `ChannelAManager` keeps applied state in memory and, unlike Telegram (`startup_apply()`
   in `local_presentation.py:main`), has no startup apply. User decision: once applied, it
   must not require re-applying on each start. Popover typography must match the login
   popover (`LoginOverlay.tsx`, `HmiButton`).
5. Admin "Ver viewer" calls `adminSessionController.exit()` (same as logout) in
   `AdminLayout.tsx`. Viewing must not log out.
6. Admin "Credenciales de proveedores" (`VoiceCredentialSettings.tsx`) uses a 2-column grid
   of tall vertical cards. User wants horizontal rectangles per provider and icon-only
   save/delete buttons.

## Scope and constraints

- Read-only plant constraint unaffected (HMI configuration and local runtime only).
- Stale-manifest recovery must stay fail-closed: prune only when every recorded owner is
  proven `dead`, no recorded runtime process is a verified live listener, and ports 5056/5057
  are free. Any `alive`/`unknown` owner or live/ambiguous listener keeps today's refusal.
  Owner PIDs are never stop targets.
- Channel A startup apply mirrors Telegram's accepted `startup_apply()` semantics (applies the
  persisted desired configuration when a credential is configured); failures are reported in
  status, never crash the runtime.
- Icon-only buttons keep accessible names via `aria-label` (tests keep role/name queries).
- Tokens only, no hardcoded colors/fonts; Lucide icons only.
- Out of scope: PW-003 semantic query, channel B behavior changes, push/PR (user decisions).

## TDD

Strict TDD: enabled (source: global orchestrator config). Runners:
- hmi-app: `cd hmi-app && npm test` (vitest; focused: `npx vitest run <file>`).
- prisma-runtime: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime -p "test_*.py"`
  (focused: single test module).

## Delivery

Strategy: `ask-on-risk`. Forecast ~600–800 authored lines (above the ~400 heuristic); chain
strategy will be asked only if a PR is requested. RDD: off (global) — no native review.
Work-unit commits on this branch; `.gga` stays untracked. Pre-commit runs GGA.

## Tasks

- [x] **T1** Stale dev manifest recovery after abrupt close (`process-ownership.ps1`,
  `start-local.ps1`, `tests/test_runtime_safety.py`). RED: dead owner + dead processes +
  free ports => pruned and fresh start; alive/unknown owner or live listener => still refuses.
  Route: delegated (backend writer). Trigger: 2+ non-trivial files. Commit `8d9c0b7`.
- [x] **T2** Launcher text "Prisma is ready at http://127.0.0.1:5057." (`start-local.ps1`).
  Route: delegated with T1 (same writer, separate commit). Commit `9cc6627`.
- [x] **T3** Channel A startup apply (`channel_a_manager.py`, `local_presentation.py`, tests).
  Route: delegated (backend writer). Commit `94e5ec1`.
- [x] **T4** Pairing popover: clear "Prisma no se pudo iniciar" for runtime-unreachable
  failures (distinct from runtime-reported "Canal A no disponible"); typography/button aligned
  with login popover (`prismaChannelAPairing.service.ts`, `useChannelAPairing.ts`,
  `PrismaPairingControl.tsx`, tests). Route: delegated (frontend writer). Commit `46c95a2`.
- [x] **T5** "Ver viewer" navigates without ending the admin session (`AdminLayout.tsx`, test).
  Route: delegated (frontend writer). Commit `5fb8801`.
- [x] **T6** Provider credentials: full-width horizontal provider rows, icon-only save/delete
  with `aria-label` (`VoiceCredentialSettings.tsx`, `HmiButton` aria passthrough if needed,
  tests). Route: delegated (frontend writer). Commit `2d954d8`.

- [x] **T1b** Launcher always starts Prisma (user decision 2026-09-23, supersedes T1's
  fail-closed refusal): reuse a verified healthy runtime of this repo; otherwise stop any
  verified leftover Prisma processes of this repo on 5056/5057 (never owner PIDs, never
  non-Prisma processes), discard the old manifest regardless of owner state, start fresh.
  If a non-Prisma process holds a port: clear terminal message naming port, process name
  and PID, and a structured failure (`port_in_use` + detected port) in the dev receipt.
  Route: delegated (writer). Trigger: 2+ non-trivial files. Commit `5bf9fa4`.
- [x] **T4b** Pairing popover shows the detected busy port: `dev.mjs` passes the receipt
  failure to Vite; the Prisma proxy answers unreachable requests with a JSON failure
  (reason + port); service/hook/popover show "Prisma no se pudo iniciar: el puerto <port>
  está en uso por otro programa." Port comes from data, never a UI literal. Also converted
  the 5 pre-existing voseo/tuteo strings in `PrismaPairingControl.tsx` to usted per the
  2026-09-23 decision. Route: delegated (same writer, after T1b). Commit `c4cf0f1`.

- [x] **T8** Convert all user-facing Spanish copy to formal usted (user decision
  2026-09-23; rule now in `AGENTS.md` §5 / `docs/CONVENTIONS.md`, commit `c53e97a`). Sweep
  hmi-app/src (labels, placeholders, tooltips, aria-labels, errors, empty states, toasts)
  and their tests, Prisma runtime fixed user-facing messages (Telegram bot replies,
  channel A messages) and their Python tests, and any LLM prompt instructing/exemplifying
  voseo. Never touch non-user-facing code/identifiers/comments/docs or `Directrices/`.
  Route: delegated (same writer). Commits `4a6b4a5` (prisma-runtime), `039bf14` (23 of 27
  hmi-app files, parent-committed), `02d9695` (remaining 4 hmi-app files + color-token fix).

- [x] **T4c** Manual test 2026-09-23 found two gaps in T4b: (1) with a foreign program on
  5057 the Vite proxy forwards to it (observed `404 File not found`, `server: SimpleHTTP`),
  so the proxy error handler never fires and the popover shows the generic copy without the
  port; (2) Vite clears the terminal on start, erasing the launcher's port-in-use message.
  Fix: when the launcher reported a startup failure, Prisma routes answer the failure JSON
  directly without forwarding; `clearScreen: false`. Route: delegated (writer). Commits
  `95d5d2a` (never-forward proxy fix), `f2ebf49` (clearScreen).

- [x] **T1c** Manual test 2026-09-23 (point 3) found reuse after an abrupt close (window
  closed with X, then relaunched) is silent: listeners on 5056/5057 survived (pids
  27000/5056, started 10:06:35/38) and were correctly reused at 10:11 (the dead owner
  reaped, new owner pid 12788 registered, Prisma worked, QR shown), but the terminal
  showed only Vite — `Invoke-PrismaStartTransaction`'s two reuse `return`s (manual runtime,
  and healthy identity-verified dev-owned runtime) never print anything. Fix: print the
  same green "is ready" lines as a fresh start, marked "(already running)", on both reuse
  paths; no other behavior change. Route: delegated (same writer). Commit `f34a8ad`.

- [x] **T4d** Manual test 2026-09-23 (point 4, with `python -m http.server 5057` occupying
  the port) found two remaining gaps after T4c: (1) `curl` against the proxy correctly
  returned the 503 `port_in_use` marker, but the popover still showed only the generic
  "Prisma no se pudo iniciar." — the session bootstrap (POST /api/prisma/session) got the
  same marker (T4c answers every Prisma route consistently) but threw a generic Error that
  discarded the detail, and `requestPairing`'s catch mapped it to `runtime_unreachable`
  with no port; T4b's tests never exercised this because they mocked the session client
  entirely. (2) The terminal printed 4 blocks of noise for one expected outcome: the clear
  line, then a full PowerShell uncaught-error record, then dev.mjs's ownership-recovery
  warning, then its generic "unavailable" warning. Fix A: shared
  `prismaRuntimeUnreachable` module; session bootstrap throws a typed, detail-carrying
  `PrismaRuntimeUnreachableError`; `requestPairing` recognizes it. Fix B: `start-local.ps1`
  exits cleanly via a top-level handler instead of an uncaught throw for this one case;
  `dev.mjs` skips the redundant recovery call and generic warning when the receipt already
  carries a structured failure. Route: delegated (same writer). Commits `9ad120d` (Fix A),
  `5cd10a5` (Fix B).

- [x] **T5b** Leaving admin must not end the admin session (user decision 2026-09-23).
  `AdminSessionLifecycle.tsx`'s route-leave effect (`if (previousWasAdmin && !currentIsAdmin)
  void controller.exit();`) ends the admin session on any `/admin` -> non-admin transition
  (Ver viewer, browser history), reversing T5's fix at the button level. This was the
  2026-09-18 PAC-4B design (`odd/tasks/prisma-protected-credentials.md` ~L215, ~L341); the
  user now explicitly reverses it: viewing is not logging out. New behavior: the admin
  session ends only via "Cerrar sesión" (and LoginOverlay's explicit exit), backend
  expiry/revocation, or other existing non-navigation paths — never by navigating away from
  `/admin`. Remove the route-leave exit effect (keep controller start/stop); update
  `AdminSessionLifecycle.integration.test.tsx`; update the PAC-4B statements in
  `odd/tasks/prisma-protected-credentials.md`. Route: direct (single file + its test).
- [x] **T9** Gemini credential block redesign + real key verification (user request
  2026-09-23). `VoiceCredentialSettings.tsx`'s Gemini row shows hardcoded
  "Verificación: no realizada" (backend `gemini_credentials.py` `status()` always returns
  `verified: False`, no verification exists). Required: two-column layout (title + API Key
  input/actions on the left, credential/verification status + "Verificar" button on the
  right), a fixed non-secret-derived mask when configured, and a real non-generating Gemini
  key verification call (admin-authenticated backend endpoint, Vite proxy route, frontend
  service/hook/UI). See full spec in the coordinator brief (routing doc, endpoint shape,
  copy). Route: delegated in spirit but executed by this same bounded writer (backend +
  proxy + frontend, 2+ non-trivial files). Commits (work units): `feat(prisma): verify the
  Gemini API key on demand` (backend + proxy + routing doc), `feat(admin): redesign the
  Gemini credential block with verification` (frontend).
- [x] **T9b** Gemini row: icons instead of status text, single-row layout (user feedback on
  T9 manual test, 2026-09-23). Current row (`56d7a32`) has "Credencial configurada" and
  "Verificada" as text, and "Verificar" full-width sitting lower than save/delete. New:
  single row `[API Key input] (credential icon) [save][delete]  ...  [Verificar] (verify
  icon)`, items-center, Verificar same height as save/delete. Credential icon:
  `CircleCheck`/`CircleX` (configured/not). Verification icon: `CircleCheck` (verified),
  `CircleX` (invalid_key), `WifiOff` (unreachable, warning token), `CircleDashed` (not
  verified yet, muted), `Loader2` spinning (verifying, button text stays "Verificando…").
  Each icon needs the former text as accessible name + `HoverTooltip` (T6 pattern). Only the
  Gemini row; tokens only. Route: direct (single file + its test).

- [x] **T9c** Gemini row refinements (user approved T9b's layout "quedó muy bueno";
  2026-09-23 follow-up feedback). (1) The disabled "Verificar" button (no credential
  configured) must show a `HoverTooltip` "Configure una API key para verificarla." on
  hover. (2) Icon changes: credential-not-configured icon `CircleX`→`MessageCircleWarning`
  (`text-status-warning`, "Estado Alerta" token, confirmed same as `--color-status-warning`
  via `DesignSettingsTab.tsx`); verification-verified icon `CircleCheck`→`Check`; verification
  not-yet-checked icon `CircleDashed`→`MessageCircleDashedCheck`; invalid_key/unreachable/
  verifying icons unchanged. `MessageCircleDashedCheck` requires `lucide-react` >= 1.47.0
  (installed 1.8.0 doesn't have it); upgrade within the same major
  (`npm install lucide-react@^1.47.0`), full suite + `tsc` + `lint` + `build` to catch any
  renamed/removed icon across the app, as its own commit before the UI commit. (3) Stop
  Chrome's password-manager generation/save prompts on the Gemini API Key input: research
  the reliable approach (`autocomplete="off"` alone is ignored by Chrome for
  `type="password"`); apply to the Gemini input only (Telegram/Canal A use a separate input
  block, not shared — confirm and note). Route: direct (single file + its test + a
  dependency bump commit).
- [x] **T9d** Gemini row: stable Verificar width + neutral Delete (user manual-test
  feedback, 2026-09-23). (1) "Verificar"/"Verificando…" currently reflow the row width;
  stack both labels in the same CSS grid cell (`grid-area:1/1`), inactive one
  `invisible`+`aria-hidden`, so the button's intrinsic width is always the longer label's
  width — no hardcoded pixel width (anti-hardcode dimensional policy). Accessible name
  stays the active label only; icon/spinner placement unchanged. (2) Delete-credential
  button (Gemini row only; Telegram/Canal A come in T10) must not use the red danger
  variant — same styling as Save. Route: direct (single file + its test).
- [x] **T10** Apply the approved Gemini row design (single row, block fieldset with
  floated legend, masked text input, credential icon, Save/Delete, tokens-only) to the
  Telegram and Canal A provider rows (user decisions 2026-09-23). Component:
  `VoiceCredentialSettings.tsx` (`renderProvider` → shared `renderTelegramFamilyProvider`
  reusing the new `CredentialFieldset` helper, also used by Gemini's row). Changes for
  BOTH rows (Canal A = `telegram_channel_a`; Telegram = `telegram`, channel B voice):
  (1) same layout as Gemini, reusing shared pieces (`CredentialFieldset`,
  `credentialConfiguredGlyph`, `StatusIcon`, `CREDENTIAL_KEY_MASK`), Gemini's own
  row/tests untouched; (2) removed "Aplicar cambio" and the pending/execution TEXT
  blocks — SAVE now applies (backend restarts the bot with the new token in the same
  request); DELETE already stopped the bot, confirmed unchanged; (3) execution status as
  ONE icon per row (Check/Loader2-spin/MessageCircleWarning/CircleX, plus Channel-A-only
  CircleDashed for a genuinely unconfirmed phase), mapped from existing status fields only
  (never inferred from "not running"); (4) NEW `botUsername` (string|null) exposed from
  Channel A status and the public `/health` route, shown as muted "@username" text when
  connected; (5) copy: Canal A legend "Canal A" / description "Canal privado de Telegram:
  se vincula con un QR y Prisma responde consultas sobre la interfaz." / field label
  "Telegram bot API Token"; Telegram legend "Telegram", no pre-existing description found
  (none invented); removed the now-false section description
  ("Guardar una credencial no la aplica..."); (6) tests updated across
  `VoiceCredentialSettings.test.tsx`, `GlobalSettingsDialog.voice.integration.test.tsx`,
  `adminCredential.types.test.ts`, `usePrismaCredentialAdministration.test.tsx`,
  `adminAuth.service.test.ts`, and Python (`channel_a_manager.py`, `channel_a_activation.py`,
  `telegram_lifecycle.py`, `admin_http.py`, `local_presentation.py` + their tests).
  Route: delegated in spirit but executed by this same bounded writer (backend + frontend,
  2+ non-trivial files). Commits (work units): `feat(prisma): apply Telegram credentials
  on save and expose bot usernames` (backend), `feat(admin): unify Telegram and Canal A
  credential rows with the Gemini design` (frontend).

- [x] **T11** Credential rows polish (user manual-test feedback, 2026-09-23).
  `VoiceCredentialSettings.tsx`: (1) same fixed input width (`w-full md:w-80`) on all three
  rows instead of each growing (`flex-1`) to fill its own row's leftover space. (2) extra
  bottom margin (`mb-3`) on the Canal A/Canal B description paragraphs, before the field
  label. (3) rename Telegram (channel B) row to "Canal B" (legend + group accessible name)
  and give it a description paragraph -- final copy pending from the parent, implemented
  with placeholder `CHANNEL_B_DESCRIPTION = 'TODO_CHANNEL_B_DESCRIPTION'`; frontend commit
  withheld until the real text arrives. (4) reorder rows: Proveedor de voz, Canal A, Canal B.
  (5) explicit per-provider `DELETE_CONFIRMATION_TEXT` map replacing `PROVIDER_LABELS`
  interpolation in the deletion dialog; `PROVIDER_LABELS` itself renamed to match ("Canal A",
  "Canal B", "proveedor de voz"). (6) Canal B bot: translated its last two English Telegram
  replies in `local_presentation.py` (`_handle_message`) to Spanish usted. Route: direct
  (single component + its tests, plus the separate Python fix). Backend commit
  `fix(prisma): reply in Spanish in the Canal B bot` (`5a2e86f`). Frontend commit
  `style(admin): align credential rows and rename Telegram to Canal B` (`ea99dcc`), using the
  user-approved Canal B description "Consultas a distancia por Telegram: Prisma responde por
  mensaje, sin necesidad de mirar la interfaz."

- [x] **T12** Drop screen-bound wording from Canal B bot replies (user decision
  2026-09-23): "presentación" must never appear user-facing; Canal B is remote personal
  Telegram queries without looking at a screen (`docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md`
  §1/§6.3). `local_presentation.py` `_handle_message`: reword the paired/ready/`/status`
  replies to drop "modo presentación"/"HMI visible"/"Local", keep the already-correct
  "ya está vinculado a otro chat" line (just drop "local"). Grep hmi-app + prisma-runtime
  user-facing strings for "presentación"/"Prisma Local" and report other hits. Route: direct.
  Commit `fix(prisma): drop screen-bound wording from Canal B replies` (`5692652`).
- [x] **T13** "Verificar" (non-sending token check) for Canal A and Canal B rows, same UX as
  Gemini's row (stable-width label stack, secondary variant, verification icon, disabled
  tooltip). Backend: admin-authenticated `POST .../telegram/verify` and
  `.../telegram_channel_a/verify` endpoints, non-sending `getMe`-only identity check (never
  `getUpdates`, never starts/stops/restarts the bot), refreshed `@username`, in-memory result
  reset on save/delete, 409 on concurrent verify, short timeout, never logs/returns the raw
  token or provider text. Proxy routes + `docs/prisma/PRISMA_BROWSER_ROUTING.md`. Frontend:
  wire Verificar + verification icon into both rows, decide and document row layout order.
  Route: delegated in spirit but executed by this same bounded writer (backend + proxy +
  frontend, 2+ non-trivial files). Commits: `feat(prisma): verify Telegram bot tokens on
  demand` (`6a91fab`, backend + proxy + docs), `feat(admin): add verification to Canal A and
  Canal B` (`218c203`, frontend), `fix(admin): add safe messages for Telegram and Canal A
  verification errors` (`21fe03a`, GGA follow-up).

- [x] **T14** Unified verify UX across the three rows (user decisions
  2026-09-23). Problem: in Canal A and Canal B the trailing content
  (`@username` + execution icon + "Verificar" text button + verification
  icon) wrapped to a second line under the input. Fix: harmonize all three
  rows onto ONE line: `[input] (credential icon) [Save] [Delete] [Verify ▶]
  <single result area>`. (1) Verificar is now an icon-only button (Lucide
  `Play`; `Loader2` spin while verifying), grouped with Save/Delete, same
  variant/size; accessible name "Verificar"/"Verificando…" via aria-label +
  HoverTooltip, disabled-with-tooltip when no credential. (2) ONE trailing
  result area (text + icon) replaces the old separate verification icon and,
  for Canal A/B, the separate `@username` + execution icon: Gemini shows its
  verification result directly (no live state to fall back to); Canal A/B
  show the live connection state by default and switch to the on-demand
  verification result after Verificar is clicked, with a successful result
  auto-reverting after `VERIFICATION_RESULT_DISPLAY_MS` (5000ms, new named
  constant -- no existing feedback/toast duration constant was semantically
  equivalent) while a failed result persists until the next verify, save, or
  delete. Not-yet-verified icon renamed `MessageCircleDashedCheck` ->
  `CircleDashedCheck` everywhere. (3) Coordinator mid-task addition: the
  three inputs keep one exact shared width and the result area reserves
  `min-w-[33ch]` (Telegram's 32-char username limit + "@"), sized so
  everything fits on one line at the panel's normal width. Width arithmetic
  (container chain read from each component's own source, no live browser
  available to this writer): AdminDialog panel `max-w-3xl` (768px) minus
  `p-6` (24px*2) = 720px; GlobalSettingsDialog content region minus `pr-2`
  (8px, right side only) = 712px; `VoiceCredentialSettings` section minus
  `p-4` (16px*2) = 680px; `CredentialFieldset` minus `p-3` (12px*2) = 656px
  row content width. Row items (6: input, credential icon, Save, Delete,
  Verify, result area; `gap-2` = 8px between each -> 5 gaps = 40px):
  credential icon ~18px; Save/Delete/Verify (`HmiButton size="sm"`,
  icon-only: `px-3*2` 24px + 14px icon + `border` 1px*2 = 40px each, 120px
  total); result area worst case, a pessimistic 8px/character estimate
  (body font-size is `--font-size-system` = 11px, `index.css`) for 33
  characters = 264px, plus its own `gap-1` (4px) and a 16px status icon =
  284px, rounded up to 290px for margin. Total non-input: 40 + 18 + 120 +
  290 = 468px -> 656 - 468 = 188px left for the input; chose `md:w-44`
  (176px), a 12px safety margin against this pessimistic estimate (real
  character widths at 11px are typically ~6-7px, not 8px, so the true
  margin is larger in practice). Route: direct (single component + its
  tests). Commit `style(admin): unify credential verification into grouped
  icon buttons` (`8b2fb6e`).

- [x] **T15** From the user's manual test of T14 (`8b2fb6e`), with two mid-task coordinator
  additions (below). (1) Clicking Verify in one row disabled ALL rows' Save/Delete/Verify:
  `usePrismaCredentialAdministration.ts`'s `runOperation` used one global
  `operationRef`/`pendingAction`, and the panel-level `disabled` flag read it. Verification is
  read-only per provider (backend already 409s a concurrent same-provider verify); moved verify
  OUTSIDE the global mutation lock into its own `runVerify`, with per-provider
  `verifyOperationsRef`/`verifyGenerationRef`/`verifyingProviders`, so only the pressed row's own
  Verificar disables itself -- other rows' Save/Delete/Verify stay fully usable. **Decision**: a
  same-row Save/Delete during that row's own in-flight verify IS allowed (verification is
  read-only, does not conflict with a mutation); `saveCredential`/`deleteCredential` bump that
  provider's `verifyGenerationRef` so a still-in-flight verify's result is discarded (thrown as
  `AbortError`, already-ignored by the caller) once it resolves late. (2) The pressed Verify
  button no longer swaps to a spinner -- it keeps its Play icon, just `disabled`; "Verificando…"
  is text-only in both the button's accessible name and the result area (no `Loader2` anywhere
  in this component any more). (3) Coordinator's first mid-task addition (superseding the
  original narrower ask): the result area shows an icon ONLY for a `tone: 'success'` state (the
  green `Check`) -- every other state (not-yet-verified, invalid/unreachable, connecting,
  stopped, unconfirmed, in-flight) is text only, tinted by tone; the separate credential-presence
  icon between the input and Save is unaffected. (4) Backend root-cause diagnosis (no service
  starts/stops, tests only) -- **root cause** (file:line): `channel_a_lifecycle.py`'s
  `ChannelARunner._terminal_fail()` (608-614) sets `phase='failed'` from the managed loop's OWN
  background thread; `channel_a_manager.py`'s `_record_error()` (167-169), the only setter of
  `manager._last_error`, is called ONLY from `_mutation()`'s except path and `status()`'s own
  exception handler -- neither ever observes that background failure, since `_observe()`
  (183-203) treats a valid `ChannelAStatus` with `phase='failed'` as a SUCCESSFUL observation.
  So a genuinely, terminally failed activation (this module's own "no retry" design) reports
  `lastError: None` alongside `activation.phase == 'failed'`; the pre-T15 frontend checked
  `lastError` first and then lumped a bare `'failed'` phase into the same ambiguous "Estado no
  confirmado" bucket as a truly unknown state. Reproduced in
  `test_a_background_activation_failure_is_not_reflected_in_manager_last_error`
  (`test_channel_a_manager.py`) before any fix. **Fix**: frontend-only for the
  failed-vs-unconfirmed split (`channelAConnectionResult` now checks `phase === 'failed'`
  independently of `lastError`, promoting it to the same critical "No se pudo conectar el bot"
  text; only `'retired'` or a running phase with a pending restart stays "Estado no confirmado").
  Separately, added a real `paired` signal (`ChannelAPairingRegistry.has_any_link()` ->
  `ChannelAActivation.has_paired_owner()` -> `ChannelAManager.status()`'s new `paired` field,
  gated exactly like `botUsername` -- only meaningful while running without a pending restart)
  through `admin_http.py`'s `ADMIN_CHANNEL_A_STATUS_FIELDS` to the frontend domain type.
  **Coordinator's second mid-task addition, final decision**: the live connection display
  ALWAYS shows "@username" + Check when healthy/connected (paired or not) -- `paired` is used
  ONLY in the post-Verificar transient message (Canal A: "Bot vinculado" / "Bot disponible, sin
  vincular", text only, muted, for `VERIFICATION_RESULT_DISPLAY_MS`, then reverts to the
  connection display; Canal B has no reliable paired signal, so its verify-success stays the
  generic "@username" + Check, per the coordinator's own explicit fallback). **Coordinator's
  third mid-task addition**: Gemini's resting result-area state now shows the assigned TTS model
  name (`gemini_credentials.py`'s `GEMINI_VERIFY_MODEL`, exposed non-secret via
  `admin_http.py`'s `_provider_metadata`/`admin_gemini_verify` as a new `model` field, never
  hardcoded on the frontend) instead of "Verificación: no realizada"; a successful verify shows
  "Verificado" + Check transiently, then reverts to the model name (still green/Check, since the
  credential stays verified); invalid_key/unreachable persist as before. Route: direct (single
  bounded writer, per coordinator instruction). Commits (work units):
  `fix(admin): verify credentials per row without locking the panel` (`a1c0a9b`),
  `fix(prisma): expose Canal A pairing state and the Gemini TTS model in admin status`
  (`819a08f`), `style(admin): show only a success icon in the result area, with per-row
  verify and Canal A pairing/Gemini model copy` (`36ba072`).

## Acceptance criteria

1. After an abrupt close, relaunching starts Prisma normally with no proxy errors.
2. Runtime down => popover says clearly that Prisma could not start.
3. Launcher prints "Prisma voice is ready at ..." and "Prisma is ready at ...".
4. Channel A applied once stays active across launcher restarts; popover text matches login style.
5. "Ver viewer" keeps the admin session.
6. Credentials section: horizontal provider rows, icon-only save/delete.
7. Running the launcher always starts Prisma, however the previous run ended (Ctrl+C,
   window X, shutdown), unless a non-Prisma program holds a port.
8. In that case the terminal names the port/process and the popover shows the detected port.

## Progress

- 2026-09-23: exploration mapped all six items; branch created; tracker created.
- 2026-09-23: T1 done. Added `Test-PrismaStaleDevelopmentManifest` in
  `process-ownership.ps1` (fail-closed: every recorded owner proven `dead`,
  no manifest process resolves to a verified live listener, and neither
  port 5056/5057 has any listener at all; parse errors, foreign repo root,
  missing ownership, or any alive/unknown owner all refuse). Wired into
  `start-local.ps1`'s dev-acquisition guard: on stale, removes the manifest
  under the existing lock, warns "Removed stale Prisma Local manifest left
  by an abrupt shutdown.", and falls through to the normal fresh start;
  otherwise keeps today's refusal untouched. `release-dev-local.ps1`
  confirmed unaffected (its own `Get-PrismaCanonicalManifest
  -RequireCompleteRuntime` already returns null and no-ops on dead
  processes). RED: 2 new tests failed on missing helper / old refusal
  message (3rd new test already passed pre-change, since it pins today's
  refusal for an alive owner). GREEN: all 3 new tests pass; full
  `test_runtime_safety` + `test_operations` (49 tests) pass. Commit
  `8d9c0b7`.
- 2026-09-23: T2 done. `start-local.ps1` now prints "Prisma is ready at
  http://127.0.0.1:5057." (voice line unchanged). Added a static-source
  assertion test (RED verified by temporarily reverting the string, then
  reapplied). GREEN: 49 tests pass. Commit `9cc6627`.
- 2026-09-23: T3 done. Added `ChannelAManager.startup_apply()` in
  `channel_a_manager.py`, mirroring `TelegramLifecycleManager.startup_apply()`:
  gate is "channel A credential configured" (channel A has no separate
  enabled toggle the way Telegram does; credential presence is the
  equivalent signal, and it already implies `desired_generation >= 1` since
  `save_credential` is the only path that sets it, so no separate
  generation check was needed) -- if absent, pure no-op (status untouched);
  if present, delegates to the existing `apply()` (same path admin "Aplicar
  cambio" uses), which internally starts a background thread exactly like
  Telegram's `candidate.start()`, so no new threading was needed; any
  `ChannelAManagerError` is caught and captured in status, never raised.
  Wired into `local_presentation.main()` next to
  `telegram_manager.startup_apply()`; updated the now-inaccurate "A stays
  inert" comment; confirmed `channel_a_manager.stop()` was already present
  in `main()`'s `finally` block (no change needed). RED: 3 new unit tests
  in `test_channel_a_manager.py` failed (`AttributeError`), 1 new static
  wiring test in `test_local_presentation.py` failed, and updating the
  implementation surfaced 2 pre-existing pinning tests in
  `test_channel_a_root.py` that explicitly asserted channel A stayed inert
  at startup (`test_main_starts_b_without_applying_a...`) -- updated those
  two tests and the class docstring to match the explicit 2026-09-23 user
  decision reversing that constraint (same pattern as T1's reversal of the
  PW-005 exclusion). GREEN: all new/updated tests pass; full channel_a
  suite (731 tests) + `test_local_presentation` (16 tests) pass; full repo
  suite (1134 tests) passes. Commit `94e5ec1`.

- 2026-09-23: T4 done. Checked Vite 7's proxy middleware default error handler
  (`hmi-app/node_modules/vite/dist/node/chunks/config.js`, `proxy.on('error', ...)`):
  on ECONNREFUSED it never rejects the fetch, it writes a bare
  `res.writeHead(500, { 'Content-Type': 'text/plain' }).end()` with no body,
  since `vite.prismaProxy.config.ts` defines no per-route error `configure`
  handler for the pairing route. Added error kind `runtime_unreachable` to
  `ChannelAPairingErrorKind` (`domain/channelAPairing.types.ts`) and mapped it
  in `prismaChannelAPairing.service.ts`'s `requestPairing()`: any rejected
  `fetch()` (network failure, never reached the runtime), and any non-2xx
  response whose body fails JSON parsing (the dev proxy's own failure page,
  documented in a code comment), map to `runtime_unreachable`; a non-2xx
  response with a *valid* JSON body (including 409 conflict variants) keeps
  the existing `unavailable` kind untouched — the runtime was reached either
  way. `useChannelAPairing.ts`'s `runRound` catch now branches on
  `isRuntimeUnreachable()` before the generic fallback: sets phase
  `'unreachable'`, clears the QR, and calls `schedulePoll()` so polling keeps
  retrying (unlike the generic terminal `'error'` phase, which still stops
  until close/reopen — unchanged). `PrismaPairingControl.tsx`: added the
  `'unreachable'` case to `pairingStatusCopy()` ("Prisma no se pudo
  iniciar."), with an optional muted hint line ("Reiniciá el lanzador para
  volver a intentarlo.") shown only for that phase; replaced the raw
  `<button>` "Cerrar" with `HmiButton variant="primary" fullWidth` (same as
  `LoginOverlay`'s "Ingresar"), and changed every status/QR paragraph from
  `text-sm text-industrial-text-soft` to `text-industrial-muted` (no
  `text-sm`), mirroring `LoginOverlay`'s label classes exactly. RED:
  3 new service tests failed (rejected fetch, empty-body 500, plain-text 502
  all expected `unavailable`, got default old mapping); 1 new hook test
  failed (expected phase `'unreachable'`, got `'error'`); 1 new component
  test failed (copy not found, switch had no case yet). GREEN: service 29/29,
  hook 14/14, component 11/11; full `npm test` 209 files / 2196 tests pass;
  `tsc -b --noEmit` and `eslint` clean. GGA: PASSED (two optional style notes,
  no fixes required). Commit `46c95a2`.
- 2026-09-23: T5 done. Checked for a real invariant requiring
  `controller.exit()` before viewing: `RequirePermission` only guards
  `/admin` (checks `session.isAuthenticated` + `admin:access`); the `/`
  viewer route in `app/router.tsx` carries no permission guard at all, and
  no other route guard, shield-reveal call or session check depends on the
  admin session being cleared to view it. Concluded the `exit()` call on
  "Ver viewer" was not protecting any invariant (a copy/paste artifact next
  to "Cerrar sesion"'s real logout) and removed it from `AdminLayout.tsx`,
  keeping only `navigate('/')`; "Cerrar sesion" keeps calling
  `controller.exit()` unchanged. Updated the existing pinned test (previous
  T1/T3-style reversal) from "suspends the admin session before navigating"
  to assert `logoutMock` is NOT called. RED: updated test failed (logoutMock
  called once). GREEN: `AdminLayout.test.tsx` 4/4; full `npm test` 209/2196
  pass; `tsc -b --noEmit` and `eslint` clean. GGA: PASSED. Commit `5fb8801`.
- 2026-09-23: T6 done. Restructured `VoiceCredentialSettings.tsx`: outer
  `grid gap-3 md:grid-cols-2` -> `flex flex-col gap-3` (one full-width row
  per provider, stacked vertically); each provider `<fieldset>` is now
  `flex flex-col ... md:flex-row md:items-start md:gap-4` with three
  sub-columns (identity/state on the left `md:w-56`, credential input +
  icon-only actions in the middle, apply status/action on the right
  `md:w-64`, rendered whenever `provider === 'telegram' || isChannelA` so
  the always-present Channel A "Aplicar cambio" button, including its
  pending/disabled state, is unaffected); status label/value blocks changed
  from `grid grid-cols-2` to `flex flex-wrap gap-x-4 gap-y-1` so pairs read
  on one line where space allows. Save/Delete credential buttons are now
  icon-only (`<Save>`/`<Trash2>` only, no text children) with
  `aria-label`/`title` set to their original text ("Guardar credencial" /
  "Eliminar credencial") so every existing `getByRole('button', { name })`
  query keeps working unchanged, wrapped in the project's existing
  `HoverTooltip` primitive (`position="top"`) for the hover label; kept
  `variant="primary"`/`"danger"` styling and existing disabled logic
  untouched. `HmiButton` already spread `...props` (including
  `aria-label`/`title`) via `ButtonHTMLAttributes`, so no passthrough change
  was needed there. Kept "Aplicar cambio", "Actualizar estado", "Confirmar
  eliminación" as text buttons (unchanged) per the task's default. RED: new
  test (icon-only buttons keep accessible names) failed — `save.textContent`
  was "Guardar credencial", not empty. GREEN: `VoiceCredentialSettings.test.tsx`
  28/28 (27 pre-existing + 1 new, none needed rewriting); full `npm test`
  209/2196 pass; `tsc -b --noEmit` and `eslint` clean. GGA: PASSED (three
  optional notes: mixed Spanish register across the file pre-existing and
  out of scope, a possible `errorCodeText` helper, and a pre-existing
  possible duplicate stale-warning line — none are regressions from this
  task). Commit `2d954d8`.

- 2026-09-23: parent spot checks: backend `test_runtime_safety` + `test_channel_a_root`
  55/55 OK; frontend focused pairing/layout vitest 16/16 OK. User decisions: launcher must
  start Prisma "si o si" (T1b); popover must show the detected busy port (T4b); ports
  5056/5057 stay fixed across the stack (no configurable-ports task).

- 2026-09-23: T1b done. `process-ownership.ps1`: removed T1's now-redundant
  `Test-PrismaStaleDevelopmentManifest` (owner liveness is no longer relevant to the
  recovery decision at all); added `Resolve-PrismaPortState` (one Get-NetTCPConnection
  call per port, classifies `free` / `ours` (verified this repo's Prisma module,
  stoppable) / `foreign` (never a stop target)) and `Test-PrismaDevelopmentRuntimeHealthy`
  (single-attempt /health check on both ports, no retry loop, distinct from
  Wait-VoiceReady/Wait-PresentationReady's polling). `start-local.ps1`'s
  `Invoke-PrismaStartTransaction`: dev-owned canonical manifest is now reused only when
  BOTH `Test-PrismaDevelopmentRuntimeIdentity` AND `Test-PrismaDevelopmentRuntimeHealthy`
  pass (previously identity alone, and an identity mismatch threw instead of recovering);
  manual (no `developmentOwnership`) manifests keep today's unconditional reuse. Every
  other case (missing/partial/ambiguous/unhealthy/identity-mismatched manifest, or no
  manifest at all) now recovers instead of refusing or throwing: scans 5056/5057 first
  (before touching anything) for a non-Prisma occupant -- if found, throws a message
  naming port/process-name(or "another program")/PID and writes a structured
  `{registered:false, failure:{reason:'port_in_use', port, processName, pid}}` dev receipt
  (documented inline; consumed by dev.mjs in T4b) -- otherwise stops only verified Prisma
  listeners of this repo, waits briefly for the ports to free, discards the old manifest
  regardless of owner state, and warns once. Owner liveness (dead/unknown/alive) plays no
  role in this decision anymore (test still proves no owner pid is ever a stop target).
  Tests: removed the now-obsolete `Test-PrismaStaleDevelopmentManifest` unit test; reversed
  `test_start_local_still_refuses_when_owner_liveness_is_not_provably_dead` into
  `test_start_local_always_recovers_a_dev_owned_manifest_regardless_of_owner_liveness`
  (dead/alive/unknown, parametrized); rewrote the partial-manifest refusal test into
  `test_partial_owned_manifest_now_recovers_instead_of_refusing`; added
  `test_start_local_stops_leftover_verified_listeners_with_no_manifest_and_recovers`,
  `test_start_local_reuses_a_healthy_verified_runtime_without_stopping_or_starting`,
  `test_start_local_recovers_an_identity_verified_but_unhealthy_runtime`,
  `test_start_local_reports_and_never_stops_a_foreign_process_holding_a_port`,
  `test_start_local_reports_another_program_when_the_occupant_name_cannot_be_resolved`;
  added a healthy `Invoke-RestMethod` stub to the 3 pre-existing dev-reuse tests that now
  exercise the new health check (`_assert_failed_receipt_handoff_rolls_back`,
  `test_concurrent_acquisitions_...`, `test_warm_acquisition_...`). RED observed via actual
  failing runs while iterating (3 then 1 genuine failures from miscounted
  Get-NetTCPConnection call budgets across the new port-state/health-check paths, fixed by
  recomputing exact call counts per scenario, never by loosening an assertion). GREEN: full
  `test_runtime_safety` + `test_operations` 53/53; full repo `unittest discover` 1138/1138.
  Commit `5bf9fa4`.
- 2026-09-23: T4b implemented and GREEN, but NOT committed -- see "T4b commit blocked"
  below for the exact conflict needing a decision.
  `hmi-app/scripts/dev.mjs`: `acquire()` now inspects the dev receipt (before the
  `finally` block deletes it) when `start-local.ps1` exits non-zero, via
  `parsePrismaStartupFailure()` (validates `registered===false`, `reason` in a known set,
  `port` an integer 1-65535); a valid failure is attached as `.failure` on the thrown
  Error. `runDevelopment` reads `.failure` off a caught acquisition error and forwards
  `{PRISMA_STARTUP_FAILURE: JSON.stringify(...)}` as `extraEnvironment` to `spawnVite`;
  `createViteLauncher` only overrides the child's `env` (merged with `process.env`) when
  `extraEnvironment` is non-empty, otherwise unchanged inheritance. `vite.prismaProxy.
  config.ts`: every route's `configure` now also registers `proxy.on('error', ...)`
  (previously only `stripSessionCapability` routes had a `configure` at all), answering a
  JSON 503 `{error:'prisma_runtime_unreachable'[, reason, port]}` (reading
  `PRISMA_STARTUP_FAILURE` via `readPrismaStartupFailure()`, same validation as dev.mjs)
  instead of Vite's bodiless default 500, guarded on `headersSent`. Domain/service: added
  `ChannelARuntimeUnreachableDetail` to `channelAPairing.types.ts`; `PrismaChannelAPairingError`
  gets an optional `.detail`; `requestPairing()` recognizes the proxy's JSON marker
  (`isRuntimeUnreachableMarker`) and maps it to `runtime_unreachable` with
  `parseRuntimeUnreachableDetail()` BEFORE the 409/unavailable branches, so it takes
  precedence over T4's "non-2xx with valid JSON = unavailable" rule as required. Hook:
  `useChannelAPairing` adds `unreachableDetail` state (set from
  `runtimeUnreachableDetailOf(error)` alongside phase `'unreachable'`; cleared on every
  other phase transition and on session reset) and returns it. Component: `pairingStatusCopy`
  takes the detail and calls `runtimeUnreachableCopy()`, which renders "Prisma no se pudo
  iniciar: el puerto {port} está en uso por otro programa." only when
  `detail?.reason === 'port_in_use'` (port always from data), else keeps T4's generic copy;
  T4's hint line and retry-polling behavior are unchanged. Audited every other
  `/api/prisma/*` consumer (session bootstrap, voice events poll, TTS live, snapshot,
  voice-config adapter, admin auth/credentials) for the 500-bodiless -> 503-JSON change:
  all either check `!response.ok` before ever touching the body, or (session bootstrap)
  end up throwing the same generic error regardless of body shape -- no regressions.
  RED verified per file by stashing only that file's implementation (git stash push -- <file>,
  run its test file, git stash pop) and observing the exact new/updated tests fail for
  `dev.mjs` (5), `vite.prismaProxy.config.ts` (9), `prismaChannelAPairing.service.ts` (5),
  `useChannelAPairing.ts` (2), `PrismaPairingControl.tsx` (1) -- domain type additions have
  no independent RED (structural). GREEN: full `npm test` 209 files / 2224 tests pass;
  `npx tsc -b --noEmit` clean; `npm run lint` clean.

  **T4b commit blocked (needs a decision):** `git commit` for T4b was refused by the
  repo's GGA pre-commit hook (Claude-provider code review against `AGENTS.md`), which
  reviews each staged file's FULL current content, not just the diff. It flagged 5
  PRE-EXISTING voseo/tuteo strings in `PrismaPairingControl.tsx` that T4/T1b never touched
  ("Configurá...", "Revisá...", "Reiniciá el lanzador...", "Confirma el destino...",
  "Escanea el código QR..."), citing AGENTS.md's usted-register rule. The new T4b string
  ("Prisma no se pudo iniciar: el puerto...") is already correct usted per the 2026-09-23
  coordinator instruction, which also explicitly said NOT to rewrite the pre-existing
  voseo strings in this file (a separate task owns that conversion, to avoid overlap).
  Fixing the hook's finding would mean rewriting those 5 strings against that explicit
  instruction; leaving them means the commit stays blocked. No `--no-verify` was used (not
  authorized). All T4b files remain staged, uncommitted, working tree otherwise clean.
  **Needs a decision:** (a) authorize fixing the 5 pre-existing strings in this file as
  part of the T4b commit (overrides the "leave voseo alone" instruction for this one
  file), or (b) run the separate voseo-conversion task first then retry this commit, or
  (c) some other resolution (e.g. hook scope/config change) -- out of this writer's
  authority to decide.

- 2026-09-23: T4b committed (`c4cf0f1`) after the coordinator decided option (a): fixed
  the 5 pre-existing voseo/tuteo strings in `PrismaPairingControl.tsx` as part of the T4b
  commit ("Configurá"->"Configure", "Revisá"->"Revise", "Reiniciá el lanzador..."->
  "Reinicie el lanzador...", "Confirma el destino..."->"Confirme el destino...",
  "Escanea...confirma..."->"Escanee...confirme..."), updated the 5 matching test
  assertions (RED confirmed against the unfixed source, then GREEN). Full `npm test`
  209/2224 pass (one unrelated Dashboard.test.tsx flake reproduced only under full-suite
  parallelism, confirmed passing in isolation and on suite re-run); `tsc -b --noEmit` and
  `eslint` clean. GGA PASSED with 2 non-blocking notes (pre-existing `PrismaStartupFailure`
  type/range-check duplication between the Vite proxy and the service; pre-existing fixed
  `QRCodeSVG size={256}` that `className="h-auto w-full"` already overrides) -- neither
  touched, out of scope.

- 2026-09-23: T8 started. Swept hmi-app/src and services/prisma-runtime/src for voseo
  (vos/-és/-á imperatives, "sos", "vos") and tuteo (tú conjugations, "tu/tus/te") in
  user-facing Spanish, using layered ripgrep passes (curated verb lists, word-final
  á/é/í case-sensitive AND case-insensitive, tú-conjugation list, "¿...querés/podés/
  tenés/deseás...?" questions) plus manual review of every hit to exclude JSDoc/code
  comments, names ("José", "Rodó"), demonstratives ("estas reglas"), nouns ("haces" =
  beams), and infinitives (already-correct impersonal forms like "Dejar vacío para
  deshabilitar."). Fixed 27 hmi-app source files (dialogs, admin panels, EPPI viewer
  mock fixtures, HierarchyPage, DashboardBuilderPage/DashboardManagerPage, LoginOverlay,
  ErrorState, hierarchyResolver's empty-reason copy, adminSession rate-limit message,
  templateAspectMismatch) and their test files where a test pinned the literal old text
  (LoginOverlay, Dashboard, EppiViewer, VoiceCredentialSettings +
  GlobalSettingsDialog.voice.integration, TemporalSettingsTab, NodeTypeConfigDialog,
  PropertyDock -- 8 test files updated in total); most other hits (HierarchyPage,
  DashboardManagerPage, DashboardBuilderPage, LoaderOptionsSettingsTab, ErrorState,
  adminSession.controller, templateAspectMismatch, hierarchyResolver, ADMIN_CONVENTIONS.md)
  had no test pinning the literal string (source-only fix). Fixed 3 services/prisma-runtime
  Python files (`channel_a_bot.py`'s `CONFIRMATION_PROMPT_TEMPLATE`/`WELCOME_TEMPLATE`/
  `COPY_DESTINATION_UNAVAILABLE`/`COPY_ACTION_REFUSED`/`COPY_INACTIVITY_WARNING`,
  `channel_a_query.py`'s `COPY_QUERY_UNAVAILABLE`, `local_presentation.py`'s two Telegram
  `/start`/`/help` replies); every Python test referencing these messages imports the
  constant rather than hardcoding the literal, so no test needed changes (verified before
  editing). Searched for an LLM/Gemini system prompt instructing or exemplifying voseo:
  none found -- `voice_service.py`'s `build_tts_prompt` is an English audio-synthesis
  instruction to the TTS model, and the local Q&A answers (`answer_from_snapshot`) are
  deterministic Python string templates, not an LLM call. Prisma runtime GREEN: full
  `python -m unittest discover` 1138/1138 (no test needed updating, but full suite run
  as a safety check anyway). Commit `4a6b4a5`.

  hmi-app commit **also blocked** by the same class of pre-existing-content GGA finding
  as T4b's first attempt, but on a NEW set of files: `ErrorState.tsx` (line 29,
  `bg-[#1a0b0f]` raw hex instead of a token), `DashboardManagerPage.tsx` (default
  Tailwind palette `hover:bg-violet-500/20`/`hover:text-violet-400` and
  `hover:bg-red-500/20`/`hover:text-red-400` on two action buttons instead of the
  project's `--color-status-critical` token already used elsewhere in the same file for
  an equivalent button), and `PropertyDock.tsx` (`group-hover:drop-shadow-[0_0_5px_rgba(
  255,255,255,0.4)]` hardcoded in every legacy toggle, instead of reusing the file's own
  token-based `TREND_CHART_V2_TOGGLE_LABEL_CLS` pattern). GGA confirmed the usted
  conversion itself is correct in all 18 reviewed files and flagged no remaining voseo/
  tuteo. Per this task's explicit instruction ("fix only register issues; if it flags
  other unrelated pre-existing issues in a file you touched only for copy, stop and
  report the exact output instead of expanding scope"), none of these 3 hardcoded-color
  findings were touched -- they predate this task and are unrelated to register. All 27
  hmi-app files remain staged, uncommitted. GGA also left 2 non-blocking notes (missing
  accents on some pre-existing words like "Duracion"/"Miercoles"/"Todavia"/"Cerrar
  sesion", and fixed default dates in `EppiLabelDialog.tsx`'s `FIELD_SETS`) -- also
  pre-existing, also untouched.

- 2026-09-23 (parent): committed 23 of the 27 staged hmi-app T8 files as `039bf14`
  (GGA PASSED; notes: missing accents in some strings, English info-card defaults — both
  outside register scope). Held back, still unstaged-modified with usted changes:
  `ErrorState.tsx`, `DashboardManagerPage.tsx`, `PropertyDock.tsx` + test, because GGA
  flags pre-existing hardcoded colors there. T4b checked (`c4cf0f1`).

- 2026-09-23: T8 finished (user authorized fixing the 3 pre-existing hardcoded-color
  spots). Chose the token for each by intent, reusing existing `--color-*` tokens only
  (no new token added):
  - `ErrorState.tsx`: `bg-[#1a0b0f]` -> `bg-accent-ruby/10`. Verified this is not a
    cosmetic swap: `#ef4444` (accent-ruby) alpha-blended at 10% over `--color-industrial-bg`
    (`#05070a`) computes to ~`#1c0d10`, matching the documented literal `#1a0b0f` within
    rounding — the same token+opacity pattern `bg-accent-ruby/10`/`bg-accent-cyan/10`
    already used for status tints elsewhere (`AlertsPage.tsx`). `docs/DESIGN_SYSTEM.md`
    (root) explicitly names raw hex as the theming-break problem GGA flagged; the
    per-status hex table in `hmi-app/src/styles/design-system.md` documents the
    *resulting* color, not a mandate to hardcode it.
  - `DashboardManagerPage.tsx`: "Guardar como Template" `hover:bg-violet-500/20
    hover:text-violet-400` -> `hover:bg-accent-pink/20 hover:text-accent-pink` (matches
    the TEMPLATE `AdminTag`'s own `variant="pink"` color, right next to this button in the
    same row). "Eliminar" `hover:bg-red-500/20 hover:text-red-400` -> `hover:bg-white/10
    hover:[color:var(--color-status-critical)]`, mirroring the sibling "Eliminar template"
    button in the same file exactly (the pattern GGA cited as proof a token exists).
  - `PropertyDock.tsx`: all 14 occurrences of `group-hover:drop-shadow-[0_0_5px_rgba(
    255,255,255,0.4)]` -> `group-hover:drop-shadow-[0_0_5px_var(--color-industrial-text)]`,
    same structure as the file's own token-based `TREND_CHART_V2_TOGGLE_LABEL_CLS`
    (`drop-shadow-[0_0_5px_var(--color-admin-accent)]`), just swapping the token to match
    these toggles' existing white-family text color instead of extracting a new shared
    constant (kept the fix minimal, no unrequested refactor).
  Reasoned that true hunk-level two-commit splitting (color-only then usted-only) was not
  achievable without GGA re-flagging the *other* unfixed axis at the intermediate commit
  (GGA reviews full staged file content fresh each time, not a diff), so used the
  coordinator-authorized single-commit fallback for these 4 files. Focused
  `PropertyDock.test.tsx` + `DashboardManagerPage.test.tsx` 94/94; full `npm test`
  209 files / 2224 tests; `tsc -b --noEmit` and `eslint` clean. GGA PASSED (2 non-blocking
  notes: `hover:[color:var(...)]` vs the more common `hover:text-status-critical` form,
  and pre-existing English info-card copy in `PropertyDock.tsx` — neither touched).
  Commit `02d9695`.

- 2026-09-23: T4c done. Root cause of gap 1: a foreign process holding 5056/5057 IS a real
  TCP listener, so the Vite proxy middleware forwarded to it successfully (observed live:
  `curl http://127.0.0.1:5173/api/prisma/channel-a/pairing` -> `HTTP/1.1 404 File not
  found`, `server: SimpleHTTP/0.6 Python/3.14.7`, HTML body) and the `proxy.on('error')`
  handler from T4b never fired, since no connection error ever occurred. Verified the exact
  mechanism against Vite's own proxy middleware source
  (`node_modules/vite/dist/node/chunks/config.js`, `viteProxyMiddleware`): when a route's
  `bypass` returns `false`, Vite trusts the response was already written and never calls
  `proxy.web()` — the same mechanism the existing 405 method-rejection code already used.
  `vite.prismaProxy.config.ts`: moved the `PRISMA_STARTUP_FAILURE` read to run once at
  `createPrismaProxyConfig()` build time (not per-request); `bypass` now checks it FIRST,
  before the method allowlist — when present, every route answers the same
  `{error:'prisma_runtime_unreachable', reason, port}` JSON 503 directly via
  `response.end()` and returns `false`, for every method (including ones the route would
  otherwise 405), so proxying is never attempted. The `on('error')` handler is unchanged
  and still covers the no-detected-failure case (runtime genuinely down, nothing at all
  listening). Root cause of gap 2: Vite clears the terminal on dev server start by default
  (`clearScreen: false` is the documented off-switch), erasing `start-local.ps1`'s own
  "Prisma could not start: port ... is in use by ..." warning that `dev.mjs` prints before
  ever spawning Vite. Chose `hmi-app/vite.config.ts` over routing it through `dev.mjs`'s
  spawn args: `clearScreen` is Vite's own native top-level config key (documented at
  vite.dev/config/shared-options.html#clearscreen), so setting it directly in the config
  Vite already reads is simpler and needs no new plumbing through the launcher. Added
  `hmi-app/vite.config.test.ts` (new file): imports the config's default export, resolves
  it (it's a `({mode}) => {...}` function) and asserts `clearScreen: false` on the
  resolved object — a real behavioral assertion, not a source-string match.
  RED verified per file (stash the one implementation file, run its tests, confirm the
  new/updated tests fail, pop): `vite.prismaProxy.config.ts` (5 new T4c tests fail with
  the old bypass, 59 pre-existing pass unaffected); `vite.config.ts` (the new
  `vite.config.test.ts` fails, showing the actual resolved config object missing
  `clearScreen`). GREEN: focused run of all 6 touched/related test files (proxy config,
  vite config, pairing service/hook/component, dev.mjs) 152/152; full `npm test`
  210 files / 2231 tests; `tsc -b --noEmit` and `eslint` clean.
  Commit `95d5d2a` (never-forward proxy fix; GGA PASSED, 2 non-blocking notes: the 503
  body is built twice — once in `bypass`, once in `on('error')` — a shared helper could
  dedupe it; the `127.0.0.1:505x` target strings repeat 18 times and could become named
  constants — neither touched, pre-existing pattern, not requested).
  Commit `f2ebf49` (`clearScreen: false` + its test; GGA PASSED, no notes).

- 2026-09-23: T1c done. Confirmed the underlying reuse/reap behavior observed by the user
  was already correct (listeners survived the abrupt close, the dead owner was reaped, the
  new owner registered, Prisma worked) — only the terminal feedback was missing, because
  both reuse `return`s in `Invoke-PrismaStartTransaction` (manual-runtime reuse around line
  116, and healthy identity-verified dev-owned reuse around line 124) never printed
  anything, unlike the fresh-start path a few lines below. Added
  `Write-Host 'Prisma voice is ready at http://127.0.0.1:5056 (already running).'` and
  `Write-Host 'Prisma is ready at http://127.0.0.1:5057 (already running).'`
  (`-ForegroundColor Green`, matching the fresh-start lines exactly except for the
  "(already running)" suffix) immediately before each reuse `return`; no other behavior
  change. Extended the two existing reuse tests (`test_manual_canonical_runtime_is_reused_
  without_start_or_stop_ownership`, `test_start_local_reuses_a_healthy_verified_runtime_
  without_stopping_or_starting`) with `assertIn` checks against `result.stdout` for both
  new lines, rather than adding a separate test, since `Write-Host` output is already
  captured in `result.stdout` for these PowerShell subprocess invocations (confirmed by
  the pre-existing `Write-Warning` lines already visible in that same stdout capture).
  RED: both assertions failed against the unmodified source (the reuse paths printed
  nothing beyond the pre-existing owner-identity warnings). GREEN: `test_runtime_safety` +
  `test_operations` 53/53; full repo `python -m unittest discover` 1138/1138.
  Commit `f34a8ad`.

- 2026-09-23: T4d done. Fix A root cause (parent-traced, verified): `prismaSessionClient
  .ts`'s `bootstrap()` POSTs to `/api/prisma/session`; once T4c made the proxy answer
  every Prisma route with the same JSON marker, that POST got it too. `bootstrap()` did
  `response.json()` (succeeds, valid JSON) then checked `response.status !== 201` (true,
  503) and threw a generic `Error('Prisma session bootstrap failed')` -- never inspecting
  the body for the marker. `prismaChannelAPairing.service.ts`'s `requestPairing()` awaits
  `prismaSessionClient.fetch()`, which internally awaits `bootstrap()` first; its catch
  only special-cased `AbortError`/`PrismaStaleSessionResponse`, so the generic Error fell
  into the plain `PrismaChannelAPairingError('runtime_unreachable')` branch with no detail.
  T4b/T4c's own tests never caught this because `prismaChannelAPairing.service.test.ts`
  mocks `./prismaSessionClient` entirely (bootstrap never actually runs there).
  Fix: new `hmi-app/src/services/prismaRuntimeUnreachable.ts` (marker/detail parsing +
  `PrismaRuntimeUnreachableError`), used by both `prismaSessionClient.ts` (bootstrap now
  checks the marker right after the epoch-staleness check, before the generic status/shape
  validation, and throws the typed error) and `prismaChannelAPairing.service.ts` (removed
  its own duplicated marker/detail functions in favor of the shared ones; `requestPairing`'s
  catch now recognizes `PrismaRuntimeUnreachableError` and maps it to
  `PrismaChannelAPairingError('runtime_unreachable', error.detail)` before the generic
  fallback). `fetch()` and `#waitForBootstrap()` already propagated any bootstrap
  rejection unchanged, so no change was needed there. Checked every other session-client
  consumer (dashboardSnapshotExport, prismaVoiceTtsAudioSource, voiceEventListener,
  usePrismaOrbPresentation, main.tsx): all catch generically (`catch (error: unknown)`,
  bare `catch {}`, or `.catch(() => undefined)`) with no `instanceof` distinction, so they
  treat the new error type exactly like the old plain Error -- no regressions. Added the
  regression test the coordinator asked for: `prismaChannelAPairing.service.integration
  .test.ts` (new file) exercises the REAL `prismaSessionClient` singleton + REAL
  `prismaChannelAPairing` service (neither mocked), with only `global.fetch` stubbed to
  answer `/api/prisma/session` with the 503 marker -- this is the one test that would have
  caught the original bug. Also added two focused unit tests in `prismaSessionClient
  .test.ts` for `bootstrap()`'s new marker recognition (with and without detail).
  RED: `prismaSessionClient.test.ts` failed to even collect (missing module) and the
  integration test's detail assertion failed, against the pre-fix source. GREEN: focused
  61/61; full `npm test` 211 files / 2235 tests; `tsc -b --noEmit` and `eslint` clean.
  Commit `9ad120d` (GGA PASSED, 1 non-blocking note: `isPlainObject` duplicated between
  the shared module and the pairing service -- pre-existing pattern, not touched).

  Fix B: verified structurally that `Invoke-PrismaStartTransaction`'s port_in_use throw is
  its EARLIEST guard in the always-start recovery block, before `Prune-PrismaProcessManifest`,
  `Assert-PrismaLocalPortsAvailable` or any `Start-Process`/manifest-write -- no development
  owner is ever registered before it, so dev.mjs's ownership-recovery call has nothing to
  recover for this case. `start-local.ps1`: the port_in_use branch now sets
  `$script:portInUseTerminalMessage` right before its existing `throw $message` (kept as a
  normal exception so `Invoke-PrismaManifestLock`'s own `finally { $stream.Dispose() }`
  still unwinds correctly -- `exit` was deliberately NOT used this deep, since PowerShell
  does not reliably run enclosing `finally` blocks for it); a NEW top-level `try/catch`
  around the existing `Invoke-PrismaManifestLock` call recognizes that flag, prints the
  one message with `Write-Host -ForegroundColor Red` (never `Write-Error`/`throw` at that
  point, so no uncaught-error record), and calls `exit 1` directly (safe at this truly
  top-level point); every other exception still `throw`s unchanged. `dev.mjs`: added
  `hasPrismaStartupFailure()`; `acquire()`'s catch skips the `release-dev-local.ps1
  -RecoverRegisteredOwner` call when the rejection already carries `.failure`;
  `runDevelopment`'s catch skips the generic "Prisma Local is unavailable" warning in the
  same case (start-local.ps1 already printed the one line that matters), and still runs
  both exactly as before for every other rejection (regression-tested).
  Rewrote the two existing port_in_use terminal-message tests in `test_runtime_safety.py`
  to invoke `start-local.ps1` WITHOUT the test's own wrapping try/catch (an outer
  try/catch can never observe `exit`, unlike a `throw`) and assert `result.returncode !=
  0`, the one clean line in `result.stdout`, and the ABSENCE of `FullyQualifiedErrorId`/
  `CategoryInfo` in `result.stderr`; the "never stops the foreign process" assertion moved
  from an in-process `$global:stopped` variable (unobservable after `exit`) to a file
  marker written by the stubbed `Stop-Process`. Added `hasPrismaStartupFailure`-skip
  assertions to `dev.test.ts` (both the `acquire()`-level spawn-count check and the
  `runDevelopment`-level `warn` check), with matching regression assertions for the
  non-failure case (recovery/warning still run exactly as before).
  RED: both rewritten PS tests failed against the pre-fix source (message landed in
  stderr as part of the uncaught-error record, never in stdout); both new dev.test.ts
  assertions failed against the pre-fix dev.mjs. GREEN: `test_runtime_safety` +
  `test_operations` 53/53; full repo `python -m unittest discover` 1138/1138; full
  `npm test` 211 files / 2235 tests; `tsc -b --noEmit` and `eslint` clean.
  Commit `5cd10a5` (GGA: no matching files -- `.mjs` is outside its `*.js` glob, `.ps1`/
  `.py` are outside its configured patterns entirely).

- 2026-09-23: T5b done. Removed `AdminSessionLifecycle.tsx`'s route-leave effect
  (`if (previousWasAdmin && !currentIsAdmin) void controller.exit();`), keeping only the
  existing `controller.start()`/`controller.stop()` effect; the component no longer tracks
  `previousPath` at all. Updated `AdminSessionLifecycle.integration.test.tsx`'s second test
  (renamed to "keeps settings close authenticated and keeps the session alive across Ver
  viewer and route history"): moved `HistoryControls` outside the routed pages (rendered
  once, always available, matching real browser back/forward) and reversed every assertion
  that pinned the old contract — Ver viewer, and two browser-history round-trips through
  `/admin`, all now assert `isAuthenticated` stays `true` and zero logout calls; only
  clicking "Cerrar sesion" ends the session (unchanged path, still calls
  `controller.exit()` from `AdminLayout.tsx`, untouched by this task). Updated the PAC-4B
  statements in `odd/tasks/prisma-protected-credentials.md` (~L215-218 near-verbatim
  contract paragraph, and the ~L341 Voice-credential-block bullet) with dated
  "Reversed 2026-09-23 (T5b)" notes, keeping the original text struck through for history
  per the coordinator's "short dated note" instruction; grepped `docs/prisma` for
  "Ver viewer"/"Leaving admin"/"ends local administrator" — no other file states the old
  contract. RED: the rewritten test failed on `expect(useAuthStore.getState().session
  .isAuthenticated).toBe(true)` right after the Ver-viewer click (got `false`) against the
  unmodified component. GREEN: `AdminSessionLifecycle.integration.test.tsx` 2/2; full
  `npm test` 211 files / 2235 tests; `tsc -b --noEmit` and `eslint` clean. GGA PASSED (1
  non-blocking note: the code comment says "Cerrar sesion" without the accent — not
  user-facing text, not touched). Commit `65c2b80`.

- 2026-09-23: T9 done, in two work-unit commits.

  **Backend + proxy + docs** (`ca696e9`). `gemini_credentials.py`: added
  `GeminiVerificationService` (in-memory, thread-safe via a single `Lock`; `verify()`
  resolves the credential through the existing `GeminiCredentialResolver`, then calls
  `client.models.get(model=GEMINI_VERIFY_MODEL)` -- a non-generating model lookup, never a
  generation call -- classifying the outcome into `verified` / `invalid_key`
  (`google.genai.errors.ClientError`) / `unreachable` (`ServerError`, network/timeout, or
  any other unexpected exception, fail-closed) / `not_configured`
  (`GeminiCredentialUnavailable`); rejects a concurrent call with
  `GeminiVerificationInProgress`; `reset()` clears back to `not_checked`. Added
  `GEMINI_VERIFY_TIMEOUT_MS = 10_000` (new `timeout_ms` param on `create_gemini_client`,
  default unchanged at 45s for TTS) and `GEMINI_VERIFY_MODEL`, pinned equal to
  `voice_service.TTS_MODEL` by a dedicated regression test (not imported directly, to avoid
  coupling the port-5057 module to the separate port-5056 voice service process). Verified
  the exact google-genai API against the installed package source in `.venv`
  (`google_genai-2.17.0`): `genai.models.Models.get(*, model, config=None)` exists and is
  synchronous; confirmed via `inspect.signature`. Found and fixed a real mocking hazard
  while writing the tests: `create_gemini_client`'s `from google import genai` can bind
  through an already-real `google.genai` package attribute (set by any earlier real import
  of a `google.genai.*` submodule elsewhere in the same test process), silently bypassing a
  `sys.modules` patch; switched both that import and `_run_check`'s `google.genai.errors`
  import to `importlib.import_module(...)`, which always resolves through `sys.modules`
  and is unaffected by the parent package's attributes. `admin_http.py`:
  `AdminHttpBoundary` takes an optional `gemini_verification_service`; the existing
  `/api/prisma/admin/credentials` GET now embeds `verified`/`verification` on the gemini
  entry only (telegram/telegram_channel_a keep their plain `{configured}` shape); PUT/DELETE
  gemini reset verification on success; new `POST
  /api/prisma/admin/credentials/gemini/verify` (same origin/session/CSRF pattern as the
  PUT/DELETE routes; 409 `GEMINI_VERIFICATION_IN_PROGRESS` on a concurrent call; 503
  `GEMINI_VERIFICATION_UNAVAILABLE` when no service was composed) responds with the exact
  result just computed by `verify()`, not a re-read snapshot, so the caller's own outcome is
  never raced by a concurrent request. `local_presentation.py`: default `create_app` wires
  `GeminiVerificationService(GeminiCredentialResolver(os.environ, lambda: credentials))`,
  reusing the same protected store the generic credential routes already resolve Gemini
  through. `vite.prismaProxy.config.ts`: added the anchored POST-only route following the
  existing admin-credential pattern (stripped session capability, 5057 target). Documented
  the new route and its non-generating/never-persisted/reset-on-save-or-delete contract in
  `docs/prisma/PRISMA_BROWSER_ROUTING.md`. RED verified per layer (new/updated tests failed
  against the pre-change source: 15 `test_gemini_credentials.py`, 17 `test_credential_http.py`
  including 2 pre-existing tests whose gemini fixture needed the new shape, 1 new
  `vite.prismaProxy.config.test.ts` route-table row confirmed failing via `git stash` of
  just that file). GREEN: full backend `python -m unittest discover` 1156/1156; full
  frontend `npm test` 211 files / 2235 tests; `tsc -b --noEmit` and `eslint` clean. GGA
  PASSED (one non-blocking note: the 503 body helper duplication pattern already flagged in
  T4c, unrelated to this task, not touched).

  **Frontend redesign** (`56d7a32`). `adminCredential.types.ts`: added
  `GeminiVerificationState`/`GeminiVerification`/`GeminiCredentialProviderMetadata` (extends
  the base `{configured}` metadata with `verified`+`verification`), `CredentialMetadata.gemini`
  narrowed to the new type, `parseGeminiVerificationResult` for the verify endpoint envelope
  -- both parsers keep the project's exact-key, closed-enum fail-closed discipline.
  `adminAuth.service.ts`: `AdminAuthClient.verifyGemini()` posts an empty `{}` JSON body to
  the new route with the active private CSRF (mirrors `applyChannelA`); added
  `GEMINI_VERIFICATION_IN_PROGRESS`/`GEMINI_VERIFICATION_UNAVAILABLE` to the public error
  allowlist so they surface instead of collapsing to the generic `AUTH_REQUEST_FAILED`.
  `usePrismaCredentialAdministration.ts`: `verifyGemini()` follows the same
  `runOperation('verify-gemini', ...)` + `refresh()` lifecycle as the other explicit actions
  (pending-action mutual exclusion, abort-on-deactivation, stale-result fencing all reused
  for free). `VoiceCredentialSettings.tsx`: Gemini gets its own `renderGeminiProvider()`
  (the shared three-column `renderProvider` now returns early for `gemini`, Telegram/Channel
  A untouched) -- left column: `<legend>Proveedor de voz: Gemini</legend>` (fieldset
  `aria-label` changed to match, only for Gemini) + "API Key" input (renamed from "Credencial
  Gemini") with the existing icon-only Save/Delete; right column: credential-status phrase
  (`Credencial configurada` green / `Credencial no configurada` red, falling back to the
  shared `ProviderStatus` loading/unavailable wording so the existing 3-provider exact-count
  assertions keep holding) and, only once real metadata has loaded, the verification phrase
  (`Configure una API key para verificarla.` when unconfigured; else
  `Verificación: no realizada` / `Verificada` / `API key inválida` / `No se pudo verificar:
  sin conexión con Google` from the closed state) plus a secondary `HmiButton` "Verificar"
  ("Verificando…" while `pendingAction === 'verify-gemini'`), disabled whenever the shared
  `disabled` flag is set or the credential isn't configured. Mask: a fixed
  `'•'.repeat(12)` rendered as the input's `placeholder` (only when the draft is empty
  and the credential is configured) rather than its `value` -- chosen over a value-based mask
  because a placeholder can never merge with typed characters (the browser swaps it out on
  the first keystroke instead of the new text splicing into existing dots at cursor
  position, which a controlled `value` mask would risk) and is reported by screen readers as
  hint text on a blank field, not as an actual 12-character value; the accessible name stays
  exactly "API Key" (unchanged `<label>` text) in both states. Added
  `GEMINI_VERIFICATION_IN_PROGRESS`/`GEMINI_VERIFICATION_UNAVAILABLE` to the component's own
  `errorText` map for the same reason as the service layer. RED verified: 21 of 39 tests in
  `VoiceCredentialSettings.test.tsx` failed against the pre-redesign component (legend/label
  renames, new mask/status/verify assertions); one of my own new assertions was itself wrong
  against the *intended* design (expected `Verificación: no realizada` for an unconfigured
  credential, but the spec's own "Configure una API key..." message correctly takes
  precedence there) and was corrected before GREEN, not the component. Collateral: three
  other pre-existing test files constructed a `CredentialMetadata`/gemini fixture or queried
  `'Credencial Gemini'` and broke at *runtime* (not caught by `tsc -b`, which excludes
  `*.test.tsx` from its project per `tsconfig.app.json`) --
  `GlobalSettingsDialog.voice.integration.test.tsx`, `VoiceSettingsTab.test.tsx` (both fixed:
  gemini fixture shape + label rename) and `usePrismaCredentialAdministration.test.tsx`
  (fixed as part of the hook's own RED/GREEN cycle above). GREEN: full `npm test` 211 files /
  2260 tests; `tsc -b --noEmit` and `eslint` clean. GGA PASSED (three non-blocking notes: an
  unnecessary non-null assertion on `verification!.state` inside an already-narrowed branch,
  the pre-existing 4096-byte secret-limit duplication between `validateCredentialSecret` and
  its error message, and `<legend>` living inside a wrapper `div` instead of directly under
  `<fieldset>` -- same pre-existing pattern as the Telegram/Channel A cards, not introduced
  by this task -- none touched).

  **Exact Gemini API call chosen**: `client.models.get(model=GEMINI_VERIFY_MODEL)` from the
  installed `google-genai` 2.17.0 SDK (`services/prisma-runtime/.venv/Lib/site-packages/
  google/genai/models.py`, `Models.get(self, *, model, config=None) -> Model`) -- a metadata
  lookup for one specific model, confirmed via `inspect.signature` against the actual
  installed source (not guessed, no context7 call was needed since the installed package
  source was authoritative and directly inspectable). It performs no content generation, so
  it never consumes generation quota, matching the task's "non-generating" requirement.

  **Product decisions made without further clarification** (none needed escalation): kept
  both a flat `verified: boolean` and the nested `verification: {state, checkedAt}` object on
  the wire (brief said "verified true/false plus a verification object") rather than
  deriving `verified` client-side from `state === 'verified'`, for exact literal compliance;
  chose `placeholder` over a `value`-based mask (brief explicitly allowed either and asked
  for a justified choice); did not show a separate success-toast feedback message after a
  successful verification, since the inline "Verificada" status already reports it and a
  toast would be redundant (consistent with how the panel already avoids duplicate
  positive-outcome messaging elsewhere).

- 2026-09-23: T9b done. Replaced the Gemini row's two status TEXT spans
  ("Credencial configurada/no configurada", "Verificada"/"API key inválida"/"No se pudo
  verificar..."/"Verificación: no realizada") with Lucide icons carrying the former copy as
  `role="img"` `aria-label` plus a `HoverTooltip` (same icon+tooltip pattern T6 used for
  Save/Delete): credential icon `CircleCheck`/`CircleX` (`text-status-normal`/
  `text-status-critical`); verification icon `CircleCheck` (verified, `text-status-normal`),
  `CircleX` (invalid_key, `text-status-critical`), `WifiOff` (unreachable,
  `text-status-warning` -- confirmed this token exists in `hmi-app/src/index.css` and is
  already used elsewhere in this same file for Telegram/Channel A warnings), `CircleDashed`
  (not yet verified / not_configured, `text-industrial-muted`); a spinning `Loader2`
  (`animate-spin`) with `aria-label="Verificando…"` replaces the verification icon slot
  while `pendingAction === 'verify-gemini'`, and the button text stays "Verificando…"
  unchanged. Collapsed the row into one `flex flex-wrap items-center gap-2` container
  (`data-testid="gemini-credential-row"`) holding, in order: the API Key input (label text
  now sits above the row instead of wrapping it, associated via explicit `htmlFor`/`id`),
  the credential icon, Save, Delete, and (`ml-auto`, so it stays right-aligned) a
  non-full-width `Verificar` `HmiButton` plus its result icon -- both at the button's own
  `size="sm"` height, matching Save/Delete, per the user's ASCII layout. Dropped the earlier
  "Configure una API key para verificarla." not-configured message (not in the user's
  6-string tooltip list); the disabled Verificar button alone now communicates that state,
  with `CircleDashed`/"Verificación: no realizada" shown regardless of configured status
  once metadata has loaded (Verificar itself stays disabled until configured). RED: 7 of 40
  `VoiceCredentialSettings.test.tsx` tests failed against the pre-icon component (rewritten
  to query `getByRole('img', {name})` instead of `getByText`, plus one new structural test
  asserting every row control via `toContainElement` against the shared
  `gemini-credential-row` testid). GREEN: `VoiceCredentialSettings.test.tsx` 40/40; full
  `npm test` 211 files / 2261 tests (no collateral breakage elsewhere this time); `tsc -b
  --noEmit` and `eslint` clean. GGA PASSED (1 non-blocking note: the pre-existing 4096-byte
  secret-limit duplication already flagged after T9, not touched). Commit `5917ca6`.

- 2026-09-23: T9c done, in two commits (dependency bump separate from the UI change, as
  instructed).

  **Dependency bump** (`43069c5`, `package.json`/`package-lock.json` only).
  `MessageCircleDashedCheck` does not exist in the installed `lucide-react` 1.8.0; confirmed
  present in 1.47.0 via `node_modules/lucide-react/dist/esm/icons/message-circle-dashed-
  check.mjs` after `npm install lucide-react@^1.47.0` (same major, satisfies the existing
  `^1.8.0` range's caret only if the range itself is bumped -- updated the `package.json`
  range to `^1.47.0`). Verified no other icon import broke across the app: full `npm test`
  211/2263 (2 more than the prior count -- the two new T9c tests below), `npx tsc -b
  --noEmit`, `npm run lint`, and `npm run build` all clean/succeeded unchanged.

  **UI change** (`a5a2908`). (1) Wrapped the disabled "Verificar" button (unconfigured
  credential) in a `HoverTooltip` "Configure una API key para verificarla." -- confirmed
  this works without extra plumbing: `HoverTooltip` attaches its mouse/focus listeners to
  its own wrapping `<div>`, and a browser still fires `mouseenter` on that ancestor div when
  the pointer is over a `disabled` descendant button (only the disabled element's own event
  dispatch is suppressed, not its ancestors'), which is exactly the same pattern already
  used for the Save/Delete tooltips. (2) Icon changes: credential-not-configured
  `CircleX`→`MessageCircleWarning` (kept `text-status-warning`, confirmed identical to the
  "Estado Alerta" `--color-status-warning` token labeled in `DesignSettingsTab.tsx:181`);
  verification-verified `CircleCheck`→`Check`; verification-not-yet-checked
  `CircleDashed`→`MessageCircleDashedCheck` (muted, unchanged tone). Credential-configured
  (`CircleCheck`/success) and verification invalid_key/unreachable/verifying icons kept as
  T9b, per this writer's reading of the brief: the enumerated list's first two bullets read
  as *value changes to the existing two icon slots* (credential icon's not-configured case;
  verification icon's verified case), not a new merged single-icon design -- flagging this
  interpretation explicitly since the brief's phrasing was compact enough to admit the
  alternative reading. (3) Stopped Chrome's password-generation/save prompts on the Gemini
  API Key field: changed `type="password"` + `autoComplete="new-password"` to `type="text"`
  masked via a new `.hmi-masked-text` CSS utility (`-webkit-text-security: disc`, added to
  `hmi-app/src/index.css` next to `.hmi-scrollbar`, same "reusable utility class, not a
  token" convention) plus `autoComplete="off"`, `spellCheck={false}`, `autoCapitalize="off"`,
  `autoCorrect="off"`, `data-1p-ignore="true"`, `data-lpignore="true"`,
  `data-form-type="other"`; confirmed no `<form>` wraps this panel anywhere in
  `hmi-app/src/pages/admin` or `hmi-app/src/components/admin` (grepped), so there was no
  login-form heuristic to defeat beyond the field's own type/autocomplete. Known limitation
  (documented in the new CSS comment, not hidden): `-webkit-text-security` is Chromium/
  Safari-only; Firefox has no standard-CSS equivalent, so the field renders as plain
  visible text there -- accepted per the user's explicit Chrome-focused request, but noted
  since it's a real cross-browser trade-off, not chosen silently. Telegram and Canal A
  credential inputs use a separate inline `<input type="password" autoComplete="new-
  password">` in the shared `renderProvider` function (`VoiceCredentialSettings.tsx:469-
  470`), not the same input component as Gemini's -- confirmed via grep and left untouched,
  per the brief's "only if they share the same input component" condition.
  RED: 4 of the (then) 40 `VoiceCredentialSettings.test.tsx` tests failed against the
  pre-T9c component (rewrote two existing icon assertions to check the actual lucide
  `class="lucide-<kebab-name>"` identity, since accessible-name text stayed the same across
  the CircleX→MessageCircleWarning and CircleDashed→MessageCircleDashedCheck swaps and
  couldn't by itself catch a reverted icon choice; added the disabled-tooltip test and the
  input-hardening test). GREEN: `VoiceCredentialSettings.test.tsx` 42/42; full `npm test`
  211 files / 2263 tests; `tsc -b --noEmit`, `eslint`, and `npm run build` all clean. GGA
  PASSED (1 non-blocking note: "API key" vs the field's own "API Key" label casing --
  pre-existing string from T9, reused verbatim in the new tooltip, not touched).

  **Correction** (2026-09-23, same day): the user's "use `Check`" applied to every check in
  the row, including credential-configured (still `CircleCheck` above). Switched it to
  `Check` too (same success token); updated the lucide-class test assertion (RED against
  the pre-fix icon, then GREEN), removed the now-unused `CircleCheck` import. Full `npm
  test` 211/2263, `tsc -b --noEmit`, `eslint` clean. GGA PASSED (1 non-blocking note,
  unrelated 4096-byte message constant, not touched). Commit `8110edb`.

- 2026-09-23: T9d done. (1) Extracted `VerifyButtonLabel({ verifying })`: both "Verificar"
  and "Verificando…" spans render always, stacked in the same CSS grid cell
  (`[grid-area:1/1]`); the inactive one gets `invisible` (keeps its layout box so the grid
  cell doesn't collapse to the shorter label) and `aria-hidden` (excluded from the button's
  accessible name, which stays exactly the active label). No hardcoded pixel width and no
  runtime measurement -- the grid cell's intrinsic size is simply the wider of its two
  overlapping children, satisfying the anti-hardcode dimensional policy natively. Used by
  both the enabled/configured Verificar button and the disabled/unconfigured
  `HoverTooltip`-wrapped one, so both share identical width regardless of state; icon/
  spinner placement (the separate `StatusIcon`/`Loader2` slot after the button) unchanged.
  (2) Gemini's Delete button: `variant="danger"` → `variant="primary"` (Save's exact
  variant), scoped to the Gemini row only -- Telegram/Canal A's Delete buttons (in the
  separate, non-shared `renderProvider` block) still use `variant="danger"`, unchanged,
  left for T10. RED: the width test failed with `getByText('Verificando…')` not found at
  all (old code rendered only one label, swapped via ternary) against the pre-fix
  component; the styling test failed on the literal `status-critical` classes still
  present. GREEN: `VoiceCredentialSettings.test.tsx` 44/44 (comparing Delete's and Save's
  full `className` strings directly, rather than hardcoding either variant's class list, so
  the test tracks the actual `HmiButton` variant+size contract instead of a fixed
  snapshot); full `npm test` 211 files / 2265 tests; `tsc -b --noEmit` and `eslint` clean.
  GGA PASSED (3 non-blocking notes: Gemini's Delete now differs from Telegram/Canal A's
  Delete variant -- intentional, scoped per this task, T10 will reconcile; pre-existing
  "Consultando estado"/"Estado no disponible" text duplicated inline instead of reusing
  `ProviderStatus`; pre-existing double-tooltip risk from `HoverTooltip` + native `title`
  on Save/Delete -- none touched, all pre-existing or explicitly in-scope-as-is). Commit
  `d982a06`.

  **Follow-up** (2026-09-23, same day): user manual test found Delete's new `primary`
  variant looked too highlighted when enabled. Switched to `variant="secondary"`, matching
  Verificar exactly (Save keeps `primary`, unchanged); RED confirmed against the pre-fix
  `primary` classes (test rewritten to compare Delete's className against Verificar's, and
  assert it now differs from Save's), then GREEN. `VoiceCredentialSettings.test.tsx` 44/44;
  full `npm test` 211/2265; `tsc -b --noEmit` and `eslint` clean. GGA PASSED (3
  non-blocking notes: Gemini Delete vs Telegram/Canal A Delete variant mismatch --
  intentional/scoped, T10 will reconcile; pre-existing double-tooltip risk; comments
  mentioning task IDs will go stale once this tracker is archived -- none touched).
  Commit `ffa1d31`.

  **Follow-up 2** (2026-09-23, same day; user approved the row, last details). (1) Legend
  border-notch: grepped the codebase first for an existing fix (Telegram/Canal A's shared
  `renderProvider` legend has the identical issue, unfixed, left for T10) -- none found, so
  applied the user's preferred `float-left w-full` technique. Root cause: a native
  `<legend>` is positioned via its own browser "straddle the top border" algorithm that is
  independent of the fieldset's `display`/`flex-direction` (a flex-column fieldset alone
  can't move it); the fieldset's `className` was changed from `flex flex-col gap-2 ...` to
  plain block (`rounded border ... p-3`), the legend got `float-left w-full px-0 ...` (this
  removes it from the notch algorithm entirely, rendering it as an ordinary block inside
  the border) with a `<div className="clear-both" />` immediately after, and everything
  else that was directly in the fieldset (label + credential row) moved into its own
  `flex flex-col gap-2` wrapper div, unaffected by the legend's float. (2) Copy: legend/
  `aria-label` "Proveedor de voz: Gemini" → "Proveedor de voz" (group accessible name);
  input label "API Key" → "API Key de Gemini" (input's accessible name too); all other
  copy (tooltips, "Configure una API key para verificarla.", etc.) unchanged. Global
  find-replace across `VoiceCredentialSettings.test.tsx` (24 + 17 occurrences) plus two
  other pre-existing test files that queried the old group/label names at runtime only
  (`GlobalSettingsDialog.voice.integration.test.tsx`, `VoiceSettingsTab.test.tsx` -- same
  `tsconfig.app.json` test-file exclusion from `tsc` as earlier T9 collateral, fixed
  proactively this time before running the full suite). RED: 2 new structural tests failed
  against the pre-fix component (legend missing `float-left`/`w-full` classes; "API Key de
  Gemini" label not found). GREEN: `VoiceCredentialSettings.test.tsx` 46/46; the two
  collateral files 25/25; full `npm test` 211 files / 2267 tests; `tsc -b --noEmit` and
  `eslint` clean. GGA PASSED (2 non-blocking notes, both already recorded: the Gemini/
  Telegram Delete-variant split, and the pre-existing double-tooltip risk from `title` +
  `HoverTooltip` on every icon button -- neither touched). Commit `c2a19cb`.

  **Follow-up 3** (2026-09-23, same day; user decision): removed the standalone "Actualizar
  estado" button and its `refreshDisabled` gating. `administration.refresh()` itself is
  untouched and still runs automatically inside the hook after every save/delete/apply/
  verify (`usePrismaCredentialAdministration.ts`'s `saveCredential`/`deleteCredential`/
  `applyTelegram`/`applyChannelA`/`verifyGemini` each call it post-operation) -- the
  component no longer calls it directly anywhere. Checked reachability of the stale/error
  notices as asked: both stay reachable, since they derive from `administration.error`/
  `administration.data`, which the automatic refetches (initial load, or any of those
  five operations) still populate the same way a manual refresh did; verified this by
  rewriting the two tests that used to click the button to instead trigger the identical
  refetch-failure path through Telegram's and Channel A's own "Aplicar cambio" buttons --
  both still show "Último estado conocido; la actualización falló." and disable the same
  controls. Also removed two standalone "button stays enabled" assertions that only tested
  the button itself, and added one explicit regression test asserting the button is gone.
  Spacing: gave the provider-fieldset list its own `mt-3` (previously relied entirely on
  the description paragraph's `mb-3`, with the removed button's row providing incidental
  extra separation) so the first (Gemini) frame doesn't sit flush under the section
  header/description now that the button's row is gone. RED: the new "button is gone"
  test failed against the still-present button (the two rewritten refresh-path tests
  already passed pre-removal, since `applyTelegram`/`applyChannelA` already triggered the
  same internal `refresh()` before this task -- confirming they test the underlying
  behavior independent of the button). GREEN: `VoiceCredentialSettings.test.tsx` 47/47;
  full `npm test` 211 files / 2268 tests; `tsc -b --noEmit` and `eslint` clean. GGA PASSED
  (2 non-blocking notes, both already recorded: stale task-ID comments, double-tooltip
  risk -- neither touched). Commit `7b96b59`.

- 2026-09-23: T10 done, in three commits.

  **Backend** (`397e838`). Decided to implement "save applies" at the admin HTTP boundary
  layer (`admin_http.py`) rather than inside `ChannelAManager.save_credential()` or
  `TelegramLifecycleManager.set_secret()` themselves, per the brief's own example ("the save
  endpoint applies"): the PUT `/api/prisma/admin/credentials/telegram` route now calls
  `telegram_manager.apply()` right after `set_secret()` (Telegram's `operation_lock` is a
  reentrant `RLock`, but the call happens as a separate statement, not nested, so no
  reentrancy question even arises), and `_channel_a_credential_write` calls
  `channel_a_manager.apply()` right after `save_credential()` (Channel A's `_mutation()`
  busy-lock has already been released by then, since `save_credential()`'s `with
  self._mutation():` block exited). This was far less invasive than fusing apply into each
  manager's own save method: `channel_a_manager.py`'s `save_credential()` and `apply()` are
  completely unchanged, so the ~40 existing manager-level tests (structural invariants like
  "save never calls factory", busy-reentrancy assertions) needed zero changes. Both new
  `_apply_*_after_save()` helpers swallow the apply exception (`TelegramLifecycleError` /
  `ChannelAManagerError`) so a post-save apply failure never fails the save response --
  mirrors `startup_apply()`'s existing non-raising contract; the failure is already captured
  in the manager's own `lastError` by the time the next status/health refresh runs.
  Confirmed DELETE already stopped the bot on both channels (`_settle()`/`_stop_owned_bot()`
  were already wired into `delete_credential()`); no code change needed there, only a new
  regression test.
  `botUsername` (string|null, public info, never the token): added a public `bot_username`
  property to `ChannelAActivation` (already privately tracked, set from `getMe` during
  prepare, cleared on stop) and a `ChannelAManager._bot_username_if_running()` helper that
  exposes it only when `phase == running` and `not restart_required` (fail-closed on any
  broken/missing attribute); added to `ChannelAManager.status()` and
  `ADMIN_CHANNEL_A_STATUS_FIELDS` (six fields -> seven). Telegram: `TelegramLifecycleManager
  .status()` computes it fresh from `self.bot.bot_username` (via `getattr`, defensive against
  a minimal test double) gated on the same "actually running" check already used for the
  `running` field; added to `ADMIN_TELEGRAM_STATUS_FIELDS` and to the public `/health` route
  as `telegramBotUsername` (gated the same way, with a `telegram_bot` no-manager legacy
  fallback for symmetry with the route's other fields, though no test exercises that branch
  since the manager path is what's actually used).
  RED verified per unit: `test_channel_a_manager.py` (`STATUS_KEYS`/`assert_status` updated
  to 7 fields, `FakeActivation` gained a `bot_username` attribute defaulting `None`, one new
  dedicated test), `test_telegram_credentials.py` (`FakeBot` gained `bot_username`, one
  updated + one new test), `test_credential_http.py` (two new tests: apply-called-after-save,
  apply-failure-swallowed), `test_channel_a_admin_http.py` (`ADMIN_CHANNEL_A_FIELDS`/
  `ADMIN_TELEGRAM_FIELDS` updated, the `mock_calls` assertion in the existing "exactly one
  manager mutation" test flipped to expect `save_credential` then `apply`, one new
  apply-failure-swallowed test), `test_telegram_http.py` (`ADMIN_TELEGRAM_FIELDS`/
  `canonical_admin_status` updated, the existing "PUT is desired-only" test renamed and
  flipped to expect `apply()` called, two new `/health` botUsername tests) -- all failed
  against the pre-change source for the reasons described (missing key, wrong call sequence,
  KeyError), confirmed by direct runs (not git-stash, since the changes were additive/
  small enough to reason about directly). Collateral: `test_telegram_diagnostics.py`'s own
  separate `ADMIN_TELEGRAM_FIELDS` copy needed the same update (found via a full-suite run,
  not grep, since it wasn't in the initially targeted file list). GREEN: full
  `python -m unittest discover` 1163/1163 (up from 1156 pre-T10: +7 new tests net of the
  test-only field/fixture updates). Also updated `docs/prisma/PRISMA_BROWSER_ROUTING.md`'s
  route table and the Channel A credential-route paragraph to describe the new save-applies
  contract (previously stated "only writes or deletes a secret", now false). GGA PASSED.

  **Frontend** (`4ad6aaf`). Domain types: added `botUsername: string | null` to
  `ChannelAAdministrationStatus` (exact-key parser, seven fields) and `TelegramPassiveHealth`
  (parsed from `telegramBotUsername`), with a shared `isBotUsername()` validator (null, or a
  non-empty string -- an empty string is never a real username). Fixed every collateral
  fixture across `usePrismaCredentialAdministration.test.tsx`,
  `GlobalSettingsDialog.voice.integration.test.tsx`, `VoiceSettingsTab.test.tsx` and
  `adminAuth.service.test.ts` that constructed a raw channelA/health JSON object or a typed
  mock without the new field (found by grep across all four files, not just the ones vitest
  first flagged, since `parseTelegramPassiveHealth` and the exact-key `parseChannelA
  AdministrationStatus` both now reject a payload missing it).
  Component: extracted a shared `CredentialFieldset` (the block-fieldset + floated legend +
  clearing div shell already approved for Gemini in T9's follow-up) and reused Gemini's own
  `credentialConfiguredGlyph`/`StatusIcon`/`CREDENTIAL_KEY_MASK` (renamed from
  `geminiCredentialGlyph`/`GEMINI_KEY_MASK` since they're now shared) for a new
  `renderTelegramFamilyProvider(provider)`, replacing the old three-column `renderProvider`
  entirely for Telegram and Channel A; Gemini's own `renderGeminiProvider` was refactored to
  use the same `CredentialFieldset` wrapper with byte-identical output (verified by its 47
  pre-existing assertions passing unchanged). Removed "Aplicar cambio", the pending/applied
  and Ejecución activa/detenida text blocks, "Origen:"/"Generación:"/"Habilitada" spans, the
  now-dead `ProviderStatus` and `channelAExecutionLabel` helpers, the `Play` icon import, and
  the section-level "Guardar una credencial no la aplica..." paragraph (removed per the
  brief's stated preference, now false). Added `StatusIcon`'s `spin` prop (also used to
  de-duplicate Gemini's previously hand-rolled verifying-spinner block into the same
  primitive, byte-identical markup).
  Execution icon mapping: `telegramExecutionGlyph(telegram, pending)` and
  `channelAExecutionGlyph(channelA, pending)`, both reading only existing status fields
  (never a derived "not running" guess) plus a client-side `pending` flag (`pendingAction ===
  'save-<provider>' || 'delete-<provider>'`) for the "Conectando..." state, since neither
  health payload has its own transitional phase and T10 makes save apply synchronously within
  the same request. Channel A reuses the exact phase branching the pre-existing
  `channelAExecutionLabel` established (the "never infer quiescence from not-running" rule):
  idle/stopped/null -> "Bot detenido"; preparing/prepared/stopping -> "Conectando..."
  (spinner); running without a pending restart -> "Bot conectado"; failed/retired/
  running-with-restart-required -> the new "Estado del bot no confirmado" (`CircleDashed`,
  muted) -- lastError always takes precedence over phase when present. Telegram's glyph does
  not read `restartRequired` (documented decision: since save now applies immediately, a
  genuinely running bot is honestly "conectado" even with a stale desired/applied generation
  from another source; Telegram has no extra transitional phase to fall back to the way
  Channel A does). `botUsername` renders as muted "@username" text next to the icon on both
  rows.
  Copy (per brief): Canal A legend/group name "Canal A" (was "Telegram (Canal A)"; the
  deletion-confirmation dialog's body text was left as "Telegram (Canal A)" -- out of the
  brief's stated scope, which named only the fieldset's group accessible name), description
  "Canal privado de Telegram: se vincula con un QR y Prisma responde consultas sobre la
  interfaz." (replacing the now-false "Guardar la credencial no inicia ni verifica el bot.");
  Telegram legend stays "Telegram" -- grepped for any existing description paragraph before
  this task and found none, so none was invented (reporting this so the parent/user can
  decide whether one is wanted); both rows' field label is "Telegram bot API Token" (shared
  literal, not derived from `PROVIDER_LABELS`).
  RED verified directly: ran the full `VoiceCredentialSettings.test.tsx` before any test edits
  (22 of 47 failed against the rewritten component, all Telegram/Canal A related -- old
  button/text/label queries), then rewrote each failing test to the new contract (icon
  queries via `getByRole('img', {name})` + `expectLucideIcon`, `within(group).getByLabelText
  ('Telegram bot API Token')` since the label text is now shared by two rows, `@username`
  text assertions) and removed four tests that had become meaningless once "Aplicar cambio"
  no longer exists (`applies Telegram only through its explicit action`, `translates a
  channel identity collision...`, `applies channel A only through its explicit action...`,
  `gates the channel A apply on a saved credential...`), replacing them with tests for the
  new save-applies/icon contract instead. Split the old dual-purpose "does not render a
  non-running channel A activation phase as stopped" `it.each` (stopping/failed, both forcing
  `lastError: 'PRISMA_CHANNEL_A_STOP_UNCONFIRMED'`) into a phase-only version (`lastError:
  null`, since lastError now visually outranks phase in the icon mapping) plus a separate new
  lastError-icon test, since the two concerns can no longer share one assertion under the
  icon design. GREEN: `VoiceCredentialSettings.test.tsx` 47/47; full `npm test` 211 files /
  2270 tests; `tsc -b --noEmit` and `eslint` clean.
  GGA PASSED with one legitimate, in-scope non-blocking note (fixed immediately, see below)
  and two accepted-as-is notes: the icon-size-vs-button-size inconsistency (`size={16}` icons,
  `size={14}` buttons -- pre-existing pattern from T9b, no documented token, not touched) and
  the Gemini-vs-Telegram/CanalA input+Save+Delete markup still repeating ~60 lines each
  (already reduced via `CredentialFieldset`/glyph/mask reuse; a full shared-row component
  was deliberately not extracted further, to keep Gemini's approved row byte-identical and
  minimize regression risk to its 47 pinned assertions -- a legitimate follow-up, not done
  here).

  **Follow-up fix** (`beed20e`, same day). GGA's one legitimate finding: the shared save
  success message ("Credencial guardada. No se aplicaron cambios al proveedor.") became false
  for Telegram/Canal A once their save started applying on the backend. Added a
  provider-keyed `SAVE_SUCCESS_TEXT` map -- Gemini keeps the original text (still accurate:
  its save never applies or verifies), Telegram/Canal A get "Credencial guardada y
  aplicada." RED: the Channel-A-save test's message assertion failed against the (still
  Gemini-worded) pre-fix text; GREEN: `VoiceCredentialSettings.test.tsx` 47/47; full
  `npm test` 211/2270; `tsc -b --noEmit` and `eslint` clean. GGA PASSED, no further findings.

- 2026-09-23: T11 backend done and committed; T11 frontend implemented and GREEN, held
  uncommitted pending the Canal B description text (this answers the "Product question for
  the user" below, which is now superseded by the parent's own T11 instructions).

  **Backend** (`5a2e86f`). Found the two English Canal B bot replies the coordinator
  named in `local_presentation.py`'s `_handle_message` (migration-active `/start` and
  not-yet-paired fallback) and translated them to usted: "Send /start again after migration
  completes." -> "Envíe /start nuevamente cuando finalice la migración."; "Send /start to
  pair this local bot." -> "Envíe /start para vincular este bot." Grepped the rest of
  `services/prisma-runtime/src/prisma_runtime` for other English user-facing bot/Telegram
  reply strings (broad literal-sentence pattern across every module, then manual review of
  every hit): every `channel_a_bot.py`/`channel_a_query.py` copy constant is already Spanish
  (T8); the only other English hits were `local_presentation.py`'s three `_voice_probe_error`
  messages ("Voice health request timed out.", "...failed to connect.", "...failed.") and
  `voice_service.py`'s `"Gemini speech is unavailable."` -- both are internal
  diagnostic/error-code text embedded in JSON API responses (health probe detail, TTS HTTP
  error body), never a Telegram/bot reply, so left untouched per this task's explicit "bot
  replies only, not error codes" scope; reporting them here for the parent to decide if a
  separate task should touch them. RED: rewrote the two existing pinning assertions in
  `test_telegram_lifecycle.py` (`test_legacy_allowlists_do_not_authorize_first_migrating_bot`,
  `test_migration_fence_drains_multiple_backlog_batches_before_pairing`) to the Spanish text
  first, confirmed both failed against the unmodified source (English still returned), then
  translated the source. GREEN: `test_telegram_lifecycle` 38/38; full
  `python -m unittest discover` 1163/1163. GGA: no matching files (`.py` outside its
  configured patterns, same as prior Python-only commits). Commit `5a2e86f`.

  **Frontend** (implemented, tested, NOT committed). `VoiceCredentialSettings.tsx`: added
  `CREDENTIAL_INPUT_WIDTH_CLS = 'w-full md:w-80'` (a Tailwind spacing-scale token, not a raw
  px value -- documented inline as a deliberate 2026-09-23 user decision so it isn't mistaken
  for an anti-hardcode-dimensional violation) and applied it to all three credential inputs
  in place of `min-w-40 flex-1`, so every row's input keeps the same fixed width regardless
  of its own trailing content (Verificar+icon, @username, execution icon) instead of growing
  to fill whatever space that content leaves; the row container already had `flex-wrap`, so a
  row that doesn't fit at narrow widths wraps instead of overflowing (accepted per the task).
  Could not visually confirm the longest trailing content fits on one line at the panel's
  normal width (no server/runtime available to this writer per this task's constraints);
  reasoned it through instead: `GlobalSettingsDialog` caps at `max-w-3xl` (768px), minus
  dialog/section/fieldset padding leaves roughly 660px of row width at the `md` breakpoint,
  and `w-80` (320px) plus the credential icon, Save, Delete, gaps, and either "Verificar" +
  its icon or the longest observed `@username` text (~25 chars) sum to roughly 600-650px --
  tight but fitting, and `flex-wrap` degrades gracefully if a narrower viewport disagrees.
  `CredentialFieldset`'s description `<p>` gained `mb-3` (applies to both Canal A's existing
  description and Canal B's new one, since both go through the same shared component) -- extra
  space beyond the row's own `gap-2`, matching the legend's own `mb-3` above it. Canal B
  (`renderTelegramFamilyProvider('telegram')`): legend/group name "Telegram" -> "Canal B";
  added its description via a new `CHANNEL_B_DESCRIPTION = 'TODO_CHANNEL_B_DESCRIPTION'`
  placeholder constant (documented inline: swapping this one constant is the only change
  needed once the real text arrives; do not commit until then); field label unchanged
  ("Telegram bot API Token"). Render order swapped to Canal A before Canal B ("Proveedor de
  voz, Canal A, Canal B"). `PROVIDER_LABELS` renamed to match current row names (`gemini:
  'proveedor de voz'`, `telegram: 'Canal B'`, `telegram_channel_a: 'Canal A'`) -- still used
  by the stop-unconfirmed retry feedback message, the only remaining consumer. Added a new
  explicit `DELETE_CONFIRMATION_TEXT: Record<CredentialProvider, string>` map and pointed the
  deletion dialog at it instead of interpolating `PROVIDER_LABELS`, so each provider's exact
  wording ("La credencial protegida de Canal A/Canal B se eliminará..."; "...del proveedor de
  voz se eliminará...") is reviewed independently of that other map's own casing/wording.
  RED: updated all group-name queries (`{ name: 'Telegram' }` -> `{ name: 'Canal B' }`, 17
  occurrences across this file plus 1 in `GlobalSettingsDialog.voice.integration.test.tsx`),
  the two pre-existing dialog-text regex assertions (`/Telegram \(Canal A\)/` -> the new exact
  Canal A text) and one `/Gemini/` assertion (-> the new exact proveedor-de-voz text), then
  added 6 new tests (input-width equality across all three rows with no leftover `flex-1`;
  Canal A/Canal B description `mb-3`; Canal B legend + description placeholder; row order via
  each fieldset's legend text; a parametrized exact-delete-copy check per provider) -- 22 of
  55 tests failed against the pre-T11 component (renamed groups, old dialog text, new
  structural assertions), confirmed via a full run before any component change. GREEN:
  `VoiceCredentialSettings.test.tsx` 55/55; collateral files (`GlobalSettingsDialog.voice
  .integration.test.tsx`, `VoiceSettingsTab.test.tsx`) 25/25; full `npm test` 211 files /
  2278 tests; `tsc -b --noEmit` and `eslint` clean.

  **Finished** (2026-09-23, same day): the user approved the Canal B description text
  ("Consultas a distancia por Telegram: Prisma responde por mensaje, sin necesidad de mirar
  la interfaz."). Swapped `CHANNEL_B_DESCRIPTION` from the placeholder to this exact text and
  the same literal in the two test assertions that referenced it; re-ran
  `VoiceCredentialSettings.test.tsx` (55/55), full `npm test` (211 files / 2278 tests),
  `tsc -b --noEmit` and `eslint` (both clean) -- no other test needed touching, confirming the
  placeholder-swap design worked as planned. Committed `style(admin): align credential rows
  and rename Telegram to Canal B` (`ea99dcc`). GGA PASSED (2 non-blocking notes: Save/Delete's
  `title` + `HoverTooltip` double-tooltip risk, already recorded pre-existing; the "Telegram
  bot API Token" field label being English amid otherwise-Spanish copy, pre-existing, not
  touched -- neither in scope for T11).

- 2026-09-23: T12 done. `local_presentation.py` `_handle_message`: dropped "presentación"
  and "Local" wording per the user's decision that Canal B is remote personal Telegram
  queries, never framed around looking at a screen. Paired reply: "Prisma Local quedó
  vinculada a este chat. Abra la HMI en modo presentación y ya puede consultar los datos
  visibles." -> "Prisma quedó vinculada a este chat. Ya puede hacer sus consultas."; ready
  reply: "Prisma Local está lista para responder sobre la HMI visible." -> "Prisma está lista
  para responder sus consultas."; unidentified-bot reply: "Este bot local ya está vinculado a
  otro chat." -> "Este bot ya está vinculado a otro chat." (dropped "local" only); `/status`
  reply: "Prisma Local está activa. Último snapshot: ..." -> "Prisma está activa. Última
  actualización de datos: ...". Grepped hmi-app + prisma-runtime for "presentación"/"Prisma
  Local" in user-facing strings: every hit in hmi-app (`bindingResolver.ts`,
  `thresholdEvaluator.ts`, `dataContract.types.ts`, `telemetry.types.ts`, `widget.types.ts`,
  `ADMIN_CONVENTIONS.md`) is a code comment/docstring about the "presentation layer"
  architecture term, not user-facing copy; `Topbar.test.tsx`'s "Prisma Local" is a test
  description string, and `prismaVoiceAudioEngine.ts`'s is an internal AudioContext error
  message (dev diagnostic, never shown to the end user) -- none touched, none in scope.
  `paths.py`'s and `local_presentation.py`'s own module docstrings ("Prisma Local ...") are
  also comments, not runtime output. RED: added 5 new tests to `test_telegram_lifecycle.py`
  pinning the exact new copy for all four reply paths (plus a no-snapshot `/status`
  variant), confirmed failing against the pre-fix source (old English/"Local"/"presentación"
  text observed). GREEN: `test_telegram_lifecycle` 43/43; full `python -m unittest discover`
  1168/1168. GGA: no matching files (`.py` outside its glob). Commit `5692652`.

- 2026-09-23: T13 done, in three commits.

  **Backend** (`6a91fab`: backend + Vite proxy + `docs/prisma/PRISMA_BROWSER_ROUTING.md`).
  New `telegram_verification.py`: `TelegramTokenVerificationService`, shared by both channels
  (each composed around its own credential resolver, exactly like `GeminiVerificationService`
  composes around a `GeminiCredentialResolver`). Deliberately does NOT reuse
  `ChannelATransport.get_me()` or `TelegramLocalBot.observe_identity()` -- both were read
  first as the task asked, and both are production connect-time calls that intentionally
  collapse every failure (bad token, network error, malformed response) into one generic
  code, so neither can distinguish "invalid token" from "unreachable", which is exactly what
  on-demand verification needs to report. Built one narrow `getMe`-only HTTP call instead,
  with its own status classification (401 -> `invalid_token`; anything else abnormal ->
  `unreachable`, fail-closed since the token may still be valid). Never calls `getUpdates`
  (no offset read/consumed) and never sends a message. `channel_a_manager.py`: added a public
  `resolver` alias (`self.resolver = self._resolver`) mirroring `TelegramLifecycleManager`'s
  already-public `resolver` attribute, so `local_presentation.py`'s composition root can
  build each verification service from the exact same resolver save/apply already use,
  without reaching into a private attribute. `admin_http.py`: generalized Gemini's
  `_provider_metadata`/reset-on-save-or-delete machinery to all three providers;
  `telegram`/`telegram_channel_a` entries in the generic `/api/prisma/admin/credentials` GET
  now also carry `verified`/`verification` (`{state, checkedAt, username}`); two new POST
  routes `.../telegram/verify` and `.../telegram_channel_a/verify` (same auth/origin/CSRF
  pattern as Gemini's, 409 on concurrent verify, 503 when no service composed). Verification
  is deliberately independent of `channel_a_manager`'s mutation lock (busy/activation/
  generations) -- it never touches manager state. Proxy: two new anchored routes in
  `vite.prismaProxy.config.ts` following the existing `createRoute` pattern. RED verified
  throughout (new tests failed against pre-change source: `test_telegram_verification.py`
  confirmed via a temporary file move + restore since the module was new; `test_channel_a_manager.py`
  new resolver-alias test; `test_credential_http.py` and `test_channel_a_admin_http.py` new
  verify-route/reset assertions; `vite.prismaProxy.config.test.ts` two new declared-route
  rows + lookalike/pattern-isolation rows). GREEN: `test_telegram_verification` 14/14; full
  `python -m unittest discover` 1191/1191; `vite.prismaProxy.config.test.ts` 77/77. GGA
  PASSED (2 non-blocking notes: the 503-body-builder duplication already flagged after T4c,
  and the repeated `127.0.0.1:5057` literal already flagged then too -- neither touched).

  **Frontend** (`218c203`). `adminCredential.types.ts`: added
  `TelegramTokenVerificationState`/`TelegramTokenVerification`/
  `TelegramFamilyCredentialProviderMetadata` (extends the base `{configured}` shape with
  `verified`+`verification`, the `username` field distinguishing it from Gemini's own
  verification shape); `CredentialMetadata.telegram`/`.telegram_channel_a` narrowed to the
  new type (exact-key, closed-enum parser, same fail-closed discipline as Gemini's);
  `parseTelegramVerificationResult`/`parseChannelAVerificationResult` for the two verify
  endpoints' envelopes (`{ok, telegram}` / `{ok, channelA}`). `adminAuth.service.ts`:
  `verifyTelegram()`/`verifyChannelA()` posting an empty `{}` body with the active private
  CSRF (mirrors `verifyGemini()`); added the four new error codes to the public allowlist.
  `usePrismaCredentialAdministration.ts`: `verifyTelegram`/`verifyChannelA` follow the same
  `runOperation('verify-telegram'|'verify-channel-a', ...)` + `refresh()` lifecycle as every
  other explicit action. `VoiceCredentialSettings.tsx`: added
  `telegramTokenVerificationGlyph()` (verified -> `Check` success with a
  "Token verificado: @<username>" tooltip; `invalid_token` -> `CircleX` critical, "Token
  inválido"; `unreachable` -> `WifiOff` warning, "No se pudo verificar: sin conexión con
  Telegram"; else -> `MessageCircleDashedCheck` muted, "Verificación: no realizada", reusing
  the exact icon choices already established for Gemini's row) and a shared
  `verifyTelegramFamily(provider)` action dispatching to the right client method. Wired
  Verificar + its icon into the existing `ml-auto` trailing block of
  `renderTelegramFamilyProvider`, reusing `VerifyButtonLabel` (T9d's stable-width grid stack)
  and `StatusIcon` unchanged. Updated collateral test fixtures across
  `VoiceCredentialSettings.test.tsx`, `GlobalSettingsDialog.voice.integration.test.tsx`,
  `usePrismaCredentialAdministration.test.tsx`, `adminAuth.service.test.ts` and
  `adminCredential.types.test.ts` wherever a `telegram`/`telegram_channel_a` metadata fixture
  needed the extended shape (the exact-key parser now rejects the old bare `{configured}`
  shape for these two providers). RED verified per layer (domain parsers: 5 new tests failed
  against the pre-change types; service: 5 new/updated tests failed -- missing methods; hook:
  6 new tests failed -- missing methods; component: 9 new tests failed, confirmed a second
  time by stashing the component's own T13 diff and re-running the full file, restoring
  after). GREEN: `VoiceCredentialSettings.test.tsx` 64/64 (68/68 after the follow-up fix
  below); full `npm test` 211 files / 2310 tests; `tsc -b --noEmit` and `eslint` clean.

  **Layout decision** (asked for explicitly): the trailing area of each Telegram-family row
  reads, left to right: `@username` (when connected) -> execution status icon (live
  connectivity, unchanged from T10) -> Verificar -> its own verification icon (T13, an
  on-demand re-check of the stored token itself). Chosen so "what's happening right now"
  reads before "check the token on demand", and because it reuses Gemini's own row ending
  (Verificar then its icon) verbatim rather than inventing a second convention. All three
  rows now end in a Verificar+icon pair; Gemini's stays right after Save/Delete inside its
  own `ml-auto` block (no execution icon there), Telegram/Canal A's follows their
  `@username`+execution icon inside the shared `ml-auto` block. Documented inline in the
  component and covered by a new structural test asserting DOM order.

  **Follow-up fix** (`21fe03a`, same day). GGA's one legitimate finding on the frontend
  commit: `errorText()` had no entries for the four new verification error codes
  (`TELEGRAM_VERIFICATION_IN_PROGRESS`/`_UNAVAILABLE`,
  `PRISMA_CHANNEL_A_VERIFICATION_IN_PROGRESS`/`_UNAVAILABLE`), so they fell through to the
  generic fallback message instead of Gemini-parity specific text. Added all four (the
  in-progress pair reuses Gemini's existing generic wording verbatim -- it names no provider
  --; the unavailable pair gets "La verificación del Canal A/Canal B no está disponible.").
  RED: 4 new tests (2 concurrent-verify, 2 unavailable) failed against the pre-fix map,
  showing the generic fallback text instead of the specific one. GREEN:
  `VoiceCredentialSettings.test.tsx` 68/68; full `npm test` 211 files / 2314 tests (one
  unrelated full-suite-only flake reproduced once, confirmed passing on immediate re-run,
  same class as the pre-existing `Dashboard.test.tsx` flake noted after T4b); `tsc -b
  --noEmit` and `eslint` clean. GGA PASSED, 3 non-blocking notes (pre-existing "Telegram" in
  some error-code copy vs the row's new "Canal B" name -- a real but out-of-scope
  observation, since those codes belong to save/apply/delete, not this task; `border-white/10`/
  `bg-black/10` non-token Tailwind colors, already the established admin pattern; stale
  task-ID comments -- none touched).

- 2026-09-23: T14 done. `VoiceCredentialSettings.tsx`: removed the dead T9d stable-width
  grid-stacked "Verificar"/"Verificando…" label pair, `VerifyButtonLabel`,
  `geminiVerificationGlyph`, `telegramTokenVerificationGlyph`, `telegramExecutionGlyph` and
  `channelAExecutionGlyph`; replaced them with a new `ResultGlyph`/`ResultDisplay` pair (a
  result now carries an optional visible `text` alongside its icon, not just an icon+tooltip),
  a new icon-only `VerifyIconButton` (Lucide `Play`/spinning `Loader2`, grouped with
  Save/Delete, same variant/size, `aria-label`+`HoverTooltip` for the accessible name), and
  four pure glyph functions (`geminiVerificationResult`, `telegramTokenVerificationResult`,
  `telegramConnectionResult`, `channelAConnectionResult`). Telegram/Canal A rows now hold a
  `verificationResultVisible: Record<'telegram'|'telegram_channel_a', boolean>` state flag and
  a `verificationRevertTimersRef` (one `setTimeout` id per provider): `verifyTelegramFamily`
  clears any pending timer, calls the client, and on a successful response sets the flag true
  and -- only when `result.verification.state === 'verified'` -- schedules a revert to false
  after `VERIFICATION_RESULT_DISPLAY_MS`, guarded by the existing `panelGenerationRef` pattern
  so a stale timeout can never update state after the panel was hidden/reset; `save`/`remove`
  call a new `resetVerificationResultIfTelegramFamily` on success (clears the timer and the
  flag immediately, since the backend already resets verification on save/delete per T13); a
  dedicated empty-deps `useEffect` cleanup clears both timers on unmount. Gemini's row has no
  such flag/timer -- its result area always reflects the live verification state directly
  ("Result persists, Gemini has no live state to return to" per the brief). Icon rename:
  `MessageCircleDashedCheck` -> `CircleDashedCheck` for every "not yet verified" state
  (confirmed installed in the already-bumped `lucide-react@1.47.0`, both `CircleDashedCheck`
  and `Play` present). New copy per the brief: Gemini "Verificada"->"Verificado",
  "No se pudo verificar: sin conexión con Google"->"Sin conexión con Google"; Canal A/B
  connection-state "Estado del bot no confirmado"->"Estado no confirmado" (all other
  connection-state strings unchanged, now shown as visible text instead of tooltip-only).
  Coordinator mid-task width requirement: `CREDENTIAL_INPUT_WIDTH_CLS` shrunk from T11's
  `w-full md:w-80` to `w-full md:w-44`; new `RESULT_AREA_WIDTH_CLS = 'min-w-[33ch]'` shared by
  all three rows' result areas (full arithmetic above in the T14 task entry).
  RED: ran the full pre-T14 test file against the rewritten component first -- 17 of 68 tests
  failed (button/icon/text queries against the retired separate-slot layout and the old
  "Verificada"/"No se pudo verificar..."/"Estado del bot no confirmado" copy), confirmed
  against the actual failing-test list before changing any test. Rewrote/removed those 17 and
  added 8 new ones (Gemini's structural order test rewritten for the merged result area; a
  parallel structural-order test for Canal A; a shared-result-area-width test; a 32-char
  max-length-username no-truncation test; and, inside a new `describe('verification result
  display duration')` block using `vi.useFakeTimers({shouldAdvanceTime:true})` +
  `userEvent.setup({delay:null, advanceTimers:vi.advanceTimersByTime})`: the timed revert on a
  successful verify, persistence of a failed verify past the duration, timer cleanup on
  unmount asserted via a `console.error` spy staying uncalled, and immediate timer
  cancellation when Save resets verification). Two intermediate fixture bugs found and fixed
  while iterating (not scope creep): the new invalid_token/unreachable/timed-revert tests
  originally passed a constant `credentialMetadata` mock that kept returning the pre-verify
  metadata on the post-verify `refresh()` call, so the rendered result (sourced from
  `credentials?.[provider].verification`, unchanged T13 contract) silently fell back to
  "Verificación: no realizada" instead of the verified/failed state under test; fixed by
  chaining `.mockResolvedValueOnce(configuredA).mockResolvedValue({...configuredA,
  telegram_channel_a: <expected post-verify state>})`, matching the existing pattern already
  used by the "verifies the bot token" tests. GREEN: `VoiceCredentialSettings.test.tsx`
  74/74; full `npm test` 211 files / 2320 tests; `npx tsc -b --noEmit` clean; `npm run lint`
  clean (fixed one leftover unused fixture and one unnecessary eslint-disable found by lint,
  both pre-existing-test-shape artifacts of the rewrite, not new findings).
  GGA: first attempt FAILED -- legitimate finding: the `CREDENTIAL_INPUT_WIDTH_CLS` comment
  walked through the full container-width arithmetic inline in source, which GGA correctly
  read as a "calculated dimensional estimate" under `docs/CONVENTIONS.md`'s anti-hardcode
  policy, rather than a plain design-token choice (T11's original `w-80` had no such inline
  derivation and was never flagged). GGA's own suggested fix (`flex-1`+`basis-40`) was not
  applied: it would make the input's rendered width vary with each row's own leftover space
  again, reversing T11's fix and directly violating the coordinator's explicit "keep one exact
  shared width" requirement for this task. Instead, trimmed the inline comment to a short
  design-token rationale (same style/precedent as T11's own accepted comment) and moved the
  full arithmetic to this tracker entry only, per the coordinator's own instruction to "write
  the arithmetic in the tracker" (not necessarily duplicate it in source); the token value
  (`md:w-44`) itself was not changed. Also tightened the `RESULT_AREA_WIDTH_CLS` comment's
  wording per GGA's minor (non-blocking) note that `ch` is a proxy from the "0" glyph, not an
  "exact" width. Second attempt: GGA PASSED, one accepted note (min-w-[33ch] is
  content-derived but fits the CONVENTIONS.md "fixed structural value" exception since 33 is
  Telegram's own API limit, not a guess). Commit `8b2fb6e`.

- 2026-09-23: T15 done, in three commits (full task detail and root-cause diagnosis already
  recorded in T15's own task entry above; this logs the RED/GREEN/GGA evidence).

  **Hook** (`a1c0a9b`). RED: reused/extended the existing `usePrismaCredentialAdministration
  .test.tsx` -- the 6 tests asserting `pendingAction === 'verify-*'` failed once verify stopped
  setting it (moved to `runVerify`'s own `verifyingProviders`); updated them plus added a new
  cross-row independence test and a same-row-save-discards-a-late-verify staleness test. GREEN:
  `usePrismaCredentialAdministration.test.tsx` 32/32.

  **Backend** (`819a08f`). RED per layer, each confirmed failing before implementing: 
  `test_channel_a_pairing.py`'s `test_has_any_link_...` (`AttributeError`), 
  `test_channel_a_activation.py`'s `test_has_paired_owner_...` (`AttributeError`), 
  `test_channel_a_manager.py`'s `test_status_exposes_paired_...` (missing `STATUS_KEYS` member),
  `test_channel_a_admin_http.py`'s two six-vs-eight-field assertions, `test_credential_http.py`'s
  three exact-shape assertions missing `model`. Root-cause reproduction
  (`test_a_background_activation_failure_is_not_reflected_in_manager_last_error`) is a
  diagnostic, not a RED/GREEN pair -- it passes unchanged before and after (channel_a_manager.py
  itself was not modified for that disconnect; the fix is frontend-only, see below). GREEN: full
  `python -m unittest discover` 1195/1195 (43 new/updated assertions net across five files, no
  regressions).

  **Frontend** (`36ba072`). RED: ran the full pre-T15 `VoiceCredentialSettings.test.tsx` against
  the rewritten component in three passes as the coordinator's scope grew -- 60 failures after
  the per-row-verify/icon-removal rewrite (mostly a single root cause: every fixture missing the
  new required `model`/`paired` domain fields, crashing `ResultDisplay` on `text.startsWith`),
  down to 21 after fixing the shared fixtures, down to 3 after the per-state icon/text rewrites,
  confirmed fixed after the icon-aria-label regression (`iconLabel` needed on the connection
  "success" glyphs so `role=img name='Bot conectado'` didn't silently become the raw username)
  and the Canal A paired-copy tests. Also fixed `GlobalSettingsDialog.voice.integration.test.tsx`
  (5 raw fixtures needing `model`/`paired`, 1 icon-removal assertion) and
  `usePrismaCredentialAdministration.test.tsx`/`adminAuth.service.test.ts`/
  `adminCredential.types.test.ts` (fixture-only `model`/`paired` additions, all through the real
  parser in those files). Added dedicated fake-timer tests for Gemini's own resting/verified/
  revert/failure cycle (mirroring Canal A's) and a component-level cross-row independence test.
  GREEN: `VoiceCredentialSettings.test.tsx` 79/79; full `npm test` 211 files / 2329 tests;
  `npx tsc -b --noEmit` clean; `npm run lint` clean. GGA PASSED on the hook and the frontend
  commits (2 optional non-blocking notes each, none acted on: a `CREDENTIAL_PROVIDERS` constant
  suggestion for the hook, an icon-size-literal note for the component, both pre-existing-pattern
  observations); the backend commit matched no GGA file pattern (`.py`), as with every prior
  Python-only commit in this tracker.

## Next step

All seventeen roadmap items were committed before T14. Still pending, unchanged by
T11/T12/T13/T14: manual re-checks of point 3 (relaunch after closing the launcher window with
X), point 4 (foreign process on 5057, terminal + popover), T5b (Ver viewer keeps the session),
point 6's Chrome-specific no-autofill-prompt behavior (T9c's proof was offline/mocked only),
and T10's own manual test (save/delete a Canal A and a Telegram token, plus one deliberately
wrong token). New from T13: manual test of Verificar on both rows against real Telegram (valid
token, deliberately wrong token, and offline/unreachable) to confirm the three verification
states render as expected outside the mocked test suite -- this writer's Python tests mock
every HTTP call, so the real Telegram Bot API surface (401 shape, timeout behavior) was never
exercised end-to-end. New from T14: manual check of the credentials panel in the real
GlobalSettingsDialog -- confirm all three rows (Proveedor de voz, Canal A, Canal B) fit on one
line at the dialog's normal (desktop, >= md) width with no wrap, the icon-only Verificar button
reads clearly next to Save/Delete, the trailing result area shows the expected text+icon for
each state (including a real long Telegram username if available), and the 5-second
auto-revert after a successful Canal A/B verification is visually smooth and not jarring; this
writer's test suite only proves the DOM/timer contract, not the real rendered layout (no
browser was available to confirm the exact `md:w-44`/`min-w-[33ch]` fit against real font
metrics -- see the arithmetic in T14's own task entry above). New from T15: manual re-check of
the panel confirming (a) verifying one row no longer blocks the other rows' Save/Delete/Verify
in the real browser (this writer only proved it against mocked clients), (b) the Canal A
"Bot vinculado"/"Bot disponible, sin vincular" transient message reads clearly before reverting
to "@username" against a REAL paired and REAL unpaired bot (the `paired` backend signal was
proven only against fakes/mocks, never a live Telegram pairing flow), (c) whether the
previously-observed "Estado no confirmado" Canal A failure actually recurs as
"No se pudo conectar el bot" now, ideally by reproducing a real transient network failure during
long-polling (not exercised end-to-end -- this writer's Python tests mock every HTTP call), and
(d) the Gemini model name displays legibly and turns green after a real verify.
