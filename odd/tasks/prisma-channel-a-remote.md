# Prisma Channel A remote — ODD tasks

## Session checkpoint — resume functional Channel A integration

**Session closed at the user's explicit request. This is a WIP checkpoint, not completion or acceptance of RCA-5. Auxiliary harness expansion is paused.** This section supersedes every historical writer, correction, or execution grant below.

### Next session: the first functional backend slice

Connect the existing dedicated bot A, pairing, HMI-owner context and current response parser so that a simulated phone conversation reaches the correct HMI data and produces a reply for that phone. Use the real start/confirmation/question flow with an offline Telegram boundary; do not manufacture a pre-linked ticket or alter private action tables.

Acceptance for this bounded slice: the correct linked HMI supplies a fresh answer; expired/unlinked authority or stale context is rejected. First inspect only the missing integration seams and the existing unaccepted identity-handoff delta. Agree on the minimum safe verification for that slice; do not automatically resume clock-harness work or launch broad discovery through known-unsafe/unreviewed fixtures.

- Scope is **Channel A only**, not general runtime cleanup or Canal B development. Preserve shared identity/exclusion compatibility where A actually depends on it.
- Keep the current parser and existing audio capability; no new NLU/STT, offscreen data, industrial commands or live provider calls.
- QR/link presentation and remote response text/audio presentation remain later RCA-6/RCA-7 work. Finish remaining RCA-5 integration first, then pause and notify before RCA-6.
- Read `decision/prisma-channel-a-scope-reset`, `checkpoint/prisma-channel-a-implementation-progress` and this section before any older detailed plan.

### Saved verification limits

| Saved work | Status at closure |
|---|---|
| RCA-1–4 and RCA-5a–5c | Accepted offline and committed previously. |
| RCA-5d(i) identity handoff | Implemented; independent acceptance still pending. |
| Transport fixture cleanup | Independent cleanup13 and transport56 passed. |
| Generation / warning fixture cleanup | Independent inert29 and inert12 passed; not native whole-pairing acceptance. |
| `test_channel_a_pairing_clock_cleanup.py` | Author reported14 cases and no commands. Parent has not reviewed or executed this candidate; save as unfinished work, not the next automatic task. |
| Native pairing54 / full backend / full Channel A | Not freshly verified; known fixture gaps and incomplete integration remain. |

No tests, providers, runtime services or new implementation are to be executed for this checkpoint. The historical checks below are not new results. The checkpoint commit preserves unfinished source/tests and is **not** a delivery-ready or reviewed product claim.

- Branch: `feat/prisma-telegram-credentials`.
- Latest accepted commit: `43ca2657118e389a7190d90fe290eb8c376bff1a` — standalone Channel A activation runner. Three files,4351 additions/156 deletions=4507 authored lines; core4138. Parent observed clean Git immediately after commit; this later planning/accounting update is parent-owned.
- Verification chronology, first-failure details and scoped acceptance remain in the historical sections and verified Engram archives below. Do not treat historical GREEN results as acceptance of the current full candidate, or old agent grants as permission to resume auxiliary work.
- Full remote A remains unwired. A credentials, domain, transport and B's shared-reservation integration do not establish operational A/B exclusion or full-product acceptance.

### Authority and workflow

Latest user instruction: commit the current work, close this session, and record the functional Channel A restart point. This explicitly authorizes a local WIP checkpoint; it does not approve the unfinished implementation or authorize further harness work. The longer-term boundary remains: finish all RCA-5, then pause BEFORE RCA-6. No push, PR, branch creation, paid/live Telegram/Gemini tests, deployment or runtime restart is authorized.

User approved distinct A/B bots operating concurrently: the incumbent observed-identity reservation wins and a conflicting activation is rejected. No automatic takeover or permanent cross-channel stop. Development-only channel stopping is permitted if necessary, but does not authorize credential deletion, state reset, restart or provider calls. No operational stop has occurred.

