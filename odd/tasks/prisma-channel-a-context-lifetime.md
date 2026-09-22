# CL — Context lifetime contract fix: distinguish view visits from routine updates

## Status (current truth; 2026-09-22, user acceptance and session closure)

**CL1–CL6 CLOSED.** User-reported manual acceptance: replies to the exercised questions,
Telegram replies, HMI voice and orb. No separately observed cross-view/latency test or
universal guarantee is claimed. Full CL gates below predate PW-005, not final gates for
its later cold-start correction. One local commit is authorized and pending parent execution;
no hash is claimed. The user selected `skip_hook_this_commit` for that commit only, without
hook/configuration edits; `.gga` remains untracked/excluded. No push or new automated checks.

**NEXT SESSION:** present for approval a bounded planning proposal for the shared semantic
data boundary (master §6.4, §7.2, §8 Entrega 1.3 and current §11.1): approve planning or defer.
No implicit implementation authority, automatic tests, services or provider calls; do not
repeat accepted audio/orb/Ctrl+C. PW-003 retains broader roadmap work, not CL acceptance.

### Historical implementation checkpoint (before manual acceptance)

The following evidence and counts describe the pre-PW-005 checkpoint, not current Git totals.

- **CL1 DONE. CL2 RED observed. CL3 GREEN. CL4 independent offline PASS. CL5 test-harness
  follow-up DONE.** This documentation follow-up completed after its own readback and git
  checks (see §12). The historical 11-failure gate blocker is independently
  baseline-confirmed as pre-existing on base `1731350` and is **resolved**; there is no
  gate awaiting confirmation.
- **Strict TDD: ACTIVE.** Sources: `openspec/config.yaml` (`strict_tdd: true`) and
  `docs/TESTING.md` (TDD obligatorio for services/bugs). RED was observed before each
  source wave and GREEN after, with runner repeats (§10).
- **Baseline: `HEAD 1731350`** (`fix(prisma): require HMI name before QR pairing`, branch
  `feat/prisma-telegram-credentials`), unchanged. 21 modified files including the five
  documentation surfaces (§5, §12); untracked `.gga` untouched.
- **Delivery at that checkpoint: no commit, no push.** Manual acceptance and commit
  authorization were pending then; the current status above supersedes those next steps.
- **Route: delegated-direct** with task ids: read-only mapper `mucpyxaw-1-66yn` (original
  mapping), CL5 mapper `mucs6iq1-4-mzcj`, baseline verifier `mucselsk-5-1sas`, final
  independent verifier `muctg3tg-7-tbg4` (full-candidate PASS). RDD is off; no native
  review ran; the parent owns the Engram task mirror.
- **Non-goals (unchanged):** no scope expansion to frameworks, audioengine, STT, Telegram
  transport, Channel B, credentials, Ctrl+C handling, or live services. Production
  pairing behavior is untouched (the pairing corrections are test-harness only).

## 1. Objective and problem

A captured Channel A answer was authorized against `context_revision` (`hmi_sessions.py`)
and bounded only by the 15s receipt-age window. The browser exporter
(`dashboardSnapshotExport.service.ts`) republishes the visible snapshot every ~5s and every
publish bumped `context_revision`, so a captured answer was routinely invalidated between
capture and the HMI read-time guard (`channel_a_manager.is_query_envelope_current` →
`voice_events.publish(is_current=...)`): phone answered, HMI orb/audio silenced — the
reported intermittence (phone answers, no HMI audio; not a warmup issue).

Two fixes, both implemented: (1) `frameGeneration` distinguishes each visit to a view from
routine same-frame updates while preserving captured-answer expiry; (2) a captured
`captured_deadline` anchors each answer's true expiry in one monotonic domain. The legacy
path was never reactivated. Before the fix, the offline diagnostic showed that an identical
publish during a fake Telegram send could yield phone effect 1 and
`QUERY_ANSWER_UNPUBLISHED` with no HMI envelope.

