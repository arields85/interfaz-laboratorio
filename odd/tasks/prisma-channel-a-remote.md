# Prisma Channel A remote — ODD tasks

## Status and next action

RCA-1 complete and independently verified offline, committed as `e32bef1fa5189c51fa6a9c89c4807e808c27cada`. RCA-2 complete and independently verified offline (local commit pending); RCA-3 in progress (read-only integration planning). Original baseline: `6e05e38`, branch `feat/prisma-telegram-credentials`; RCA-2 base: `e32bef1`. Next: commit verified RCA-2 locally, then map and implement the separate bot A adapter without live provider calls. Full Channel A remains incomplete.

Recovery mirror: `odd/prisma-channel-a-remote/tasks` (full document plus this path).

## Objective and authority

Let a person viewing an inputless HMI use their phone to ask about that document's current visible snapshot. Source of approved intent: `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` v2.0.12 §11.1 and `checkpoint/prisma-channel-a-remote-odd`. User explicitly authorized implementation with ODD, a maintained frontend QR dependency/install, and future feature-branch-chain review slices. No SDD, push, PR creation, live Telegram/Gemini calls, paid tests or runtime restarts are authorized. User authorized local code/test/tracker commits after each verified work unit, beginning with RCA-1; no push or PR.

## Contract and constraints

- Dedicated bot A; preserve bot B behavior, admission, lifecycle and persisted snapshot. Reuse the protected credential store and existing admin session; no second login.
- Automatic single-use opaque QR, rotating every 60 seconds while free. Never expose HMI capability/admin/bot secrets. Phone confirms destination with Telegram buttons; Start may be required. QR possession is not proof of proximity; forwarded-photo risk remains a design limitation, not a waived security requirement.
- One phone per HMI document session and one HMI per phone; multiple independent pairs. No takeover/implicit transfer. Hide QR while linked; phone unlink. In-memory links expire on restart/reload/session expiry.
- Human inactivity is 10 minutes, independent of technical polling. Advance warning and keep-connected; lead time configurable. Configuration home/default/range to finalize before wiring, not a blocker for injected domain configuration.
- Existing deterministic visible-snapshot parser only. Same answer text in HMI and phone, existing HMI audio. No Telegram response audio or latent recipient path. STT/NLU/navigation/history/offscreen data are deferred. No industrial writes.
- Server-observed context receipt freshness and bounded presence, never client timestamp alone or stale/global/cross-owner fallback. Internal owner lookup never provides a capability and never renews session activity.
- Generation/correlation protects late answers/audio across unlink/relink, including an unchanged session owner. Deduplicate updates; offsets alone do not guarantee exactly-once.
- Frontend domain types only in `domain/`; tokens, Lucide and `hmi-scrollbar`; follow project admin conventions. No edits under `Directrices/`.

## Tasks and boundaries

All tasks use one delegated writer at a time (multi-file/preparation trigger). About 400 authored lines per task is advisory only: do not drop tests, minify or split artificially to fit.

- [x] **RCA-1 — Fresh internal HMI context (offline verified; committed e32bef1).** Add server receipt time and internal owner-scoped freshness access without changing capability callers. Exact source scope: `services/prisma-runtime/src/prisma_runtime/hmi_sessions.py`; tests: `services/prisma-runtime/tests/test_hmi_sessions.py`. Prove missing/stale/closed/expired rejection, independent owners, deep-copy isolation, no bearer leakage and no activity renewal. Explicit positive finite freshness bound supplied by caller; no arbitrary product default. Preserve existing routes/behavior. Forecast 120–250 lines.
- [x] **RCA-2 — Pairing domain (offline verified; commit pending).** New `channel_a_pairing.py` and `test_channel_a_pairing.py`: bounded token lifecycle, atomic claim/phone confirmation, exclusivity, generation, unlink, human timeout/warning/keepalive. Fake clocks, entropy, races and late-result tests. No HTTP/providers. Depends RCA-1. Forecast 350–650.
- [ ] **RCA-3 — Dedicated bot adapter (planning in progress).** New bot A module/tests: private chat identity, callbacks, confirmation, unlink/keepalive, text-only answers, dedupe and correlated cancellation. All transport mocked; no B behavior changes. Depends RCA-2. Forecast 300–550.
- [ ] **RCA-4 — Protected A credentials/admin contract.** Independent resolver/lifecycle and provider key (planned `telegram_channel_a`), backend status/apply plus exact frontend domain parser/admin UI in existing session. Preserve B status contract. Resolve exact paths before writer launch. Forecast 400–750.
- [ ] **RCA-5 — HTTP/runtime integration.** Capability-scoped pairing endpoints/proxy, internal freshness and generation gates, lifecycle startup/shutdown, bot username discovery via mocked getMe; unconfigured/stopped bot yields unavailable state, not a fake QR. Configure bounded warning/presence policy. Integration/negative isolation tests. Depends RCA-1–4. Forecast 400–750.
- [ ] **RCA-6 — HMI QR/link presentation.** Select maintained local QR encoder (no external QR service), pinned lockfile; session client, typed pairing state, hook and automatic UI. Token expiry/reset/error and multi-HMI tests. Depends RCA-5. Forecast 350–650 excluding generated lockfile.
- [ ] **RCA-7 — HMI text/audio correlation.** Visible text plus existing audio, generation invalidation cancels stale work; phone receives matching text. Resolve automatic transcript placement/lifetime before UI implementation; no required local interaction. Component/service tests. Depends RCA-5–6. Forecast 250–500.
- [ ] **RCA-8 — Integrated verification and docs.** Backend/HMI full suites, coverage/build/lint, independent risk-based check; README/master reconciliation. Keep offline vs live evidence distinct and pending backlog active. Forecast 100–200.

