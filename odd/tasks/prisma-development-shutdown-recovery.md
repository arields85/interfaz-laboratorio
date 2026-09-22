# PW-005 — Prisma development shutdown recovery: on-demand owner identity

> ODD feature task (not SDD). **CLOSED by user decision on normal Ctrl+C shutdown.**
> DS1–DS3 complete; DS3b manually validated; DS4 additional gates excluded by user decision,
> not passed; DS5 normal Ctrl+C accepted. Abrupt recovery is not independently demonstrated
> and is excluded, not a remaining acceptance task. Do not reopen or run more suites.

## Session closure (current authority; 2026-09-22)

User: «listo asunto terminado, se cierra con ctrl+c y listo, no damos mas vueltas».
Parent-forwarded snapshot `2026-09-22T19:47:25Z`: no listeners on 5056/5057/5173,
no Prisma processes, no errors. The one-line `[pscustomobject][ordered]` cold fix has
independent static readback and manual matching Node PID/birth persistence evidence;
initial 26 backend/14 Node focused passes PRECEDE it. No new automated tests or final
full gates were run afterward. This is not acceptance of terminal-X cleanup or abrupt recovery.

One local commit authorized/pending parent execution, with `skip_hook_this_commit` applying
only to that commit and no hook/configuration edits. No fabricated hash, push or staging here;
`.gga` remains untracked/excluded. Parent records the actual commit identity after success.

**NEXT SESSION:** present for approval the shared semantic data boundary planning proposal
from master §6.4/§7.2/§8 Entrega 1.3 and §11.1 (approve planning or defer), not another
Ctrl+C/audio/orb test. No automatic implementation, tests, providers or service starts.
The contract, runners and intermediate pending states below are historical evidence,
not instructions to resume PW-005. User choice `authorize_on_demand_owner_recovery`
was granted and must not be re-asked.

## 1. Objective

Make development-owner retention in the Prisma Local process manifest reappable: an
orphaned owner token (the PW-005 retention mechanism) must be provably distinguishable
from a live owner, on **both** acquire (warm reuse) and normal release, using per-owner
process identity (pid + canonical creation time), without ever endangering live,
unknown, legacy, or foreign processes.

## 2. Mechanism vs unproven incident

- **Proven mechanism (from code):** `developmentOwnership.owners` is an array of opaque
  UUID token strings with no per-owner process identity. A token whose launcher process
  died cannot be reapped, so a single stale entry perpetuates retention.
- **Unproven:** the exact cause of the PW-005 incident (which signal/exit path left the
  orphan). Runtime identities were recorded; this task must not assert which path failed
  and must not claim immediate cleanup during forced terminal termination, power loss,
  or OS crash. Safe recovery on a subsequent acquire/release is the intended guarantee.

## 3. Scope, non-goals, safeguards

**In scope:** `process-ownership.ps1`, `start-local.ps1`, `dev.mjs`; tests; docs later.

**Out of scope (hard):**
- No watchdog, service, scheduled-task, or external `CoreAnalitycs.bat` edits.
- No instant-cleanup guarantee or force-kill path. Owner PIDs are never stop targets.
- No restart of runtime halves, no partial-start restoration, no broad recovery
  framework. Safety takes precedence over automatic partial repair.
- `Get-PrismaProcessIdentity` / `Resolve-PrismaVerifiedListener` generic behavior
  unchanged; null is NEVER proof that an owner died and must not drive owner reaping.
- No migration framework; the manifest schema only gains a nested member.

**Safeguards (frozen):** fail closed on ambiguous state; preserve manifest on refusal;
legacy/manual runtimes without `developmentOwnership` are never claimed or stopped;
every destructive step remains gated by canonical-root + generation + token + identity
proofs as today.

## 4. Frozen contract (DS1)

### 4.1 Manifest ownership schema

- Keep `developmentOwnership.owners` as a string array for compatibility. The owners
  list remains the sole authority; the map below never grants ownership by itself.
