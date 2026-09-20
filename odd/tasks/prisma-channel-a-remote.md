# Prisma Channel A remote — ODD tasks

## Current state and next action

**RCA-1–4 and RCA-5a–5c are accepted OFFLINE. Continue the remaining RCA-5 units; pause and notify BEFORE starting RCA-6.** Do not close the session at RCA-5c.

- Branch: `feat/prisma-telegram-credentials`.
- Previous committed boundary: `7fb7edc23715e07062778dc5913a3eb1fbdf015c` — cooperative bot identity exclusion. RCA-5c's actual commit hash/count is recorded afterward in the progress checkpoint, not self-inserted into its commit.
- RCA-5c accepted by parent after independent516 focused/825 backend PASS, parent95 lifecycle PASS, source/scope/hash/whitespace checks. No source writer active; next freeze a coherent remaining RCA-5 unit.
- Full remote A remains unwired. A credentials, domain, transport and B's shared-reservation integration do not establish operational A/B exclusion or full-product acceptance.

### Authority and workflow

User authorized ODD implementation and local work-unit commits. The latest instruction supersedes prior RCA-5b pause/closure requests: finish all RCA-5, then pause BEFORE RCA-6. No push, PR, branch creation, paid/live Telegram/Gemini tests, deployment or runtime restart is authorized.

User approved distinct A/B bots operating concurrently: the incumbent observed-identity reservation wins and a conflicting activation is rejected. No automatic takeover or permanent cross-channel stop. Development-only channel stopping is permitted if necessary, but does not authorize credential deletion, state reset, restart or provider calls. No operational stop has occurred.

Parent owns this tracker, its full Engram mirror, acceptance and commits. Delegate source implementation/testing/verification; one writer at a time. Freeze each unit's exact paths, behavior, TDD and commands before launch. About 400 authored lines is advisory, not permission to omit tests, minify or split incoherently. Native assessment unavailable/unassessable means independent verification, never invented approval.

## Recovery and historical evidence

Full recovery mirror: `odd/prisma-channel-a-remote/tasks` (the complete current document plus repository path). Current progress/commit/task identity: `checkpoint/prisma-channel-a-implementation-progress`. User boundary: `decision/prisma-channel-a-session-boundary`.

This consolidation keeps the mirror below its observed approximately 50k readback limit. It is not a diff-budget reduction. RCA-5c correction chronology through writer16/independent17 launch is preserved verbatim in verified Engram topic `evidence/prisma-rca5c-correction-chronology`; final completion/acceptance is below. Earlier lossless accepted contracts, failed rounds and command evidence remain in Git:

| History | Canonical repository snapshot |
|---|---|
| RCA-1–4 and initial RCA-5 planning | `c411687:odd/tasks/prisma-channel-a-remote.md` |
| RCA-5a full transport contract and correction history | `6301e97:odd/tasks/prisma-channel-a-remote.md` |
| RCA-5b full registry/B/409 contract, containment incidents and correction history | `7fb7edc:odd/tasks/prisma-channel-a-remote.md` |

`docs/PENDING_WORK.md` is the discovery authority. PW-002/PW-003/PW-004 remain active; use each row's full Engram topic before unrelated work. PW-003 is `backlog/prisma-dual-channel-assistant`. Product source is `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md` §11.1 plus subsequently accepted decisions. Do not infer broader assistant authorization from the backlog.

## Product invariants

A person viewing an inputless industrial HMI uses a phone to ask about that document's current visible snapshot. The HMI remains strictly read-only toward the industrial process.

### Authority and pairing

- Dedicated protected bot A and independent lifecycle; same protected credential store and backend administrative session. No second login, B/environment token fallback or token-prefix identity comparison.
- Preserve B admission, conversations, `JsonFileStore`, offsets, migration, diagnostics and exact nine-field admin status except the accepted collision rejection.
- Automatic single-use opaque QR rotates every 60 seconds while free. Never expose HMI capability, admin secrets or bot token. Phone confirmation is required; Telegram Start alone is not pairing.
- One phone per HMI document and one HMI per phone; multiple independent pairs. No implicit transfer or takeover. Hide QR while linked; unlink on the phone. Reload, restart or expiry requires relinking. No durable device identity.
- A forwarded QR photograph remains a limitation, not proof of proximity.

### Time and visible context

- Human inactivity: 600 seconds. Only admitted human interaction renews it; technical polling never does.
- Warning lead: default 60 seconds, configurable 15–300 in existing admin mode and persisted runtime policy. An absent implementation field is not an undecided product requirement.
- Presence-loss cutoff: 30 seconds. Explicit close/revoke: immediate.
- Freshness: 15-second fail-closed server-receipt age bound, not proof of delivery or visibility.
- Existing viewer export: nominal 5 seconds, 4.5-second timeout, single-flight/skipped ticks. Hidden/offline/navigation gaps are unbounded. Existing voice polling every second renews presence only. No new heartbeat interval is approved.
- A known-invalid prior view must be invalidated immediately, not reused until TTL. Delivered invalidations and publications need ordering; captured view identity must be revalidated before phone and HMI output. The backend cannot instantly know navigation that never arrived.

### Answers and epochs