## RCA-2 execution contract

Exact new surfaces: `services/prisma-runtime/src/prisma_runtime/channel_a_pairing.py` and `services/prisma-runtime/tests/test_channel_a_pairing.py`. Existing files and RCA-1 stay unchanged. Pure in-memory registry, no transport/config/storage dependencies. Clock/entropy injectable; bounded allocation, thread-safe atomic transitions and immutable/copy-safe public projections. Phone identity is the Telegram actor in a private chat, validated by the future adapter, not a durable hardware identifier.

One current 60-second QR per free owner; repeated status does not extend TTL, rotation invalidates old challenge. Consuming a QR only creates pending phone confirmation, not a linked controller. Pending confirmation is bound to the claiming phone and expires no later than the original QR deadline; replay/racing claims or confirmations cannot take over a reservation/link. Active and pending reservations enforce one phone/one owner. Confirm via a separate opaque callback ticket; no owner/capability secrets in Telegram payloads. No future integration may treat owner id alone as authority.

10-minute human idle starts on confirmed link; only admitted human interaction/explicit keep-connected renews. Technical status/QR polls never renew it. Inject warning lead (positive and below idle TTL), emit at most one warning per activity window; resets only on human activity. Distinct generation on each confirmed link; old generation cannot validate results, touch, keep alive or unlink a replacement. Unlink/owner invalidation/expiry clears pending/current challenges and associations; owner invalidation will be wired later. Deadlines reject at equality. No unbounded replay/tombstone history. Current-link checks are domain predicates, not a claim of atomic network delivery or cancellation of already-playing audio.

Tests cover expiry boundaries, replay, wrong phone, simultaneous claims/confirms, independent pairs, fresh QR after release, old-generation rejection, human vs technical clocks, warning dedupe/reset, owner invalidation and capacity release. Product timing policy remains 60s/600s; warning lead injected rather than selecting a new UI default.

## TDD and verification

TDD ON for logic/services/bugs, mandated by `AGENTS.md` §8–9 and `docs/TESTING.md`; observed RED before source edits, GREEN then refactor. Components also receive behavioral tests. No historical suite count is current evidence.

Frontend runner: `npm --prefix hmi-app test -- <focused paths>` (`vitest run --allowOnly=false`); integration: `npm --prefix hmi-app test`, `npm --prefix hmi-app run test:coverage`, `npm --prefix hmi-app run build`, `npm --prefix hmi-app run lint`.

RCA-1 focused command, from repository root in Bash/Git Bash (repeat for RED/GREEN):

```bash
./services/prisma-runtime/.venv/Scripts/python.exe -B - <<'PY'
import os
from pathlib import Path
import subprocess
import tempfile
with tempfile.TemporaryDirectory(prefix='prisma-rca-test-') as temporary:
    env = os.environ.copy()
    for name in list(env):
        if name.startswith(('PRISMA_', 'TELEGRAM_', 'GEMINI_')):
            env.pop(name)
    env['PRISMA_RUNTIME_STATE_DIR'] = temporary
    env['PYTHONPATH'] = str(Path('services/prisma-runtime/src').resolve())
    result = subprocess.run([
        'services/prisma-runtime/.venv/Scripts/python.exe', '-B', '-m',
        'unittest', 'discover', '-s', 'services/prisma-runtime/tests',
        '-p', 'test_hmi_sessions.py',
    ], env=env, check=False)
raise SystemExit(result.returncode)
PY
```

RCA-2 focused command: use the exact RCA-1 supervisor above with only the unittest discovery pattern changed to `test_channel_a_pairing.py`. Observe RED before production implementation. Run the same isolated full backend gate after GREEN. Its caches are authorized incidental test output, not source changes.

