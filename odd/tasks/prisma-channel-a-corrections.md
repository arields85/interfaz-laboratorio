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

## Next step

T1b (`5bf9fa4`), T4b (`c4cf0f1`) and T8 (`4a6b4a5`, `039bf14`, `02d9695`) are all
committed. Next step: manual verification with the real launcher (user).