Rejected (debate closed — do not reopen): a single-session stable revision keyed by
screen/view id — invalidate can be lost/reordered ahead of a higher-order publish
(A→B→A looks unchanged), and `is_owner_context_fresh_current` renews from the LATEST
`context_received_at`, which could keep a captured answer "fresh" up to the voice-event TTL.

## 2. Accepted contract resolutions (binding)

1. **Server ordering and None precedence** — under the lock, after the existing order
   check, reject `fg < highwater` with zero mutation FIRST, then evaluate whether the
   PRE-UPDATE context is None BEFORE assigning the new context (never assign-then-check).
2. **Client frame minting** — one client-global monotonically increasing numeric counter;
   no WeakMap/token/re-mint design; never reset across epoch.
3. **Captured deadline** — required `captured_deadline` float on `QueryEnvelope`;
   six-field construction fails at construction; activation samples the injected
   clock after the final status/witness gate.
4. **Regression coverage** — delivery_authority and root modules included in the focused
   runner; constructor fixtures adapted alongside the required-field GREEN rather than
   counting TypeErrors as RED.

## 3. Piece 1 — `frameGeneration` (browser → backend publish contract)

**Server rules (`hmi_sessions.py`):** `_Session` carries
`frame_generation_highwater: int = 0`. Wire: `{version:1, command:'publish', order,
snapshot, frameGeneration?}` — optional on publish only. Validation is exact: `int` (not
`bool`), positive, `Number.MAX_SAFE_INTEGER`-bounded (Python: `isinstance(fg, int) and not
isinstance(fg, bool) and fg > 0 and fg <= 9007199254740991`); anything else →
`ValueError("INVALID_SNAPSHOT")` without mutation. Unknown keys still rejected;
`frameGeneration` on an `invalidate` command rejected; envelope discipline and body
limits unchanged.

**State transition (under the existing lock, after the existing
`order <= command_order → False` check, for a publish carrying `frameGeneration`), in
this exact order:**

1. `fg < highwater` → return `False`, zero mutation (older frame rejected even with a
   higher order; no ABA return).
2. Evaluate whether the PRE-UPDATE context is None BEFORE assigning. Bump
   `context_revision` when `fg > highwater` **or** pre-update context is None; apply the
   context; when `fg > highwater`, set `highwater = fg`.
3. `fg == highwater` with pre-existing context → apply context and renew
   `context_received_at`/`command_order` only; `context_revision` UNCHANGED (routine
   refresh of the same frame).

Legacy publish (no `fg`) and `set_context`: today's behavior verbatim — unconditional
revision bump, highwater untouched. Invalidate: today's behavior verbatim
(`context=None`, revision bump); highwater retained so a retired frame cannot resurrect
after invalidation. `capture_owner_context` keeps its exact 3-tuple.

**Client minting (`prismaSessionClient.ts`, `dashboardSnapshotExport.service.ts`):**
client-global monotonic counter with `createContextFrame(): number`; safe-integer
exhaustion fails closed; the counter is never reset across epoch (epoch fences in-flight
intents; a new epoch implies a fresh server document with highwater 0) and increases
across exporter replacements and `reset`. `startDashboardSnapshotExporter` mints ONE
frame per exporter instance — each instance is one view visit — reused across periodic
ticks, hidden/offline resume, and `reset`; never derived from snapshot object identity or
minted per tick. `publishContext(...)` and `exportDashboardSnapshot` gain an optional
trailing numeric `frameGeneration`; legacy omission unchanged (no field on the wire when
absent).

**Ordering safety (analyzed):** orders are client-global and monotonic; a retired
exporter's in-flight publish is rejected by order and highwater; its invalidate is either
accepted before the new exporter's first publish or rejected after it — no sequence
clears an established new frame. Hide/offline → existing invalidate; resume → same-fg
publish over `context=None` → revision bump = fresh lifetime for new captures. Capability
reset while an exporter survives → epoch fence discards in-flight intents; the surviving
exporter reuses its frame over the fresh document (highwater 0, absent context → revision
bump) and the client counter increases only when `createContextFrame` is called. Captures
fail closed (`CONTEXT_UNAVAILABLE`) until the next publish lands.

