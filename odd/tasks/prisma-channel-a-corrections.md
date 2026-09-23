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

## Next step

All twelve roadmap items are committed: T1b (`5bf9fa4`), T4b (`c4cf0f1`), T8 (`4a6b4a5`,
`039bf14`, `02d9695`), T4c (`95d5d2a`, `f2ebf49`), T1c (`f34a8ad`), T4d (`9ad120d`,
`5cd10a5`), T5b (`65c2b80`), T9 (`ca696e9`, `56d7a32`), T9b (`5917ca6`) and T9c (`43069c5`,
`a5a2908`, `8110edb`). Next step: the user re-runs manual test point 4 (foreign process on 5057,
confirm the popover now shows the port through the session bootstrap AND the terminal shows
exactly one clean red line), re-checks point 3 (relaunch after closing the launcher window
with X, confirm the terminal now announces the reused runtime), manually verifies T5b (enter
/admin, click "Ver viewer", confirm the session stays active; confirm "Cerrar sesión" still
ends it), re-checks point 6 against T9c's icon/tooltip/no-password-prompt refinements (this
writer's proof was offline/mocked only -- no network, no launcher/runtime, no real Chrome
autofill behavior observed, per constraint), and then T10 applies the same approved Gemini
row design (single row, icons, HoverTooltip) to the Telegram and Canal A provider rows.
