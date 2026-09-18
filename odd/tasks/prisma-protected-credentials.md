Repository-relative file: odd/tasks/prisma-protected-credentials.md

# Prisma protected administrator authentication and provider credentials

## Current status — PAC-5 complete and accepted offline

`PAC-1` through `PAC-4B`, the `PAC-4` umbrella, and now `PAC-5` are complete offline. Independent
verifier `ses_f4ab3eba7ffeF6KSertcHHo3LD` returned COMPLETE PASS after closing all four PAC-4B
findings without correction regressions, and the parent accepted PAC-4B and the PAC-4 umbrella
offline. Independent verifier `mu7e3sey-q-bwyw` then passed all six integrated PAC-5 gates once,
with Git status and `HEAD` unchanged before and after. Final independent documentary readback
`mu7f1mcu-v-6et3` closed the remaining documentation findings; the parent accepts PAC-5 offline.
No production readiness or full layer-coverage claim is made.

PAC-4A acceptance is based on independent authentication verifier
`ses_f4b473e58ffeudIYvT20yFJNVZ`, the final parent spotcheck, and the current canonical backend gate.
All known PAC-4A functional and security findings are closed offline.

One pre-existing runtime setup race remains a visible warning: concurrent state seeding can reach a
check-then-copy window before manifest locking and produce a temporary `Copy-Item` sharing violation.
The authorized read-only diagnostic did not change source and did not claim the race fixed. Its
isolated reproduction passed once, and the required canonical backend gate then passed completely.

### PAC-5 integrated offline evidence

- Full HMI verification: **1924 tests in 202 files** in 61.17 s; coverage **86.79 % statements
  (13472/15521), 80.12 % branches (10010/12493), 86.07 % functions (3189/3705), 87.66 % lines
  (12724/14514)**; enforced global 70 thresholds all passed.
- TypeScript/Vite build (**2734 modules** in 8.98 s), ESLint, and `git diff --check`: PASS.
- Canonical backend gate `services/prisma-runtime/operations/verify-local.ps1`, invoked once with
  the exact unchanged canonical PowerShell argv: **240 tests in 16.673 s**.
- `repo.venv` Python `-B -m pip check`: no broken requirements.
- Retained warnings: jsdom `canvas.getContext`, unresolved `/grid.svg`, large chunk `main
  1592.99 kB`, and CRLF advisories. The `services` layer branch coverage is 80.92 % and does not
  meet the 90 % `docs/TESTING.md` layer target; the enforced global pass does not claim every
  layer target met.
- The `PW-002` pre-lock `Copy-Item` race did not recur during PAC-5 but was **not** fixed and
  remains active.

### Backend ambient-safety caveat

