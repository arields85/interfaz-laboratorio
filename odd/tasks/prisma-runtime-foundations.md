Repository-relative file: odd/tasks/prisma-runtime-foundations.md

# Prisma runtime foundations — single-command local development

## Objective and problem

Continue E1.1 from the completed safe-unconfigured runtime increment into one bounded local-development integration. Keep `npm run dev` as the single developer command, automatically acquire the repository-owned Prisma runtime before launching Vite, and release only a runtime identity that this development session collectively owns. Prisma unavailability must remain nonfatal to the HMI, and all lifecycle behavior must be provable through offline seams without starting services or probing real machine state.

## Authorized scope

FND-1–FND-8 are complete and preserved below. The authorized next direct implementation increment is limited to FND-9–FND-11:

- an atomic development-runtime acquire/release boundary that reuses only verified canonical same-repository listeners;
- a thin Node ESM `npm run dev` wrapper that forwards all arguments to the unmodified Vite CLI and treats Prisma startup failure as a warning;
- offline lifecycle tests, full independent verification and operator documentation reconciliation.

The increment is local development orchestration only. It does not select a production host, add OS supervision, claim forced-terminal or OS-crash durability, or change browser runtime-mode selection. The HMI currently defaults to `central`; automatic process startup therefore makes Prisma available but does not silently switch an operator's persisted or default browser preference to `local`.

## Constraints

- Keep the existing canonical schema and completed audio projection work unchanged.
- Parent readback closed FND-6–FND-8; the next implementation dispatch is limited to prepared FND-9–FND-11 after parent readback and command authorization.
- During implementation, preserve the current local bind addresses, ports, process ownership checks, startup-failure rollback and existing liveness fields consumed by current clients.
- Keep provider configuration separate from provider verification: a present key/token may be reported as configured, but never as connected or verified until a later explicit provider check proves it.
- Health endpoints must not call Gemini, Telegram or any external provider. Existing local service-to-service voice health probing may remain because it verifies runtime liveness, not provider readiness.
- Telegram remains explicit opt-in. Disabled Telegram must not construct a bot or make requests. Enabled Telegram with a missing token must be reported as enabled but unconfigured, must not construct/start a bot, and must not kill the runtime.
- State/log/run-directory initialization may occur during normal startup, but dependency installation, virtual-environment creation and lock reconciliation may occur only during explicit bootstrap.
- Missing virtual environment or required dependencies must stop startup before any service process is launched and name `operations\bootstrap-local.ps1` as the remediation. Startup must not silently install, reconcile or fall back to another interpreter.
- Do not add secret persistence, credential APIs, network authentication, a new settings framework, HMI fields, diagnostics UI, browser loader behavior, supervisor behavior or deployment integration.
- No production services, real process probes, provider/Telegram requests, installations, external API probes, commits, staging, pushes, credentials, `.env` files, ambient runtime state or legacy/worktree deletion.
- English for new technical tracking and memory; preserve neutral professional Spanish in the existing master. Preserve historical audit evidence as historical.
- About 400 authored lines per task is a planning heuristic only; do not omit tests, compress code, or split a coherent fix artificially to meet it.
- The task file and complete mirror `odd/prisma-runtime-foundations/tasks` must be updated and read back after each task.
- Preserve all 13 currently modified, uncommitted FND-6–FND-8 files. No source-control mutation or cleanup belongs to this increment.
- `npm run dev` remains the only normal developer command and must preserve Vite CLI arguments, HMR and Vite-managed config restarts. `build`, `preview`, Vitest and config imports must never acquire Prisma.
- Parent-spawned PowerShell helpers and Python services remain hidden; the user's existing npm/Vite terminal remains attached and visible. Browser or tab closure never controls backend lifetime.
- Missing credentials remain a valid unconfigured state. Missing owned Python or imports, a failed runtime start, or unsupported development OS must produce an honest console diagnostic and still allow Vite to run.
- Do not bootstrap, install, reconcile dependencies, read credentials or `.env`, call providers, probe the network, inspect ambient runtime state, or launch real services during tests or verification.
- Reuse an existing runtime only when the canonical manifest belongs to this repository and every expected listener exactly matches its recorded identity. Any occupied port without that complete proof is foreign and must not be reused or killed.
- Serialize check/reuse/start/manifest mutation and release through one repository-runtime-scoped cross-process lock. Extend the existing canonical manifest rather than creating a parallel manifest, lease subsystem or generalized supervisor.
- Development ownership may add exact process creation identity and a bounded set of active development owner tokens to the canonical manifest. Legacy schema-v1 records without the new fields must remain readable by existing prune/stop paths; they cannot be upgraded into development-owned identities merely by being observed.
- Normal release removes its owner token exactly once. Only the last registered owner may stop listeners originally started by that development ownership session, and only after exact PID, executable, module, command line, port and creation identity verification. Reused manual/preexisting processes are never stopped.
- Startup failure, cancellation before Vite, Vite spawn failure, Vite exit, `SIGINT` and `SIGTERM` all converge on idempotent release. Broad image-name termination, `taskkill`, PID-only termination and trust in a mutable manifest without live identity verification are forbidden.

