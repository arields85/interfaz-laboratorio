# Prisma Channel A remote — ODD tasks

## Status and next action

RESUMED from documentary checkpoint `c4116873284e19bf5d1d22fe6109042cc136e16f`, branch `feat/prisma-telegram-credentials`; parent observed clean Git before this update. RCA-1–4 are accepted OFFLINE and committed; RCA-5 remains in progress; RCA-5a standalone transport is accepted OFFLINE after independent re-verification and parent spotcheck. RCA-6–8 have not started. Full remote Channel A remains unwired.

Next: record the verified RCA-5a local work-unit commit (actual hash and authored count in checkpoint Engram after commit), then freeze RCA-5b cooperative exclusion scope. Collision mapping is complete but its proposal is NOT accepted verbatim; lifecycle exclusion and known-visible-view invalidation still need bounded integration work. Do not jump to RCA-6.

Recovery mirror: `odd/prisma-channel-a-remote/tasks` (full document plus repository path). Parent owns this tracker, mirror, acceptance and local commits. ODD, not SDD; one delegated source writer at a time. Route is delegated because implementation spans source/tests and preparation requires multiple files.

### Authority and recent decisions

- User previously authorized implementation with ODD, maintained local QR dependency/install and local work-unit commits after verification. No push, PR creation, paid/live Telegram/Gemini tests or runtime restarts authorized.
- User now authorized coordinated A/B validation: distinct bots run simultaneously; existing reservation wins; reject a second activation of the same observed bot identity. No bot sharing, automatic takeover or stopping the other channel in permanent product behavior.
- User separately permits stopping channels ONLY during development if necessary; states neither is currently used (not independently checked). This is not authorization to delete credentials, reset state, restart services or make provider calls. No stop has been executed; offline tests remain sufficient for the current unit.
- Source of product intent: `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` v2.0.12 §11.1 plus subsequent accepted decisions. PW-002/PW-003/PW-004 remain active; read their full Engram detail before unrelated work.

### Historical recovery

This consolidation prevents the full Engram mirror from exceeding its observed approximately 50k readback limit; it is not a diff-budget reduction. Full earlier contracts, RED/correction histories and detailed acceptance evidence remain losslessly available at `c411687:odd/tasks/prisma-channel-a-remote.md`. Earlier full RCA-2/3 contracts are also at `f3ac2cb`, RCA-4 contracts at `713f7ae`. Preserve those references and never replace the full current mirror with a short worker summary. Last accepted source commit is `713f7ae1bd9fece599b0281c4a1e7adb105c1b86`. No historical suite count is fresh evidence.

## Objective and invariants

A person viewing an inputless industrial HMI uses their phone to ask about that document's current visible snapshot. The HMI is strictly read-only toward the industrial process.

- Dedicated protected bot A and independent lifecycle. Preserve B admission, conversations, JsonFileStore, offsets and nine-field admin wire status except explicitly authorized collision rejection. Same protected credential store/admin session; no second login or B/environment token fallback for A.
- Automatic single-use opaque QR rotates every60s while free; never exposes HMI capability/admin/token secrets. Phone confirms destination; Telegram Start alone is not pairing. No HMI keyboard/click/touch required. Forwarded QR-photo risk remains a limitation, not proof of proximity.
- One phone per HMI document and one HMI per phone, multiple independent pairs; no implicit transfer/takeover. Hide QR while linked; phone unlink. Reload, restart or expiry requires re-linking; no durable device identity.
- Human inactivity600s. Technical polling never renews it. Warning default60s before expiry, configurable15–300s in existing admin and persisted runtime. Presence-loss cutoff30s; explicit close/revoke immediate. Freshness15s is a fail-closed server-receipt age limit, not delivery/visibility assurance.
- Viewer publishes every5s nominal,4.5s timeout, single-flight skipped ticks; hidden/offline/navigation gaps unbounded. Voice poll1s renews presence only. Known-invalid prior view must be invalidated immediately, never reused until TTL; no new heartbeat interval approved.
- Existing deterministic visible-snapshot parser; same answer text on phone/HMI plus existing HMI audio. No Telegram answer audio, STT, general NLU, history, offscreen/global fallback or requested navigation in this increment. No latent recipient path.
- Generation/correlation fences late answers/audio after unlink/relink, even same owner. Fresh adapter epoch on restart/reconfiguration/week-idle update-ID discontinuity; no B offset reuse or exactly-once claim. Uncertainty alone cannot erase live authority.
- Frontend domain types in `domain/`; tokens, Lucide, `hmi-scrollbar`, admin conventions. No edits under `Directrices/`.

