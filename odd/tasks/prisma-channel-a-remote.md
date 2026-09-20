# Prisma Channel A remote — ODD tasks

## Status and next action

RESUMED from documentary checkpoint `c4116873284e19bf5d1d22fe6109042cc136e16f`, branch `feat/prisma-telegram-credentials`; parent observed clean Git before this update. RCA-1–4 are accepted OFFLINE and committed; RCA-5 remains in progress; RCA-5a standalone transport and RCA-5b cooperative exclusion are accepted OFFLINE after independent verification and parent spotchecks. RCA-6–8 have not started. Full remote Channel A remains unwired.

RCA-5a committed locally as `6301e9797081d2fbed84e37271f4ac1f9114eb7e`; parent observed clean Git. RCA-5b is accepted OFFLINE; next is its authorized local work-unit commit, then mapping/freezing the remaining RCA-5 units. Record the actual commit in the checkpoint after success. Known-visible-view invalidation and remaining A lifecycle/HTTP integration are still pending. Do not jump to RCA-6.

Latest session boundary (supersedes earlier stops): finish and verify RCA-5b, then CONTINUE the remaining RCA-5 units without pausing or closing the session. PAUSE and notify BEFORE starting RCA-6. Prior local work-unit commit authorization remains; no push/PR or new live/runtime permissions. If blocked, report honest partial status, never claim completion. Freeze each remaining RCA-5 writer scope separately; acceptance alone does not authorize additional source edits.

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
  - [x] **RCA-5b — Cooperative bot identity exclusion:** accepted offline; independent172focused/730backend,81frontendfocused/1973full,coverage/build/lint PASS; parent38lifecycle PASS. Candidate2393authoredlines; local commit next, actual identity in checkpoint.
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

## RCA-5a accepted evidence and recovery

Full transport execution history/corrections remain at `6301e97:odd/tasks/prisma-channel-a-remote.md`; this consolidation keeps the current full mirror below its readback limit. Initial independent48/673 PASS did not waive four defects (polling timeout, same-class error leak, Mapping access, setup cleanup). Correction observed RED55/17failures+6errors then55/680 PASS; independent source closure still required targeted result-extraction coverage. Test-only19additions honestly passed corrected source without inventedRED. Final independent `mu9rptbf-9-acg8`56focused/681full PASS, parent56spotcheck/readback/hash/scope/whitespace PASS. Source359lines SHA256 `103ebc44adfb9b057c6ab2aa3854025b546d886c4aa0e7982b11dbecb44c66ef`; test919lines `b7586bb96601e8f0d11fcf434b378581fc4303724fb71a58bd0ed59e48450123`. Accepted offline/committed6301e97,1278source/test authoredlines; commit1470 includingtracker, cumulative10738 since6e05e38. No nativeapproval/live/runtime/fullfeature claim. FuturePR slicing remains unresolved.

Known-view mapper `mu9qq5gm-4-nrxb`: exporter abort does not invalidate server context; no sequence rejects late old-view POST resetting freshness; session removal only cleansvoice. Do not implement mapper verbatim: g<=last rejection conflicts with same-generation invalidation/publish; in-flight answers require captured-view revision revalidation before phone/HMIoutput. Remote navigation cannot be instantly known under lostdelivery; local suppression plus delivered invalidation/order and freshness bound. Detail `architecture/prisma-channel-a-visible-context-invalidation`, no newheartbeat/timing decision.

## RCA-5b map and unresolved technical work

Read-only mapper `mu9qcj8g-1-f4y3` confirms `TelegramLocalBot.prepare()` currently calls deleteWebhook BEFORE getMe and then loads/persists B state. Split identity observation from effects; shared process-local reservation keyed by observed getMe id must happen before webhook/state effects. B operation_lock does not serialize A; nine-field wire status contains no authoritative bot identity. No token-prefix, private-state or historical-ID comparison can substitute for cooperative ownership.

