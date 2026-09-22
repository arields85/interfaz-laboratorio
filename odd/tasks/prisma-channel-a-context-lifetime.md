# CL — Context lifetime contract fix: distinguish view visits from routine updates

## SESSION CLOSE / NEXT SESSION (2026-09-22) — GATE RECONFIRMATION REQUIRED

Documentation-only close. Status remains DRAFT/DOCUMENTATION-ONLY CL1: no CL2 tests, no CL3 source, and no CL4 verification of this proposal were started or executed. The user said "avisame antes de implementar" and then explicitly deferred this exact point to the next session; neither this session close nor a generic "continue" infers implementation permission.

Next session must: read the master COMPLETE (§11.1/§3.4), recover Engram checkpoint `checkpoint/prisma-channel-a-manager-resume` (updated by the parent after the authorized session-close commit), this CL task and its mirror `odd/prisma-channel-a-context-lifetime/tasks`, the NAME record (`prisma-pairing-name-preflight`) and PENDING/Git. Then present the planned two pieces (frame/visit generation + captured-answer deadline) and WAIT for FRESH explicit confirmation BEFORE any test or source edit.

The final execution contract is NOT frozen. Before execution, clarify: (a) equal frameGeneration / context None precedence, (b) the legacy setter/publication transition versus the frame highwater, (c) exact test edit paths and a safe, executable focused runner. Do NOT claim ready for blind apply. The six planned production files and their tests are not yet finalized or frozen. No scope expansion to frameworks, audioengine, B or Ctrl+C. Source and tests for this fix have NOT been started.

Status: CONTRACT ONLY (CL1). No source/test edits, no commands run for this fix. Baseline `HEAD c82fe44` (feat/prisma-telegram-credentials) plus the COMPLETE, uncommitted NAME-panel fix — preserve it, its task doc, its tests, and `docs/PENDING_WORK.md` PW005 untouched.

## 1. Objective and current problem

A captured Channel A answer is authorized against `context_revision` (hmi_sessions.py) and its lifetime is bounded only by the 15s receipt-age window. The browser exporter (`dashboardSnapshotExport.service.ts`) republishes the visible snapshot every ~5s; every `apply_context_command` publish bumps `context_revision`. Therefore a captured answer is routinely invalidated by a routine same-view refresh between capture and the HMI read-time guard (`channel_a_manager.is_query_envelope_current` → `voice_events.publish(is_current=...)`): phone effect observed, HMI orb/audio silenced — the reported intermittence (phone answers, no HMI audio; not a warmup issue).

## 2. Why this scope is essential (user-authorized)

`authorize_context_lifetime_contract_fix`: the browser/backend contract must distinguish each visit to a view from routine same-frame updates, while preserving captured-answer expiry. Excluded: audioengine, STT, Telegram transport, Channel B, credentials, Ctrl+C handling, framework work, commits/push, live queries. The former reliable HMI TTS behavior is wanted, but the legacy path is never reactivated. The accepted offline primitive stays: an identical publish during a fake Telegram send yields phone effect 1 and `QUERY_ANSWER_UNPUBLISHED` with no envelope; after publish, events may retire.

Rejected plan (debate closed — one independent challenge spent, do not reopen): a single-session stable revision keyed by screen/view id. Unsafe: (a) invalidate can be lost/reordered ahead of a higher-order new publish (A→B→A with no B publish looks unchanged); (b) `is_owner_context_fresh_current` renews from the LATEST `context_received_at`, so a captured answer could stay "fresh" up to the voice-event TTL (300 s). Both are addressed by the two approved pieces below.

## 3. Implementation gate (binding)

After this CL1 contract, the parent presents the planned scope to the user and WAITS for fresh explicit confirmation BEFORE any implementation, including test edits. CL2/CL3/CL4 are blocked by this gate; the prior implementation authorization is not auto-executable. Only CL1 (this document) is complete now.

## 4. Piece 1 — `frameGeneration` (browser → backend publish contract)

**Wire (publish command only):** `{version:1, command:'publish', order, snapshot, frameGeneration?}`. Missing `frameGeneration` = legacy command: today's behavior (revision bump on every publish). Present: must be `int` (not bool), `1 ≤ frameGeneration ≤ 9007199254740991`; anything else → `ValueError("INVALID_SNAPSHOT")` without mutation. Exact-set envelope discipline and body limits unchanged; unknown keys still rejected. `invalidate` unchanged.