## Tasks and boundaries

All source work uses bounded delegation. About400 authored lines is advisory only; never omit tests, minify, remove formatting or split artificially to fit. Keep tests/code together.

- [x] **RCA-1 — Fresh internal HMI context:** accepted offline, `e32bef1`.
- [x] **RCA-2 — Pairing domain:** accepted offline, `0fdfe0f`.
- [x] **RCA-3 — Dedicated bot adapter:** private dialogue `51ecd70`, captured queries `d2fc349`, warnings `42edf8b`, accepted offline.
- [x] **RCA-4 — Protected A credentials/admin contract:** registry/parser `465321b`, protected resolver `f3ac2cb`, credential card/exact proxy `713f7ae`, accepted offline. Configuration only, no A runtime readiness claim.
- [ ] **RCA-5 — HTTP/runtime integration:** in progress; transport, cooperative exclusion, lifecycle, capability-scoped endpoints, admin status/apply/policy, proxy, scheduling, owner/view invalidation and negative integration tests. Original400–750 estimate is obsolete; reforecast each coherent unit.
  - [x] **RCA-5a — Standalone transport:** accepted offline; independent56focused/681full PASS, parent56focused PASS. Two new files1278 authored lines; local commit boundary recorded in checkpoint after commit. Forecast450–750 exceeded without trimming tests.
  - [ ] **RCA-5b — Cooperative bot identity exclusion:** mapping complete, technical proposal requires corrected epoch semantics and exact scope before writer. B must reserve before webhook/persistence effects. No collision source implementation yet.
  - [ ] **RCA-5c onward — Remaining runtime units:** freeze coherent policy/lifecycle/HTTP/admin/proxy/scheduler/bootstrap units and known-view invalidation after maps; do not infer full integration from pure-domain tests.
- [ ] **RCA-6 — Automatic HMI QR/link presentation:** maintained local QR encoder, typed client/hook/UI, expiry/error/multi-HMI tests. Depends RCA-5. Forecast350–650 excluding generated lockfile.
- [ ] **RCA-7 — HMI text/audio correlation:** revalidate generation/freshness at publication, cancel stale work, matching phone text. Resolve automatic transcript placement/lifetime before UI. Depends RCA-5/6. Forecast250–500.
- [ ] **RCA-8 — Integrated verification/docs:** backend and frontend full gates, coverage/build/lint, independent risk-based verification; reconcile README/master and keep pending backlog active. Forecast100–200.

## RCA-5a frozen writer contract

Exact authorized NEW paths only:

- `services/prisma-runtime/src/prisma_runtime/channel_a_transport.py`
- `services/prisma-runtime/tests/test_channel_a_transport.py`

Both absent at read-only revalidation. `requests==2.34.2` already declared/locked; no dependency/install changes. No adapter, B, lifecycle, route, tracker or other file changes by the writer.

### API and transport