Candidate surfaces (NOT yet a frozen writer scope): new `bot_identity_reservation.py`/test; B `telegram_lifecycle.py`, `local_presentation.py`, order-sensitive lifecycle/diagnostics tests, coherent admin conflict projection if required. A lifecycle will consume the same instance later. No claim of operational exclusion until BOTH production paths are wired.

Parent review rejects same-owner string as permission to overwrite a live epoch: exact manager/activation ownership is required; different epochs must not steal reservations even with identical channel labels. Confirmed stop releases only its matching reservation; uncertain stop/cleanup retains it. Registry lock is leaf-only with no I/O/callbacks. B already stops its own candidate before replacement; do not conflate own reapply with cross-channel incumbent. A collision must not mutate the other channel's bot or credential/state. Scope permission never authorizes deleting real credentials as a development convenience.

Opaque epochs independent of credential generations are technical design, not a new user choice. Bounds, distinct safe conflict error/public projection and deterministic cold-start ordering need a coherent integration decision. Known-view invalidation still unresolved; transport can proceed independently. Mappers: transport `mu9qcy1e-2-hdok` confirms two-file scope/source compatibility; its assumptions are pinned above. No mapper executed tests or operational calls.

## RCA-5b frozen coherent writer contract

Baseline `6301e97`, clean Git before parent contract update. Route delegated:19 exact source/test paths, coordinated backend/frontend strict error contract, one writer. Forecast700–1300 authored lines advisory; preserve tests/readability. No A lifecycle/transport edits or operational exclusion claim until A later consumes the same registry. Mapper `mu9rwv1c-a-ilnb` scope is accepted with lifecycle hardening below, not its word 'pinned' as independent authority.

### Exact allowed edit paths

```text
services/prisma-runtime/src/prisma_runtime/bot_identity_reservation.py
services/prisma-runtime/src/prisma_runtime/local_presentation.py
services/prisma-runtime/src/prisma_runtime/telegram_lifecycle.py
services/prisma-runtime/src/prisma_runtime/admin_http.py
services/prisma-runtime/tests/test_bot_identity_reservation.py
services/prisma-runtime/tests/test_telegram_lifecycle.py
services/prisma-runtime/tests/test_telegram_diagnostics.py
services/prisma-runtime/tests/test_telegram_credentials.py
services/prisma-runtime/tests/test_telegram_http.py
services/prisma-runtime/tests/test_local_presentation.py
services/prisma-runtime/tests/test_runtime_safety.py
hmi-app/src/domain/adminCredential.types.ts
hmi-app/src/services/adminAuth.service.ts
hmi-app/src/components/admin/VoiceCredentialSettings.tsx
hmi-app/src/domain/adminCredential.types.test.ts
hmi-app/src/services/adminAuth.service.test.ts
hmi-app/src/components/admin/VoiceCredentialSettings.test.tsx
hmi-app/src/hooks/usePrismaCredentialAdministration.test.tsx
hmi-app/src/components/admin/GlobalSettingsDialog.voice.integration.test.tsx
```

Only reservation source/test are new. Parent owns tracker/mirror. Existing test files may need only recheck rather than edits; do not add gratuitous changes to fill scope. No production hook/proxy/dependency/transport changes. Admin UI change is error copy only, no new shell/control/login.

### Ownership and lifecycle invariants