**Server state/rules (hmi_sessions.py, `_Session` gains `frame_generation_highwater: int = 0`):** under the existing lock, after the existing `order <= command_order → False` check, for a publish carrying `frameGeneration`:
- `fg < highwater` → return `False`, zero mutation (older frame rejected even with a higher order; no ABA return).
- `fg == highwater` → apply context, renew `context_received_at`/`command_order`, `context_revision` UNCHANGED (routine refresh of the same frame).
- `fg > highwater` or `context is None` → apply, `context_revision += 1` (new frame / post-invalidate replacement), `highwater = fg`.
- Legacy publish (no `fg`) → today's behavior verbatim; highwater untouched.
- `invalidate` → today's behavior verbatim (`context=None`, revision bump); highwater untouched so a retired frame cannot resurrect after invalidation.
`capture_owner_context` keeps its exact 3-tuple `(age, context, revision)`; no other registry API changes.

**Client minting (prismaSessionClient.ts, mirroring the existing intent pattern):** new `#frameGeneration` counter and `createContextFrame(): PrismaContextFrame` (frozen token + WeakMap frame→`{epoch, generation}`; exhausted at `MAX_SAFE_INTEGER`; stale frame after epoch change throws `PrismaStaleSessionResponse`, same as intents). The counter renews (resets) on capability epoch change — safe because a new epoch implies a fresh server session document with highwater 0. `publishContext(intent, snapshot, signal?, transport?, frame?)` includes `frameGeneration` only when a frame is supplied.

**Exporter wiring (dashboardSnapshotExport.service.ts):** `startDashboardSnapshotExporter` mints one frame per instance — each instance is one view visit (view navigation already stops the old exporter and starts a new one; retirement stays the immediate invalidation seam). The frame is reused across periodic ticks; it is re-minted only on observed client epoch change. `exportDashboardSnapshot` gains an optional trailing `frame` param. The frame is instance-scoped, never derived from snapshot object identity or per tick, so routine value updates cannot accidentally mint a new frame (CL2 frontend test asserts two ticks with different snapshot objects share one `frameGeneration`).

**Ordering safety (analyzed, no code):** orders are client-global and monotonic. A retired exporter's in-flight publish (lower order, older `fg`) is rejected by order and by the highwater rule; its invalidate (minted at retirement, order N) is either accepted before the new exporter's first publish (order > N, new frame → revision bump) or rejected after it. No sequence clears an established new frame. Hide/offline → existing invalidate; resume → same-fg publish over `context=None` → revision bump = fresh lifetime for new captures. Capability reset while an exporter survives → epoch fence discards in-flight intents, frame re-minted on next tick; captures fail closed (`CONTEXT_UNAVAILABLE`) until the first publish lands.

## 5. Piece 2 — captured deadline anchor (internal envelope field)

**Choice:** propagate the coordinator's ALREADY-computed monotonic `deadline` inside `QueryEnvelope` as new required field `captured_deadline: float`. Justification: the coordinator's clock is the activation's injected `query_clock` (`time.monotonic` in `local_presentation.py`); the guard samples that same injected clock, so both values live in one monotonic domain — no wall-clock/monotonic mixing, and `capture_owner_context`'s 3-tuple and all its callers stay untouched.

**channel_a_query.py:** `QueryEnvelope(owner_id, generation, update_id, epoch, answer_text, context_revision, captured_deadline)`; `handle_query` passes its existing `deadline`. `is_query_envelope_well_formed` additionally requires `type(...) is float`, finite, `> 0`; a missing field fails the `try/except` → not well-formed (fail closed, never silently renewed). `as_dict()` and the `answerEnvelope` wire projection are UNCHANGED (internal field omitted; no external-wire or fixture churn beyond envelope constructors).

**channel_a_activation.py:** retain `self._query_clock = query_clock`. In `is_query_envelope_current`, keep every existing check (admission witness, RUNNING status, `is_owner_context_fresh_current` 15s receipt-age revision guard — exact 15-boundary semantics preserved) and make the FINAL gate, after the last `status()` re-observation and the final reference-only witness match: sample `now = self._query_clock()` (fail closed on exception, bool, non-number, non-finite, negative) and require `now < captured_deadline`. No foreign callback runs between that sample and the return (existing pattern). The 15s receipt-age check remains the revision/presence guard; the deadline is the true per-answer expiry, immune to same-frame `received_at` renewal.

## 6. Invariants