## TDD and verification

- Effective TDD remains ON for bugs and pure logic under `AGENTS.md` section 8 and `docs/TESTING.md` sections 5–6. FND-9 and FND-10 start with failing tests against ownership and child-process seams before source changes.
- This preparation used source and memory readback only. No test, launcher, service, process probe, provider, installer, network or ambient-state command was executed.
- Implementation verification must run from the repository root in a sanitized child environment with `PRISMA_RUNTIME_STATE_DIR` and all mutable temporary files under `C:\Users\ARIELD~1\AppData\Local\Temp\opencode`; bytecode generation is disabled.
- The test child must clear provider credentials, Telegram credentials and opt-in, proxy variables, Python injection variables, and any inherited Prisma mutable-state/config path overrides before setting only the isolated test paths and repository `PYTHONPATH`.
- Tests must use existing temporary-directory fixtures, subprocess seams and HTTP/provider mocks. They must not call real `Start-Process`, `Stop-Process`, Gemini, Telegram or any other network provider.
- Missing dependencies or a missing owned interpreter are stop conditions for verification. Do not run bootstrap, pip or any installer to repair the environment.
- The main Python command is `& '.\services\prisma-runtime\.venv\Scripts\python.exe' -B -m unittest discover -s services/prisma-runtime -p 'test_*.py'`.
- Changed PowerShell scripts receive parser-only checks through `[scriptblock]::Create(...)`; do not execute the launchers as verification. Final static checks are `git diff --check` and scoped diff/status readback.
- Node orchestration tests must inject or fake child-process, signal and platform seams. They must never execute the real npm dev command, Vite server, PowerShell runtime launcher or Prisma services.
- PowerShell lifecycle tests must use temporary manifests/state and stub process, listener, wait and stop functions. Concurrency coverage must use isolated test processes against temporary lock/manifest paths only, never canonical ports or machine state.
- The orchestration test is `hmi-app/scripts/dev.test.ts` with `// @vitest-environment node`, so it remains in the standard Vitest suite. The focused command is `npm.cmd run test -- scripts/dev.test.ts` from `hmi-app`; do not add a parallel Node test runner or alter Vitest discovery.
- Full verification adds HMI unit tests, TypeScript build checking, production build and lint because `hmi-app/package.json` and a Node development entry point change. None may import or start the development orchestrator as a side effect.
- RDD: off by default, observed through read-only mode status. Do not enable or start review. Parent risk assessment and independent verification still apply; no risk verdict is inferred from assessment failure.
- Do not invent RED/GREEN, runtime, provider, process-survival or implementation evidence.

## Tasks

- [x] FND-1 — Make generator identity and projection ownership reproducible.
  - Normalize only CRLF/CR to LF for the schema digest; retain sensitivity to other schema edits.
  - Compare complete expected generated content without mutating files in the checker; tolerate checkout newline conventions only.
  - Tests must show newline portability, safe imports/temporary output generation, and detection of Python and TypeScript body drift despite unchanged embedded hashes.
- [x] FND-2 — Align generated Python validation with the existing schema.
  - Reject invalid run-ID suffixes, missing required browser fields, unknown payload keys, booleans as numbers and non-finite numeric values.
  - Preserve optional provider/backend fields and the browser-only TypeScript projection. Do not add schema maxima or expand product requirements.
  - Update only invalid synthetic fixtures; regenerate both outputs and add TypeScript parity guards.
- [x] FND-3 — Verify the increment independently and reconcile current status.
  - Observe targeted/full checks, compare scope against existing dirty work, update master/backlog detail without erasing historical failures, and read back the complete tracker mirror.
  - Keep PW-002 and PW-003 open. No runtime durability, access control, live acceptance or complete E1.1 closure is claimed.
- [x] FND-4 — Reconcile the user-corrected active scope in documentation and canonical memory.
  - Preserve completed audio evidence and factual source inspection, but withdraw synthetic crash investigation as an active prerequisite.
  - Record that no spontaneous failure was reported during use; do not convert this clarification into a reproduced cause or fixed bug.
  - Update the active master, PW-002 index summary and supplied canonical memories, then mirror and read back this complete task file.
- [x] FND-5 — Validate the source-backed HMI startup mapping and define the next integration boundary.
  - Confirm that the current browser entry points do not own runtime startup, the launcher bootstraps on every start and configuration/diagnostics do not yet cover protected credentials or operational state.
  - Keep the deployment owner unresolved: do not invent a server OS, service manager, desktop framework or OS-boot requirement.
  - Recommend a staged boundary—separate installation from normal start, then support safe unconfigured startup before secrets/UI work—without implementing it.