Parent owns this tracker, its full Engram mirror, acceptance and commits. Delegation is optional under revised AGENTS.md; earlier pairing-proof editing grants are historical and do not reopen the paused auxiliary work. Keep one writer and independent verification. Freeze each unit's exact paths, behavior, TDD and commands before launch. About 400 authored lines is advisory, not permission to omit tests, minify or split incoherently. Native assessment unavailable/unassessable means independent verification, never invented approval.

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

### RCA-5c accepted contract — historical reference

Full contract archived before consolidation in verified Engram topic `evidence/prisma-rca5c-accepted-contract` (6,980 contract characters, excluding terminal blank separators), also preserved at `43ca265:odd/tasks/prisma-channel-a-remote.md`. Historical grants are NOT current authority.

Preserve lazy validated construction; once-observed identity, owned reservation and fresh dialogue/empty registry/epoch; no lifecycle lock over foreign calls. Closed errors/four-field status, serialized admission and sticky terminal fences remain mandatory. Register startup/activity ownership before dispatch; no self-join; retain exact lease on uncertain quiescence/release, retry safely and finalize idempotently.

Cursor remains activation-local. Validate the entire bounded ordered batch, suppress stale/duplicate IDs, atomically fence/reserve before handling, publish each completed outcome once, retain completed prefixes and never replay unknown effects. Returned prefixes are observational, not publication instructions. Seven-day monotonic retirement is conservative LOCAL protection, not lossless provider reset recovery; no automatic replacement or operational wiring. The later identity-handoff delta is separately frozen below.

#### Tests, execution and deferred work

Historical scaffold: q's221-line candidate was rejected before execution for unsafe refusal/teardown/proof design; r's415-line correction passed parent readback and3 harness tests/0.003s. That proved the scaffold, not runner behavior. Full original scope, blob and corrections remain in `43ca265:odd/tasks/prisma-channel-a-remote.md`. Historical grants are not current authority; release uncertainty must still retain the owned handle.

First install per-test request record/refuse guards with external cleanup assertions, inert fake sessions and failure-safe owned-thread teardown before any test can dispatch. Prove guard discrimination only over an inert lower floor. No imported unsafe thread helper or daemon-only escape. Strict RED-first staged behaviors; distinguish initial missing-module RED from later behavioral failures.

Cover constructor laziness/validation/bounds, identity-reservation-factory order/collision, real fresh factories and no old-link transfer, entire-batch validation/gaps/duplicates/cursor maximum, ignored/unknown/error outcomes, consumer prefix/handoff/no replay, clock/idle boundaries and stalled requests, direct/managed/poll exclusion, all stop/reentry/startup races, release uncertainty/retry/idempotence and sanitizer canaries. Register cancellation/release/join before launch; external outcomes cannot be swallowed by production catches.

Historical RCA-5c used the seven focused patterns and exact README backend supervisor; complete gate authority/evidence is retained at43ca265. Current execution requires a fresh phase-specific grant under the containment rules below; historical grants never authorize replay.

Deferred: actual credentials/manager/bootstrap, automatic replacement, warning scheduler, persisted policy/admin, safe HTTP projections, ordered view invalidation and HMI publication. A later warning seam must acquire this same owned-operation admission; do not expose arbitrary raw-dialogue operations now.

#### RCA-5c candidate and confirmed TDD deviation

Permanent provenance: writer `mu9xlqa1-s-28wt` wrote COMPLETE source922 BEFORE behavior tests1749 and the first71-test RED (15 failures/3 errors); ZERO earlier behavioral/missing-module RED existed. Later fixes cannot repair that initial TDD violation. Initial candidate2671 authored lines includes415 scaffold;2256 was an incorrect subtraction. Reported492/801 GREEN was not independent acceptance. User **Verificar el candidato** authorized independent assessment, not a TDD waiver or approval. Preserve test-only/readback/observed RED/separate source authority for later work. Full original blobs, counts and chronology remain in `43ca265:odd/tasks/prisma-channel-a-remote.md` and Engram `decision/prisma-rca5c-tdd-deviation`.

#### RCA-5c correction history — preserved