- Existing deterministic visible-snapshot parser only. Same answer text on phone/HMI plus existing HMI audio in the later correlation unit.
- No Telegram answer audio, microphone/STT, general NLU, history, offscreen/global fallback, requested navigation or latent recipient path in this increment.
- Generation/correlation fences suppress late answers/audio after unlink/relink, including the same owner.
- Fresh adapter and fresh empty link epoch on restart, reconfiguration and Telegram's week-idle update-ID discontinuity. No B offset reuse or exactly-once claim. An old high poll offset can hide lower new IDs; discontinuity is not harmless merely because IDs are non-contiguous.
- Uncertainty alone cannot erase live authority. Release only exact owned reservations after confirmed quiescence.

Frontend domain types stay in `domain/`; use design tokens, Lucide, `hmi-scrollbar` and admin conventions. Do not edit `Directrices/`.

## Tasks and acceptance boundaries

- [x] **RCA-1 — Fresh internal HMI context:** `e32bef1`, accepted offline.
- [x] **RCA-2 — Pairing domain:** `0fdfe0f`, accepted offline.
- [x] **RCA-3 — Dedicated bot adapter:** dialogue `51ecd70`, queries `d2fc349`, warnings `42edf8b`, accepted offline.
- [x] **RCA-4 — Protected A credentials/admin configuration:** provider/parser `465321b`, resolver `f3ac2cb`, card/proxy `713f7ae`, accepted offline. Saving A credentials NEVER starts or verifies runtime.
- [ ] **RCA-5 — HTTP/runtime integration:** in progress; freeze the remaining coherent units separately.
  - [x] **RCA-5a — Standalone transport:** `6301e97`, independent 56 focused/681 backend and parent 56 focused PASS.
  - [x] **RCA-5b — Cooperative identity exclusion:** `7fb7edc`, independent 172 focused/730 backend, 81 focused/1,973 frontend, coverage/build/lint PASS; parent 38 lifecycle PASS.
  - [x] **RCA-5c — Standalone A activation runner:** accepted offline; independent516 focused/825 backend and parent95 PASS. Initial TDD deviation remains recorded. Commit identity/count recorded in progress checkpoint.
  - [ ] **Remaining RCA-5 units:** query/context glue, ordered view invalidation, capability-scoped pairing projection, A policy/admin status/apply, scheduler, exact proxy and bootstrap. Names/order below are proposals, not frozen implementation contracts.
- [ ] **RCA-6 — Automatic HMI QR/link presentation:** maintained local QR encoder, typed client/hook/UI and expiry/error/multi-HMI tests. PAUSE and notify before starting. Original 350–650 estimate must be revalidated.
- [ ] **RCA-7 — HMI text/audio correlation:** generation/freshness checks and cancellation; decide automatic transcript placement/lifetime before UI. Original 250–500 estimate must be revalidated.
- [ ] **RCA-8 — Integrated verification/docs:** full gates, independent verification, README/master reconciliation; keep active backlog honest. Original 100–200 estimate must be revalidated.

## Accepted integration contracts to preserve

| Unit | Load-bearing contract |
|---|---|
| RCA-1 | Owner-scoped internal context with server receipt time and caller-supplied finite positive age bound; immutable/deep-copy isolation, no capability in result, no activity renewal, stale/missing/expired/closed owners rejected. |
| RCA-2 | Bounded locked in-memory authority, injected monotonic clock/entropy, immutable snapshots. One 60-second challenge; confirmation deadline no later than challenge. Exclusive pending/live associations. Opaque actions/generations; 600-second human idle begins at confirmation. Clock sampled under lock; rollback/overflow/equality expiry handled; no unbounded tombstones. |
| RCA-3a | Strict private actor/chat/bot validation, start/callback grammar and 64-byte callbacks. Displayed destination revalidated at confirmation; reserve capacity before claim, never evict live authority for unauthenticated replacements. Per-epoch high-water/confirmation fences, nonce protection, no durable B offset. Serialize ingress/effects without holding the domain lock over I/O. Delivered/rejected/unknown receipts sanitized; never replay uncertain sends. |
| RCA-3b | One-shot startup-only query attachment. Capture owner/phone/generation/update/adapter epoch; inject existing parser/context. Question limit 4,096 UTF-8 bytes differs from 128-character start grammar. Captured receipt-age deadline cannot be extended by newer snapshots. Effectful validators precede authoritative checks, freshness resampled before send. Human touch only on admission. Envelope only after observed phone delivery and post-send validity; future HMI publisher must revalidate again. |
| RCA-3c | Atomic warning reservation once per human-activity window. Sweep revalidates owner/generation/activity/deadline/nonce for each recipient, including prior-send changes. Spanish Seguir conectado/Desvincular controls. Rejected/unknown/skipped warning does not rearm until human activity; no answer envelope. Scheduler remains unwired. |
| RCA-4 | Three exact protected provider keys and strict metadata parsing. Older binaries reject A rows; rollback must account for this. A resolver reads only protected `telegram_channel_a`, lazy explicit-None factory, no cache/fallback; fixed missing/unavailable errors and missing-master rejection before I/O. Same admin session, metadata-only store. Provider-keyed secret drafts plus revision/session/panel/dialog fences. Exact A PUT/DELETE proxy preserves cookies/query/CSRF and strips HMI capability. Save never activates. |
| RCA-5a | Fixed-host text transport with mandatory timeout and injected fresh owned session per call; default `trust_env=False`, TLS verification, no redirects/retries/shared session/offset/lifecycle/webhook mutation. Poll connect/read tuple preserves distinct timeouts. Strict input/result bounds and sanitized errors, independent close attempts, no raw secret exposure. Adapter owns raw receipt classification. Full API/edge-case contract at commit `6301e97`. |
| RCA-5b | Shared process registry with immutable exact owner/epoch lease, callback-free key/handle validation and non-authoritative occupancy snapshot. B observes identity before reservation and effects. All direct/managed activity participates in quiescence; stop/failure fences prohibit reactivation. Known-quiescent cleanup releases, uncertainty retains; successful finalization is idempotent. Fixed `TELEGRAM_BOT_IDENTITY_RESERVED` HTTP409/frontend projection; B wire shape/auth/CSRF preserved. A must still consume the same registry. |