- [x] FND-6 — Implement safe unconfigured runtime behavior.
  - Add tests first for voice health and key-requiring endpoints with no Gemini key: preserve `ok`, `ready`, `service` and `mode` liveness compatibility, add explicit configured-versus-verified integration status, and return a stable actionable unavailable response without attempting a provider call.
  - Add tests first for disabled, configured opt-in, and enabled-but-missing-token Telegram states. Missing token must be observable without exposing token material, constructing the bot, starting its thread or making a Telegram request.
  - Keep the runtime active when integrations are absent. Never infer provider verification from secret presence, and never include secret values in payloads, errors or logs.
  - Acceptance: both services can construct and answer health in an environment with no provider credentials; health performs no provider request; provider-dependent voice operations fail safely and locally; existing health liveness keys and explicit Telegram opt-in behavior remain compatible.
- [x] FND-7 — Separate explicit installation from normal startup.
  - Add PowerShell seam tests first showing that `start-local.ps1` never invokes bootstrap, pip, virtual-environment creation or dependency installation.
  - Preserve lightweight state/config/log/run initialization on startup without invoking the installer. Keep explicit `bootstrap-local.ps1` responsible for virtual-environment creation and pinned dependency reconciliation.
  - Add a pre-launch readiness check for the repository-owned interpreter and required runtime imports. Missing environment/dependencies must fail before `Start-Process`, provide the explicit bootstrap remedy, and never fall back to PATH or mutate dependencies.
  - Preserve port preflight ordering, verified listener ownership, manifest behavior and all-or-nothing rollback after a launched child fails readiness.
  - Acceptance: normal startup works after one explicit bootstrap without reinstalling; an absent or incomplete owned environment stops before process launch with actionable remediation; state/log initialization remains independent of installation.
- [x] FND-8 — Verify independently and reconcile operator documentation.
  - Run focused tests for runtime safety, operations and Python-environment seams in the sanitized offline harness, then the full Prisma unittest discovery command.
  - Parse every changed PowerShell file without executing it, run `git diff --check`, inspect the scoped diff/status, and record exact results without claiming provider or live-service verification.
  - Update `services/prisma-runtime/README.md` in the implementation work unit so operators bootstrap explicitly once, start normally without credentials, understand configured versus verified status, and receive missing-environment/dependency remediation.
  - Obtain parent independent readback before marking this task complete. Keep deployment wiring, protected secret management, Voice UI and live provider acceptance open.
- [x] FND-9 — Add the bounded development-runtime ownership acquire/release seam. **Corrected after independent finding #5355 and closed offline by FND-11.**
  - Write failing offline PowerShell seam tests first for cold acquisition, complete canonical same-repository reuse, incomplete/foreign occupation, startup failure rollback, last-owner release and idempotent duplicate release.
  - Serialize the complete check/reuse/start/register transaction and every participating canonical-manifest writer, including explicit manual stop, with one scoped lock. Concurrent acquisitions must produce one runtime identity and an uncorrupted canonical manifest; later owners join only an already verified development-owned session.
  - Extend newly created process records with creation identity while keeping schema-v1 legacy records readable. A complete verified legacy/manual runtime may be reused but must never become stoppable by the development wrapper.
  - Register development owner tokens only for processes originally created by the development acquisition. Release removes one token; nonfinal release preserves listeners, and final release stops each exact live identity at most once.
  - Preserve current loopback hosts, ports, hidden service windows, interpreter/dependency preflight, installer-free startup, readiness checks and partial-start rollback. Do not weaken the corrected PowerShell 5.1 `NativeCommandError` behavior.
  - Acceptance: cold start ownership, safe canonical reuse, foreign-port refusal, failed/cancelled acquisition cleanup, concurrent no-duplicate behavior and exact final-owner cleanup are all demonstrated without real processes or ports.
- [x] FND-10 — Wire the single npm development command through a thin Vite-preserving wrapper. **Corrected after independent finding #5355 and closed offline by FND-11.**
  - Write failing Node tests first using injected child-process and signal seams. Cover runtime acquisition success/failure, unsupported OS fallback, exact Vite argument forwarding, Vite spawn failure/exit, `SIGINT`, `SIGTERM` and cleanup-once behavior.
  - Add `hmi-app/scripts/dev.mjs` as the only new orchestration entry point and change only the `dev` script to invoke it. Resolve and spawn the installed Vite CLI with the current Node executable, inherited stdio and the exact user arguments; do not copy Vite's CLI parser.
  - On Windows, invoke the bounded PowerShell acquisition helper with a per-invocation opaque owner token, token-array arguments, `shell: false` and `windowsHide: true`; every path must remain safe with spaces. A bounded runtime acquisition error is diagnostic-only: Vite still starts and the HMI remains usable.
  - Start Prisma once per npm invocation, not per Vite config reload or HMR cycle. On normal Vite completion or forwarded termination, await idempotent owner release before mirroring Vite's result.
  - On unsupported development operating systems, state that automatic Prisma orchestration is unavailable and launch Vite normally. Do not claim cross-platform runtime support or production supervision.
  - Acceptance: `npm run dev -- <vite args>` retains Vite behavior, automatically attempts hidden Prisma startup only on supported local Windows development, and never makes build/preview/test/config import paths acquire Prisma.