Lossless detail is in `43ca265:odd/tasks/prisma-channel-a-remote.md` and verified Engram topic `evidence/prisma-rca5c-correction-chronology`. Initial independent review stopped before execution on unsafe managed-worker capture. Test-only corrections established prelaunch ownership, external failures and post-join checks; genuine89/90-test RED (10 failures/8 errors) covered callback fences, release exclusion, sanitization, exact outcome IDs and busy preparation. Source-only fixes passed511/820 before a broader review found the three residual races/bounds defects summarized below. Initial TDD noncompliance remains permanent.

Historical recovery had no test execution/in-flight command, but disclosed shell source-read/venv inspection deviations. A later shell grep and gate-count/net-growth misstatements were separately corrected: eight writer gates, no hidden retry; net growth is not authored diff. Full raw tool output was retained while handoffs condensed tracebacks. No current authority derives from these historical launches.

#### RCA-5c final residual correction and acceptance

Complete intermediate chronology is preserved in verified Engram topic `evidence/prisma-rca5c-correction-chronology`; compaction removes no evidence. Independent11 found atomic cursor-admission, stale settlement and huge-int conversion defects despite511/820 GREEN. Parent rejected fixture counter collisions/unrecorded waits before execution; corrected tests then produced independent95-test RED (2 failures/1 error,0.087s). Subsequent source-only correction preserved frozen tests and reached all prefix/cursor/idempotence assertions. Initial TDD noncompliance and tool-discipline deviations remain permanent.

- Writer16:516 focused/825 backend PASS, eight invocations once each.
- Independent17: source/full-contract review and seven focused suites (95/56/180/54/74/19/38=516) PASS. Its malformed full supervisor had an extra `]`: parse-time SyntaxError, no supervisor body/backend child executed; stopped without retry.
- Explicitly reauthorized independent18: exact README backend825/24.211s PASS, canonical exit0. Combined technical PASS; nine attempts total (seven focused, one failed prelaunch, one successful backend). No unexplained retry or provider claim.
- Parent: exact isolated lifecycle95/0.084s PASS; actual final source readback, matching hashes, expected scope/empty index and explicit untracked whitespace checks. No unexpected dispatch/timeout/surviving worker/cleanup failure.

**Parent accepts RCA-5c OFFLINE only.** Source1031 SHA256 `bbb84bb7b915b2fac10a485f23992ed0a5219d52d7330f73791f02bba4d6a3ae`; tests3107 SHA256 `b55ab76039610e05fb29375e4ff20465fc7557174e478ca90ba16a907c66144e`; total4138 new/authored lines. +18 net source growth is not an authored correction diff. Native assessment remained unavailable/unassessable; no native approval. Commit identity/count follows in the progress checkpoint. Remaining RCA-5 wiring and all RCA-6 work remain incomplete.

### RCA-5d(i) frozen contract — validated identity handoff

A bounded integration extension of the accepted standalone runner, before query composition. Eventual source scope: `services/prisma-runtime/src/prisma_runtime/channel_a_lifecycle.py`; tests: `services/prisma-runtime/tests/test_channel_a_lifecycle.py`; tracker remains parent-owned. Baseline `43ca265`, source1031/bbb84bb7… and tests3107/b55ab760… (95 cases). No composition, bot/query module, clock API, HTTP, manager, persistence, UI or B changes.

- Read observed identity ID/username once, validate existing exact types/ranges/ASCII grammar, then construct a NEW exact-base frozen `ChannelABotIdentity` from those locals BEFORE acquisition. No raw provider object/subclass, rereads, duplicate lookup, token-prefix identity or hidden state.
- Preserve clock/getMe/validation/fence/acquire/fence order and ownership. Invoke the trusted factory once with exactly ONE positional argument: that immutable validated projection. Preserve its ID/username through an acquisition callback mutating the raw observation. No token/lease/owner/epoch in the projection.
- Keep dialogue ID/registry/identical-transport validation and every stop/failure/release invariant. Zero-argument-only factories now fail canonically without compatibility fallback, retry or signature inspection. Status remains four fields; no new public identity getter. Keep existing derived private `_bot_id`; no unnecessary retained-field swap.
- Test-only migration of ten actual legacy factory definitions may tolerate/record zero-or-one argument solely to preserve old behavioral assertions while observing missing projection. Do not make invalid non-callables callable. New cases must pin one positional argument, exact base type, distinct immutable snapshot, once-only accessor reads, mutation stability, sequence/lease ownership, no factory on conflict/stop/invalid identity, zero-arg refusal and mismatch/factory-failure cleanup. Callback assertions run externally; guard/ownership harness unchanged.