- Add nested `developmentOwnership.ownerIdentities`: per-token object with `pid` (int)
  and `creationTimeUtc` (validated canonical string).
- Comparers: owner tokens use **OrdinalIgnoreCase**, preserving PowerShell's existing
  case-insensitive `-notin`/`-ne` semantics. Case-colliding duplicate metadata is ambiguous:
  retain/refuse rather than grant or reap ownership. `creationTimeUtc` uses Ordinal;
  `pid` is a validated positive integer in the int32 range.
- Duplicate or corrupt identity metadata fails closed → treated as unknown, retained,
  warned. No schema migration; readers tolerate absence (legacy entries).

### 4.2 Owner liveness lookup (new small tri-state helper)

- Uses `Get-CimInstance` with `-ErrorAction Stop` (non-terminating CIM errors are
  upgraded to terminating and caught as errors).
- Exactly one result with valid pid and **valid parsed canonical** creation time
  (not merely non-empty) equal to the stored identity → `alive`.
- Successful **zero** result → `dead`.
- Valid creation time but **different** value → `dead` (old owner gone, PID reused).
- Error (incl. upgraded non-terminating CIM), duplicate result, missing/invalid
  metadata, or legacy entry without birth → `unknown` → retain + warn.
- Warnings must never become destructive: release/acquire decisions never route
  through warning emission; behavior must be safe under `-WarningAction Stop`.

### 4.3 Acquisition (start / warm reuse and cold)

- Node passes its own `process.pid` (injectable, existing style in `createPowerShellRuntime`)
  to a new optional `-DevelopmentOwnerProcessId` start parameter **at registration
  (acquire) only**. Never fall back to PowerShell `$PID`, `ParentProcessId`, or any
  service PID. Supplied invalid / non-positive / out-of-range / unparseable / CIM
  birth missing → **reject registration before any reap, save, or stop**. A legacy
  caller that omits the PID registers a legacy unproven owner, retained with a warning.
- Under the manifest lock: prove canonical root + valid ownership + generation;
  validate the incoming owner identity **before** reaping; reap only provably `dead`
  old owners; preserve `alive` and `unknown`; add the new owner + its identity in the
  SAME computation and a SINGLE manifest save (no intermediate zero-owner state).
- Warm reuse keeps the existing generation. Cold start records ownership via the
  existing receipt transaction. Owner identity is recorded before mutating state and,
  where possible, before the cold start.
- Legacy/manual runtimes without `developmentOwnership` remain unclaimed and
  unstopped (existing `registered=false; reused=true` path unchanged).
- **Scope boundary:** do NOT auto-fix a partially dead/replaced dev-owned runtime on
  acquire. Fail closed: refuse + preserve the manifest with a clear warning, and ensure
  such state never passes through the destructive `Prune-PrismaProcessManifest`. Guard
  `Prune` against deleting or rewriting a development-owned manifest; malformed or
  ambiguous dev-owned state is preserved/refused at the dev acquisition boundary.
- A failed new registration (including no valid identity) gives **no** implicit stop or
  reap; this resolves the purported product gap conservatively.

### 4.4 Release (normal release; recovery unchanged in shape)

- Validate ROOT + generation + CALLER-TOKEN membership **before** any release mutation
  or reaping. Wrong token/generation → zero effects (existing behavior).
- Exclude the caller token from peer reaping, then remove it explicitly. Remaining
  owners that are `alive` OR `unknown` all count as retainers. The last-owner decision
  must not come from the `Remove-PrismaDevelopmentOwner` boolean alone: compute the
  authoritative remaining set after reap + removal in the same single save, and stop
  only when the authorized release leaves zero owners.
- Keep the per-service recheck (pid / exec / module / commandLine / creationTime) and
  retain unproven records and stop failures with a warning, as today. Owner-identity
  PIDs are liveness data only — never `Stop-Process` targets.
- Release performs no new registration and needs no PID pass-through (stored identity,
  token, and generation suffice); `release-dev-local.ps1` is edited only if actual
  minimal code proves a pass-through necessary.