## Remaining RCA-5 design: accepted directions and unresolved contracts

Read-only maps: `mu9w9m0p-n-ee7w`, corrected follow-up `mu9wghxk-o-91g0`. Parent rejected unsupported assumptions; neither report is an implementation specification. Focused contract review `mu9wolyp-p-ta2n` informed the now offline-accepted RCA-5c contract. Remaining production wiring is not implemented.

### RCA-5c frozen contract — one standalone activation

Exact authorized NEW paths only; writer must confirm both absent before creation:

- `services/prisma-runtime/src/prisma_runtime/channel_a_lifecycle.py`
- `services/prisma-runtime/tests/test_channel_a_lifecycle.py`

No other source/test edits, persistence, `paths.py`, B refactor, transport method, HTTP/admin, scheduler, bootstrap or production wiring. Forecast **650–1,200 authored lines** including substantive tests; advisory, never trim coverage/readability. Automatic replacement and operational acceptance are deferred.

#### Construction and preparation

`ChannelARunner` takes keyword dependencies `transport`, `dialogue_factory`, required `clock`, `poll_timeout`, `read_timeout`, `join_timeout`, `poll_pause`, `on_outcome`, and `reservation=None` (only explicit None selects `process_bot_identity_reservation()`). No constructor/import I/O or credential lookup. Validate callable seams and finite nonbool timing values before I/O; poll timeout is a nonnegative exact int, read exceeds poll, join/pause are positive and within platform wait bounds. Validate the transport's connect timeout and finite connect-plus-read budget; reject a budget reaching the seven-day horizon. The pause is interruptible pacing after successful polls, not retry backoff after terminal failure.

Preparation registers ownership, samples the clock, observes `get_me`, validates `ChannelABotIdentity`/exact positive bounded ID/ASCII username using accepted transport bounds, checks the fence, acquires a lease with private owner/activation objects, then invokes the factory once. Validate a `ChannelAPairingDialogue` with matching bot ID, a `ChannelAPairingRegistry` and the identical transport before marking prepared. Never hold lifecycle locks over foreign calls, registry callbacks or joins.

The trusted factory must create a NEW dialogue, NEW empty pairing registry and fresh adapter epoch; it may attach queries before returning. No I/O, spawned work or use of retained references to bypass runner ownership. Freshness is a construction obligation tested through real factories, not private-map introspection. Identity/prepared state is not proof of successful polling. Do not add webhook inspection/mutation or an invented transport `close()`.

#### Public boundary and failure

Expose `prepare`, `poll_once`, `run`, `start`, `stop -> bool` and immutable sanitized internal status. `prepare` is idempotent after success; a concurrent preparation can refuse without mutating the incumbent activity. `run`/`start` do not spawn duplicate activity. External `poll_once` returns a fixed busy disposition while a runner/preparation owns admission, without changing its state. The loop uses its already-owned poll path rather than recursively contending with itself.

Use fixed `PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE` for invalid configuration/dependency failures, with `ChannelALifecycleError` raised from None where an API raises. Only a real reservation conflict preserves canonical `TELEGRAM_BOT_IDENTITY_RESERVED`; never blindly rethrow a dependency's same-class exception or raw message. Terminal idle retirement has distinct `PRISMA_CHANNEL_A_RESTART_REQUIRED`. Internal status contains only a closed phase, fixed reason, quiescent and restart-required flags; no raw exceptions, updates, dialogue, lease, owner, tokens or answer text. No admin wire contract is introduced here.

Track preparation, managed-start reservation and all poll/handler/consumer activity, not merely `self.thread`. Reserve startup before launching; cover launch failure and stop-before-entry. Stop sets a sticky fence immediately and rechecks after foreign calls/before further work. Same-thread stop never joins itself and returns False while owned work remains. Bounded join timeout retains authority. Last owned activity settles terminal failure automatically; repeated successful finalization is idempotent. Release uncertainty retains the exact handle for a later stop retry. No failed/stopped/retired instance can reactivate.

#### Cursor and outcome handoff

- Cursor starts None and is activation-local/in-memory; no durable or B cursor.
- Validate the WHOLE bounded tuple before handlers: at most `GET_UPDATES_LIMIT`, mapping entries, exact int IDs in `0..MAX_TELEGRAM_ID`, nondecreasing order. Accessor failures, bad suffix or decreasing order terminally fail without processing/advancing that batch; never sort it.
- Skip stale IDs below the cursor and equal-ID duplicates; the first occurrence owns a duplicate. Gaps are valid.
- Immediately before a new handler, reserve local cursor `id+1`, matching the adapter's pre-handler high-water. A valid-ID ignored/malformed-payload outcome is consumed. Delivered/rejected/unknown sends all consume the ID; unknown is NEVER retried.
- Validate the returned `IngressOutcome` ID and acceptance consistency; `accepted` is not delivery. Handler exception or malformed/mismatched outcome is terminal: retain the attempted local cursor, never advance over the untouched suffix or poll again. Stop before the next handler leaves that suffix untouched.
- Invoke required synchronous `on_outcome` once per completed valid handler, including completion after a concurrent stop. Consumer execution remains owned; future publication must itself revalidate lifecycle/correlation/freshness. Consumer failure is terminal, never replayed, and HMI delivery is unconfirmed.
- `poll_once` returns an immutable bounded result: tuple of completed outcomes, closed disposition (`completed`, `busy`, `stopped`, `failed`, `restart_required`) and fixed reason if any. Include a completed prefix on later failure; returned outcomes are observational, NOT another publication instruction. No unbounded queue.