- [x] FND-11 — Verify independently and reconcile local-development documentation. **Closed offline by parent approval after corrected independent PASS.**
  - Run focused Node and sanitized PowerShell-operation suites first, then full Prisma unittest discovery, HMI unit tests, TypeScript checks, production build and lint. Parse every changed PowerShell file and run `git diff --check` plus scoped diff/status readback.
  - Update `services/prisma-runtime/README.md` in the implementation work unit: bootstrap remains explicit, `npm run dev` becomes the normal combined local command, Prisma failure remains nonfatal to Vite, and shutdown/reuse/unsupported-OS boundaries are stated without durability claims.
  - Record that the browser default remains `central`; operators must already select/persist `local` for the HMI to consume the local runtime. Do not add a loader, UI prompt or silent mode override in this increment.
  - Obtain parent independent readback before completion. Keep production deployment/supervision, protected credential management, browser diagnostics/Voice settings, remote access controls and live provider acceptance open.

## Original audio increment history and current reconciliation

- Original audio increment start: `main` at `82dd2f1`, ahead 1 of local `origin/main`; the runtime environment, schema tooling, documentation and two unrelated HMI files were dirty at that time. This is historical state, not a claim about the current worktree.
- Previous audit reported 74 Python tests and 72 focused frontend tests passing; these are not current-run evidence.
- The previous checker failure was newline-sensitive hashing; Python/TypeScript contract divergence was independently confirmed before correction. Generated files are now owned by complete normalized-content checks plus actual-repository discovery coverage.
- Lifecycle mapping found the prior success-path wrapper kill already fixed and tested. The historical audit also observed absent listeners and a stale manifest, but the user reports no spontaneous failure during use: Prisma answered later consultations unless the launcher/terminal was closed. The proposed synthetic crash experiment is withdrawn from active scope, not completed and not evidence of a fixed crash.
- FND-1 completed with strict TDD: the new 4-test generation/checker suite first failed on newline-sensitive hashing and undetected body drift, then passed after normalized hashing, LF-explicit writes, and complete in-memory Python/TypeScript comparisons.
- FND-2 completed with strict TDD: Python first failed 6 genuine assertions across exact run-ID matching, required browser payloads, and finite numeric validation. An added TypeScript unsafe-integer acceptance assertion also failed against the original safe-integer behavior; independent review identified that assertion and the resulting `Number.isInteger` change as unintended scope broadening, not prior bug evidence.
- Initial writer-side evidence passed after generation: checker exit 0, 82/82 Python tests, 1964/1964 HMI tests across 198 files, both TypeScript no-emit checks, `git diff --check`, and explicit whitespace checks for the new test/tracker/master files.
- The bounded correction restored TypeScript `Number.isSafeInteger` checks while preserving arbitrary Python integer counts, and added an actual-repository checker assertion to ordinary unittest discovery. Its strict RED was 2 unsafe-integer TypeScript rejection failures with 7/9 passing; corrected targeted checks passed 15/15 Python audio and 9/9 TypeScript tests. Final writer-side checks passed checker exit 0, 83/83 Python tests, 1967/1967 HMI tests across 198 files, and both TypeScript no-emit checks. At that checkpoint, these local results did not yet satisfy independent FND-3 verification or live acceptance.
- FND-3 closed after parent approval: independent targeted confirmation passed Python 83/83 and TypeScript 9/9 with both review findings resolved; parent checks also observed checker and diff exit 0, unchanged canonical schema and generated TypeScript, and preserved Gauge/Kpi hashes. Writer evidence retains HMI 1967/1967 and both TypeScript no-emit checks. Risk assessment was unavailable because the bounded scope is untracked; RDD remained off and no native lifecycle review was started. No live operation, access, provider, audio, install, commit, or cleanup evidence is claimed.
- FND-4 reconciled the active master to v2.0.4, PW-002 and canonical memories #5289, #5199, #5310 and #5333. The prior synthetic crash recommendation is retained only as withdrawn history. No spontaneous crash, experimentally verified terminal cause or crash fix is claimed.
- FND-5 validated the supplied mapping against `hmi-app/package.json`, browser entry points/router, `start-local.ps1`, `runtime-environment.ps1` and the current Voice settings surface. No common production host owns startup today; the next implementation boundary is deployment-owner selection, install/start separation and safe unconfigured startup—not a synthetic failure experiment or a complete control-plane build.

