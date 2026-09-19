# Prisma runtime seeding atomicity — PW-002

## Intent and authorization

User authorized a bounded fix of the PW-002 pre-lock state-seeding race after an
explicit measurement session. Scope agreed with the user: "arreglar con el mínimo,
con test primero" (minimal fix, test first). The user also required that the result
be shown before any commit: **no commit, push, merge, or PR is authorized by this
document**.

Reporting for this work is in Spanish; this artifact stays in English per the
repository language convention.

## Problem statement (measured, not hypothesized)

`Initialize-PrismaRuntimeState` seeds `prisma_voice_config.json` with a
check-then-act pair:

- `services/prisma-runtime/operations/runtime-environment.ps1:283` — `Test-Path`
- `services/prisma-runtime/operations/runtime-environment.ps1:284` — `Copy-Item`

`services/prisma-runtime/operations/start-local.ps1:181` calls it **before**
taking the manifest lock at `:184`, so two launchers can both observe a missing
file and both attempt to create it. The loser raises
`System.IO.IOException` ("being used by another process") and aborts before it
ever registers.

Measured on 2026-09-18 with an isolated, product-untouched harness
(`%TEMP%\pw002-seed-race\repro-seed-race.ps1`, sha256
`f25c347a5898b0bf6331acb5c8cb942a86603c0a41ce2313c5929c8f9c95dfcd`):
14/60, 11/60 barrier-aligned and 15/60 with natural start jitter
=> **40/180 ≈ 22%** of concurrent fresh-state start pairs lose one launcher.
Alignment is irrelevant.

Reachability: `hmi-app/scripts/dev.mjs` `acquire()` holds no Node-side lock and
spawns `start-local.ps1` directly, so two `npm run dev` processes reach the
unlocked seeding path. `bootstrap-local.ps1:13` also seeds with no lock.

Recovery evidence: `verification/pw002-seed-race-measurement` and
`backlog/prisma-runtime-monorepo-integration` in Engram.

## Invariants that must not break

1. **An existing effective configuration is never overwritten.**
   `runtime-environment.ps1:258-261` and its test in
   `tests/test_python_environment.py`.
2. **No partial file is ever published.** A seeding attempt that fails must not
   leave a truncated `prisma_voice_config.json`, because a present-but-corrupt
   file permanently blocks future seeding.
3. Inherited contract of the function: still returns an object exposing
   `StateRoot`, `Configuration`, `Seeded`; `Seeded` is true only for the caller
   that actually created the file.
4. One generation per canonical runtime; ownership, manifest and lock semantics
   are untouched by this change.
5. Genuine failures stay visible: a seeding failure that is not a lost race must
   still surface as an error, not be silently converted into `Seeded = false`.

## Scope

Allowed edit surfaces (narrow):

- `services/prisma-runtime/operations/runtime-environment.ps1`
- `services/prisma-runtime/tests/test_runtime_safety.py`

Any need for a third file stops the task and returns to the parent.

## Non-goals

- Moving seeding inside the manifest lock (rejected shape: `run/` is created by
  seeding itself, and `Invoke-PrismaManifestLock` opens the lock file with
  `FileMode.OpenOrCreate`, so `DirectoryNotFoundException` — an `IOException` —
  would be swallowed by the retry loop as a misleading timeout).
- Locking `bootstrap-local.ps1`.
- Changing the lock primitive, the manifest schema, generation semantics, or the
  runtime read path.
- Any state-root, credential, provider, service, or network action.

## Plan

TDD, test first, one bounded writer.

1. **RED** — add a deterministic concurrency test proving the defect. Design:
   the test drives two real `powershell.exe` processes against one fresh state
   root and one deliberately **large** template, so the first caller's
   `Copy-Item` is still in flight when the second caller runs `Test-Path`. This
   widens the loser's window deterministically without modifying the product.
   Assert: both processes exit 0, and the destination equals the template.
   Confirm RED against the unmodified product code.
2. **GREEN** — replace the check-then-act with publish-by-rename, as implemented:
   stream the template into a unique `prisma_voice_config.json.<guid>.tmp`
   created in the destination directory; treat the write as complete only after
   that handle closes cleanly (a close failure is rethrown when nothing else is
   in flight, and is always reported as a path-bearing diagnostic); publish with
   `[IO.File]::Move($tempPath, $config)`, a same-volume rename that still fails
   when the destination exists. On `IOException` from the move, rethrow unless
   the destination is now a leaf (lost race or pre-existing config) →
   `Seeded = false` with no overwrite. Cleanup cannot replace the initiating
   error. An earlier `CreateNew`-claim-plus-copy revision was rejected in
   verification because it could expose a present-but-partial destination.
3. **Verify** — the new test is green repeatedly; the existing invariants stay
   green: `tests/test_python_environment.py` and the whole
   `tests/test_runtime_safety.py` suite under the documented isolated runner.

## Correction history

Three independent read-only verification rounds, each returning FAIL before the
next correction:

1. **Round 1 (FAIL)** — `$complete = $true` was set before the destination
   handle closed, so a flush failure could skip deletion and leave a truncated
   configuration; cleanup could replace the initiating error; the test's child
   cleanup started only after both launches.