- Fixed public `TELEGRAM_BOT_IDENTITY_RESERVED`, HTTP409 on protected apply; exact nine-field status unchanged. Add to backend projection, frontend runtime union/allowlist, service public-code allowlist and existing errorText mapping. Spanish copy: 'Este bot ya está en uso por el otro canal. Configurá un bot distinto.' Conflict must not become AUTH_REQUEST_FAILED/provider502 or a committed mutation. Keep current credentials/drafts and desired/applied semantics except normal existing own-reapply stop.
- New process-local thread-safe `BotIdentityReservation`, opaque lease and fixed sanitized reservation error. Key observed positive nonbool bot id<=existing MAX_TELEGRAM_ID, never token/persisted/historical IDs. Failed acquisition adds nothing. Same exact owner+epoch may re-enter; a different epoch, even same label, cannot overwrite live authority. Release requires matching lease identity/epoch and owner; stale release is no-op. Use identity comparisons for opaque epochs, not arbitrary equality callbacks. No token/storage/network. Leaf registry lock covers bounded state only, never callbacks/I/O/stop/join. Process accessor initializes a single shared registry thread-safely; tests inject fresh instances.
- Bot owns its lease so manager, standalone run and build_telegram_bot activation cannot bypass it. Constructor optional reservation=None selects process registry (explicit None only), NEVER disables guard. Existing positional api_base compatibility preserved. create_app/build_telegram_bot explicitly share process accessor; future A uses same instance. Do not introduce different implicit registries per manager. Avoid import cycle when reusing ID bound; do not edit A modules to solve unrelated architecture.
- observe_identity performs getMe only and validates id before any effect; no state write/reservation. Identity observation is NOT readiness. prepare: observe -> acquire -> deleteWebhook -> load/persist own B state -> prepared. Repeated prepare must not mint another epoch while retaining a lease or silently re-observe a new identity under an old lease. Stable per-bot activation epoch, new lifecycle object for reapply. Normal repeated prepare after readiness is idempotent; closed/stopping instance cannot re-activate. Preserve diagnostics and migration/admission/state semantics.
- Harden prepare/start/run/stop ordering: stop while identity/preparation/start is in progress must NOT release lease and let that same object later perform effects/poll. Physical thread termination alone is insufficient if preparation/start is still in flight. Serialize/fence bot lifecycle transitions safely; do not hold a lock while joining a thread that needs it. No network/foreign callbacks under shared registry lock. Deterministic event-driven races, not sleeps, must prove no early release/reactivation and no deadlock. run uses prepared state, not bot_id alone; direct observed-but-unprepared run cannot poll without successful guarded preparation. Do not retire supported unmanaged construction/run paths.
- Confirmed quiescent stop closes/releases only its own exact lease. Uncertain stop/cleanup retains authority and manager candidate for retry; no cross-channel stop or credential/state deletion. If no lease acquired, cleanup cannot release incumbent. Failed standalone preparation/run must have a safe owned cleanup path; do not leave a known-quiescent unreachable lease forever, and never free uncertain in-flight work. Existing manager generic errors normalize; reservation error maps fixed409 with the same cleanup/retention discipline, not a special-case leak. Factory/setup failures produce safe status and never retain an unowned lease. Existing startup B ordering remains; future A follows B on cold start, no takeover.

### RED and regression matrix

Observe meaningful RED for each changed behavior before its source edits, not only a blanket missing-module error hiding B/frontend regressions. Registry: exact-epoch reentry, same-label different-epoch rejection, foreign/stale release, failed acquire no mutation, atomic two-thread winner. Bot/manager: getMe before reservation before webhook/state effects, malformed identity no effects, conflict leaves incumbent untouched, observed!=prepared, own reapply rotation same/new identity releases only after confirmed stop, stopped objects cannot restart, concurrent prepare/stop and start/stop fences, failed prepare/start/cleanup paths, uncertain stop retains vs confirmed stop releases, disabled/missing no provider/lease, process accessor shared and fresh-test injection. Preserve B state/offset/migration/admission and diagnostic tests; do not weaken fixtures or bypass real guarded bot with dummy-only tests. HTTP: protected409 fixedcode and exactly nine fields, auth/CSRF unchanged, no credential delete or committed flag. Frontend: strict status/passive-health/error parser accepts only new fixedcode, service preserves409 error/status (not committed), Spanish UI message, hook/integration keep failure distinct from successful apply. A credential writes remain unable to invoke B manager (existing test_credential_http recheck).

### Exact verification commands