- `ChannelATransportError(RuntimeError)` with fixed `PRISMA_CHANNEL_A_TRANSPORT_UNAVAILABLE`, raised from None for validation/dependency/response failures, never raw provider exceptions.
- Frozen `ChannelABotIdentity(id: int, username: str)`.
- `ChannelATransport(token, *, request_timeout, session_factory=None)`: required positive finite nonbool timeout; explicit None selects lazy default factory. Validate token before I/O: untrimmed nonempty ASCII `[A-Za-z0-9_:-]`, bounded by existing `MAX_SECRET_BYTES`; token prefix is not identity. No construction/import I/O or default product timing.
- Fresh OWNED session for each method call, including sends concurrent with polling. Default `requests.Session()` has `trust_env=False`, default TLS verification; fixed `https://api.telegram.org`. No shared session/global lock, custom host, environment fallback, retries, redirects, webhook mutation, offset state, polling loop or lifecycle wiring. Factory is a trusted callable returning a new owned session each time.
- All calls use one `session.post` with `json=` payload and `allow_redirects=False`. send/ack/getMe use scalar request_timeout; getUpdates MUST use `(request_timeout, read_timeout)` connect/read tuple with its validated read_timeout (not a discarded declaration). JSON preserves markup/list structure; omit optional None values. No parse_mode. Default requests adapter has no retries; do not add any.
- `send_message(*, chat_id: int, text: str, reply_markup: object=None)` and `answer_callback_query(*, callback_query_id: str, text: str=None)` match existing keyword-only raw-body Protocol. Chat positive nonbool <=existing MAX_TELEGRAM_ID; send text1–4096 characters, not `/start`128 bound or question UTF8-byte bound. Callback ID1–MAX_CALLBACK_ID_CHARS; optional acknowledgement text0–MAX_ACK_TEXT_CHARS, no truncation/strip.
- For send/ack, 2xx Mapping bodies pass through unchanged for adapter classification (including explicit ok:false); 4xx only with explicit `ok is False` passes through. Contradictory 4xx success, 3xx/5xx, malformed status/body/JSON and dependency exceptions normalize to fixed error. Do not adopt mapper's narrowing to only 2xx ok:true or B's raise_for_status-before-parse pattern. Adapter retains responsibility for delivered/rejected/unknown receipts.
- `get_me()` requires successful2xx with `ok is True`; validates result Mapping, positive nonbool id<=existing MAX_TELEGRAM_ID, `is_bot is True`, ASCII username `[A-Za-z0-9_]{5,32}` with no suffix assertion. Prior public BotFather docs support the bounds; no live query authorized.
- `get_updates(*, poll_timeout: int, read_timeout: float, offset: int|None=None)` validates nonnegative nonbool integer poll timeout, finite positive nonbool read timeout strictly greater, offset absent or nonbool integer0..MAX_TELEGRAM_ID+1. JSON fields: timeout, limit100, allowed_updates exactly `["message","callback_query"]`, optional offset. Successful2xx `ok is True`, result list with each item Mapping; return ordered tuple unchanged, reject non-Mapping items, no update-id filtering/sorting or offset advancement.
- Independently attempt response/session close exactly once if obtained; cleanup exceptions never mask result/primary failure. Session creation/post/JSON/accessor exceptions sanitize. No token/URL/body logging or repr exposure; object repr must not include token.

### Acceptance tests

Strict observed RED before source implementation. Fake sessions/responses only; monkeypatch default requests construction to prove trust_env and prevent actual requests. Cover pre-I/O invalid inputs including bool/nonfinite/huge integers, laziness/explicit-None/falsy callable, exact JSON/timeouts/None omission, raw2xx and explicit4xx classification, malformed status/results, identity limits, updates ordering and no offset ownership, sanitizer canaries, resource closure and cleanup failures, no redirects/retries/webhooks/env host, and deterministic event-driven concurrent poll/send without shared lock. No sleeps as race proof. No raw secret/store/provider tests. Forecast is advisory, not permission to trim coverage.

## RCA-5a execution history — earlier candidates not accepted