- No unrestricted cleanup of an empty registry entry via a wrong token.
- Partial release: existing code already refuses as one unit when any record identity
  changed; preserve/refuse remains acceptable — no broad recovery framework.

## 5. Strict TDD mode and source

- **Mode:** Strict TDD — **active**. Source: `openspec/config.yaml` (schema-driven
  context) + `docs/TESTING.md` (TDD obligatorio para bugs/lógica pura; bug reproduction
  test before fix).
- Historical lifecycle: DS2 RED → DS3 GREEN + TRIANGULATE. Later DS3b used an explicit
  local no-automated-tests exception; DS4 further verification was excluded by user decision,
  and DS5 closed on normal Ctrl+C only (see current closure above).
- Test-only OS boundaries: all oracles use PowerShell function overrides in child
  processes over temporary state dirs; **no** actual services, providers, ports, or
  real `Stop-Process` targets. An inert subprocess baseline test is optional and may be
  skipped if it would expand the command surface.

### Regression oracles (minimum set)

1. Stale peer owners prevent the last owner from stopping the runtime (RED core).
2. Successful absent-PID lookup ⇒ dead; non-terminating CIM error ⇒ unknown (retained).
3. Live owner (matching birth) preserved; PID-reused owner (different birth) pruned.
4. `unknown` / legacy / bad-metadata owners retained.
5. Another alive owner keeps the runtime up on release.
6. New cold owner wiring passes Node's correct PID (no `$PID` fallback).
7. Warm reap + register is ONE save; generation stays stable.
8. Caller with wrong token/generation: zero effects.
9. Identity-mismatched services are never stopped.
10. Partially dead runtime on acquire is preserved and never reaches `Prune`.
11. Failed registration mutates nothing (no implicit stop/reap).
12. Existing receipt rollback, shared-owner release, normal SIGINT, and recovery
    cases unchanged (existing tests keep passing).

Compose with existing meaningful fixtures (e.g. `_assert_failed_receipt_handoff_rolls_back`,
`test_concurrent_acquisitions_join_one_owned_generation_without_manifest_corruption`);
no 16-case giant matrix. Confirmed target class:
`tests.test_runtime_safety.RuntimeOwnershipTests` (line 115 of
`services/prisma-runtime/tests/test_runtime_safety.py`). If a separate helper test
class becomes necessary, name it exactly `OwnerIdentityLookupTests` in the same file
and add it explicitly to the backend vector below.

## 6. Route and delegation

- **4-file mapper:** DONE at contract time (process-ownership.ps1, start-local.ps1,
  release-dev-local.ps1, dev.mjs, stop-local.ps1, both test files, README, maestro).
- **Single writer:** one writer implements DS2→DS3 across the allowed surfaces below.
- **Verification rule:** verification runs are exact and listed in §8; no broad suites
  before final.

## 7. Allowed edit surfaces (exact)

- `services/prisma-runtime/operations/process-ownership.ps1`
- `services/prisma-runtime/operations/start-local.ps1`
- `hmi-app/scripts/dev.mjs`
- `services/prisma-runtime/operations/release-dev-local.ps1` — only if actual minimal
  code proves a pass-through necessary; avoid otherwise.
- Tests: `services/prisma-runtime/tests/test_runtime_safety.py`;
  `hmi-app/scripts/dev.test.ts`
- Docs (later step, English technical): `services/prisma-runtime/README.md`,
  `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` sections as needed,
  `docs/PENDING_WORK.md` (PW-005 row only).
- This task file. **All other writes forbidden.**

## 8. Historical verification commands (focused commands executed in DS3; do not rerun at closure)

Backend focused — class-only vector through the §8 sandbox supervisor (monorepo root,
Bash/Git Bash; child-only env with the eleven README PAC-5 variables cleared, fresh
temporary state dir, resolved PYTHONPATH — never a raw relative `PYTHONPATH`):