#### Local idle retirement, not lossless recovery

Use the documented seven-day protocol horizon, not human idle600. Track nondecreasing finite monotonic samples and an idle anchor initialized during preparation. Refresh the anchor only for a newly admitted valid update, using that poll's start sample conservatively; empty/stale-only batches do not renew it. Invalid/throwing/nonfinite/regressing clocks and arithmetic overflow terminally fail closed.

Check before polling, after return and between updates. Before polling, retire if the connect-plus-read budget reaches the remaining horizon. At/equality beyond the horizon, fence further polls/dispatch, report restart-required and release only after settlement. Never reset the cursor while preserving old adapter/link authority.

This is LOCAL retirement, not guaranteed lossless Telegram discontinuity handling: receipt time differs from generation time, and scheduling suspension/backlog may let an old-offset request already acknowledge a lower reset ID. State that limitation. A later manager must await quiescence, detach old authority and create an entirely fresh activation/empty pairing registry with cursor None; no automatic replacement in RCA-5c.

#### Tests, execution and deferred work

Safety checkpoint `mu9xcf1n-q-zji5` returned221 test-only lines, no execution or production module. Parent rejected URL-bearing refusal messages, teardown without guaranteed restoration/unstarted-thread handling, cancellation disconnected from actual workers, and proofs that cleared evidence instead of demonstrating external cleanup failure. Read-only source/test access is approved; continuation `mu9xhtlw-r-958g` may edit ONLY the new test scaffold and must return for another parent readback before any test/source implementation. Expired parent query granted no execution authority.

Corrected scaffold `mu9xhtlw-r-958g`:415 lines, Git blob `15491c9fcce23f0a5a0ea89c0a9f7fcbd647faa5`. Parent read all guards/fixtures/proofs and ran the exact isolated lifecycle supervisor: **3 tests PASS in0.003s**, exit0. This proves the harness, not runner behavior. Continuation `mu9xlqa1-s-28wt` now has the two-file source/test scope and staged RED/GREEN plus frozen backend gates. Guard restoration/teardown must remain effective. An unconfirmed release (False or exception) retains the handle for later stop retry.

First install per-test request record/refuse guards with external cleanup assertions, inert fake sessions and failure-safe owned-thread teardown before any test can dispatch. Prove guard discrimination only over an inert lower floor. No imported unsafe thread helper or daemon-only escape. Strict RED-first staged behaviors; distinguish initial missing-module RED from later behavioral failures.

Cover constructor laziness/validation/bounds, identity-reservation-factory order/collision, real fresh factories and no old-link transfer, entire-batch validation/gaps/duplicates/cursor maximum, ignored/unknown/error outcomes, consumer prefix/handoff/no replay, clock/idle boundaries and stalled requests, direct/managed/poll exclusion, all stop/reentry/startup races, release uncertainty/retry/idempotence and sanitizer canaries. Register cancellation/release/join before launch; external outcomes cannot be swallowed by production catches.

Authorized gates: exact focused supervisor below for `test_channel_a_lifecycle.py` (RED/GREEN), then `test_channel_a_transport.py`, `test_channel_a_bot.py`, `test_channel_a_pairing.py`, `test_channel_a_query.py`, `test_bot_identity_reservation.py`, `test_telegram_lifecycle.py`; exact README full backend supervisor. No frontend change or frontend rerun needed. Read-only Git/scope/hash/line/whitespace checks allowed, including new files; no extra probes, py_compile or process commands. Stop on unexpected dispatch/timeout/worker survival. Parent fresh assessment, independent verification and spotcheck precede acceptance/commit.

Deferred: actual credentials/manager/bootstrap, automatic replacement, warning scheduler, persisted policy/admin, safe HTTP projections, ordered view invalidation and HMI publication. A later warning seam must acquire this same owned-operation admission; do not expose arbitrary raw-dialogue operations now.

#### RCA-5c candidate and confirmed TDD deviation

Writer `mu9xlqa1-s-28wt` returned new source922 lines (Git blob `105e799e615e66a4968f354ecf05459459fa620d`) and tests1749 (blob `10900b2273fd8e1f328f1f35a9180d86fba452a5`). **Candidate total is2671 authored lines**, including the415-line scaffold; subtracting it to report2256 for this unit was incorrect. Forecast exceeded; preserve substantive coverage/readability.

Retained chronology explicitly confirmed: COMPLETE SOURCE first, then behavior tests, then the first focused run (71tests/15failures/3errors). There were ZERO earlier behavioral or missing-module RED runs. The parent authorized staged RED-first, NOT one-pass implementation before tests. Two subsequent genuine defect fixes (failed-prepare settlement and last-batch prefix on stop), plus test corrections, led to71GREEN; that is post-implementation RED/fix evidence, not initial TDD compliance. Do not recreate or retroactively claim the missing history.