## 4. Piece 2 — captured deadline anchor (internal envelope field)

**`channel_a_query.py`:** `QueryEnvelope` gains required `captured_deadline: float`
(SEVEN fields; six-field construction fails at construction — the correct oracle;
TypeErrors are not counted as behavior RED). `handle_query` passes its existing
coordinator `deadline`; validation is strict (`type(...) is float`, finite, `> 0`;
`None`/NaN/inf/non-positive rejected). `as_dict()` and the `answerEnvelope` wire
projection are UNCHANGED (internal field omitted).

**`channel_a_activation.py`:** `is_query_envelope_current` keeps every existing check
(admission witness, RUNNING status, `is_owner_context_fresh_current` 15s receipt-age
revision guard — exact 15-boundary semantics preserved) and, after the last `status()`
re-observation and the final reference-only witness match, makes the FINAL gate: sample
`now = self._query_clock()`, fail closed on exception/bool/non-number/non-finite/negative,
then require `now < captured_deadline` (exact equality fails closed). A reference-only
post-sample witness recheck closes injected-clock reentrancy (stop/invalidation during
the sample); it compares captured references under the existing locks and runs no foreign
callback, clock sample, or status query after the sample. The 15s receipt-age check
remains the revision/presence guard; the deadline is the per-answer expiry, immune to
same-frame `received_at` renewal. Runtime behavior now has a fixed internal answer
deadline — it is not a wire field.

## 5. Edit surfaces (all authorized; writer scope single-threaded)

**Production (6):**

| Path | Change |
|---|---|
| `services/prisma-runtime/src/prisma_runtime/hmi_sessions.py` | §3 state transition + field validation |
| `services/prisma-runtime/src/prisma_runtime/channel_a_query.py` | §4 envelope field + strict validation |
| `services/prisma-runtime/src/prisma_runtime/channel_a_activation.py` | §4 final deadline gate + reentrancy fence |
| `hmi-app/src/domain/prismaSession.types.ts` | frame type for the publish command |
| `hmi-app/src/services/prismaSessionClient.ts` | §3 counter + optional trailing param |
| `hmi-app/src/services/dashboardSnapshotExport.service.ts` | §3 one frame per instance |

**Tests — ten files total (7 original + 3 expanded-authority):**

| Path | Coverage |
|---|---|
| `services/prisma-runtime/tests/test_hmi_sessions.py` | §3 oracles |
| `services/prisma-runtime/tests/test_channel_a_query.py` | §4 envelope oracles |
| `services/prisma-runtime/tests/test_channel_a_activation.py` | §4 deadline gate + reentrancy oracles |
| `services/prisma-runtime/tests/test_channel_a_delivery_authority.py` | required in focused runner + boundary restoration (CL5.3) |
| `services/prisma-runtime/tests/test_channel_a_root.py` | required in focused runner |
| `hmi-app/src/services/prismaSessionClient.test.ts` | §6.7 frame discipline |
| `hmi-app/src/services/dashboardSnapshotExport.service.test.ts` | §6.7 exporter ticks |
| `hmi-app/src/pages/Dashboard.runtime.integration.test.tsx` | one-property fixture adaptation (CL5.1) |
| `services/prisma-runtime/tests/test_channel_a_pairing.py` | test-local harness fix (CL5.2) |
| `services/prisma-runtime/tests/test_channel_a_pairing_clock_cleanup.py` | docstring truthfulness only (CL5.2) |

`test_channel_a_bot.py` and the other Dashboard test files ran UNCHANGED as regression
witnesses. Production pairing is untouched.

## 6. Regression oracles (implemented)

1. **Routine refresh keeps the answer current (RED core):** publish `fg=5` → revision R;
   captured answer stays current; same `fg=5` with higher order → revision still R and
   `is_owner_context_current(owner, R)` True.
2. **Visit invalidates:** publish `fg=6` → revision R+1; previous revision no longer current.
3. **Guards:** ABA rejection; invalidate retains highwater; order guard; legacy
   publish/set_context unconditional bump; invalidate unchanged.