Writer `mu9qpouh-3-713v` reports genuine missing-module RED, focused48 GREEN and fullbackend673 PASS on final bytes (full gate twice). Exactly342source+750tests=1092 authored lines, over advisory forecast; preserve coverage/readability. SHA256 source `f0c08f49833f454efe6c87867d00cbe8d954dc2c05ba9a590f00eea16be1b10c`, test `f1a2e876c244ff41c6df7e5784861adf045521d8463788233e08cecd8b67760c`. Parent read full source, confirmed exact Git scope and whitespace; new files remain untracked. Native assess returned empty/unassessable, RDDoff: independent verification required, active `mu9r34qs-5-svoa`. Writer-reported gates are not yet independent evidence.

Parent identified discarded get_updates read_timeout (wire always request_timeout); correction contract should use `(request_timeout, read_timeout)` connect/read tuple for polling and scalar request_timeout elsewhere. Also referred same-class dependency error rethrow, Mapping accessor normalization and default-factory ownership failure to verifier. These are source-read concerns, no fresh probes or correction yet. No operational A/collision claim.

Known-view mapper `mu9qq5gm-4-nrxb` completed read-only: exporter abort does not invalidate server context; no publication sequence prevents a late old-view POST resetting freshness; session removal currently only cleans voice. Proposal needs correction before scope freeze: rejecting g<=last cannot also allow invalidate/publish with the same g; in-flight parsed results need captured view-revision revalidation, not merely future reads failing. No instant remote knowledge under lost delivery; local suppression plus delivered invalidation/order and bounded freshness. Detailed map/caveats: `architecture/prisma-channel-a-visible-context-invalidation`. No new heartbeat/product timing decision.

### Independent FAIL and bounded correction

Verifier `mu9r34qs-5-svoa` independently ran focused48/fullbackend673 PASS; unchanged hashes/1092lines, no unexpected provider activity in observed output. Four source-read findings (not extra executed probes): HIGH ignored polling read_timeout and tests encoding scalar; HIGH same-class dependency error bypasses sanitizer; HIGH outer/nested Mapping access outside normalization; MEDIUM obtained default session not closed if trust_env setup raises. Parent confirmed tracker86+/106- as its own changes; candidate remained untouched. Green suites do not waive findings.

Correction scope remains EXACT same two transport/test files, one delegated writer. First add/fix durable tests and observe RED on this candidate: distinct polling connect/read values while nonpoll calls remain scalar; post/status accessor throwing ChannelATransportError(CANARY); outer and nested Mapping.get throwing generic/same-class canaries across effect/discovery/identity/update extraction; trust_env setter raising with exactly-one close, including close raising without masking primary error. Then correct transport, preserve raw-body identity/classification, all existing coverage and independent one-shot cleanup. Normalize dependency errors regardless of class, never rethrow canary unchanged. Keep simple exception boundaries, no broad refactor/adapter/B/runtime edits. Rerun exact focused/full isolated supervisors and whitespace/hash checks. Forecast50–180 incremental authored lines, advisory; no coverage trimming. Fresh native assess and independent recheck required. No stop/restart/live calls or acceptance yet.

### Correction candidate — independent recheck pending

Writer `mu9r9m6y-6-lab0` reports correction RED55tests/17failures+6errors covering all four findings, then focused55/fullbackend680 PASS. Final source359lines SHA256 `103ebc44adfb9b057c6ab2aa3854025b546d886c4aa0e7982b11dbecb44c66ef`; test900lines SHA256 `70d976e2e520e12dd42c5525315919fc5494c5791662486ba37f57996e6841a5`; total1259 authored NEW-file lines. Increase167 is NET growth, not incremental authored additions+deletions; writer's claim of being within50–180 authored forecast is unproven. Keep coverage/readability. Parent confirmed both hashes, whitespace and exact scope, and read corrected boundaries. Fresh native assess with writer-reported deepseek-v4-flash/high remains empty/unassessable/RDDoff; independent re-verification required. No source acceptance/commit/live verification yet.