Writer reports all7focused492 (71/56/180/54/74/19/38) and801fullbackend PASS; no frontend changes/gates. These are not independent acceptance. Parent native assessment remains unassessable/RDDoff. After explicit disclosure, user selected **Verificar el candidato**: independently review/test it and record the deviation; this does not waive future TDD, confer native approval or accept current bytes. Verifier `mu9yyuxx-u-viby` checks guards first, then frozen backend gates, with technical disposition separate from the permanent process finding. Future corrections must use test-only authority until RED is observed before source-edit authority is granted.

#### RCA-5c independent FAIL — staged correction

Verifier `mu9yyuxx-u-viby` stopped before ALL gates: later managed-worker integration bypasses safe ownership despite passing scaffold proofs. Source/test hashes stable: `f51102b4d470daeda8067d97d8a0f78fc9f3e7188858169744a4dd9d7ede8f30` / `0c533930c23425f87e01ce278bcf7f33653611067ec71ae1bfe290d8ed36682a`. Source922/tests1749=2671 authored. Writer492/801 remains unverified. No new probes or runtime actions.

| Finding | Required correction evidence |
|---|---|
| HIGH managed workers discovered after start by enumeration/name; failures swallowed internally | Capture exact managed Thread before launch, register teardown and external escaped/unexpected-terminal errors; include immediate finish and launch failure. |
| HIGH missing fences after clock/acquire callbacks and per-update clock | Reentrant stop permits no subsequent getMe/factory/handler/cursor effects. |
| HIGH concurrent/reentrant release has no in-progress exclusion | At most one release call; reentrant stop cannot recurse; uncertainty retains handle and later retry is serialized. |
| HIGH attribute/conversion/same-class/outcome faults leak raw errors | Fixed sanitized errors/status and terminal cleanup across constructor, prepare and direct poll. |
| MEDIUM outcome ID equality accepts bool/float | Exact integer ID validated before consumer/prefix. |
| MEDIUM poll during preparation reports failed instead of busy | Busy disposition without incumbent mutation or additional effects. |

Correction Phase A `mu9z65px-v-28ma`: ONLY `services/prisma-runtime/tests/test_channel_a_lifecycle.py`; source bytes frozen. Repair fixture capture first, add bounded deterministic regressions, then return for parent source-read checkpoint without any execution. Parent then runs/authorizes exact focused RED; only afterward may source-edit authority be granted separately. No counter clearing, recursive/hanging proof, daemon-only workaround or test weakening. Forecast200–450 correction authored lines advisory. Further verification remains incomplete; these fixes will not imply automatic acceptance or erase the initial TDD deviation.

Recovery checkpoint: parent observed unchanged922-line production SHA256 `f51102b4d470daeda8067d97d8a0f78fc9f3e7188858169744a4dd9d7ede8f30`; partial tests now2501 lines SHA256 `9ca05962734f2a6c6201c9742019ebd2187805224894d5fa2bd40bfbb6db31f0`. Same2new paths plus parent tracker, index empty. Generic task failure supplies no execution/completion evidence. Recovery `mua06om1-w-qr0z` may finish existing test-only work only after confirming no uncertain execution/in-flight command; otherwise stop and report. File presence does not prove RED or completion; do not replay commands blindly.

Recovery `mua06om1-w-qr0z` reports no test/compile/probe or unfinished command; source/test hashes match the parent checkpoint. It disclosed cat/sed/head source reads and external Python/venv inspection outside the enumerated shell scope; these are tool-discipline deviations, not evidence of network activity. Parent reiterated read tools and narrow metadata commands. Source read found two residual harness flaws: nested captures wrap the enclosing facade and double-register threads; `launch` installs result checks after start/assertions and before actual activity teardown. Test-only continuation `mua0cipp-x-v18a` must separate real thread construction from prior-facade restoration, register expectations before launch, and validate every outcome after joins but before guard restoration, with a failure-before-release proof. No RED/GREEN inferred; +752 test lines is net growth, not measured correction-authored count.

Corrected harness `mua0cipp-x-v18a` returned without execution: tests2649 SHA256 `1a6cb5526f0ade25678b4f0e22bf614103ebeb1da4ddd242926ec4e50731a641`, frozen source922 unchanged; total3571 new candidate lines. Parent read guard/activity/setup, capture/expectations/launch and all four managed proofs: real constructor/prior facade separated, expectations registered pre-start, checks run after activity joins and before restoration, including body-failure/deferred-terminal-failure proof. Bare expected-refusal start sites remain for independent review. Fresh native assessment again empty/unassessable. Independent `mua0kcka-y-dj32` has read-only authority and, only if execution safety passes, ONE exact tracker supervisor for `test_channel_a_lifecycle.py`; no other gates/reruns/probes/writes. Return observed source RED versus fixture faults and complete execution evidence before any production grant. This is not harness execution acceptance or a technical PASS yet.

Independent checkpoint `mua0kcka-y-dj32`: safety PASS; exact isolated lifecycle supervisor executed ONCE, **89 tests in0.021s,10 failures/8 errors, exit1**. All3originalguard+4managedproofs passed; no unexpected dispatch/timeout/survivor/cleanup failure reported. All18 records are genuine production defects: three callback fences, reentrant/concurrent release, five constructor getter/conversion errors, same-class preparation sanitization (two assertions), two outcome getter errors, pre-poll clock conversion, bool/float IDs, and busy-during-prepare. Source/test hashes unchanged; full stdout retained without truncation. This establishes correction RED only, never initial TDD compliance or production acceptance.

