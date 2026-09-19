# Prisma seeding hardening — PW-002 residual closure

## Intent and authorization

User reviewed the accepted residual inventory of the committed PW-002 seeding fix
(`f865e79`, docs `83d36ee`, index `f290e78`) and explicitly authorized the bounded
hardening option: close residuals 1, 2, 3 and 7 plus two new tests, keep 5, 6 and 8
documented as inherent or contrived, and commit at the end of the cycle after an
independent verification round.

Reporting is in Spanish; this artifact stays in English per the repository language
convention.

## Problem statement

Four of the eight accepted residuals are closable inside the same two files:

1. **Orphan `.tmp`, no sweeper.** A hard process kill between the temporary write and
   the rename leaves `prisma_voice_config.json.<guid>.tmp` in the state root forever.
2. **Unconditional temporary write.** Every launcher writes a temporary copy even when
   the effective configuration already exists, adding a write and a write-permission
   requirement on a path that previously needed neither.
3. **No power-loss ordering (the real hole).** The stream is closed but never flushed
   to disk. On NTFS the rename is journaled metadata while the data is not, so a power
   cut in the window can persist the final name with absent or partial content —
   precisely the failure class that made verification reject the earlier
   `CreateNew`-claim shape. Closing a `FileStream` flushes the managed buffer to the
   operating system, **not** to the disk.
7. **Test diagnostics.** `with tempfile.TemporaryDirectory(...)` removes the tree
   before `unittest` runs the child cleanups, so on a Windows failure path a still-live
   child can make directory deletion raise and replace the original failure message.

Residuals 5 (timing sensitivity), 6 (best-effort child cleanup) and 8 (unusable warning
stream) stay accepted: 5 is inherent to testing concurrency without mocking the
product, 6 cannot survive an interpreter abort, and 8 is contrived.

## Invariants that must not break

1. An existing effective configuration is never overwritten.
2. No partial destination is ever published; the rename stays the only publication step.
3. The function still returns `StateRoot`, `Configuration`, `Seeded`, with `Seeded` true
   only for the caller that published the file.
4. Genuine failures stay visible; a lost race is still `Seeded = false` with no error.
5. Lock, manifest, generation, `start-local.ps1` and `bootstrap-local.ps1` untouched.
6. The two published sha256 blob values from the previous cycle remain the reference for
   unchanged behaviour, and PowerShell 5.1 / .NET Framework compatibility holds.

## Design (implement exactly this)

### D1 — stale temporary sweep

After the state directories are ensured and BEFORE the already-configured early return,
sweep the state root for orphaned temporaries so they are shed on every start. Non-recursive,
exact pattern match against `prisma_voice_config.json.<pid>.<guid>.tmp`.

Implemented rule: a temporary is deleted only when it is BOTH older than the named one-hour
threshold AND its name carries an owner process id that is no longer running. Age alone is
never proof of death: `FileShare::None` protects a temporary only while its handle is open,
so a live owner suspended past the threshold in the dispose-to-rename interval must never be
disturbed. A name that cannot be attributed (wrong shape, or a numeric owner outside the
representable range) is skipped entirely, and the whole sweep is guarded so that it can never
abort initialization. A temporary that disappears mid-flight surfaces as a genuine rename
error, because the existing `IOException` handler rethrows when the destination is not a leaf.
Deletion failures only warn: they must never replace another error and must never turn a lost
race into a failure.

### D2 — skip the write when the configuration already exists

Before creating any temporary, if the destination is already a leaf file, return
`Seeded = false` immediately. This is an optimization only: the authoritative decision
remains the rename, so no check-then-act hazard is reintroduced. Restores the previous
behaviour of needing no write access on that path.

### D3 — flush the data before publishing

Invoke `$tempStream.Flush($true)` on the temporary write handle before disposing it, so
the content reaches the disk before the rename is issued. `Flush($true)` exists on
`.NET` `FileStream` and is PowerShell 5.1 compatible. A flush failure is a failure to
publish: it must propagate the same way a failed close does (hard error when nothing
else is in flight, guarded path-bearing diagnostic when something is).

### D7 — test temporary-directory ordering

Replace the `with tempfile.TemporaryDirectory(...)` usage in
`ConcurrentFreshStateSeedingTests` with an explicit `tempfile.mkdtemp()` whose removal is
registered so it runs **last** among the cleanups (registration order is LIFO), so child
termination happens before directory removal and a failure message is never obscured.

### T1 — non-leaf destination test

A test where the destination path is an existing **directory** instead of a file:
seeding must raise (the non-leaf branch must not be silently converted into
`Seeded = false`) and must leave no `.tmp` behind.

### T2 — sweep tests

Five assertions across two tests, all invoking the real product function:

- an aged temporary whose owner is dead is removed by a successful seeding;
- an aged temporary whose owner is ALIVE survives — the assertion that locks the
  suspended-live-owner counterexample;
- a temporary whose name cannot be attributed is never deleted;
- an aged temporary whose owner id is out of the representable range is skipped while
  initialization still succeeds — the regression lock for the abort-on-cast defect;
- a young temporary survives, including one with a dead owner, so the age requirement is
  protected independently of the owner requirement;
- the same sweep happens when the effective configuration already exists (the early return
  must not skip it).

Not testable directly, and explicitly not claimed as tested: that `Flush($true)` reaches
the platter. D3 is justified by construction; the existing suite is its regression guard.