The ambient backend gate was **not** run. Source preflight found an inherited legacy provider key
and an import-time real default voice configuration, so verification ran inside an approved
child-only Python `TemporaryDirectory('prisma-pac5-')` supervisor that set child
`PRISMA_RUNTIME_STATE_DIR` and cleared the exact ambient overrides (`PRISMA_VOICE_CONFIG_FILE`,
`PRISMA_CREDENTIAL_MASTER_KEY_FILE`, `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`PRISMA_LOCAL_TELEGRAM_ENABLED`, `PRISMA_LOCAL_TELEGRAM_BOT_TOKEN`, `PRISMA_LOCAL_SNAPSHOT_FILE`,
`PRISMA_LOCAL_STATE_FILE`, `PRISMA_LOCAL_VOICE_URL`, `PRISMA_PUBLIC_ORIGIN`,
`TELEGRAM_BOT_API_BASE`), then invoked the canonical PowerShell argv once. Fixtures used fake
providers and listeners, and native ACL tests stayed temp-only. The parent/live environment was
unchanged and owned temporary state was cleaned. The runtime README documents the reproducible
offline-safe verification wrapper; an unsandboxed runner is not an isolation claim.

### Separate limited local evidence (parent-confirmed, not independently repeated in PAC-5)

- Windows ACL helper correction (DirectorySecurity Owner+Access reads with
  `Directory.SetAccessControl` persistence, policy unchanged): 9 permission tests, 18 auth tests,
  and 2 traceback probes PASS; the actual auth-directory repair and VerifyOnly passed
  non-elevated. Tracked in [`windows-acl-helper-remediation.md`](windows-acl-helper-remediation.md).
- Administrator fetch receiver correction (`fetch.bind(globalThis)` preserving injected
  transport): receiver-sensitive RED, then 33 tests plus lint/build PASS; the user confirmed the
  native local Chrome admin login. Tracked in
  [`prisma-admin-fetch-receiver.md`](prisma-admin-fetch-receiver.md).
- A fresh protected master key and empty ciphertext store were provisioned with separate explicit
  user approval; independent metadata, 32-byte size, ACL, and key-database binding checks passed,
  with both providers initially unconfigured.
- The existing external `.bat` received one added setting for the key **path**, not its contents.
  The user stopped the old dev session with Ctrl+C; a read-only snapshot confirmed ports
  5173/5056/5057 free before the user relaunched the updated batch. The latest Voice screenshot
  shows the red banner gone and both providers "Sin configurar". Telegram is enabled but stopped,
  with no token and desired/applied generations `1/0`; this is not provider-connectivity evidence.
  User paths, cookies, passwords, and secret bytes are deliberately absent from documentation.

### Delivery state

The accepted PAC-4 umbrella was delivered as local commit `46f3303` on
`feat/prisma-telegram-credentials`, based on `b5fcaf2`. The subsequent ACL-helper and
fetch-receiver source/test corrections were then delivered as observed local commits
`41dc286` and `0cdf345` on the same branch with explicit user authorization; the
pre-existing external `.gitignore` modification was excluded. Delivery identity for
these reconciled documentation updates is recorded by the parent through Git and the
canonical Engram checkpoint, rather than embedded in this self-referential tree; no new
commit is invented here. Push, merge, backend production work,
dependency changes, provider actions, and production acceptance remain separate parent decisions.

## Stable work packages

- [x] **PAC-1 — Backend administrator authentication and offline recovery.**
  - [x] **PAC-1a — Validate login JSON shape and types before authentication.**
- [x] **PAC-2 — Encrypted credential store and protected API.**
- [x] **PAC-3 — Adopt stored credentials at provider-consumption boundaries.**
  - [x] **PAC-3A — Adopt Gemini through the event-bound paid invocation path.**
    - [x] **PAC-3A-S1 — Establish server-owned HMI document-session isolation.**
  - [x] **PAC-3B — Adopt Telegram through explicit desired/applied lifecycle semantics.**
- [x] **PAC-4 — Integrate HMI administrator flow and Voice credential fields.**
  - [x] **PAC-4A — Unified administrator authentication, transport, proxies, and tests.**
    - [x] **PAC-4A-1 — Service/controller behavioral tests.**
    - [x] **PAC-4A-2 — Backend-validated authority replaces local credential authority.**
    - [x] **PAC-4A-3 — Bounded admin HTTP client and private CSRF handling.**
    - [x] **PAC-4A-4 — Privileged rendering and lifecycle gates.**
    - [x] **PAC-4A-5 — Central administrator exit and durable manual-login barrier.**
    - [x] **PAC-4A-6 — Exact development proxies and integration tests.**
  - [x] **PAC-4B — Credential UI, diagnostics, explicit actions, and tests.**
- [x] **PAC-5 — Independently verify and reconcile active documentation.**

## Objective and fixed boundaries

Prisma owns backend administrator authentication, encrypted Gemini and Telegram credentials, and
provider consumption without trusting browser roles or exposing secrets. Routine startup remains
unattended. The HMI remains an observer: no industrial control or process writes.

Included:

- Application-owned administrator authentication on Windows and Linux.
- A separately provisioned 32-byte installation master key protected by OS permissions.
- Encrypted provider credential storage and metadata-only administration.
- Authoritative protected-mode Gemini and Telegram credential selection.
- Anonymous, server-issued browser-document authority and per-session Prisma state.
- Bot-scoped Telegram pairing, acknowledged offsets, and one managed local poller.
- Event-bound TTS, bounded shared execution, and strict offline verification.

Excluded:

- Viewer accounts, durable personal chat, identity across reloads/tabs, or account migration.
- Cloud vaults, keyrings, bundled keys, `.env` secret persistence, or per-start prompts.
- Telegram-to-HMI identity, chat UI, broadcast, or automatic paid audio.
- Industrial writes or treating snapshot/question ingress as real-world identity proof.
- Live-provider, FFmpeg, deployment, TLS/proxy/supervisor, backup/restore, native-Linux,
  clean-installation, multi-process Telegram, or forced-thread-termination acceptance.

## Security and session constraints

- `prisma_runtime.local_presentation` owns `/api/prisma/admin/*`; HMI role state never authorizes the
  backend boundary.
- Admin sessions use opaque random cookies, digest-only storage, strict Origin/CSRF checks, bounded
  throttling, and `Cache-Control: no-store`.
- The credential database contains AES-256-GCM ciphertext and metadata only. Unknown formats,
  malformed rows, wrong keys, and corruption fail closed.
- A nonblank `PRISMA_CREDENTIAL_MASTER_KEY_FILE` selects protected mode. Missing or unavailable
  protected credentials never fall through to legacy environment values.
- Browser document capabilities remain memory-only, digest-only server-side, owner-partitioned,
  bounded, non-durable, and invalid after revocation, expiry, or process restart.
- Capability failure precedes credential reads, paid work, queue admission, and provider I/O.
- Telegram remains installation-snapshot, private-text-only, and separate from HMI sessions,
  events, Gemini, TTS, FFmpeg, and audio.

## PAC-3 accepted operating contract

### Gemini and document sessions

- Protected mode resolves only the stored Gemini secret and never falls through to
  `GEMINI_API_KEY` after absence, deletion, unavailability, wrong key, or corruption.
- Health, credential mutation, and startup do not contact Gemini.
- Each HMI document receives an anonymous server capability retained only in memory.
- Capabilities partition question state, view context, events, replay, audio, cancellation, and
  navigation. They are not accounts, device identity, or protection against bearer theft.
- Reload creates another document session. State is bounded, non-durable, and not multiworker.

### Telegram state and polling

- State schema v2 keys records by canonical decimal bot ID and stores only paired private chat IDs,
  next acknowledged offset, and migration state.
- Legacy root allowlists are never imported. A new bot remains migration-fenced until its initial
  backlog drains; pairing then requires a fresh `/start`.
- Same numeric bot identity retains pairing and offset across token rotation. Different bot IDs do
  not share pairing or offsets.
- Whole response batches are validated, ordered, deduplicated, and filtered before handling.
- Offset advances only after handling and required sends. Delivery is at least once, not exactly
  once, because a crash after accepted delivery but before persistence may repeat a response.
- Only private text input is supported. Telegram remains separate from HMI identity and paid audio.

### Telegram desired/applied lifecycle

- `PRISMA_LOCAL_TELEGRAM_ENABLED=1` is the explicit opt-in. Disabled startup resolves no secret.
- Protected mode resolves only the stored Telegram secret. Legacy environment input is available
  only when protected mode was not selected.
- One manager owns desired/applied generations, serialized transitions, cached status, and at most
  one poller. Passive status uses a separate short-held state lock.
- Save changes desired state without provider contact or restart. Apply stops and confirms the old
  poller before constructing a replacement.
- Failed apply remains unapplied and retryable. Public errors are stable, allowlisted, and sanitized.
- Delete commits absence before stop/join. A timeout returns `TELEGRAM_STOP_TIMEOUT`, retains
  ownership, remains restart-required, and never claims thread termination or starts a replacement.

| Field | Meaning |
|---|---|
| `desiredGeneration` | Latest process-local generation after startup configuration or committed mutation. |
| `appliedGeneration` | Generation that reached a complete running or confirmed-stopped outcome. |
| `configured` | Selected source had a nonblank token when last resolved or mutated. |
| `running` | Owned poller is observed alive without a stop request. |
| `verified` | `getMe` succeeded during apply; not continuous connectivity proof. |
| `restartRequired` | Desired and applied generations differ. |
| `lastError` | Stable allowlisted sanitized code only. |

### PAC-3 boundary and evidence

- Existing generic credential routes remain the mutation boundary. Telegram PUT saves desired-only;
  DELETE commits first and then reconciles stop/join.
- Telegram apply accepts exact `{}` only after transport, authentication, Origin, and CSRF checks.
- Startup, apply, mutation, shutdown, and health share one manager and credential service graph.
- `/health` is passive: no credential read, bot construction, stop/join, or provider call.
- Independent PAC-3B acceptance retained **27 focused Telegram tests** and **236 backend tests**, plus
  `pip check`, diff, ownership/retry/DELETE/shutdown/thread/migration/offset/no-loss scenarios.
- No provider, network, service, listener, FFmpeg process, real key, or production environment was
  used for PAC-3 acceptance.

## PAC-4A accepted administrator contract

### One backend-validated administrator flow

The HMI exposes one visible administrator login. A validated backend login/session grants the fixed
HMI `Admin` role and permits `/admin`. There is no second Voice login, corporate identity provider,
account-management UI, browser credential fallback, or storage-hydrated privileged authority.

Viewer routes and individual Voice/conversation capabilities remain available without administrator
authentication. Closing and reopening **Configuración general** preserves the active administrator
session. Leaving administrator mode through **Ver viewer**, **Cerrar sesión**, browser history, or
another `/admin` to non-admin transition ends local administrator authority through one central path.

Bootstrap validates backend state before privileged rendering without blocking public viewer use.
Missing, invalid, expired, revoked, or unreachable backend state leaves viewer behavior available and
admin unavailable. Refresh occurs only on relevant user action, focus, or authorization failure; the
client does not poll or heartbeat the backend idle lease.

### Durable manual-login barrier

Administrator exit immediately suspends local authority, clears private CSRF, publishes only a
revocation notice, and persists a non-secret barrier. The barrier has two semantic states:

| State | Meaning | Automatic behavior |
|---|---|---|
| Remote revocation pending | The current cookie has not been conclusively revoked. | Reconcile conservatively without granting authority. |
| Manual login required | Exact logout `204` revoked the presented cookie. | Stay viewer-only; do not issue an automatic session GET. |

Exact `204` does not prove an earlier locally aborted login POST stopped server-side. It therefore
cannot remove the manual-login requirement. A late cookie may continue to exist until overwritten by
fresh login or backend TTL, but it cannot automatically restore the HMI role. Only a fresh, explicit,
successful backend login clears the barrier. That login also establishes a new private CSRF token and
restores normal validated-session reload behavior.

This policy deliberately avoids heuristic delays, TTL guesses, JavaScript cookie inspection, new
backend APIs, and false cancellation claims. A confirmed ordinary logout remains viewer-only across
reload without displaying a false unconfirmed-revocation error.

### Concurrency and cross-tab guarantees

- Stale bootstrap, login, or session results cannot win after exit intent or a newer operation.
- A pending exit GET cannot clear a newer identity or its private CSRF state.
- Once logout POST starts, fresh login waits for mutation and cleanup before it can commit.
- The original abort → `401` → repeated reload path keeps the barrier until safe reconciliation.
- Cookie A → login B → local abort → logout A `204` → late cookie B remains viewer-only across
  repeated reloads with `error=null` and no automatic session GET.
- Explicit login C clears the barrier; a subsequent ordinary reload may restore validated C.
- Cross-tab messages contain revocation intent only, never identity, role, CSRF, or secrets.
- Marker removal is not authority and is ignored by other tabs. Revocation notifications use unique
  IDs even under the same clock value.

### HTTP client and development proxy

- Requests use fixed same-origin routes, `credentials: same-origin`, `Cache-Control: no-store`,
  exact typed response validation, abort/epoch fences, and safe stable errors.
- Password bytes are transmitted exactly; nonempty whitespace-only passwords are not trimmed,
  normalized, logged, cached, persisted, broadcast, or placed in URLs.
- CSRF remains private to the document and is sent only where required.
- Logout accepts exact empty `204`; arbitrary 2xx responses, redirects, and SPA fallback are rejected.
- Development proxies allow only the exact admin auth, credentials, apply, and health routes and
  methods. They preserve Origin, cookie, `Set-Cookie`, CSRF, status, and no-store behavior and never
  forward `X-Prisma-Session-Capability` as administrator authority.

## PAC-4A final offline acceptance evidence

Independent verifier `ses_f4b473e58ffeudIYvT20yFJNVZ` closed every known PAC-4A finding:

- final focused authentication verification: **9 files, 80 tests passed**;
- full HMI verification: **199 files, 1885 tests passed**;
- build, lint, and `git diff --check`: **PASS**;
- parent spotcheck: **3 files, 40 tests passed**, plus CodeGraph readback of storage/controller;
- six prior finding groups, actual RTL lifecycle integration, Settings close, route/history exit,
  exact proxies, and public viewer/Voice independence remained passing.

The auth proof is offline. It uses the actual client/controller/storage and an in-memory server-cookie
scheduling model; it is not a live-browser cookie, native `StorageEvent`, production proxy, or
production-security claim.

### Backend gate and retained runtime warning

The first canonical backend run reported **235 passed, 1 failed** in
`RuntimeOwnershipTests.test_concurrent_acquisitions_join_one_owned_generation_without_manifest_corruption`.
The failure was a temporary sharing violation while copying `prisma_voice_config.json`.

Parent-authorized read-only diagnostic worker `ses_f4ae48996ffeTWUPE9gsX3vhcH` established:

- `start-local.ps1` initializes state before acquiring the manifest lock;
- `runtime-environment.ps1` performs `Test-Path` followed by `Copy-Item`;
- four relevant file blobs exactly matched `b5fcaf2` by empty diff and hash;
- the failure happens before changed backend Python is loaded;
- the isolated failing test passed once in **0.621 seconds**;
- one subsequent canonical `operations/verify-local.ps1` run passed **236 tests in 15.056 seconds**.

This evidence identifies a pre-existing check-then-copy race window. It does not prove the exact
failed interleaving, estimate frequency, or fix the race. The current required backend gate is PASS,
while the runtime state-seeding correction remains tracked under PW-002.

RDD was globally off. Native assessment was unassessable because the worktree contains untracked
inventory, so ordinary independent verification applied. No consent-review workflow was used.

## PAC-4B accepted credential workflow

PAC-4B adds credential configuration to **Configuración general → Voz** using the same accepted
administrator session. It does not introduce another login or change viewer/Voice access. All six
leaves and the four-defect correction ledger are independently accepted offline.

- [x] **PAC-4B-1 — Write client/query/component tests first.** Cover metadata-only reads, transient
  secrets, independent actions, safe errors, dialog close, logout cleanup, Telegram status, and
  DELETE `409` reconciliation.
- [x] **PAC-4B-2 — Add typed metadata and mutation boundaries.** TanStack Query may cache public
  metadata only; mutation clients require the current verified session and private CSRF.
- [x] **PAC-4B-3 — Build the Voice credential section from shared admin primitives.** Use design
  tokens, Lucide icons, and `hmi-scrollbar`; do not create local controls when primitives exist.
- [x] **PAC-4B-4 — Keep secrets transient and actions independent.** Inputs remain local and clear
  after completion, close, or logout. They never join global Save, Zustand, query cache, persistence,
  logs, URLs, or broadcasts.
- [x] **PAC-4B-5 — Render truthful diagnostics and safe errors.** Keep configured, desired/applied,
  restart-required, running, and last verified distinct. Never echo raw backend detail.
- [x] **PAC-4B-6 — Reconcile committed Telegram absence.** DELETE `409` means absence committed but
  stop failed; refresh metadata/status and offer user-driven reconciliation without automatic replay.

### Current UI use and limits

- **Guardar credencial** stores the entered Gemini or Telegram secret; it does not join global
  **Guardar**, contact a provider, or verify connectivity.
- A saved Gemini credential is selected for new Gemini work. Saving does not perform a live Gemini
  verification and does not alter already attached or in-flight work.
- A saved Telegram credential changes desired state only. **Aplicar cambio** is the separate explicit
  action that reconciles the running bot with that desired state.
- **Eliminar credencial** removes the protected value. Telegram `409 TELEGRAM_STOP_TIMEOUT` means the
  token is already absent but poller stop is uncertain; only an explicit user retry issues another
  DELETE. The UI never auto-applies or loops.
- `configured`, desired/applied generation, running, and last verified remain separate facts. Loading,
  unavailable, and retained last-known data are labelled rather than rendered as negative facts.
- Closing Settings clears credential drafts but preserves the administrator session. Leaving admin
  mode ends that authority. Viewer Voice and per-document conversation sessions remain independent.

### PAC-4B final correction ledger

| ID | Final state | Independently reproduced defect | Accepted correction proof |
|---|---|---|---|
| PAC-4B-C1 | COMPLETE PASS | Arbitrary backend `error` text reached `AdminAuthError` and Query state. | Actual-client canaries were absent from code/message, Query error/data/mutations, UI, and browser storage. |
| PAC-4B-C2 | COMPLETE PASS | Protected metadata survived permission-boundary unmount. | Route-guard logout removed the exact query; a late GET could not restore it, public Query data remained, and remount fetched fresh metadata. |
| PAC-4B-C3 | COMPLETE PASS | Stale operations could overwrite newer panel state. | Same-byte and different-byte drafts survived old success/error; stale confirmation and apply outcomes could not commit. |
| PAC-4B-C4 | COMPLETE PASS | Unknown or stale metadata appeared as current negative facts. | Loading, unavailable, last-known, and refresh-recovery states remained truthful while unsafe mutations stayed blocked. |

### PAC-4 and PAC-4B final offline evidence

- Independent external actual-client/hook/QueryClient/RTL probes passed **6 tests** covering all four
  findings, cache secrecy, route-guard cleanup, fresh remount, stale outcomes, and truthful recovery.
- Focused verification passed **125 tests in 10 files** covering the domain, actual admin client and
  controller, metadata-only hook, credential component, Voice/global integration, retained auth
  lifecycle, and exact proxy rules.
- Full HMI coverage passed **1922 tests in 202 files** at **86.79% statements, 80.11% branches,
  86.07% functions, and 87.66% lines**.
- TypeScript/Vite build, ESLint, and `git diff --check` passed. The canonical offline backend gate
  passed **236 tests in 16.103 seconds** without starting services or contacting providers.
- The parent passed **51 tests in 3 files** and performed CodeGraph readback of the client and hook.
- The same client/private CSRF/generation boundary, current `401` invalidation, one-time `403`
  reconciliation without mutation replay, PAC-4A manual barrier/R1/R2, exact proxies, public
  viewer/Voice behavior, global effects-only Save, and Settings-close behavior all remained passing.
- The HMI stores only configured/runtime metadata in TanStack Query. Secret bytes remain in local
  password-input state and imperative client calls; no TanStack mutation is used.
- Save, confirmed delete, Telegram apply, and post-timeout stop reconciliation are separate explicit
  actions. DELETE `409 TELEGRAM_STOP_TIMEOUT` refreshes passive truth and retries DELETE only after a
  new user action; it never applies a missing token or loops automatically.
- This is independent offline acceptance, not live-browser/screenshot, provider, network, production
  proxy, security-deployment, clean-installation, or service-lifecycle acceptance. RDD was globally
  off; native risk assessment was unavailable because the candidate contains untracked inventory, so
  ordinary independent proof applied.

Accepted source readback covered `adminAuth.service.ts`, `usePrismaCredentialAdministration.ts`, and
`VoiceCredentialSettings.tsx`. The exact retained correction checks are co-located in
`adminAuth.service.test.ts`, `usePrismaCredentialAdministration.test.tsx`,
`VoiceCredentialSettings.test.tsx`, and `GlobalSettingsDialog.voice.integration.test.tsx`; the focused
gate also retained domain, session-controller, Voice-tab, global-dialog, auth-lifecycle, and proxy
tests. No source or test changed after the independently verified candidate.

## Deployment and production residuals

`configured: false` means the single backend administrator must be provisioned by the documented
offline CLI. PAC-4 adds no browser provisioning or additional accounts.

Production routing, TLS, process supervision, clean installation/startup, native Windows and Linux
permission behavior, reparse points, backup/restore, durable recovery, state-seeding concurrency,
and legacy-installation retirement remain under PW-002. Existing `/hmi/prisma-config` access policy
also requires separate treatment. Development proxy acceptance is not production readiness.

## Implementation and recovery map

| Path | Responsibility |
|---|---|
| `hmi-app/src/services/adminAuth.service.ts` | Bounded admin HTTP transport and private CSRF. |
| `hmi-app/src/services/adminAuth.storage.ts` | Durable exit barrier and cross-document storage boundary. |
| `hmi-app/src/services/adminSession.controller.ts` | Bootstrap, login, refresh, expiry, exit, and ordering authority. |
| `hmi-app/src/components/auth/AdminSessionLifecycle.tsx` | Application-level session lifecycle integration. |
| `hmi-app/src/domain/adminCredential.types.ts` | Strict credential metadata, passive health, mutation, and secret-validation contracts. |
| `hmi-app/src/hooks/usePrismaCredentialAdministration.ts` | Metadata-only Query ownership and imperative credential actions. |
| `hmi-app/src/components/admin/VoiceCredentialSettings.tsx` | Transient credential inputs, diagnostics, confirmations, and explicit outcomes. |
| `hmi-app/vite.prismaProxy.config.ts` | Exact development proxy allowlist and rewrites. |
| `services/prisma-runtime/src/prisma_runtime/telegram_credentials.py` | Telegram credential source authority. |
| `services/prisma-runtime/src/prisma_runtime/telegram_lifecycle.py` | Telegram generations and transitions. |
| `services/prisma-runtime/src/prisma_runtime/local_presentation.py` | Polling, startup/shutdown, and health. |
| `services/prisma-runtime/src/prisma_runtime/admin_http.py` | Protected auth/credential/apply boundary. |

Rollback of PAC-4A removes the admin client/storage/controller/lifecycle integration and exact admin
proxy routes without changing accepted PAC-1–PAC-3 behavior. That rollback would restore known unsafe
local authority and is a mechanical boundary, not an approved operating state.

## Exact next-session resume point

PAC-5 offline closure and documentary reconciliation are accepted. Resume with:

1. Recover this tracker/full Engram mirror, the latest canonical checkpoint, and
   `docs/PENDING_WORK.md`; reconcile actual Git state.
   Preserve the historical PAC-4 proof (**1922 HMI tests, 236 backend tests**) separately from the
   integrated PAC-5 result (**1924 HMI tests, 240 isolated backend tests**). PAC-1 through PAC-5
   are closed and accepted offline; do not repeat any of them.
2. The ACL-helper and fetch-receiver fixes were delivered as observed local commits `41dc286`
   and `0cdf345` with explicit user authorization; no push, PR, or merge was performed. The
   canonical final documentation delivery hash is recorded by the parent in Git and the Engram
   checkpoint; do not invent or embed it here.
3. Recommended next bounded scope: the `PW-002` pre-lock `Copy-Item` initialization race. Read
   the `backlog/prisma-runtime-monorepo-integration` Engram detail before proposing any
   implementation; no new implementation was authorized in the closing session.
4. Keep the broader assistant work active and separate under `PW-003`
   (`backlog/prisma-dual-channel-assistant`), and keep `PW-001` preserved as tracked.
5. Do not claim production readiness, full layer-coverage targets, Linux/deployment/SACL/reparse/
   backup acceptance, or live-provider verification; those remain separate scope.
6. Do not use real providers, keys, network, services, clean-installation flows, production
   proxies, deployment, push, or merge unless separately authorized. Broader assistant data,
   intent, history, personal context, chats, and identity remain separate future scope.