4. **None precedence:** same-fg publish over `context=None` bumps revision.
5. **Discipline:** malformed `fg` (bool/0/negative/float/2^53) → `INVALID_SNAPSHOT`; unknown
   key rejected; `frameGeneration` on invalidate rejected; body limits unchanged; legacy
   body accepted.
6. **Deadline anchor:** delivered envelope carries finite `captured_deadline`; `as_dict()`
   omits it; six-field construction fails AT CONSTRUCTION; guard flips False when the
   injected clock passes the deadline while revision is current and receipt age < 15s;
   exact equality fails closed; non-finite/negative/bool clock samples fail closed; no
   callback after the sample; injected-clock stop/invalidate during the sample still fails
   closed via the reference-only witness recheck (CL5.4).
7. **Frontend frame discipline:** two exporter ticks with different snapshot objects send
   the same `frameGeneration`; a new exporter instance mints a GREATER value;
   `reset`/epoch is safe (counter never resets); legacy path without frame unchanged.
8. **Inclusive receipt-age boundary restored (CL5.3):** direct predicate check —
   `is_owner_context_fresh_current` True at 115.0, False at 115.001,
   `max_age_seconds=15`, revision captured at 100.

## 7. TDD discipline (strict, observed)

RED: smallest failing tests per §6 added and actual failures observed before each source
wave (backend first, then frontend). GREEN: §3/§4 minimum implemented on §5 surfaces;
focused runner repeated after implementation. TRIANGULATE: negative/alternate cases in §6;
fixtures adapted, never deleted; assertions bodies preserved (only docstring/clock-helper
test-local changes). REFACTOR: clarity only, tests staying green.

## 8. Verification commands

**Backend focused — S1 narrow (one module) and S2 full (six modules).** Outer wrapper
from the monorepo root in Bash/Git Bash; the inner supervisor resolves the runtime root,
runs from it, uses a fresh temporary state dir, and strips the exact eleven README PAC-5
variables. Narrow S1 by reducing the module list to `tests.test_hmi_sessions` only;
narrow the harness wave to `['tests.test_channel_a_pairing',
'tests.test_channel_a_pairing_cleanup', 'tests.test_channel_a_pairing_clock_cleanup']`.

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
    'tests.test_hmi_sessions',
    'tests.test_channel_a_query',
    'tests.test_channel_a_activation',
    'tests.test_channel_a_delivery_authority',
    'tests.test_channel_a_root',
    'tests.test_channel_a_bot',
]
with tempfile.TemporaryDirectory(prefix='prisma-cl-') as temporary:
    child_env = os.environ.copy()
    child_env['PRISMA_RUNTIME_STATE_DIR'] = temporary
    for name in cleared:
        child_env.pop(name, None)
    child_env['PYTHONPATH'] = str(root / 'src')
    child_env['PYTHONDONTWRITEBYTECODE'] = '1'
    result = subprocess.run(command, env=child_env, cwd=str(root), check=False)
    print(f'CL focused backend exit:{result.returncode}', flush=True)