## Allowed edit surfaces

- `services/prisma-runtime/operations/runtime-environment.ps1`
- `services/prisma-runtime/tests/test_runtime_safety.py`

Any need for a third file stops the task and returns to the parent.

## Non-goals

- No directory `FlushFileBuffers` P/Invoke and no directory-fsync guarantees.
- No changes to concurrency semantics, the lock primitive, the manifest, generation
  handling, or the runtime read path.
- No failure injection beyond T1 and T2.
- No touching the pre-existing user-owned `.gitignore` modification.

## Tasks

- [x] T1 — Delegated writer implemented D1, D2, D3, D7 and the new tests, test-first where a RED was observable.
- [x] T2 — Focused class green (10 runs for the writer, 5 for the verifier) and the full canonical backend gate green: `Ran 244 tests` / OK / exit 0.
- [x] T3 — Independent read-only verification: three rounds over this cycle (FAIL, FAIL, PASS). The two FAIL rounds each caught a real defect before closure.
- [x] T4 — Committed on `feat/prisma-telegram-credentials` (identity recorded in Engram under `checkpoint/prisma-seed-hardening-commit`); no push, merge or PR.
- [x] T5 — Residual list reconciled in `odd/tasks/prisma-seed-atomicity.md` and in Engram.

## Correction history (this cycle)

1. **Round 1 (FAIL).** The sweep could delete a live seeder's temporary when its owner was
   suspended past the threshold between disposing the handle and renaming. Fixed by making the
   sweep owner-aware (pid in the name, dead-owner check).
2. **Round 2 (FAIL).** An out-of-range numeric owner id aborted initialization through a
   throwing `[int]` cast — one stray file would have broken every launcher start, including on
   a healthy configured state root. Fixed with a non-throwing conversion plus a guard that
   makes the sweep unable to abort initialization; a stale comment and an age-guard coverage
   gap were fixed in the same round.
3. **Round 3 (PASS).** No code blocker. The verifier confirmed the overflow coverage is
   genuine, that no existing assertion was weakened (`git diff -w`), and that the guards do
   not extend into the seeding path.

## Evidence ledger

| Gate | Command / artifact | Result |
|---|---|---|
| Focused tests | `ConcurrentFreshStateSeedingTests` (4 tests) | `Ran 4 tests ... OK` ×10 (writer) and ×5 (independent verifier) |
| New tests | directory destination; sweep with dead/live/unattributable/out-of-range/young fixtures; sweep with existing configuration | all green; the out-of-range fixture produced a real RED before the fix |
| Regression | `verify-local.ps1` via the documented isolated supervisor | `Ran 244 tests in 18.026s` / OK / exit 0 (was 241 before this cycle's three new tests) |
| Independent verification | three read-only rounds | FAIL, FAIL, PASS |
| Final revision | `runtime-environment.ps1` sha256 `35bc71a63b91a8daf7c931d2ea9fbc2aeff9ebb832c7a9adcecb4a9ab8e323e5` | — |
| Final revision | `test_runtime_safety.py` sha256 `9359b4de0f908faf622b87e31e08453020f1cbd241836701e9801818ba935391` | — |
| Commit | recorded in Engram, `checkpoint/prisma-seed-hardening-commit` | no push |

## Residuals after this cycle

CLOSED by this cycle (previously items 1, 2, 3 and 7 of the earlier list): orphan temporary
with no sweeper; unconditional temporary write when the configuration already exists; missing
data-before-rename ordering; and the test diagnostic obscured by temp-directory deletion
preceding child cleanup.

STILL ACCEPTED, with severity:

1. **Timing sensitivity of the concurrency test** — inherent; the barrier aligns callers but
   cannot force an interleaving, so green runs are regression evidence, not a proof of
   atomicity.
2. **Best-effort child cleanup** — an interpreter abort is not covered, and cleanup failures
   are suppressed by design so they cannot mask the original failure.
3. **Warning diagnostics may be unavailable** — an unusable or terminated warning stream
   would lose the single unwinding-path diagnostic; explicit `-WarningAction Continue`
   prevents a terminating preference from replacing an in-flight exception.
4. **Pid-reuse retention (Low)** — a reused pid can keep a genuinely orphaned temporary past
   the threshold. This errs toward never deleting a live owner's file.
5. **Permanently unswept temporaries (Low)** — unattributable names, out-of-range owner ids,
   and old-shape pid-less names from the previous committed revision are never deleted. They
   are inert (never published, never blocking seeding) and need manual removal if they ever
   matter. The pid-less shape existed only in an unpushed local commit for a few hours.
6. **Sweep eligibility is not a lifetime bound (Low)** — one hour is the earliest a dead
   owner's temporary becomes eligible; actual removal still requires a later initialization,
   a successful attribution and a successful deletion. Deletion can be blocked indefinitely
   by permissions or pid reuse.
7. **Durability is an inspection-based argument, not a tested physical guarantee
   (Medium, explicitly unproven)** — flush-before-dispose-before-rename is justified by
   construction; no test proves data reaches the platter, and directory-entry durability
   after the rename still depends on the filesystem.
8. **Sweep diagnostics wording** — the guard suppresses non-terminating enumeration and
   process-query errors, so not every suppressed condition emits a warning.

Nits deliberately not acted on: a duplicated configuration/stale/fresh assertion pair in the
sweep test.