### Residual test-only correction

Reverifier `mu9rhhlb-7-o403` independently observed55focused/680full PASS with stable hashes1259lines; all four SOURCE findings closed. Verdict still FAIL because ThrowingGetMapping with raise_for=None fails first on ok, never later result extraction. Parent focused spotcheck55 also passed. Authorize writer ONLY `services/prisma-runtime/tests/test_channel_a_transport.py`: add targeted raise_for="result" with ok=True for BOTH get_me/get_updates, generic and same-class canaries, external sanitized-error and exactly-once cleanup assertions. Production source hash must remain unchanged. These tests may pass already-correct source; report coverage-only GREEN honestly, do not fabricate RED or mutate source to recreate it. Run exact focused/full isolated gates. Forecast15–50 authored lines advisory. Independent final recheck remains required. Parent tracker91+/101- attributable; no acceptance/commit/live calls.

Writer `mu9rmapo-8-at80` added19test lines only, truthful coverage-only GREEN56focused/681full reported. Source359lines/hash unchanged; test919lines SHA256 `b7586bb96601e8f0d11fcf434b378581fc4303724fb71a58bd0ed59e48450123`; total1278 NEW-file authored lines. Test traverses keys_seen=[ok,result], both methods and exception classes, external counters/error assertions. Parent read test and checked both hashes/scope; final native assess again empty/unassessable/RDDoff. Independent recheck pending; prior failing result is not acceptance.

### Final RCA-5a acceptance OFFLINE

Final verifier `mu9rptbf-9-acg8` PASS: focused56/fullbackend681 freshly observed, residual result-extraction coverage closed, all four source findings remain closed. Full readback confirms only19test additions since preceding candidate and production unchanged. Stable source SHA256 `103ebc44adfb9b057c6ab2aa3854025b546d886c4aa0e7982b11dbecb44c66ef`359lines; test `b7586bb96601e8f0d11fcf434b378581fc4303724fb71a58bd0ed59e48450123`919lines. Exactly1278 NEW-file authored lines, plus parent tracker. Parent independently reran exact isolated focused supervisor56PASS on final candidate, read corrected source and targeted regression, matched hashes/scope/whitespace. No verification blocker remains. Native assessments unavailable/RDDoff led to independent verification, not invented native approval. Local commit is authorized; record its actual identity/count in checkpoint after success rather than postcommit self-edit. No live/provider/runtime/whole-feature acceptance. Transport remains unwired; no A/B collision guard implemented yet.

## RCA-5b map and unresolved technical work

Read-only mapper `mu9qcj8g-1-f4y3` confirms `TelegramLocalBot.prepare()` currently calls deleteWebhook BEFORE getMe and then loads/persists B state. Split identity observation from effects; shared process-local reservation keyed by observed getMe id must happen before webhook/state effects. B operation_lock does not serialize A; nine-field wire status contains no authoritative bot identity. No token-prefix, private-state or historical-ID comparison can substitute for cooperative ownership.

Candidate surfaces (NOT yet a frozen writer scope): new `bot_identity_reservation.py`/test; B `telegram_lifecycle.py`, `local_presentation.py`, order-sensitive lifecycle/diagnostics tests, coherent admin conflict projection if required. A lifecycle will consume the same instance later. No claim of operational exclusion until BOTH production paths are wired.

Parent review rejects same-owner string as permission to overwrite a live epoch: exact manager/activation ownership is required; different epochs must not steal reservations even with identical channel labels. Confirmed stop releases only its matching reservation; uncertain stop/cleanup retains it. Registry lock is leaf-only with no I/O/callbacks. B already stops its own candidate before replacement; do not conflate own reapply with cross-channel incumbent. A collision must not mutate the other channel's bot or credential/state. Scope permission never authorizes deleting real credentials as a development convenience.