## Historical preparation baseline and implementation result

The following baseline was verified by readback before FND-6/FND-7 and is retained as historical problem evidence, not current behavior:

- `operations/start-local.ps1` rejected a missing `GEMINI_API_KEY`, rejected enabled Telegram without a token, and invoked `bootstrap-local.ps1` on every start.
- `operations/runtime-environment.ps1` already has separate seams for state initialization, owned-interpreter resolution, environment creation and locked dependency installation. `Initialize-PrismaVirtualEnvironment` always reconciles dependencies, so it must remain bootstrap-only.
- `operations/startup-preflight.ps1` owns pre-launch checks and is the narrowest location for an offline required-import readiness seam. It already rejects foreign/missing interpreters before service launch.
- `voice_service.py` delayed Gemini client creation until a speech operation, but `/health` lacked separate provider configuration status and `/prisma/speak` returned an undifferentiated HTTP 500 for missing configuration.
- `telegram_config.py` raised when opt-in was enabled without a token, so this state stopped presentation startup. Disabled Telegram already avoided bot construction and requests.
- `local_presentation.py` derived Telegram enabled/configured/connected only from a constructed bot and could not represent enabled-but-unconfigured while remaining live. Its voice probe targeted only local voice `/health`, not Gemini.
- `paths.ensure_runtime_state()` and `Initialize-PrismaRuntimeState` already support state-directory creation without a provider. The PowerShell helper additionally seeds the secret-free voice template and is the proposed startup state-init path.
- Existing tests provide offline seams in `test_operations.py`, `test_python_environment.py`, `test_runtime_safety.py` and `test_voice_service.py`. PowerShell subprocess tests stub OS/process functions; Python tests already mock HTTP/provider boundaries and use temporary state roots.

Implementation progress:

- FND-6 strict RED: two direct voice behavior tests failed because `providerStatus` was absent and a whitespace-only key reached the live provider path; `test_runtime_safety.py` failed four cases because Telegram health lacked the new status fields and enabled-without-token still raised before startup.
- FND-6 GREEN: sanitized focused discovery passed `test_voice_service.py` 11/11 and `test_runtime_safety.py` 16/16. No service or provider was started. Health now remains live without keys, reports configuration separately from verification, and missing-key speech requests return a stable 503 without client construction or provider dispatch.
- Telegram disabled and enabled-without-token states construct no bot and make no Telegram request. A configured token is reported only as configured; health does not claim provider verification and never includes token material.
- FND-7 strict RED: two direct launcher tests failed on the credential gates, automatic bootstrap and absent state/dependency readiness calls; `test_python_environment.py` failed two dependency-preflight tests because `Assert-PrismaRuntimeDependencies` did not exist.
- FND-7 GREEN: sanitized focused discovery passed `test_operations.py` 6/6 and `test_python_environment.py` 30/30. Normal startup now initializes only secret-free state, resolves and verifies the owned interpreter, checks required imports without installation, and retains the existing preflight, manifest and failure-rollback flow. Explicit bootstrap remains the only environment/lock installer.
- FND-8 writer documentation: `services/prisma-runtime/README.md` now leads with explicit bootstrap, installer-free normal startup, unconfigured runtime behavior, truthful configured-versus-verified status, and deferred optional browser diagnostics, `npm run dev` wiring and production hosting. At that checkpoint independent verification was still required.
- Source normalization before final checks was limited to the scoped `apply_patch` edits; no generated files, whole-file formatter or unrelated line-ending rewrite was introduced. `git diff --check` passed with only Git's existing LF-to-CRLF checkout warnings.
- FND-8 writer checks used a fresh approved sandbox per command and a child environment rebuilt from the nonsecret OS allowlist. Final focused results were voice 11/11, runtime safety 16/16, operations 6/6 and Python environment 30/30. Full Prisma discovery passed 92/92. Both changed PowerShell scripts parsed successfully without execution.
- Parent correction finding: the initial 92/92 writer suite and first independent PASS were insufficient for the real Windows PowerShell 5.1 missing-import path. With `$ErrorActionPreference = 'Stop'`, native Python stderr raised `NativeCommandError` before the dependency seam could return `$false`, bypassing the intended bootstrap remediation.
- FND-7 correction RED executed the real owned interpreter through a `-B -S` wrapper and failed 1/1 with `ID=NativeCommandError|MESSAGE=Traceback...`, proving the prior stub-only test hid the defect. The correction catches only `NativeCommandError` inside the boolean import probe, suppresses raw expected stderr, returns `$false`, and rethrows every other exception unchanged.
- FND-7 correction GREEN passed the new direct regression 1/1, focused `test_python_environment.py` 31/31 and full Prisma discovery 93/93 in fresh sanitized sandboxes. No dependency, service, provider, network, credential or parent-environment mutation occurred. At that checkpoint FND-8 remained open for renewed independent verification.
- FND-8 closed by parent approval after fresh independent verification of the corrected candidate: focused Python environment 31/31, full Prisma discovery 93/93, and a separate actual Windows PowerShell 5.1 probe observed missing dependencies as `$false`, the assertion as the bootstrap remedy, present dependencies as `$true`, and unrelated exceptions rethrown. ScriptBlock plus AST parsing and `git diff --check` passed. This is offline code-path evidence only: no listener, service, provider, network, production deployment, clean install or RDD receipt was accepted.