Historical identity-handoff authoring/audit and gate provenance is preserved verbatim in Engram topic `evidence/prisma-rca5di-identity-handoff-provenance` (5,346 characters verified before consolidation). Historical grants are not current authority. Independent1d observed108/99 PASS/9 FAIL/0 ERROR/0.081s/exit1 before source correction; parent then changed comments only, without replay. Writer1e subsequently reported529 focused and838 backend PASS once; not independent acceptance. Forbidden shell reads and withdrawn TDD/no-command/no-match claims remain preserved, not waived.

Current identity source SHA256 `2148a98aae4b9881ee3e31b30ca42dd996bbca2f6dc00db44c586201709c0759`, tests `726ae77783c6976b47dc1a39ecea9f94dae108379b6d5b4ad6de558ff379ea56`; source28+6=34, tests564+16=580, core614 authored lines. Tests108. The identity contract above remains active; acceptance and remaining composition remain blocked by fresh safety/verification prerequisites.

Independent `mua4y203-1g-vlh1` finished BLOCKED, **0/8 gates executed**. Lifecycle source/harness review passed with no candidate defect found; source/tests hashes unchanged. Auxiliary `test_channel_a_transport.py` concurrency cases (~860–868,906–913) lack unconditional event release/barrier abort, joins and liveness/error checks when body/start fails. Sessions are inert; no provider dispatch inferred. Its clarification query timed out; later parent reply was unavailable because the task had completed. Safety remains gate-wide, not waived by user `continua`. The separate95/516/825 malformed-supervisor message matches recorded5c history, not this108/529/838 candidate; no new retry authorized.

Planner `mua5lrgr-1h-pl31` confirmed the NEW cleanup-test path is absent and transport concurrency methods lack unconditional cleanup; that module has no base teardown/guard. Frozen prerequisite Phase A: author ONLY NEW `services/prisma-runtime/tests/test_channel_a_transport_cleanup.py`, no execution. Run actual existing methods through a module alias and nested TestResult with module-local inert Thread/Event/Barrier doubles. Controlled inline targets are allowed ONLY with nonblocking fake waits/inert sessions (never real thread launch), including survivor and BaseException cases; assert errors externally. Use package-aware imports, not broad ImportError fallback or direct TestCase imports. No sleeps/enumeration as ownership proof. Preserve dispatch refusal and unconditional restoration.

After parent safety readback, authorize ONE exact supervisor with cleanup-only pattern for genuine RED against unchanged transport tests; no unsafe real-thread baseline. Separate Phase B later may repair ONLY the two existing transport concurrency methods, with prelaunch ownership, release/abort, all joins before liveness/error checks, and externally observed wait/error outcomes. No production edits. Static review precedes cleanup-proof GREEN and real transport gate. Auxiliary inventory1k confirmed pairing/bot/reservation gaps; parent also corrected its missed partial-start failures and the serialization method name. Three pairing waits are unbounded. Query has no raw workers in the scoped scan. Detailed ledger: `incident/prisma-auxiliary-test-worker-cleanup`. Freeze separate repairs; no full-backend authority until known gaps are resolved. No full-backend run is authorized by this prerequisite. Lifecycle candidate stays frozen/unaccepted and composition waits. Detail: Engram `incident/prisma-transport-test-worker-cleanup`.

Proof-authoring history1i–1o is archived verbatim in verified Engram `evidence/prisma-transport-cleanup-proof-staging` (5,200 characters); reported shell-command audit remains in `incident/prisma-transport-test-worker-cleanup`. No version ran before1p below. Preserve the permanent false-TDD/no-command claims, unauthorized shell reads, rejected erased counters and misleading `.invalid` containment claim; later correction does not erase them.