Verifier also found an unreached fixture error: pre-poll invalid clock must expect ZERO get_updates calls, not one. Misnamed consumer BaseException test actually exercises the handler; bare refusal start sites are owned/cancelled but lack explicit no-new-thread evidence. Test-only continuation `mua0pyy0-z-e0a0` may correct that assertion, accurately rename/retain handler coverage, add a real managed consumer exception test with observations asserted outside the swallowing callback, and require no captured-thread growth on refusal. Core harness stays unchanged. Only after static safety preservation, run exact lifecycle supervisor ONCE; report source RED and any new findings. No production edits, other gates or reruns. Parent then grants source-only authority separately.

Refinement `mua0pyy0-z-e0a0` executed one authorized lifecycle gate: **90 tests in0.022s,10 failures/8 errors, exit1**. Same genuine source RED; seven harness proofs, corrected refusal sites and new actual consumer BaseException case passed. Source unchanged922/f51102b4…; tests2730 SHA256 `6059268928c5d2296897718d87acc61324741bf74502d3803167a0f8fa9b4a42`; total3652 new candidate lines. Parent read the three bounded changes. Handoff condensed traceback boilerplate despite earlier complete-output wording; original retained output availability must be distinguished from the condensed report, never reconstructed or rerun as historical evidence.

SOURCE-ONLY authority `mua0xdxu-10-3bb1`: edit only `services/prisma-runtime/src/prisma_runtime/channel_a_lifecycle.py` against the observed18 records; tests and all other source frozen. Preserve acquired leases across stop fences, serialize release without foreign calls under locks, sanitize dependency faults without trusting same-class codes, validate exact outcome IDs and return busy during occupied preparation. Forecast100–300 correction diff lines advisory. Lifecycle GREEN first, then six remaining frozen focused suites and exact README full backend; no frontend/probes/py_compile/alternate launchers/process actions. Stop on safety/uncertain execution; test changes or new product decisions require a new parent grant. Fresh independent verification and parent acceptance remain mandatory before a local work-unit commit.

Source-only writer `mua0xdxu-10-3bb1` returned GREEN on frozen tests: lifecycle90/0.016s, remaining56/180/54/74/19/38 = **511 focused PASS**; README backend **820/22.684s PASS**, exits0 reported. Source now1013 SHA256 `1636af1b2817ba679436f0495e8d83b6ff3ed631e14692d0d59b94c788d9c029`; tests2730/605926… unchanged; **3743 total new candidate lines**. Parent read release serialization and preparation fences. No reported dispatch/timeout/survivor/cleanup failure. Writer's nine-invocation prose conflicts with eight listed gates; read-only `mua19f0n-12-m8q9` must reconcile retained evidence without commands. +91 source net growth is NOT correction-authored diff and cannot establish compliance with the100–300 forecast.

Fresh assessment again empty/unassessable/RDDoff. Full independent `mua18xaq-11-lmbr` first revalidates safety/current full contract, then may execute seven exact focused supervisors and README backend once each, stopping on failure/safety/uncertainty. Both candidate files frozen, no edits/probes/retries/front-end/operational actions. Check complete raw evidence versus condensed handoff honestly and hashes before/after; parent tracker changes separate. Writer PASS does not close findings or authorize acceptance; independent disposition and parent spotcheck still required.

Read-only audit `mua19f0n-12-m8q9` reconciled retained records without commands: exactly EIGHT writer invocations, seven focused then one README backend, each once; no hidden retry/pre-GREEN failure. Nine was a prose error. +91 net-growth/forecast comparison withdrawn; correction add/delete unknown, full candidate3743 known. Raw eight GREEN outputs and previous90-test RED remain in the writer transcript; only the handoff was condensed. Audit separately disclosed a post-gate Bash grep symbol sweep outside the prescribed read-tool/metadata-only boundary; read-only, no new provider/runtime evidence. Independent verifier informed; authority unchanged.

Independent interim source findings from `mua18xaq-11-lmbr` (not executed reproductions): `_validated_read_timeout` still calls unguarded `float(poll_timeout)`, so a huge exact-int poll timeout can leak OverflowError; `_settle` can apply an older refusal after another settlement finalized and overwrite STOPPED with STOPPING. Harness remains safe for the already-authorized gates. No source changes or probes; await full handoff, then test-only regressions before any source correction. Passing existing gates will not close these residual contract defects.

#### RCA-5c final residual correction and acceptance

Complete intermediate chronology is preserved in verified Engram topic `evidence/prisma-rca5c-correction-chronology`; compaction removes no evidence. Independent11 found atomic cursor-admission, stale settlement and huge-int conversion defects despite511/820 GREEN. Parent rejected fixture counter collisions/unrecorded waits before execution; corrected tests then produced independent95-test RED (2 failures/1 error,0.087s). Subsequent source-only correction preserved frozen tests and reached all prefix/cursor/idempotence assertions. Initial TDD noncompliance and tool-discipline deviations remain permanent.