Opaque epochs independent of credential generations are technical design, not a new user choice. Bounds, distinct safe conflict error/public projection and deterministic cold-start ordering need a coherent integration decision. Known-view invalidation still unresolved; transport can proceed independently. Mappers: transport `mu9qcy1e-2-hdok` confirms two-file scope/source compatibility; its assumptions are pinned above. No mapper executed tests or operational calls.

## Accepted integration contracts to preserve

- **RCA-1:** server context receipt time and caller-supplied positive finite age bound; owner-scoped internal lookup returns no capability, never renews activity, isolates deep copies, rejects stale/missing/expired/closed owners. Existing caller routes unchanged.
- **RCA-2:** bounded locked in-memory pairing with injected monotonic clock/entropy and immutable snapshots. Single60s challenge, confirmation deadline no later than challenge, exclusive pending/live owner-phone associations, opaque action/generation tickets. Confirm starts600s human idle; only admitted human activity renews. Sample clock under lock, regression watermark, finite arithmetic, equality expiry. No unbounded tombstones/storage.
- **RCA-3a:** validated private actor/chat/bot identity, strict start/callback grammar,64byte callback payload, separate confirm/cancel, process-local nonce. Exact displayed fresh destination label revalidated at confirmation; reserve bounded adapter capacity before claim, never evict live authority for unauthenticated replacements. Update high-water/confirmation fences and adapter epoch; no durable B offsets. Serialize ingress/effects without domain lock across I/O; generation recheck before effects, acknowledging network non-atomicity. Sanitize receipts and classify delivered/rejected/unknown; never retry uncertainty. Uncertain registry/clock failure preserves tickets/buttons; authoritative expiry/release removes them.
- **RCA-3b:** startup-only one-shot enable_queries; capture immutable owner/phone/generation/update/adapter epoch. Inject existing parser and owner context, no fallback/duplicate parser. Question4096UTF8bytes distinct from `/start`128chars. Captured receipt-age/monotonic deadline cannot be extended by new snapshots. Effectful validators precede authoritative registry check; resample freshness immediately before send. Human touch only on admission. Invalid/throwing parser/property access normalizes, no truncation. Envelope only after observed phone delivery plus post-send validity; future HMI publisher must revalidate again.
- **RCA-3c:** atomic warning reservation once per human activity window; explicit adapter sweep revalidates each recipient's owner/generation/activity/deadline and nonce, including changes by prior sends. Reuse Spanish Seguir conectado/Desvincular. Rejected/unknown/skipped warning does not retry/rearm until human activity; no answer envelope. Scheduler not yet wired.
- **RCA-4:** three protected provider keys with exact frontend metadata parser; no schema migration. Existing older binaries reject stored A rows, so rollback must account for that. A resolver reads only protected telegram_channel_a every call; lazy explicit-None factory, no cache/fallback, fixed MISSING vs UNAVAILABLE including missing-master rejection before I/O. Existing admin session and metadata-only store; A save never starts/verifies runtime. Provider-keyed secret drafts, revision/session/panel/dialog fences, functional clearing on completion/logout/deactivation. Exact A PUT/DELETE proxy preserves cookies/query/CSRF, strips HMI capability; no A runtime/pairing routes yet.

## TDD and verification

TDD ON by `AGENTS.md` §8–9 and `docs/TESTING.md`: observed RED before source, then GREEN/refactor. No fabricated RED or treating previously green coverage as RED. Writer reports commands, results/counts, exact paths, authored lines and limitations. Parent calls native `gentle_review assess` after writer; unavailable/failed/unassessable is high and needs independent verification. No native verdict invented. Historical RDD was off; follow actual current assessment, not cached setting. Parent spotchecks a reported command before delivery.

Focused RCA-5a from repository root Bash/Git Bash (repeat RED/GREEN):

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
        '-p', 'test_channel_a_transport.py',
    ], env=env, check=False)