First-RED proof baseline SHA256 `b6f950600c2741927d667b7a5498210b069e69728bc52b9801d3038a1bad5e45` (later1t additions authorized below). Its controls retain all evidence, expect four intentional guard-cleanup failures plus the body failure, and distinguish actual liveness/unblock/TestResult observations from fake state. All relevant waits/joins are bounded; complete controls discriminate genuine cleanup failures. Parent requires unblock-before-join and all joins before cleanup assertions; earliest necessary release suffices. Planned survivor reporting uses standard TestCase assertions after collected liveness, not a universal ban on other exception types. Native assessment remains unassessable; forecasts never authorize coverage trimming.

Transport cleanup chronology1p–1y is archived verbatim in `evidence/prisma-transport-cleanup-proof-staging` (7,295 additional characters verified before consolidation). This preserves rejected fixtures, audit deviations, intermediate hashes and first-failure/unreached-assertion distinctions. Independent RED:1p8/3 PASS/5 FAIL/0 ERROR/0.005s;1v13/9 PASS/4 FAIL/0 ERROR/0.007s, both exit1/once. After correction/static review, independent1y observed proof13 and realtransport56 PASS once each/0.007s/exit0. Full raw responses retained, handoffs condensed; no retries.

Parent accepts ONLY this transport test-cleanup prerequisite offline. Final fixture SHA256 `eafad6f3493accbcc274a57ec8b7278f4bbfa4d9de2e2b8df4bc2ccfc37cc609`,256+22=278 authored vs HEAD; proof `3ef47516836d208fe712b4538bc354c155bf44cfeb7d1261237ea9534587e9e5`,13 cases. Some cleanup-operation exception paths have static, not exhaustive dynamic coverage. No lifecycle/product acceptance or commit; other auxiliary fixtures still block backend. Historical grants are not current authority.

Pairing planning corrections and expired29-case grant are archived verbatim in Engram topic `incident/prisma-auxiliary-test-worker-cleanup` (2,870 characters verified before consolidation). Actual generation methods310/338/362 use2/2/4 worker-only barriers, no main wait; existing lists own workers before launch. At that baseline, failure unwind, unbounded waits and short-circuiting liveness were defects; the generation correction below now passes its inert proof. Whole54 remains blocked by other gated-clock/warning cases.

Pairing proof authoring/recovery22–2a and direct-edit authorization are archived verbatim in verified Engram `evidence/prisma-pairing-proof-authoring` (7,368 characters). Preserve rejected syntax/oracles, forbidden shell audits, partial writer delivery and runtime one-file-per-turn refusal; historical grants are not current authority. Independent26 passed only four controls on e33. User then authorized parent correction and removed mandatory repository delegation; safety/TDD/independent checks remain. The completed29-case matrix and current evidence follow.

Generation2b–2f history archived verbatim (3851 characters, verified before consolidation) at `evidence/prisma-pairing-generation-cleanup-staging`. Frozen proof `f596b9f1941ad7aad571361651d6ea96836959780d0d6c9a1f08703f3d9a086e`,29 methods/four controls. Independent2c meaningful RED29/7 PASS/22 FAIL/0 ERROR/0.021s/exit1 preceded93 authored fixture lines; independent2f FIRST GREEN29 PASS/0 FAIL/0 ERROR/0.015s/exit0, once each. Bounds/abort/ownership/all-joins-then-all-liveness/combined-causes/sole-body identity retained. Full first-failure/unreached-assertion evidence and acceptance limits: `evidence/prisma-pairing-cleanup-first-red`, `evidence/prisma-pairing-generation-cleanup-verified`. Acceptance is ONLY INERT generation-fixture cleanup, not native54/backend/lifecycle/product. No generation rerun occurred for the later warning-only correction. Warning staging2g–2i/initial2j grant is preserved verbatim (2950 characters, verified before consolidation) at `evidence/prisma-pairing-warning-cleanup-authoring`. New proof:230 lines/12 cases, SHA `cf4644e54493f8bae3e7b81403e14dd7b570e4c68fc2d82b8194a38ba7486621`. Two workers+MAIN Barrier(3), all waits/joins already bounded. Clock/delayed-touch staging remains separate; inline fake waits cannot prove their paused-stack ordering.