- Writer16:516 focused/825 backend PASS, eight invocations once each.
- Independent17: source/full-contract review and seven focused suites (95/56/180/54/74/19/38=516) PASS. Its malformed full supervisor had an extra `]`: parse-time SyntaxError, no supervisor body/backend child executed; stopped without retry.
- Explicitly reauthorized independent18: exact README backend825/24.211s PASS, canonical exit0. Combined technical PASS; nine attempts total (seven focused, one failed prelaunch, one successful backend). No unexplained retry or provider claim.
- Parent: exact isolated lifecycle95/0.084s PASS; actual final source readback, matching hashes, expected scope/empty index and explicit untracked whitespace checks. No unexpected dispatch/timeout/surviving worker/cleanup failure.

**Parent accepts RCA-5c OFFLINE only.** Source1031 SHA256 `bbb84bb7b915b2fac10a485f23992ed0a5219d52d7330f73791f02bba4d6a3ae`; tests3107 SHA256 `b55ab76039610e05fb29375e4ff20465fc7557174e478ca90ba16a907c66144e`; total4138 new/authored lines. +18 net source growth is not an authored correction diff. Native assessment remained unavailable/unassessable; no native approval. Commit identity/count follows in the progress checkpoint. Remaining RCA-5 wiring and all RCA-6 work remain incomplete.

### Later coherent units — provisional order

| Boundary | Work and dependencies |
|---|---|
| Query/context composition | Attach `enable_queries` once with owner context, existing parser and accepted bounds; preserve returned envelopes for the later publication seam. |
| Ordered view invalidation | Add precise client intent/order and server context identity, reject late old publications, compose session removal, revalidate captured identity before phone/HMI effects. Must finish in RCA-5, not be skipped because QR could otherwise render. |
| A policy and administration | Persist warning lead in a small A-specific policy, not DSP-only voice configuration. Use existing A admin section and backend session/CSRF. Explicit Apply/status, never auto-start on credential save. Preserve B's exact wire shape. |
| Viewer pairing projection | Capability-scoped DTOs, no second login. Do not expose raw `as_dict()` owner/phone/generation authority fields. QR token is intentionally required for its deep link, unlike HMI capability or bot credentials. No inputless-HMI manual release control; compose internal owner removal and retain phone unlink. Freeze HTTP method/cache/idempotence details separately. |
| Scheduler/proxy/bootstrap | Own polling/warnings and cleanup; deterministic cold-start behavior with shared A/B registry. Exact route/method proxy allowlist, origin/host checks, no-store policy and browser-routing docs. No actual service restart or provider validation in offline implementation. |

### View ordering: rejected shortcuts

Exporter abort/single-flight and session-client response fences do not prove server arrival order. A prior `g <= last` rejection cannot also support invalidation then publication at the same generation. The corrected mapper is still insufficient: clearing context on invalidation without advancing an ordering watermark allows a late older publication to resurrect it; same-generation publications also need explicit ordering semantics.

Required design traces include old publish after newer invalidation, invalidation then replacement publish, replacement publish before delayed invalidation, same-view publication reordering, StrictMode/reset and undelivered navigation. Distinguish pairing generation, adapter epoch, client view intent/order and server captured context revision. A phone answer already delivered cannot be retracted; HMI publication still must fail closed. No new heartbeat. Detailed prior topic: `architecture/prisma-channel-a-visible-context-invalidation`.

## RCA-5b acceptance and incident record

Final independent verifier `mu9vwj2e-m-g4d4`: PASS, no remaining blocker. Fresh evidence:

| Gate | Result |
|---|---|
| Backend focused | 172: registry19, lifecycle38, diagnostics37, credentials10, Telegram HTTP13, local presentation14, runtime safety32, credential HTTP9 |
| Backend full | 730 PASS |
| Frontend focused | 81 tests / 5 files PASS |
| Frontend full | 1,973 tests / 202 files PASS |
| Coverage | Statements87.17%, branches80.26%, functions86.32%, lines88.05%; all >=70 |
| Build/lint | PASS; known canvas/grid/chunk advisories are not test failures |
| Integrity | All 16 candidate hashes stable before/after gates; tracker changes parent-attributed |
| Parent corroboration | Exact isolated lifecycle supervisor: 38 PASS in0.024s; source, scope, hashes, whitespace and empty-index checks |

Candidate: 2,393 authored lines. Commit `7fb7edc`: 17 files, 2,413 additions +112 deletions =2,525 authored lines including tracker. Native assessment returned empty/unassessable with RDD off; independent verification was used, not native approval. Acceptance is OFFLINE only.

### Historical limitations remain open as facts

- Initial RCA-5b RED made an actual official Telegram `getMe` attempt using a synthetic token because `_call` was unmocked. No response does NOT prove no bytes were sent. Parent disclosed it, suspended tests and required containment. Topic: `incident/prisma-rca5b-test-network-attempt`.
- The import-time frontend singleton also attempted a relative-URL fetch that reportedly failed in jsdom. The current singleton uses an injected inert transport before consumers import it; configured unexpected-route sentinel refusals are externally asserted.
- Earlier lifecycle RED printed 33 tests /7 failures /1 error, then the outer tool timed out after300s. No retained PID, exit or termination proof. Non-daemon-worker causation was a hypothesis, not established fact. Later passing tests do not prove that earlier process died.
- Parent's passive process metadata and empty lifecycle-test pattern query did not establish historical termination or attribute existing Python processes to tests. No process was stopped, signalled or restarted.
- Failure-safe thread fixtures now cancel, release barriers, join and assert outcomes externally while the network guard remains installed. The concrete missing-teardown defect is corrected; historical uncertainty is not erased.
- Phase A was source-only. Its requested initial34-test-only gate was not separately evidenced; later RED38 included34 pre-existing passes and final gates exercise the proof. Do not invent a missing run.