2. **Round 2 (FAIL, CORRECTION-1 closed)** — publish-by-rename closed the
   partial-publication finding, but a partially completed launch could still
   strand the first child, and a secondary close failure was lost while the
   initiating exception unwound.
3. **Round 3 (PASS)** — both findings closed; live evidence reproduced
   independently (focused 5/5, canonical gate 241 tests OK, exit 0). The ctypes
   barrier gained explicit native signatures as accepted Low-severity hardening.

## Tasks

- [x] T1 — Deterministic RED test added; observed failing on unmodified product code (10/10 in the first round; re-proven once after the test changed).
- [x] T2 — Atomic seeding implemented (final shape: publish-by-rename).
- [x] T3 — GREEN plus regression: focused class 10/10 and 5/5 in separate rounds; canonical backend gate 241 tests, OK, exit 0.
- [x] T4 — Two independent verification rounds and a final PASS round over the corrected revision.
- [x] T5 — Commit gate resolved: committed on `feat/prisma-telegram-credentials` as `f865e798a1a5f9b975ef35ae437afefce69e19dc` (tree `554f18196112666be5a26ce2bc64de423d13ad52`); no push, merge, or PR.

## Evidence ledger

| Gate | Command / artifact | Result |
|---|---|---|
| Origin measurement | `%TEMP%\pw002-seed-race\repro-seed-race.ps1` (3 runs) | 40/180 ≈ 22% failures |
| RED | focused class against `HEAD`'s check-then-act block | fails with `Copy-Item` IOException at the old `runtime-environment.ps1:284` |
| GREEN | focused class, final revision | 10/10 (writer) and 5/5 (independent verifier) OK |
| Regression | `verify-local.ps1` via the documented isolated supervisor | `Ran 241 tests in 17.147s` / OK / exit 0 |
| Independent verification | three rounds, final verdict PASS | findings closed; see correction history |
| Commit | `f865e798a1a5f9b975ef35ae437afefce69e19dc` on `feat/prisma-telegram-credentials`, tree `554f18196112666be5a26ce2bc64de423d13ad52` | 3 files, +354/−3; no push |
| Final revision | `runtime-environment.ps1` sha256 `2f1af8362e0b4f35bba68d6a8d438cd957477ff3675d5eb0d315e42527ed45c4` | identical as working bytes and as committed blob |
| Final revision | `test_runtime_safety.py` committed blob `a0233f1c668f39f9b838a92c76ba698662675a1a607ebb131ca310dd48c7e996` | LF, canonical; the working copy is CRLF (`108271f712d0ed0a360b4e2461d27c43fa392292b7db6f51fc9eeeb0ced7b6bd`), because this clone uses `core.autocrlf=true` and the writer left that file in CRLF. Equivalence proven with `tr -d '\r'` |

### Line-ending note (audit)

The repository stores LF blobs. The two test-file hashes above describe the same
content: the working-tree CRLF bytes that actually ran the tests, and the
committed LF blob that Git produced by normalization at staging time. Any audit
of this change must compare against the blob hashes, not the working-copy hashes.

### Evidence command (isolated supervisor)

`verify-local.ps1` is invoked with a fresh disposable `PRISMA_RUNTIME_STATE_DIR`, the
README's eleven overrides cleared from the child environment, and
`PYTHONDONTWRITEBYTECODE=1` added to the child environment; the parent environment
is never mutated and the canonical PowerShell argv is unchanged.

## Residual risks (accepted, must survive review)

1. A hard process kill between the temp write and the rename can leave an orphan
   `prisma_voice_config.json.<guid>.tmp`. It is never published as the effective
   configuration and does not block future seeding, but there is no sweeper.
2. Every caller now writes a temporary copy even when the configuration already
   exists, so a start performs one extra small write (441 bytes in production)
   and requires a writable state root on that path.
3. Atomic publication is not power-loss durability.
4. Close/disposal/deletion failure paths and terminating warning preferences were
   handled by construction and inspected statically, but were never
   fault-injected.
5. The concurrency test is timing-sensitive: the barrier aligns the callers but
   does not force a particular interleaving. Final-state assertions cannot detect
   transient partial visibility; repeated green runs are evidence, not proof.
6. Cleanup of test children is best-effort: kill failures are swallowed and an
   interpreter abort is not covered.
7. Test ergonomics on failure paths only: `addCleanup` runs after the test method
   returns, so `with tempfile.TemporaryDirectory(...)` deletes the tree before
   `unittest` kills the children. On Windows a still-alive child holding files in
   that tree can make the deletion raise and replace the original failure
   message. It cannot affect product behaviour and cannot let a defective
   implementation pass.
8. Product, exotic: on the unwinding path the recorded close failure is
   intentionally not rethrown, so the surviving diagnostic is the guarded
   warning; if the warning stream itself were unusable that single diagnostic
   would be lost, while the no-other-error path still raises a hard error.
   Inspection-based, not fault-injected.

## Decisions resolved and still open

- Commit gate: RESOLVED — committed on `feat/prisma-telegram-credentials` as
  `f865e79` with the two implementation files and this document, excluding the
  pre-existing user-owned `.gitignore` change. No push, merge, or PR.
- Still open for PW-002 as a whole (unchanged by this work): real clean start
  and clean-install acceptance, forwarding, deployment, supervision, durable
  recovery, and legacy-installation retirement.