1. Each view visit strictly increases `frameGeneration` (client-global counter, renewed per epoch) and bumps `context_revision` server-side; routine same-frame refreshes never do.
2. A captured answer dies on: view visit, invalidate, view change (A→B→A cannot return it — no ABA), or deadline passage — never by routine refresh, never extended by later receipts.
3. Legacy commands (missing field) keep today's fail-closed bump behavior; malformed field/unknown keys rejected without mutation; body limits unchanged.
4. Clock domains never mix: monotonic deadline vs monotonic guard sample; wall-clock receipt age stays inside its own check.
5. No new globals/framework; only the listed surfaces change; read-only HMI rules and the accepted offline primitive hold.

## 7. Tasks

- **CL1-contract** — this document. DONE.
- **[GATE] user re-confirmation** — parent presents scope; wait. Blocks CL2–CL4.
- **CL2-test-RED** — add the smallest failing tests per §8 (backend first, then frontend); capture observed failures. Existing defensive fixtures are adapted (e.g., envelope constructors gain the field), never with deleted assertions; test count managed, no giant matrix.
- **CL3-source-GREEN** — implement §4/§5 minimum on the exact surfaces in §4/§5; focused tests green; triangulate negative cases already in §8.
- **CL4-verify** — run §9 commands; full backend suite (shape change) and frontend `test:coverage`/`build`/`lint` final.

## 8. Regression oracles (composed, meaningful)

1. **Routine refresh keeps the answer current (RED core):** publish `fg=5` → revision R; publish same `fg=5` with higher order → revision still R and `is_owner_context_current(owner, R)` True (fails today).
2. **Visit invalidates:** publish `fg=6` → revision R+1; `is_owner_context_current(owner, R)` False.
3. **No ABA + post-invalidate rule:** publish with higher order but `fg=5` after `fg=6` → `False`, zero mutation; invalidate then same-fg republish → revision bump (no stale resurrection).
4. **Compat + discipline:** legacy publish (no field) accepted with bump; malformed `fg` (bool/0/negative/float/2^53) → `INVALID_SNAPSHOT`, no mutation; unknown key still rejected.
5. **Deadline anchor:** delivered envelope carries finite `captured_deadline` and is well-formed; `as_dict()` omits it; a legacy 6-field envelope is not well-formed; `is_query_envelope_current` flips False when the injected `query_clock` passes the deadline even though revision is current and receipt age < 15s (the exact intermittence scenario); non-finite/negative clock sample fails closed.
6. **Frontend frame discipline:** two exporter ticks with different snapshot objects send the same `frameGeneration`; epoch reset re-mints; a new exporter instance mints a greater value; legacy path without frame still publishes.

## 9. Commands (run later only by parent/verifier; one run per pattern)

- **Backend focused (derived, run once):** the README's sandboxed child-only supervisor (`services/prisma-runtime/README.md`, section "Offline-safe verification", the 11-cleared-variable PAC-5 block) with `command` replaced by `['services/prisma-runtime/.venv/Scripts/python.exe', '-B', '-m', 'unittest', 'tests.test_hmi_sessions', 'tests.test_channel_a_query', 'tests.test_channel_a_activation', 'tests.test_channel_a_bot']` and `child_env['PYTHONPATH'] = 'services/prisma-runtime/src;services/prisma-runtime'`, from the monorepo root in Bash/Git Bash.
- **Backend full gate (verbatim, locator):** `services/prisma-runtime/README.md` → "Offline-safe verification" → the PAC-5 reproduction block, unchanged, from the monorepo root in Bash/Git Bash.
- **Frontend focused:** from `hmi-app/`: `npx vitest run src/services/prismaSessionClient.test.ts src/services/dashboardSnapshotExport.service.test.ts src/pages/Dashboard.test.tsx src/pages/Dashboard.presentation.test.tsx`.
- **Frontend final:** from `hmi-app/`: `npm run test:coverage` → `npm run build` → `npm run lint`.

## 10. Safety and forecast

No network, providers, credentials, commits, or destructive operations anywhere in this plan; all tests offline. Forecast: backend ≈ 60–90 source lines + ≈ 200 test lines across 4 test modules; frontend ≈ 50 source lines (2 services + 1 domain type) + ≈ 120 test lines. Delivery strategy: ask-on-risk — no commit now; after the gate and green CL4, the parent proposes work-unit commits (Conventional Commits, tests+docs with behavior) and the user decides. Risks: the derived focused-backend command has not been run before (full gate is the authoritative fallback); exporter instance↔view-visit equivalence relies on the existing per-view `startDashboardSnapshotExporter` lifecycle (asserted by `Dashboard.presentation.test.tsx`).