```bash
./services/prisma-runtime/.venv/Scripts/python.exe -B - <<'PY'
import os
from pathlib import Path
import subprocess
import tempfile

root = Path('services/prisma-runtime').resolve()
cleared = (
    'PRISMA_VOICE_CONFIG_FILE',
    'PRISMA_CREDENTIAL_MASTER_KEY_FILE',
    'GEMINI_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'PRISMA_LOCAL_TELEGRAM_ENABLED',
    'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN',
    'PRISMA_LOCAL_SNAPSHOT_FILE',
    'PRISMA_LOCAL_STATE_FILE',
    'PRISMA_LOCAL_VOICE_URL',
    'PRISMA_PUBLIC_ORIGIN',
    'TELEGRAM_BOT_API_BASE',
)
command = [
    str(root / '.venv' / 'Scripts' / 'python.exe'), '-B', '-m', 'unittest',
    'tests.test_runtime_safety.RuntimeOwnershipTests',
]
with tempfile.TemporaryDirectory(prefix='prisma-pw005-') as temporary:
    child_env = os.environ.copy()
    child_env['PRISMA_RUNTIME_STATE_DIR'] = temporary
    for name in cleared:
        child_env.pop(name, None)
    child_env['PYTHONPATH'] = str(root / 'src')
    child_env['PYTHONDONTWRITEBYTECODE'] = '1'
    result = subprocess.run(command, env=child_env, cwd=str(root), check=False)
    print(f'PW005 focused backend exit:{result.returncode}', flush=True)
exit(result.returncode)
PY
```

Frontend focused (from repo root):

```bash
npm --prefix hmi-app test -- scripts/dev.test.ts
```

Originally planned final gates (not executed; excluded at closure, not passed): backend README PAC-5 block **verbatim, unchanged** (locator:
`services/prisma-runtime/README.md` → "Offline-safe verification"); frontend
`npm --prefix hmi-app run test:coverage`, then `run build`, then `run lint`, existing
strict thresholds preserved. The module-level test file may need the full-class run
first; if a cross-test seeding race appears, run the full `tests.test_runtime_safety`
module and record it.

## 9. Authorization history

- User: PW-005 fix, closed choice `authorize_on_demand_owner_recovery` — safe owner
  recovery on BOTH start and normal release; no watchdog/service/scheduled-task/
  external-bat edits; no instant-cleanup guarantee or force kill. Fresh authorize fix
  granted; do not re-ask. One safety challenge already spent; do not reopen.
- This launch: documentation-only contract freeze; no source/test edits; official
  stop already executed and verified by parent (all matching services gone, ports
  free) — recorded evidence, not re-run.

## 10. Evidence at contract freeze

- Official `stop-local.ps1` stop executed and confirmed by parent (services stopped,
  ports free). Not re-executed here.