Backend focused: use the EXISTING focused owned-Python supervisor above verbatim, changing ONLY discovery pattern for each of `test_bot_identity_reservation.py`, `test_telegram_lifecycle.py`, `test_telegram_diagnostics.py`, `test_telegram_credentials.py`, `test_telegram_http.py`, `test_local_presentation.py`, `test_runtime_safety.py`, `test_credential_http.py`. RED/GREEN may target relevant patterns at each implementation stage; final all eight pass. Full backend exact README Offline-safe supervisor unchanged. Inspect mocks/fixtures first; no unisolated Python/gate/probes/launcher.

Frontend focused from root:

```bash
npm --prefix hmi-app test -- src/domain/adminCredential.types.test.ts src/services/adminAuth.service.test.ts src/components/admin/VoiceCredentialSettings.test.tsx src/hooks/usePrismaCredentialAdministration.test.tsx src/components/admin/GlobalSettingsDialog.voice.integration.test.tsx
npm --prefix hmi-app run test:coverage
npm --prefix hmi-app run build
npm --prefix hmi-app run lint
```

Run focused RED/GREEN then final coverage/build/lint. All70 thresholds enforced. Read-only Git scope/whitespace/numstat/diff/hash checks authorized, including exact two new reservation files not shown by tracked diff. No runtime harness because tests use synthetic bot sessions/stores and mocked frontend API; real Telegram/runtime acceptance remains pending. No service stop/start/restart, network/provider/env-values/secrets/persisted state inspection, installs, Git mutation or commits by writer. Parent assessment and independent verification after writer; unavailable native assessment is high-risk fallback.

## RCA-5b candidate and test-execution incident — NOT accepted

Writer `mu9s65sg-b-09io` reports registryRED missingmodule, B/diagnosticsRED mostly new-constructor errors plus behavioral failures, HTTP502vs409 RED, frontend5fail/75pass RED; final focusedbackend151 across8patterns/full709 PASS, frontend80focused/5files, coverage/build/lint PASS. Full frontend test count not stated, do not infer it. Reported coverage S87.17%(13589/15588),B80.26%(10028/12493),F86.32%(3213/3722),L88.05%(12837/14578), all70 thresholds. Parent Git confirmed16 actual candidate paths (14modified+2new), NOT19changed; unchanged allowed tests rechecked. Candidate1184authored lines (1099add85delete), tracker excluded. No source acceptance/commit. Native assess again empty/unassessable,RDDoff; independent verifier required AFTER incident diagnosis.

INCIDENT: writer reports a real official Telegram getMe request attempt with synthetic token during diagnostics RED due to missing _call mock; reportedly no response. This violated offline-only authority. No-response does NOT establish that no bytes left or no server effect occurred. Writer also reports frontend singleton fetch attempt failed relativeURL parsing injsdom. Final fixtures reportedly fixed and latergates green, but do not describe the entire task as fully offline. Parent disclosed incident to user and paused further tests/acceptance/commit, launching READ-ONLY `mu9t2fx2-c-i187` to inspect final fixtures and derive durable no-network guards. No live reproduction or credential inspection authorized. Parent observed only expectedcandidate+tracker changes and emptyindex. User session boundary still finishRCA5b/verifiedlocalcommit/checkpoint/STOP; if blocked record honestpartial instead.

Separate source review remains pending, including writer-admitted known-quiescent standalone prepare failure retaining a lease until callers explicitly stop, contrary to frozen cleanup intent. Do not accept this as harmless merely because current suites pass. No A lifecycle wiring yet.

### Incident containment correction — tests only

Read-only `mu9t2fx2-c-i187` confirms final Python fixtures now mock _call before prepare, but no durable guard prevents a future omission; broad run exception handling can swallow assertion guards. Frontend singleton binds fetch at module import, so later global stubs do not intercept it. No live reproduction occurred. Ignore mapper's unrelated `prisma-telegram-poll-diagnostics.md` tracker comparison: current authority is THIS tracker and actual16within19 scope, not that old document.