Independent `muak2bek-2j-tb4a` FIRST warning RED ONCE: **12/3 PASS/9 FAIL/0 ERROR/0.014s unittest/exit1**. Two healthy callers and first-launch exact error preservation PASS. Nine first failures expose missing abort/unwind, worker error escape into inert ledger, skipped join and short-circuited liveness. Unreached final diagnostics are NOT observed failures; exact per-case evidence at `evidence/prisma-pairing-warning-cleanup-first-red`. Eight full hashes matched pre/post, expected6 modified+3 untracked, raw output untruncated, no unexpected boundary/model/import/restoration/dispatch/launch effects. Three foreground120s Bash invocations=5 metadata commands+1 exact supervisor; no retry/wall-time claim. Gate exhausted; no acceptance.

Warning correction2k/static2l/initial2m grant archived verbatim (1952 characters, verified before consolidation) at `evidence/prisma-pairing-warning-cleanup-correction`. Only WarningSweep._race changed:70 additions+13 deletions=83 authored, preserving both callers/imports/generation/clock. Current fixture SHA `7b792a6d92c622a78f6602dcb6fb1fcceab34aba5cc77f1e363884dc864ef136`; both proofs frozen.

Independent `muakpxeo-2m-frev` FIRST warning GREEN ONCE: **12 PASS/0 FAIL/0 ERROR/0.009s unittest/exit0**. All three controls and formerly unreached final identity/kind/combined-marker/actual-survivor/join/abort/report-order assertions completed. Eight hashes matched pre/post; expected scope, full raw output untruncated, no unexpected guard/model/import/restoration/dispatch/launch effects or retry. Three foreground120s Bash invocations=5 metadata commands+1 exact supervisor; no wall-time claim. Parent accepts ONLY INERT warning-fixture cleanup; detailed evidence at `evidence/prisma-pairing-warning-cleanup-verified`. No native54/backend/lifecycle/product acceptance or commit.

Planner `mual4g13-2n-69fq` completed read-only. Parent corrected its invalid zero-target-call oracle: run()/target() already execute BEFORE entering the gate. A transparent gate subclass can observe normal __enter__ return (critical-section admission), NOT internal acquire attempts; guard-before-acquire remains separately static-checked. There are THREE other _race callers. No registry-wrapper restoration requirement or fake healthy clock interleaving.

Historical clock-proof scope, now PAUSED with no execution authority: author `muambawn-2o-0ljp` completed ONLY NEW `services/prisma-runtime/tests/test_channel_a_pairing_clock_cleanup.py`; full verified contract at `plan/prisma-pairing-clock-cleanup`. Fourteen outer cases:1 new seam control;2 actual-path first-launch controls;5 fault modes on EACH claim-helper/direct-delayed path (worker wait BaseException alone or with main wait, release.set, join, survivor);1 shared-gate False-return fail-closed case. Reuse old harness/floors/guards/model/oracles via module alias; add only explicit Event/current identity and faithful test-local gate observation. No RLock/source-domain/callback behavior replacement, copied targets, deferred/native workers, synthetic clocks or ledger clearing. False-return oracle requires no held-worker admission and source TimeoutError from BEFORE inner acquire; it must fail against current source, not change after correction. Callback invocation is honestly one in started fault paths. No pure-main dynamic identity claim where the model necessarily has worker+main causes. All cleanup/evidence precedes final outcomes; zero-start release optional. Eight existing files frozen, no fixture repair. Author read/grep/find/ls/edit/write ONLY; no commands/import/compile/tests/probes/memory/subagents. Parent readback and fresh independent STATIC precede separately authorized ONE inert RED. Complete RCA-5 before RCA-6.

Composition is a separate later contract: one identity source (factory argument), fresh registry/dialogue, owner context and real parser. Proposed additive `enable_queries(clock=None)` DI must be separately authorized; HMI context uses wall clock, pairing/query deadlines monotonic. Never assume negligible elapsed time. Derive answer bound from accepted `MESSAGE_MAX_CHARS=4096`; warning default60/range15–300 already decided, label remains injected. No RCA-6 work begins here.