- New tests NOT run this launch (commands in §8 are the delegated writer's contract).
- No PW-005 source/test changes are present; only this task file was created.
- Implementation attempts `mucvsamb-h-orat` (2 turns/2 tools) and `mucw2u5d-i-fi1l`
  (10 turns/12 tools) failed with only `assistant reported an error`. No useful cause
  or test evidence was returned. Parent checked status/result and Git after each:
  PW-005 source/test diff empty, existing CL changes and `.gga` preserved, HEAD still
  `17313509ffc3502588e7d68d4efb193f2de4493a`. No rollback or further retry performed.
- Forecast: ~300–500 authored lines (advisory 400, not a cap); no code golf. Delivery
  and commit remain user decisions — no commit now.

### Resumption evidence (bounded test-only RED stage, worker `muczhzw0-l-mfbk`)

- Prior full-writer failures diagnosed: terminal response-processing error
  `Expected property name or ... JSON...` during JSON processing before any write;
  exact transport cause unknown. NOT treated as a blind-retry blocker for tests: this
  stage was a bounded, test-only launch (no production edits), and a single minimal
  same-profile read-package probe responded successfully before it.
- Probe `muczg5ks-k-ckpn` only read package metadata; it did not implement or test.
- Worker `muczhzw0-l-mfbk` completed the bounded RED stage: three regression tests added
  (two backend, one frontend), production source untouched. Observed via the exact §8 commands:
  - Backend (§8 sandbox supervisor, class vector `tests.test_runtime_safety.RuntimeOwnershipTests`):
    `Ran 23 tests ... FAILED (failures=2)`, exit 1. New behavioral RED (both ran to real
    assertion failures, no fixture/syntax errors; the 21 pre-existing class tests passed):
    - `test_release_reaps_provably_dead_peer_and_stops_runtime_for_last_live_owner` —
      `AssertionError: 'stopped=200,201' not found in 'stopped=\n'` (dead peer retained;
      runtime not stopped; manifest not removed).
    - `test_warm_acquisition_reaps_provably_dead_owner_and_registers_new_owner_without_stopping`
      — `AssertionError: Lists differ: ['dead-peer', 'owner-new'] != ['owner-new']`
      (orphaned owner retained on warm reuse).
  - Frontend (`npm --prefix hmi-app test -- scripts/dev.test.ts`): `1 failed | 13 passed (14)`,
    exit 1. New argument-assertion RED: `registers the Node owner process id with the
    acquisition start arguments` — acquire start args lack
    `-DevelopmentOwnerProcessId` `String(process.pid)`.
  - `git diff --check`: exit 0. HEAD unchanged `17313509ffc3502588e7d68d4efb193f2de4493a`;
    pre-existing CL diff and `.gga` preserved.
- Scope of this evidence: tests exist and fail for the planned contract reasons (DS2 RED
  observed); production implementation was still pending at that checkpoint. GREEN continuation
  `mucztre0-m-mnz0` subsequently failed without production changes. The user changed the
  agent model and explicitly confirmed continuation. No claim that the previous JSON error was repaired.

### DS3 GREEN + safety triangulation evidence

- Effective runtime profile was established before edits from `PI_*` metadata:
  `openai-codex/gpt-5.6-sol`, reasoning `medium` (not the excluded `nan/glm5.3-flash`).
- Changed only the launch-authorized PW-005 surfaces: `process-ownership.ps1`,
  `start-local.ps1`, `dev.mjs`, both focused test files, and this task document.
  `release-dev-local.ps1` remained unchanged because no PID pass-through was necessary.
- GREEN: the exact sandboxed backend class vector passed all 26 tests; the exact frontend
  focused command passed all 14 tests. `git diff --check` exited 0 (line-ending warnings only).
- Safety triangulation covers successful absence, live identity, PID reuse, CIM error,
  duplicate result, malformed/missing/case-colliding metadata, legacy retention under
  terminating warning preference, invalid explicit registration with zero runtime/manifest
  effects, partial owned-manifest refusal, one-save warm registration with stable generation,
  and the pre-existing receipt rollback/shared-owner/replaced-service cases.
- Implementation result: Node passes only `process.pid`; explicit registration identity is
  validated before manifest reap/save, stop, prune, or cold launch; warm acquire and release
  reap only owners proven dead by the dedicated strict CIM probe; owner PIDs are never stop
  targets; owners remain authoritative; unknown/legacy metadata retains ownership; partial or
  ambiguous development manifests are preserved and refused.
- Authored implementation/test diff at DS3 close is approximately 500 inserted lines across
  five source/test files, at the upper edge of the frozen 300–500 forecast without code golf.
  No staging, commit, service restart, provider/network call, or manual launcher action occurred.
- Residual: DS4 full offline suites/build/lint and independent verification are not run here;
  DS5 real Windows launcher close/restart acceptance remains pending with the user.

## 11. Tasks and disposition

- [x] **DS1-contract** — frozen with parent readback corrections.
- [x] **DS2-RED** — three behavioral failures observed (2 backend + 1 frontend),
  exact §8 commands. Additional safety regressions remain part of DS3 triangulation.
- [x] **DS3-GREEN** — minimal implementation and safety triangulation; focused backend 26/26 and frontend 14/14 PASS.
- [x] **DS3b-cold-start** — one-line correction statically read back and manually validated:
  persisted Node PID 30368 / birth `2026-09-22T19:30:18.5820530Z` matched the live owner.
  No new automated tests (local exception, §12).
- [x] **DS4-disposition** — further focused/full suites/build/lint and independent automated
  verification explicitly excluded by the user's closure decision; NOT executed or passed.
- [x] **DS5-manual** — normal Ctrl+C accepted, final clean snapshot at `19:47:25Z`.
  Abrupt recovery excluded, not independently demonstrated or scheduled.

No PW-005 continuation remains. The next-session planning boundary is in the current
closure above; it does not authorize source changes or new runtime operations.
Rejected registration causes no mutation; existing receipt-handoff rollback of processes
started by that invocation remains valid and unchanged. These are distinct paths, not a
conflicting guarantee.

## 12. DS3b — cold-start owner identity persistence follow-up

- Parent-provided manual failure: fresh start at `19:03:30Z` after clean shutdown
  persisted generation `cd052bb4-2b8c-4ffa-aa04-61356b065be8`, owner token
  `f6d07fd2-a4af-4e9e-a471-863f7927a4b2`, and empty `ownerIdentities: {}`.
  Reported listeners: port 5056 / PID 30912 and port 5057 / PID 6692. The user
  leaves the terminal open; this follow-up must not inspect or alter live state.
- Explicit user choice: correction WITHOUT ANY AUTOMATED TESTS, then user-led
  manual validation. Effective automated TDD mode for DS3b is OFF; this is a local
  exception only. Global strict TDD configuration and §5 remain unchanged.
  Earlier 26 backend / 14 frontend passes predate this correction and are not its GREEN.
- Static diagnosis: cold acquisition constructs `developmentOwnership` as an ordered
  dictionary, while `Set-PrismaDevelopmentOwnerIdentity` accesses its outer
  `ownerIdentities` through `PSObject.Properties`. A missing property causes
  `Add-Member` to create an extended property distinct from the dictionary entry
  serialized by `ConvertTo-Json`. Warm JSON loading produces a `PSCustomObject`.
  The inner identity map already supports dictionaries. No legacy-caller assumption
  is necessary to explain this representation mismatch.
- Applied correction: normalized only newly constructed cold `developmentOwnership`
  to `[pscustomobject][ordered]@{ ... }` in `start-local.ps1:170`, preserving field order,
  nested map, schema, identity validation, owner/liveness/root/generation gates,
  receipt transaction, and release behavior. No helper expansion is needed by static inspection.
- This follow-up may edit only `services/prisma-runtime/operations/start-local.ps1`
  and this document. Preserve all pre-existing CL/PW-005 changes and `.gga`.
  No tests, builds, lint, syntax parser, synthetic reproduction, live probes,
  runtime/provider operations, live manifest/configuration edits, or Git delivery actions.
- Validation authorized: source read/readback and Git status/diff metadata only.
  RED/GREEN are not active for DS3b; runtime behavior was not verified at this static stage.
- Static source readback confirms the helper now sees the actual `ownerIdentities`
  note property and mutates its dictionary value before the existing depth-8 JSON save.
  Follow-up source delta: one replaced line (+1/-1); no other source edits.
  Automated tests/build/lint and runtime validation were intentionally not run.
- Subsequent parent-forwarded manual evidence: the fresh-start owner map persisted Node
  PID 30368 and canonical birth `2026-09-22T19:30:18.5820530Z`, matching the live Node
  owner. This completes DS3b's bounded persistence check, not an automated GREEN.
- Subsequent normal Ctrl+C acceptance and the clean `19:47:25Z` snapshot close PW-005
  at the user's request. DS4 full gates were not run; abrupt recovery was not independently
  demonstrated. Neither is claimed passed or scheduled as follow-up.