Authorize one bounded writer only these existing files: runtime `tests/test_telegram_diagnostics.py`, `tests/test_telegram_lifecycle.py`, frontend `hmi-app/src/components/admin/GlobalSettingsDialog.voice.integration.test.tsx`. Before ANY test execution, install per-test requests.Session.request interception covering every relevant class/case: record and refuse unexpected dispatch, assert empty attempt list OUTSIDE production catches during cleanup, always restore patch even on failure. Do not format/log URLs/tokens; use fixed guard errors. Preserve deliberate fake lower-level HTTP diagnostics. Frontend bind a controllable mocked singleton before consumers import, keeping real AdminAuthClient available for injected-fetch contract tests; replace ineffective global-only assumptions without weakening assertions. Unexpected singletonfetch must be recorded/refused and checked externally. No production edits or package/global-network harness refactor.

Containment-first: do not rerun a known unguarded path to manufacture RED. If proving guard discrimination with a nested test fixture, patch an inert lower-level dispatcher FIRST so no version can access network; no source mutation or live probes. Report coverage-only GREEN honestly where source already correct. After reading all three final safeguards, ONLY canonical focused supervisors for test_telegram_diagnostics.py and test_telegram_lifecycle.py, plus `npm --prefix hmi-app test -- src/components/admin/GlobalSettingsDialog.voice.integration.test.tsx`, and read-only Git/hash/whitespace checks are authorized for this correction. No full backend/frontend gate yet, no live services/providers/network. Return exact guard evidence and counts; parent then assesses and delegates independent whole-candidate verification. Forecast60–160 authored lines advisory. Session still closes after accepted RCA5b/commit/checkpoint, no later unit.

Containment task `mu9t7vhl-d-0rjg` failed with generic assistant error and no usable handoff/cause. Parent read-only recovery confirms HEAD6301e97/indexempty, same16candidatepaths+tracker, all seven production hashes unchanged. Only the two Python tests gained guard code; frontend test remains prior hash `e5e6d109362fea196702bd2bca5bad6727970dd6a4b0282e48ec30cb49ec0e1e`. Current diagnostics hash `09b31ded0e850fb7803d8e31437b92808d56674cc56673f7f15166ba104a5ede`, lifecycle test `a1b033541b82f242ef835b0e760343ec443ba818dcea7274f3212632f4677260`. File presence proves neither execution nor success. Same-writer recovery must recover actual command outcomes without inventing/replaying uncertain executions, complete frontend containment before any further test, then only authorized focused gates. No acceptance/commit.

Containment recovery `mu9tdjqn-e-fubv` completed: reports prior failed turn ran read/edit plus py_compile (initial indentation error repaired), NO test suite, no unfinished command. Those compile commands were outside the enumerated gate list; do not repeat or fabricate approval. Final focused diagnostics37/lifecycle26/frontendintegration6 PASS reported after all3guards inspected. Python fixturewide request-funnel refusal/cleanup assertions plus nested inertfloor probes; frontend hoisted real-client/fakefetch singleton and externalrefusal assertion. Diagnostics/lifecycle hashes same as parentrecovery; frontend now `b544a3e4b6e8542802d6e1f3fb308529d0da3c7b78edaee1f6969f43d8065c9c`. Seven production hashes unchanged, NOT accepted merely because writer calls them accepted. Original external-attempt incident remains. Full gates not rerun during containment. Parent read frontendguard/currentBsource, checked actualscope/whitespace; nativeassess still unassessable/RDDoff. Fresh whole-candidate verifier `mu9tjfy5-f-4n3e` now authorized: inspect safeguards first, exact8backendfocused/fullREADMEgate/frontend5focused+coverage/build/lint, no extra probes. Lifecycle quiescence/directrun/failedprepare and leaseauthority concerns explicitly referred. User boundary finishRCA5b then commit/checkpoint/STOP unchanged.

### RCA-5b independent FAIL and six-path correction

