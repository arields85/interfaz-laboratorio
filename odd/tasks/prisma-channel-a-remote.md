# Prisma Channel A remote — ODD tasks

## Status and next action

RCA-1 complete and independently verified offline; not committed. RCA-2 in progress (planning only; no source edits yet). Baseline: `6e05e38`, branch `feat/prisma-telegram-credentials`. Next: create the authorized local RCA-1 work-unit commit, then implement the pairing domain with TDD. Full Channel A remains incomplete.

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

- [x] **RCA-1 — Fresh internal HMI context (offline verified; commit pending).** Add server receipt time and internal owner-scoped freshness access without changing capability callers. Exact source scope: `services/prisma-runtime/src/prisma_runtime/hmi_sessions.py`; tests: `services/prisma-runtime/tests/test_hmi_sessions.py`. Prove missing/stale/closed/expired rejection, independent owners, deep-copy isolation, no bearer leakage and no activity renewal. Explicit positive finite freshness bound supplied by caller; no arbitrary product default. Preserve existing routes/behavior. Forecast 120–250 lines.
- [ ] **RCA-2 — Pairing domain (planning in progress).** New `channel_a_pairing.py` and `test_channel_a_pairing.py`: bounded token lifecycle, atomic claim/phone confirmation, exclusivity, generation, unlink, human timeout/warning/keepalive. Fake clocks, entropy, races and late-result tests. No HTTP/providers. Depends RCA-1. Forecast 350–650.
- [ ] **RCA-3 — Dedicated bot adapter.** New bot A module/tests: private chat identity, callbacks, confirmation, unlink/keepalive, text-only answers, dedupe and correlated cancellation. All transport mocked; no B behavior changes. Depends RCA-2. Forecast 300–550.
- [ ] **RCA-4 — Protected A credentials/admin contract.** Independent resolver/lifecycle and provider key (planned `telegram_channel_a`), backend status/apply plus exact frontend domain parser/admin UI in existing session. Preserve B status contract. Resolve exact paths before writer launch. Forecast 400–750.
- [ ] **RCA-5 — HTTP/runtime integration.** Capability-scoped pairing endpoints/proxy, internal freshness and generation gates, lifecycle startup/shutdown, bot username discovery via mocked getMe; unconfigured/stopped bot yields unavailable state, not a fake QR. Configure bounded warning/presence policy. Integration/negative isolation tests. Depends RCA-1–4. Forecast 400–750.
- [ ] **RCA-6 — HMI QR/link presentation.** Select maintained local QR encoder (no external QR service), pinned lockfile; session client, typed pairing state, hook and automatic UI. Token expiry/reset/error and multi-HMI tests. Depends RCA-5. Forecast 350–650 excluding generated lockfile.
- [ ] **RCA-7 — HMI text/audio correlation.** Visible text plus existing audio, generation invalidation cancels stale work; phone receives matching text. Resolve automatic transcript placement/lifetime before UI implementation; no required local interaction. Component/service tests. Depends RCA-5–6. Forecast 250–500.
- [ ] **RCA-8 — Integrated verification and docs.** Backend/HMI full suites, coverage/build/lint, independent risk-based check; README/master reconciliation. Keep offline vs live evidence distinct and pending backlog active. Forecast 100–200.

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

RCA-1 full backend command: execute the exact child-only supervisor code block under **Offline-safe verification** in `services/prisma-runtime/README.md` (owned Python -> `operations/verify-local.ps1`, fresh temporary state, eleven sensitive/config overrides removed). Inspect fixtures before running; never invoke the production launcher or bare unisolated gate. This is environment isolation, not a network sandbox. Stop unexpected live access. Later A-specific env overrides must also be removed when introduced.

Every writer reports exact command/result, RED failure reason, GREEN counts, changed paths and limitations. `git diff --check` required. Parent calls native `assess` after each writer; failed/unavailable assessment treated as high with independent verifier. Parent spotchecks one reported command before delivery. No review/consent authority inferred from checkboxes.

## Delivery and evidence

Strategy: `ask-on-risk`, chain strategy **feature-branch-chain**, selected by user. Forecast 2,270–4,300 authored lines, generated lockfile excluded; estimates provisional. Proposed slices: freshness; pairing; bot; protected credentials; wiring; QR; transcript; final integration. Each keeps code/tests/docs together; refine once actual cohesive size is known. No branches, commits, PRs or push created by this plan. Baseline for new work is `6e05e38`, not the entire historical feature branch. Running committed authored count: 0. Final RCA-1 source/test diff: 333 authored lines (332 additions + 1 deletion); tracker additional. Native assessment unavailable (empty native output), RDD off; treated as high for verification, independent verifier required. No native review started.

Evidence: writer observed RED (missing new domain error import), then 17 focused and 294 full backend tests passed. Independent verifier separately observed 17/294 PASS plus pure in-memory probes; parent read the two-file diff. Scope: only authorized source/tests and this tracker. Follow-ups resolved: durable absolute-expiry/refreshed-context/rejected-replacement tests and normalized OverflowError for extreme internal freshness bounds. Follow-up writer observed overflow RED (21 tests, two subtest errors), then focused21/full298 PASS. Independent post-correction verifier observed focused21 PASS and reviewed final diff; full298 remains writer-observed, previous full294 independently observed. Parent read final production change and reran git diff --check successfully. Failed-deepcopy preservation was independently probed, not added as a durable test. RCA-1 accepted offline; no live acceptance or full-feature completion. One verifier command-entry typo failed without mutation, then exact separate Git commands succeeded; no environment workaround. Incidental ignored bytecode caches from the canonical gate explicitly authorized. QR package selection, warning configuration, transcript layout and final integration surfaces remain bounded follow-ups, not permission to invent source paths.