### Later coherent units — provisional order

| Boundary | Work and dependencies |
|---|---|
| Identity-to-factory prerequisite | RCA-5d(i) candidate: genuine RED then writer529/838 GREEN; independent0/8 blocked by pre-existing transport-test cleanup. Resolve safety prerequisite before verification/acceptance. |
| Query/context composition | After the prerequisite, attach `enable_queries` once with owner context, existing parser and accepted bounds; preserve returned envelopes for later publication. Resolve deterministic coordinator-clock injection; never assume negligible elapsed time in tests. |
| Ordered view invalidation | Add precise client intent/order and server context identity, reject late old publications, compose session removal, revalidate captured identity before phone/HMI effects. Must finish in RCA-5, not be skipped because QR could otherwise render. |
| A policy and administration | Persist warning lead in a small A-specific policy, not DSP-only voice configuration. Use existing A admin section and backend session/CSRF. Explicit Apply/status, never auto-start on credential save. Preserve B's exact wire shape. |
| Viewer pairing projection | Capability-scoped DTOs, no second login. Do not expose raw `as_dict()` owner/phone/generation authority fields. QR token is intentionally required for its deep link, unlike HMI capability or bot credentials. No inputless-HMI manual release control; compose internal owner removal and retain phone unlink. Freeze HTTP method/cache/idempotence details separately. |
| Scheduler/proxy/bootstrap | Own polling/warnings and cleanup; deterministic cold-start behavior with shared A/B registry. Exact route/method proxy allowlist, origin/host checks, no-store policy and browser-routing docs. No actual service restart or provider validation in offline implementation. |

### View ordering: rejected shortcuts

Exporter abort/single-flight and session-client response fences do not prove server arrival order. A prior `g <= last` rejection cannot also support invalidation then publication at the same generation. The corrected mapper is still insufficient: clearing context on invalidation without advancing an ordering watermark allows a late older publication to resurrect it; same-generation publications also need explicit ordering semantics.

Required design traces include old publish after newer invalidation, invalidation then replacement publish, replacement publish before delayed invalidation, same-view publication reordering, StrictMode/reset and undelivered navigation. Distinguish pairing generation, adapter epoch, client view intent/order and server captured context revision. A phone answer already delivered cannot be retracted; HMI publication still must fail closed. No new heartbeat. Detailed prior topic: `architecture/prisma-channel-a-visible-context-invalidation`.

## RCA-5b acceptance and incident record

Historical independent `mu9vwj2e-m-g4d4`: PASS/no remaining blocker. Backend172 focused (registry19/lifecycle38/diagnostics37/credentials10/Telegram HTTP13/local presentation14/runtime safety32/credential HTTP9),730 full; frontend81/5 files focused,1,973/202 full, all PASS. Coverage S87.17/B80.26/F86.32/L88.05%, all>=70. Build/lint PASS; canvas/grid/chunk advisories are not failures. All16 candidate hashes stable before/after; tracker parent-attributed. Parent exact isolated lifecycle38/0.024s PASS plus source/scope/hash/whitespace/empty-index checks.

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

Fresh Git range `6e05e38..43ca265`: **16,740 additions +212 deletions =16,952 diff lines**, including documentation. This range diff is not the sum of per-unit authored counts. RCA-5c's own commit is4351 additions+156 deletions=4507 authored lines. Remeasuring `6e05e38..7fb7edc` gives12,545 additions+212 deletions=12,757; the earlier12,798/465 report was not reproduced and is superseded, without inventing a cause or altering history. Current post-commit planning changes are not included. Compaction is not a review-budget saving.

Future PR size exception/slicing remains unresolved. Do not open a giant PR or trim coverage to meet a budget. Proposed review boundaries remain freshness, pairing, dialogue, protected credentials, transport/exclusion/runtime wiring, QR, transcript and final integration. Close each accepted ODD unit with its coherent local commit; record the actual hash/count afterward in the checkpoint rather than self-editing that commit.