Verifier `mu9tjfy5-f-4n3e` stopped before ALL gates: frontend configured handler throws on unknown route without recording refusals, so production catches can hide it. Read-only review also finds direct run not registered (stop treats thread=None as quiescent; duplicate direct/start execution possible), standalone prepare/run failure leaking known-quiescent lease, mutable/releasable inspection lease, and int-subclass callbacks under leaf lock. Same-thread stop reentry during preparation is an internal edge needing a fence. Evidence SOURCE READ, no probes or fresh gates. Actualcandidate1444 authoredlines (1354add90delete),16paths+parenttracker; all suppliedhashes matched one observed pass, not a before/after execution proof.

Authorize correction only: `services/prisma-runtime/src/prisma_runtime/bot_identity_reservation.py`, `services/prisma-runtime/tests/test_bot_identity_reservation.py`, `services/prisma-runtime/src/prisma_runtime/local_presentation.py`, `services/prisma-runtime/tests/test_telegram_lifecycle.py`, `services/prisma-runtime/tests/test_telegram_diagnostics.py`, `hmi-app/src/components/admin/GlobalSettingsDialog.voice.integration.test.tsx`. No manager/HTTP/frontendproduction/A edits. First fix frontend fake refusal accounting and prove it catches configured-handler rejection externally without realfetch; Python guard/floors stay intact. Then genuine RED-first backend regressions and fixes: track actual direct/managed runner activity, no duplicate or mixed run/start, no release while effects pending, stop fences late migration persist/handling, safe same-thread stop (no selfjoin/deadlock), owned quiescent preparation/run failure cleanup while uncertain cleanup retains. Preserve diagnostics/failure classification and existing B semantics. Immutable lease, non-releasable inspection snapshot, exact built-in int keys (reject subclasses BEFORE any callback/lock); tests for mutation/stale release/hostilekeys. No speculative hostile externalprovider claim: this is the internal API contract.

Forecast200–500 incremental authoredlines advisory, preserve coverage. Gates resume ONLY after frontend containment fixed/proven and fixtureguard review. Same exact8backendfocused/fullREADMEisolatedgate plus frontend5focused/coverage/build/lint authorized from frozencontract; no extra probes, py_compile, bare tests, runtime/provider calls or source mutations to fabricateRED. Report actualRED/GREEN per finding, fullcounts/coverage, hashes and additions+deletions. Fresh parentassess/independent verification afterward. Latest user boundary supersedes the earlier stop: finish verified RCA-5b, continue remaining RCA-5, and PAUSE/notify BEFORE RCA-6. Current writer scope remains these six paths only.

### Six-path correction returned; source recheck before execution

Writer `mu9ttzzu-g-5az6` six-path correction RED: frontend1failed6passed, registry16/8failures, lifecycle33/7failures1error then outer300sTIMEOUT. Follow-up `mu9us1ky-h-bb3e`: no retainedPID/exit/termination proof; non-daemon-thread cause speculative, laterGREEN not proof of death. GREEN reported164focused(16/33/37/10/13/14/32/9),722backend;81frontend/5files,7integration; coverage87.17/80.26/86.32/88.05 buildlintPASS. Fullfrontend totals lost via tail35. Candidate claimed1864authored vs1444:420growth not round-authored count. Scope14tracked+2new+parenttracker17,indexempty. No independent acceptance; original networkincident remains.

Parent source read/nativeunassessable led to source-only `mu9ut5d0-i-ehsn`. Passive metadata2026-09-20T13:31:25Z: Python16660/23968/18768/22060 created00:59:47–49Z,venv/base pairs/root11356absent. Server-side lifecycle-unittest pattern query returned no match; projectedPID/PPID/time/path only, no fullcommandline/envvalues. No process attribution/intervention or historictermination proof. Current frontend sentinel handlers close actualrefusalhole; nonsentinelfuturelimit notcurrentblocker. Residual concrete findings and correction below.

### Residual source FAIL — four-path correction