RCA-1 full backend command: execute the exact child-only supervisor code block under **Offline-safe verification** in `services/prisma-runtime/README.md` (owned Python -> `operations/verify-local.ps1`, fresh temporary state, eleven sensitive/config overrides removed). Inspect fixtures before running; never invoke the production launcher or bare unisolated gate. This is environment isolation, not a network sandbox. Stop unexpected live access. Later A-specific env overrides must also be removed when introduced.

Every writer reports exact command/result, RED failure reason, GREEN counts, changed paths and limitations. `git diff --check` required. Parent calls native `assess` after each writer; failed/unavailable assessment treated as high with independent verifier. Parent spotchecks one reported command before delivery. No review/consent authority inferred from checkboxes.

## RCA-2 evidence (accepted offline after correction)

Writer created only the two authorized new files: 566 source + 635 test lines = 1,201 authored lines. Observed RED: missing module before implementation. Writer GREEN: 32 focused and 330 full backend tests; git diff --check passed for tracked changes (untracked source/tests need separate readback). Much larger than forecast; do not trim coverage or formatting for size. Registry provides challenge/claim/confirm/cancel, link lookup, generation validation, human touch, warning, unlink and owner invalidation. Independent verifier interim evidence: focused32/full330 PASS but deterministic event/lock probes reproduce stale pre-lock time admitting QR claim/confirm at expiry, result validation and human touch at idle expiry (reviving the link), and delayed touch overwriting newer activity. Finite backward clock samples also regress activity; extreme finite arithmetic can create infinite deadlines; oversized config/clock integers leak OverflowError. Final independent verdict FAIL: pre-lock time and backward clocks HIGH/blocking; infinite arithmetic/raw numeric overflow and inaccurate doc claims LOW. Correction stays within the same two files: monotonic default, clock sampling plus regression checks inside serialized transitions, finite computed deadlines validated before credential consumption/activity mutation, normalized overflow and deterministic race/regression tests. Clarify clock-domain timestamps (not Unix epoch), UUID shape is not authority, and injected clock/entropy are trusted infrastructure functions distinct from forbidden lifecycle callbacks. Writer correction observed RED42 (9 failures/4 errors), then focused43/full341 PASS. Revised candidate: 607 source + 901 tests = 1,508 lines; monotonic default, in-lock time/watermark, finite future deadlines and domain numeric errors implemented. Fresh independent verdict PASS: focused43/full341 observed; deterministic original probes now reject stale/rollback/overflow operations. Pure-memory faulty-order simulation caused four expected assertion failures, demonstrating non-vacuous race tests. All four findings closed, no new blocker. Parent read numeric/deadline/watermark implementation and reran git diff --check. RCA-2 accepted offline, not full feature or live acceptance. Native assessment unavailable again, RDD off: high-risk verification fallback. RCA-2 local commit pending. Coherent scope expanded to 1,508 source/test lines; preserve tests and document the overage. Future PR slicing/size exception remains unresolved; no PR authorized or created.

## Delivery and evidence

Strategy: `ask-on-risk`, chain strategy **feature-branch-chain**, selected by user. Forecast 2,270–4,300 authored lines, generated lockfile excluded; estimates provisional. Proposed slices: freshness; pairing; bot; protected credentials; wiring; QR; transcript; final integration. Each keeps code/tests/docs together; refine once actual cohesive size is known. One authorized local RCA-1 commit created; no new branch, PR or push. Baseline for new work is `6e05e38`, not the entire historical feature branch. Running committed authored count: 408 in RCA-1 (333 source/test + 75 tracker lines). Smallest current coherent RCA-1 slice is 408 including recovery documentation; keep it intact and resolve any strict PR-size exception before future PR creation, not by shrinking tests or formatting. Final RCA-1 source/test diff: 333 authored lines (332 additions + 1 deletion); tracker additional. Native assessment unavailable (empty native output), RDD off; treated as high for verification, independent verifier required. No native review started.

Evidence: writer observed RED (missing new domain error import), then 17 focused and 294 full backend tests passed. Independent verifier separately observed 17/294 PASS plus pure in-memory probes; parent read the two-file diff. Scope: only authorized source/tests and this tracker. Follow-ups resolved: durable absolute-expiry/refreshed-context/rejected-replacement tests and normalized OverflowError for extreme internal freshness bounds. Follow-up writer observed overflow RED (21 tests, two subtest errors), then focused21/full298 PASS. Independent post-correction verifier observed focused21 PASS and reviewed final diff; full298 remains writer-observed, previous full294 independently observed. Parent read final production change and reran git diff --check successfully. Failed-deepcopy preservation was independently probed, not added as a durable test. RCA-1 accepted offline; no live acceptance or full-feature completion. One verifier command-entry typo failed without mutation, then exact separate Git commands succeeded; no environment workaround. Incidental ignored bytecode caches from the canonical gate explicitly authorized. QR package selection, warning configuration, transcript layout and final integration surfaces remain bounded follow-ups, not permission to invent source paths.