Implemented file boundary:

| File | Implemented change |
|------|-----------------|
| `services/prisma-runtime/operations/start-local.ps1` | Removed credential gates and automatic bootstrap; initializes secret-free state and checks owned interpreter/dependencies before process launch. |
| `services/prisma-runtime/operations/startup-preflight.ps1` | Added required-import assertion, bootstrap remediation and corrected PowerShell 5.1 native-error normalization without installation or network activity. |
| `services/prisma-runtime/src/prisma_runtime/telegram_config.py` | Represents enabled-but-missing-token as enabled and unconfigured instead of raising. |
| `services/prisma-runtime/src/prisma_runtime/local_presentation.py` | Builds/starts Telegram only when configured and reports enabled, configured, connected and missing-configuration independently without exposing secrets. |
| `services/prisma-runtime/src/prisma_runtime/voice_service.py` | Adds non-probing Gemini configuration status and actionable missing-key responses while preserving liveness fields. |
| `services/prisma-runtime/tests/test_operations.py` | Guards launcher ordering, no-bootstrap startup, no credential gate and rollback preservation. |
| `services/prisma-runtime/tests/test_python_environment.py` | Covers dependency readiness, real PowerShell 5.1 missing-import remediation and installer-free state initialization. |
| `services/prisma-runtime/tests/test_runtime_safety.py` | Covers Telegram configuration states, health truthfulness and zero-network behavior. |
| `services/prisma-runtime/tests/test_voice_service.py` | Covers unconfigured health compatibility and provider-operation failure without provider construction. |
| `services/prisma-runtime/README.md` | Reconciles explicit bootstrap, normal startup, unconfigured behavior and status semantics. |

No new settings subsystem, provider verification endpoint or deployment launcher was added.

## FND-9–FND-11 preparation and minimal design

Before implementation, source inspection confirmed the smallest concrete boundary:

- `hmi-app/package.json` mapped `dev` directly to Vite; build, preview and Vitest already had independent scripts.
- `hmi-app/vite.config.ts` is shared by Vite and Vitest. It has no process ownership role, so putting runtime startup in a plugin would create config-import/build/test side effects and lifecycle ambiguity across Vite config restarts.
- `hmi-app/src/main.tsx` and `App.tsx` are browser-only. They cannot own a machine process, and browser/tab close must not become a backend stop signal.
- `start-local.ps1` already owns interpreter/dependency preflight, hidden service launch, readiness, canonical manifest writes and partial-start rollback. `process-ownership.ps1` already owns exact listener/manifest comparison, while `stop-local.ps1` is the backward-compatible manual stop boundary.
- The canonical manifest currently records PID, executable, module and command line but no creation identity or cross-process synchronization. `start-local.ps1` rejects every occupied canonical port before it can distinguish safe reuse from a foreign listener.
- The browser runtime default is `central` in `src/config/prismaRuntime.config.ts`. Starting local Prisma does not make the browser consume it until the existing setting is `local`; this increment must not override that unrelated product preference.

Minimal implementation:

| Path | Planned responsibility |
|------|------------------------|
| `services/prisma-runtime/operations/process-ownership.ps1` | Extend live/record identity with optional creation time, canonical-runtime validation, atomic manifest persistence and one scoped lock helper while retaining legacy-record compatibility. |
| `services/prisma-runtime/operations/start-local.ps1` | Accept an optional development owner token; under the lock, reuse a complete verified canonical runtime or perform the existing cold start and register development ownership. Direct/manual startup remains supported. |
| `services/prisma-runtime/operations/release-dev-local.ps1` **(new)** | Under the same lock, remove one owner token and stop only exact newly development-owned identities when the final owner releases. Reused manual/legacy processes are a no-op. |
| `services/prisma-runtime/operations/stop-local.ps1` | Honor the same canonical-manifest lock while preserving explicit manual-stop semantics and startup-failure rollback reentrancy. |
| `hmi-app/scripts/dev.mjs` **(new)** | Generate one opaque token, attempt the Windows PowerShell acquire, spawn the installed Vite CLI with exact arguments/inherited terminal, forward termination and release once. Exports injected seams for offline tests but has no import-time side effects. |
| `hmi-app/package.json` | Change only `dev` from `vite` to `node ./scripts/dev.mjs`. |
| `services/prisma-runtime/tests/test_operations.py` | Add offline acquire/release ordering, failure and non-installation tests. |
| `services/prisma-runtime/tests/test_runtime_safety.py` | Add exact identity, legacy compatibility, reuse/refusal, lock/concurrency, owner-count and final-release tests with temporary state and mocked OS boundaries. |
| `hmi-app/scripts/dev.test.ts` **(new)** | Use the existing Vitest runner with the Node environment and fake child processes/signals to cover orchestration without Vite, PowerShell, Prisma, ports or network. |
| `services/prisma-runtime/README.md` | Document the combined local command and its truthful ownership/fallback limits. |