Independent `mu9ut5d0-i-ehsn` and retained-detail followup close prior frontend/directrunner/successful-failurecleanup/reentrantstop/immutability/acquire-key findings BY SOURCE ONLY. Four residual findings: HIGH lifecycle threaded tests lack guaranteed teardown; assertions before release/stop/join and swallowed callback wait assertions can leave workers retrying (NOT proof of historical timeoutcause). MEDIUM failed standalone preparation/directrun cleanup does not fence activation when close fails; lease retained but effects may restart. MEDIUM completed finalization closes again, so laterclose fault reports falseuncertainty after release. MEDIUM release admits forged-key/lease-subclass callbacks underleaflock before identityreject.

Authorize ONLY `services/prisma-runtime/src/prisma_runtime/local_presentation.py`, `services/prisma-runtime/tests/test_telegram_lifecycle.py`, `services/prisma-runtime/src/prisma_runtime/bot_identity_reservation.py`, `services/prisma-runtime/tests/test_bot_identity_reservation.py`. First install unconditional test cancellation/release/join and external threadoutcome assertions BEFORE any gate; keep network guard through teardown, no daemon-only workaround. Add safe failing-path teardown proof with inert fakes; do not replay original unsafeRED. Then RED-first regressions/fixes: failedactivation fences beforecleanup; uncertainclose retains lease but blocks prepare/run/start; stop retriescleanup; terminal success shortcircuits repeatedclose; reject malformed exact-lease keys/lease subclasses beforecallback/lock with incumbent unchanged. Existing guards/frontend/all otherproduction unchanged. Forecast100–300 correction authoredlines advisory.

After source inspection confirms safe teardown, exact existing focused supervisors (registry/lifecycle RED then all8 GREEN), fullREADMEisolatedgate, frontend5focused/fullcoverage/build/lint authorized. Preserve full stdout (no tail/filter hiding counts), exact test/file totals and failed/succeeded exit evidence. No extra probes or processintervention; prior passive metadata does not prove historictermination. Fresh independent source/gate verification required. Continue remainingRCA5 only after accepted unit; pause beforeRCA6.

Phase A `mu9v0ruj-k-2ddd`: only lifecycle test edited, hash `dcf3ce9bc12322d371962dc3604880344b331a1973bcbd2030491c5e2a1283ba`. No execution. Parent read helper/four races/inert failure proof; cancellation/release precede joins and external assertions. Phase B four-path RED/fix/exact gates now authorized; no historic timeout closure inferred.

Phase B `mu9v6bfe-l-5url` returned exactly4paths. ReportedRED registry19/2fail, lifecycle38/4fail exit1; GREEN172focused(19/38/37/10/13/14/32/9),730backend,81frontend/5files,1973full/202files,coverage87.17/80.26/86.32/88.05 buildlintPASS. Initial34test fixture-only gate not separately evidenced; later38testRED had34green, do not infer an earlier run. Sticky activation-failure fence, terminal finalization shortcircuit, exact foreignrelease type/key prevalidation. Approx351PhaseBauthored; per-file nettable growth is not necessarily exactrounddiff. Parent source spotread/nativeassess stillunassessable; independent `mu9vwj2e-m-g4d4` now inspects allguards then runs exactfullgates. No acceptance yet. Historical timeout/networkincident unchanged.

### Final RCA-5b acceptance — OFFLINE

Verifier `mu9vwj2e-m-g4d4` returned PASS: all four residual findings closed; fresh172focused/730fullbackend,81frontend/5files and1973full/202files,coverage87.17/80.26/86.32/88.05%,build/lint PASS. All16candidate hashes stable before/after gates; tracker mutation parent-owned. Parent independently ran exact isolated lifecycle supervisor38PASS, read corrected boundaries and checked scope/hashes/whitespace/indexempty. Accepted candidate2393authoredlines, plus tracker; no native approval or live-provider/full-A integration claim. Earlier network incident and historical timeout uncertainty remain recorded. Local commit authorized; do not self-edit its hash into that same commit. Continue remaining RCA-5 after commit; pause BEFORE RCA-6.

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
