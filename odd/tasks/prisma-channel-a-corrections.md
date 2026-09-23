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

- [ ] **T1b** Launcher always starts Prisma (user decision 2026-09-23, supersedes T1's
  fail-closed refusal): reuse a verified healthy runtime of this repo; otherwise stop any
  verified leftover Prisma processes of this repo on 5056/5057 (never owner PIDs, never
  non-Prisma processes), discard the old manifest regardless of owner state, start fresh.
  If a non-Prisma process holds a port: clear terminal message naming port, process name
  and PID, and a structured failure (`port_in_use` + detected port) in the dev receipt.
  Route: delegated (writer). Trigger: 2+ non-trivial files.
- [ ] **T4b** Pairing popover shows the detected busy port: `dev.mjs` passes the receipt
  failure to Vite; the Prisma proxy answers unreachable requests with a JSON failure
  (reason + port); service/hook/popover show "Prisma no se pudo iniciar: el puerto <port>
  está en uso por otro programa." Port comes from data, never a UI literal.
  Route: delegated (same writer, after T1b).

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

## Next step

Writer: T1b then T4b. Afterwards the user verifies manually with the real launcher.