raise SystemExit(result.returncode)
PY
```

Full backend: exact child-only owned-Python supervisor under **Offline-safe verification** in `services/prisma-runtime/README.md`, fresh temporary state, eleven override names removed, invokes `operations/verify-local.ps1`. Parent read the exact block this session. Inspect fixtures before running; no bare unittest/pytest/gate/production launcher. This is environment isolation, NOT a network sandbox. Stop unexpected live access. Incidental ignored test caches authorized. No environment values/secrets/real persisted state inspection. No runtime harness needed for this standalone mocked transport; operational acceptance remains pending.

Frontend when its units change: `npm --prefix hmi-app test -- <focused paths>`, `npm --prefix hmi-app run test:coverage`, `npm --prefix hmi-app run build`, `npm --prefix hmi-app run lint`. All coverage thresholds70 enforced. `git diff --check` plus readback/whitespace checks on NEW untracked files. No frontend rerun required for transport-only unit.

## Historical acceptance evidence (not rerun this session)

Full failed rounds, corrections and exact commands retained in Git `c411687:odd/tasks/prisma-channel-a-remote.md`; table records final disposition without erasing limitations.

| Unit | Accepted evidence and boundary |
|---|---|
| RCA-1 e32bef1 | Final focused21 independently passed; full298 writer-observed (prior294 independent). Overflow/expiry/deep-copy owner safety corrected;333 source/test lines. |
| RCA-2 0fdfe0f | Independent43focused/341full and deterministic race/rollback/overflow probes PASS after correction;1508 source/test lines. |
| RCA-3a 51ecd70 | Independent136focused/477full and residual probes PASS after three correction rounds;3059 source/test lines. Display-label, capacity, ID bounds, uncertain controls, expiry and nonce/ack ordering closed. |
| RCA-3b d2fc349 | Independent74query/159bot/574full and14 probe groups PASS after corrections;2218 source/test lines. Validator ordering/freshness, one-shot attachment and property exception findings closed. |
| RCA-3c 42edf8b | Independent54pairing/180bot/606full and12 probe groups PASS;619 source/test lines. Single-attempt warning reservation, no scheduler. |
| RCA-4a 465321b | Independent store10/HTTP9/backend611/frontend68focused/full1950in202files plus coverage/build/lint PASS after durable guard correction. Mutation probes caught both B calls;320 source/test lines. Coverage L87.97/B80.17/S87.09/F86.22%. |
| RCA-4b f3ac2cb | Independent14focused/625full PASS;318 source/test lines. Missing-master real empty-path rejection tested with external I/O guards; failed initial task had no reliable completion evidence until recovered. |
| RCA-4c 713f7ae | Independent102focused/6files twice, frontend1966/202files, coverage/build/lint PASS;518 source/test lines across8paths. L88.05%(12836/14578),B80.23%(10024/12493),F86.32%(3213/3722),S87.16%(13588/15588). Root proxy executed by Vitest/ESLint, outside tsc scope. |

Prior native assessments sometimes failed/schema-incompatible; independent verification used, no native approval invented. Prior frontend advisories: canvas getContext, unresolved grid.svg and >500kB bundle. None of these counts proves live Telegram/Gemini, runtime forwarding, production or full remote-A acceptance.

## Delivery

Strategy `ask-on-risk`, user-selected chain `feature-branch-chain`; local work-unit commits authorized, no branch/push/PR authorization. Original2270–4300 forecast exceeded. Baseline `6e05e38`; eight code units total9206 authored lines including tracker; documentary closure c411687 adds62 =>9268 before this session. Breakdown408/1534/3091/2244/641/354/340/594. Update actual running count from commits, not guesses. Coherent oversized units retain tests/readability; future PR size exception/slicing remains unresolved and no PR opened. Proposed slices: freshness, pairing, bot, protected credentials, wiring, QR, transcript, final integration. This tracker consolidation creates additional documentary diff and is not counted as size savings.