exit(result.returncode)
PY
```

**Backend final gate (unchanged README block, run verbatim):** locator
`services/prisma-runtime/README.md` → section "Offline-safe verification" → the PAC-5
reproduction block (the eleven-cleared-variable child-only supervisor invoking
`verify-local.ps1`), from the monorepo root in Bash/Git Bash. Do not change those
canonical instructions.

**Frontend focused (from repo root):**

```bash
npm --prefix hmi-app test -- src/services/prismaSessionClient.test.ts src/services/dashboardSnapshotExport.service.test.ts src/pages/Dashboard.test.tsx src/pages/Dashboard.presentation.test.tsx
npm --prefix hmi-app test -- src/pages/Dashboard.runtime.integration.test.tsx
```

**Frontend final (from repo root, in order):**

```bash
npm --prefix hmi-app run test:coverage
npm --prefix hmi-app run build
npm --prefix hmi-app run lint
```

No installs, service starts, or environment mutation beyond the supervisor's child copy;
`services/prisma-runtime/.venv/Scripts/python.exe` exists (parent-confirmed).

## 9. Tasks

- [x] **CL1-contract** — this document frozen per §2. DONE.
- [x] **[GATE] user authorization** — `authorize_context_lifetime_implementation`, then
      the follow-up selection plus `authorize_pairing_test_harness_fix` for CL5.
- [x] **CL2-test-RED** — §6 backend first, then frontend; failures observed (§10).
- [x] **CL3-source-GREEN** — §3/§4 minimum on §5 surfaces; runner repeats to green.
- [x] **CL4-verify** — writer-level gates green, then **independent offline full-candidate
      PASS** (`muctg3tg-7-tbg4`; §10, §11), before PW-005. Manual acceptance followed in CL6.
- [x] **CL5-gates-follow-up** — frontend fixture (CL5.1), test-local pairing harness fix
      (CL5.2), boundary restoration (CL5.3), injected-clock fence (CL5.4). DONE (§10).
- [x] **CL6-manual-acceptance** — user reported: «si, loacabo de comprobar y ahora si
      responde bien, no se evita ninguna pregunta y responde por telegram y por voz en la
      hmi mostrando el orbe.» Acceptance covers exercised questions and reported Telegram,
      HMI voice/orb outcomes only; no agent-executed live acceptance, separate cross-view
      or latency evidence. One local commit is authorized/pending the parent.

## 10. Implementation evidence (strict TDD; observed)

| Wave | RED observed (before source) | GREEN observed (after source) |
|---|---|---|
| S1 registry (`hmi_sessions.py`) | S1-narrowed supervisor: 42 tests, 5 failures — framed publish rejected `400 != 202`; two follow-up failures were fixture arithmetic, fixed in test, then repeat. | 42/42 OK, exit 0. |
| S2 envelope+activation (4 backend modules) | Six-module supervisor: 391 tests, 2 failures + 15 errors. Behavioral RED core: delivered answer stayed `current` after the query clock advanced 16s past delivery — the missing fixed-expiry guard reproduced, not a live intermittence reproduction; six-field constructor did not raise. The 15 errors were fixture-class TypeErrors, adapted at GREEN. | 391/391 OK, exit 0. |
| S3 frontend (client/exporter/types) | Focused: 3 failed / 59 passed — `createContextFrame is not a function`; `frameGeneration` missing from framed and exporter bodies. | 62/62 passed, 4 suites; Dashboard suites unchanged. |
| CL5.1 frontend fixture | `Dashboard.runtime.integration.test.tsx`: 1 failed / 4 passed — received body carries `frameGeneration: 1`, expected object lacked it. | 5/5 passed. |
| CL5.2 pairing harness | §8 supervisor, harness vector: 100 tests, 11 failures, exit 1 — identical to independent baseline `mucselsk-5-1sas` (current tree AND isolated archive of `1731350`: each 14 tests, 11 identical failures, 3 passes, 0 errors, exits `[1, 1]`). | 100/100 OK, exit 0. |
| CL5.3 boundary | Coverage restoration only; the registry predicate is unchanged production, so no behavioral RED is claimed. | Covered by the CL5.4 six-module GREEN. |
| CL5.4 clock fence | Six-module §8 vector: 394 tests, 2 failures — both reentrancy scenarios (stop/invalidate during the final sample still authorized the witness). | 394/394 OK, exit 0. |

**CL5 content:** `Dashboard.runtime.integration.test.tsx` gained
`frameGeneration: expect.any(Number)` on the exact expected publish object (everything
else unchanged). `test_channel_a_pairing.py` (test-local only): `_GatedLock.__enter__`
rejects a falsy `release.wait(5)` with a truthful `TimeoutError` BEFORE acquiring the
inner lock, and `_race` plus the delayed-touch duplicate share one `_run_gated_transition`
mirroring `_run_generation_race` — worker `BaseException`/main failures captured, gate
release always attempted before joins, every successfully started worker independently
joined (bounded 5s) and observed alive despite other cleanup failures, categorized
worker/main/release/join/liveness causes aggregated with original injected markers.
`test_channel_a_pairing_clock_cleanup.py` assertion bodies unchanged; only the docstring
was corrected for truthfulness. `test_channel_a_delivery_authority.py` gained the direct
inclusive-boundary check (§6.8) while the composed exclusive-deadline test stays verbatim;
`channel_a_activation.py` gained the reference-only post-sample witness recheck
(`_captured_deadline_current` requires `self._delivery_witness_matches(original_witness)
is True`) after two behavioral reentrancy REDs.

**Residual test-only limitation (honest):** the supported harness cleanup path
(successfully started workers + refused-before-start) is exercised; a static, unexecuted
hypothetical worker start raising AFTER identity is not covered by tests. This is a
residual test-only limitation of the harness, not a new production defect, and not scope
expansion.

## 11. Independent CL verification (`muctg3tg-7-tbg4`, full CL candidate PASS before PW-005)

| Command | Observed result |
|---|---|
| README PAC-5 backend gate (verbatim, fresh sandbox, eleven overrides absent) | 1121 tests, 23.299 s, exit 0. |
| `npm --prefix hmi-app run test:coverage` | 209 suites / 2188 PASS, 67.18 s, exit 0; statements 87.42 %, branches 80.63 %, functions 86.57 %, lines 88.30 %; thresholds 70 unchanged. |
| `npm --prefix hmi-app run build` | PASS, 10.03 s, exit 0. |
| `npm --prefix hmi-app run lint` | PASS, exit 0. |
| `git diff --check` | PASS, exit 0 (LF/CRLF warnings only). |

Non-failing canvas warnings came from frontend tests; `grid.svg` and chunk-size
warnings came from build, not from the diff check.

Baseline `mucselsk-5-1sas` confirmed the 11 historical `test_channel_a_pairing_clock_cleanup`
failures identical on the current tree and an isolated archive of `1731350`
(children `[1, 1]`, outer 0, NOT green) — pre-existing, now resolved by CL5.2.
Diff before this documentation follow-up: `HEAD 1731350` unchanged, 17 modified files,
1180+/121− (production 103+/6−, tests 517+/42−, task 560+/73−). Production pairing
untouched; clock-cleanup oracle assertion bodies unchanged (docstring only). The user's
real audio/orb acceptance had NOT yet occurred at this gate; CL6 later records the user
report, without separate latency evidence or a live root-cause proof.
RDD off and native risk assessment unavailable due to untracked-scope declaration, hence the
independent verifier route; no native terminal review or approval was run.

## 12. Historical documentation follow-up (2.0.19)

Authorized documentation-only follow-up after the independent full-candidate PASS:
consolidated this task file into one truthful current document (superseded contradictory
status removed; history condensed without dropping contract semantics, exact paths, auth
history, stable CL1–CL5 ids, observed RED/GREEN, final numeric proof, the manual next
step, and the residual clock-harness limitation); updated `docs/PENDING_WORK.md` PW-003
only, the master document (2.0.19: header, §11.1 checkpoint, changelog), the runtime
README wire-contract paragraph, and one consistency paragraph in
`docs/prisma/PRISMA_BROWSER_ROUTING.md`. No source/test edits, no test/runtime runs, no
commit/staging/push; readback and `git diff --check` / `git status --short` /
`git diff --numstat` verified, with source/test numstat identical before and after.

## 13. Historical provenance (brief)

The 2026-09-22 first close froze a DRAFT/DOCUMENTATION-ONLY CL1 with a reconfirmation
gate (base pre-commit `c82fe44`, committed as `1731350`); a fresh explicit user choice
(`authorize_context_lifetime_implementation`) discharged that gate and authorized the
offline TDD implementation. §10/§11 supersede all earlier "gate awaiting confirmation"
wording; historical labels in the master document retain their period meaning. No commit
or push had been made at that checkpoint. Current session closure authorizes one local
commit, pending the parent; its actual identity will be recorded in Engram only after success.