### Correction provenance

Initial independent source findings covered frontend refusal accounting, untracked direct runners, failed-prepare lease retention, mutable/inspection authority and key callbacks. Six-path correction was followed by a source-only FAIL on unsafe test teardown, activation after uncertain cleanup, repeated finalization and forged-handle callbacks in release.

Phase A `mu9v0ruj-k-2ddd` installed guarded thread fixtures and an inert nested failure proof; parent readback preceded Phase B authorization. Phase B `mu9v6bfe-l-5url` observed registry19/2 failures and lifecycle38/4 failures with exit1 before source changes. Sticky activation-failure fencing, idempotent completed cleanup and exact release validation then passed all final gates. Writer reports remain attributed; independent final evidence is above. Full hashes, earlier containment recovery and all round details remain in Git `7fb7edc`.

## TDD, containment and authorized verification patterns

TDD is ON by `AGENTS.md` §8–9 and `docs/TESTING.md`: meaningful observed RED before source, then GREEN/refactor. Coverage-only additions may honestly pass already-correct source; never mutate production to fabricate RED. Preserve coverage/readability when forecasts are exceeded.

New runtime tests must inject inert transports/stores. Install a per-test `requests.Session.request` record/refuse guard and assert no unexpected attempts outside production catches; always restore it. A deliberate guard proof must first install an inert lower transport floor. Track every test-owned thread before launch, register failure-safe cancellation/barrier release/join/termination assertions, and keep the guard through teardown. No sleeps as race proof, daemon-only workaround or swallowed callback assertions.

Use foreground commands and preserve full stdout/exit evidence, including frontend test/file counts. Stop on unexpected dispatch, timeout or surviving worker; do not cascade gates, blindly rerun uncertain commands or infer process termination. No live probes, environment-value/secret inspection, real persisted-state access, bare unittest/pytest/launcher, extra py_compile or process intervention is implicitly authorized.

### Focused backend supervisor

From repository root Bash/Git Bash, use this exact owned-Python supervisor, changing only the authorized discovery pattern. Fresh copied environment and sandbox; this is environment isolation, NOT a network sandbox.

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

Full backend: exact child-only owned-Python supervisor under **Offline-safe verification** in `services/prisma-runtime/README.md`; fresh temporary state, eleven override names removed, invoking `operations/verify-local.ps1`. Read the exact block before running. Incidental ignored test/build caches are allowed; no runtime harness with actual bots is required or authorized for mocked boundaries.

Frontend when its unit changes: `npm --prefix hmi-app test -- <frozen focused paths>`, `npm --prefix hmi-app run test:coverage`, `npm --prefix hmi-app run build`, `npm --prefix hmi-app run lint`. All four coverage thresholds70 enforced. No frontend rerun is required for a backend-only standalone unit unless the frozen verification contract says otherwise.

Parent assesses every returned writer diff, uses the returned plan (unassessable treated as high risk), obtains independent verification where required, and spotchecks a reported command before delivery. Check Git scope/index/whitespace and new untracked-file contents explicitly. Never treat a child's PASS as parent acceptance or native review authority.

## Earlier acceptance evidence — historical, not fresh gates

| Unit | Final evidence |
|---|---|
| RCA-1 `e32bef1` | Focused21 independent, full298 writer-observed; owner/age/overflow safety corrected. |
| RCA-2 `0fdfe0f` | Independent43focused/341full plus race/rollback/overflow probes. |
| RCA-3a `51ecd70` | Independent136focused/477full after three correction rounds;3059 source/test lines. |
| RCA-3b `d2fc349` | Independent74query/159bot/574full and14 probe groups;2218 source/test lines. |
| RCA-3c `42edf8b` | Independent54pairing/180bot/606full and12 probe groups;619 source/test lines. |
| RCA-4a `465321b` | Store10/HTTP9/backend611, frontend68focused/1950full202files, coverage/build/lint;320 source/test lines. |
| RCA-4b `f3ac2cb` | Independent14focused/625full;318 source/test lines, missing-master rejection before I/O. |
| RCA-4c `713f7ae` | Independent102focused/6files twice, frontend1966/202, coverage/build/lint;518 source/test lines. Root proxy tested/linted outside tsc scope. |
| RCA-5a `6301e97` | Independent56focused/681full and parent56. Four source defects plus result-extraction coverage closed;359 source+919 test lines. |

None of these counts proves live provider, production, runtime forwarding or complete remote-A acceptance.

## Delivery accounting

Strategy: `ask-on-risk`, user-selected `feature-branch-chain`. Local work-unit commits authorized; no branch/push/PR authorization. Original2270–4300 total forecast is obsolete; reforecast coherent remaining units and preserve tests/readability.

Fresh cumulative commit accounting from `6e05e38` through `7fb7edc`: **12,798 additions +465 deletions =13,263 authored lines**, including documentary work. RCA-5a commit contributed1,470; RCA-5b contributed2,525. Current planning consolidation is subsequent uncommitted documentary work, not counted yet and not a size saving.

Future PR size exception/slicing remains unresolved. Do not open a giant PR or trim coverage to meet a budget. Proposed review boundaries remain freshness, pairing, dialogue, protected credentials, transport/exclusion/runtime wiring, QR, transcript and final integration. Close each accepted ODD unit with its coherent local commit; record the actual hash/count afterward in the checkpoint rather than self-editing that commit.