The canonical manifest remains the only ownership truth. A development-created generation carries its immutable launch records plus active opaque owner tokens. A concurrent invocation joins only after the lock holder proves the full manifest against both live listeners. Manual or legacy canonical processes may be reused but receive no development-owned marker, so release cannot stop them. Creation identity is required for newly development-owned cleanup and optional for legacy reads; this avoids treating a PID reused after launch as the owned process.

The Node wrapper owns only orchestration, not runtime truth. Acquisition has a finite timeout and Vite eventually starts when Prisma is unavailable. If cancellation arrives during acquisition, the wrapper records cancellation, lets the bounded PowerShell transaction settle or roll back, releases its token if registered, and does not abandon launched children. Once Vite exists, `SIGINT`/`SIGTERM`, child error and child exit converge on one release promise. A stale release can act only on the exact recorded development generation and live creation identities; mismatch leaves replacement/foreign state untouched with an honest warning. HMR and Vite config restart remain inside that one child and therefore never reacquire Prisma.

No new dependency is needed. No product decision blocks implementation: the approved single-command lifecycle is implementable while preserving the existing browser `central` default and persisted mode. The concrete product concern is discoverability—developers in central mode will have a healthy local runtime that the browser intentionally does not consume—but changing that preference or adding UI is outside this increment.

Implementation evidence:

- FND-9 RED: sanitized `test_operations.py` ran 8 tests with 1 failure and 1 error because the development cancellation/lock seams and `release-dev-local.ps1` did not exist. Sanitized `test_runtime_safety.py` ran 21 tests with 5 expected ownership failures: no manifest lock, owner add/remove transaction, canonical-manifest resolver or required creation-time check existed. No service, listener, provider or canonical state was used.
- FND-10 RED: `npm.cmd run test -- scripts/dev.test.ts` discovered the standard Vitest file and failed before tests because `scripts/dev.mjs` did not exist. This proves orchestration remains in normal Vitest discovery rather than a parallel runner.
- FND-9 GREEN: focused sanitized operation tests passed 8/8 and final runtime-safety tests passed 25/25. The suite exercises a real cross-process file lock only against temporary state, concurrent owner registration into one generation, manual canonical reuse without start/stop, legacy identity compatibility, corrupt/foreign refusal, nonfinal owner release, replacement creation-identity refusal and cancellation during mocked startup rollback. Final full sanitized Prisma discovery passed 104/104 in 11.266 seconds.
- FND-10 GREEN: focused Vitest passed 9/9. It covers exact Vite argument forwarding, token-array PowerShell arguments with `shell: false`/`windowsHide: true`, unavailable-runtime fallback, unsupported OS, pre-Vite cancellation, Vite spawn failure and `SIGINT`/`SIGTERM` races with cleanup once. Full HMI verification passed 1,976/1,976 tests across 199 files in 45.07 seconds.
- FND-11 writer checkpoint: both exact no-emit TypeScript commands passed silently; `npm.cmd run build` passed with 2,722 modules in 14.42 seconds and retained the existing unresolved `/grid.svg` and chunk-size warnings; lint and all four PowerShell parser/AST checks passed. Independent verification was still required at that historical checkpoint and is closed by the final outcome below.

Historical defect, correction and final outcome after independent finding #5355:

- The independent Windows PowerShell 5.1 to Node probe proved that `Set-Content -Encoding UTF8` prefixes the development receipt with BOM bytes `239,187,191`; Node observes leading U+FEFF and rejects the otherwise valid JSON. Ownership had already been committed, while receipt delivery happened outside the lock, so the wrapper could continue without the proof needed for ordinary generation-bound release.
- The defect class includes any receipt write, read or parse failure after owner registration, helper nonzero after successful registration, and temporary-file cleanup that masks the ownership outcome. FND-9/FND-10 were reopened for one correction pass; this is historical chronology, not current status.
- This single correction pass adds regressions in the existing `test_runtime_safety.py` and `scripts/dev.test.ts` discovery paths. The PowerShell suite must exercise an actual Windows PowerShell 5.1 BOM-less serializer consumed by actual Node, plus failed handoff rollback for sole/cold and shared development ownership using temporary canonical manifests and mocked process/listener functions only. Vitest must cover missing receipt, invalid JSON, helper failure after registration, and temporary cleanup failure without real PowerShell or Prisma processes.
- The intended correction keeps the canonical manifest as the only shared ownership record. Receipt delivery joins the locked registration transaction and rolls back only the invocation token with exact generation and live creation-identity proof. When Node lacks a usable receipt, it may request narrowly scoped recovery by its unique owner token; recovery derives the canonical generation under the same lock, requires exact live creation identity, and never claims or stops manual, foreign, replaced or unproven state. Ordinary successful release retains its explicit expected-generation check.
- Correction RED was deterministic. Focused Vitest passed 9/13: missing receipt, invalid JSON and helper failure performed no recovery, while temporary cleanup replaced a successful ownership result. An invalid first Python harness run omitted `PRISMA_RUNTIME_STATE_DIR`; after fixing only the harness, runtime safety passed 25/28: no BOM-less serializer, no sole-owner cleanup, and a leaked shared owner.
- Correction GREEN passed focused Vitest 13/13 in 0.272 seconds, sanitized operations 8/8 in 0.236 seconds, and sanitized runtime safety 28/28 in 8.744 seconds. The runtime suite invokes the actual Windows PowerShell 5.1 serializer, asserts the emitted bytes do not begin with `239,187,191`, and has actual Node parse that file; no manually canned UTF-8 receipt is accepted as this regression proof. Temporary canonical manifests plus mocked listener/process functions prove failed receipt delivery removes the sole/cold invocation and its exact owned identities, while shared delivery failure removes only the joining owner.
- Full writer verification passed sanitized Prisma 107/107 and HMI 1,980/1,980 across 199 files; both typechecks, build and lint passed. Build transformed 2,722 modules in 7.86 seconds; only existing `/grid.svg`, chunk-size, jsdom Canvas and LF/CRLF warnings remained.
- Fresh independent verification passed Vitest 13/13, Python 107/107, all four PowerShell ScriptBlock/AST checks, tracked/new-file whitespace checks, the actual PowerShell-to-Node bytes path, and extra shared/replaced/manual/foreign/repeat/cancel-after-register cases. Parent final spotchecks passed Vitest 13/13 in 274 ms and sanitized Python 107/107 in 12.278 seconds; no source changed afterward.
- FND-9/FND-10/FND-11 are complete offline. RDD remained off/default; native risk assessment refused the three untracked files, so risk was treated as HIGH and independently verified without fabricating an RDD receipt. No live Vite/Prisma/provider/install/production or forced-terminal/OS-restart acceptance is claimed.

## Historical verification protocol

Verification used normal Vitest discovery, the repository-owned Python interpreter in a sanitized child environment, temporary state only, injected Node seams, mocked PowerShell listener/process boundaries, four parser/AST checks, and tracked plus new-file whitespace checks. It did not execute `npm run dev`, real launchers, listeners, providers, installers, network calls or ambient canonical runtime state. Detailed commands remain in Git history; the final results above are the current authority.

## Next step and rollback boundary

All eleven foundation tasks are complete offline. Local Windows `npm run dev` orchestration is implemented; `build`, `preview` and tests do not acquire Prisma. The browser preference remains `central` unless the existing `local` mode is selected. Manual runtime reuse is non-owning; concurrent development owners stop exact owned identities only on final normal release. Normal Ctrl+C shutdown is covered, while browser close, abrupt console termination and OS restart carry no durability claim.

The planned FND-9–FND-11 rollback boundary is exactly the ten paths in the preparation table. Revert the `dev` script, remove the new Node wrapper, Vitest file and release helper, and revert only the bounded ownership/start/stop tests, helpers and README text. That restores explicit Prisma startup without touching completed FND-1–FND-8 work, the other currently dirty files, browser runtime-mode preferences or production plans.

E1.1 remains open for protected backend credential storage/API before General Settings > Voice, real development-start and clean-install acceptance, IT-managed production deployment/supervision, remote access controls and live provider acceptance. No spontaneous-crash experiment, audio-schema rework or browser-mode override is pending.

## Session-close handoff

The audio-contract increment is complete, but E1.1 and PW-002/PW-003 remain open. Resume from the active master at `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md`, this task record, `odd/tasks/prisma-documentation-reconciliation.md`, and the stable topics `backlog/prisma-runtime-monorepo-integration` and `backlog/prisma-dual-channel-assistant`. Do not repeat the completed schema/generator correction.

The completed offline increment integrates Prisma startup with the user's local `npm run dev` flow while preserving installer-free normal startup and exact ownership. Protected backend secrets/API and General Settings > Voice fields follow that integration. Production deployment, durable supervision and paid/provider or Telegram-message acceptance remain later work.

The future IT-managed production pipeline remains an approved goal without a selected OS or supervisor and does not block local work. Browser-loader readiness changes are optional, nonblocking UX only—not a mandatory approved rewrite.
