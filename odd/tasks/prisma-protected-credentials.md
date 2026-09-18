Repository-relative file: odd/tasks/prisma-protected-credentials.md

# Prisma protected administrator authentication and provider credentials

## Current status

`PAC-1`, `PAC-1a`, `PAC-2`, `PAC-3A`, and `PAC-3A-S1` are complete and accepted
offline. Delivery is recorded in Git and Engram; production acceptance remains separate.

`PAC-3` remains open because `PAC-3B` has not started. The exact next unit is Telegram
stored-token adoption with explicit desired/applied state, safe stop/join without overlapping
pollers, preserved pairing and pending updates, and explicit apply/restart behavior. `PAC-4`
then integrates credential fields and diagnostics into the HMI administrator experience.

No provider, FFmpeg process, service, listener, real key, network, remote operation, native RDD,
or production deployment was used for the offline acceptance. The externally modified
`.gitignore` entries for local Pi runtime state and `.atl/` are unrelated and remain outside the
intended feature commit.

## Stable work packages

- [x] **PAC-1 — Backend administrator authentication and offline recovery.**
  - [x] **PAC-1a — Validate login JSON shape and types before authentication.**
- [x] **PAC-2 — Encrypted credential store and protected API.**
- [ ] **PAC-3 — Adopt stored credentials at provider-consumption boundaries.**
  - [x] **PAC-3A — Adopt Gemini through the event-bound paid invocation path.**
    - [x] **PAC-3A-S1 — Establish server-owned HMI document-session isolation.**
  - [ ] **PAC-3B — Adopt Telegram through explicit desired/applied lifecycle semantics.**
- [ ] **PAC-4 — Integrate HMI administrator flow and Voice credential fields.**
- [ ] **PAC-5 — Independently verify and reconcile active documentation.**

PAC-3A acceptance does not close the PAC-3 umbrella and does not authorize PAC-4 work.

## Objective and boundaries

Prisma owns backend administrator authentication, encrypted Gemini and Telegram credential
storage, and provider consumption without trusting browser roles or exposing secrets. Routine
startup remains unattended: no password or terminal prompt is required on every launch.

Voice is available to viewers and administrators after installation configuration, but each
browser document owns its own interaction. Shared infrastructure—backend processes, model
account, configured key, catalogue, installation telemetry, and bounded worker pools—does not
create shared conversation, view context, events, replay, cancellation, audio, or navigation.

### Included

- Application-owned administrator authentication for Windows and Linux.
- A separately provisioned 32-byte installation master-key file protected by OS permissions.
- Encrypted provider credential storage and metadata-only administration.
- Protected Gemini credential adoption with authoritative protected mode.
- Anonymous server-issued browser-document authority and per-session Prisma state.
- Event-bound TTS, bounded/fair shared execution, and strict offline verification.

### Excluded

- Viewer accounts, durable personal chat, cross-reload/tab identity, or account migration.
- Cloud vaults, desktop keyrings, DPAPI-only storage, bundled keys, `.env` secret persistence,
  or per-start prompts.
- HMI credential UI, Telegram protected-token adoption, or automatic paid Telegram audio.
- Industrial writes, control permissions, or claims that snapshot/question ingress proves a
  user's real-world identity.
- Live provider, FFmpeg, production TLS/proxy/supervisor, clean installation, backup/restore,
  native Linux, or new-key Windows acceptance.

## PAC-1 administrator authentication

`prisma_runtime.local_presentation` owns `/api/prisma/admin/*`; the HMI auth store never
authorizes this boundary.

| Route | Contract |
|---|---|
| `GET /api/prisma/admin/auth/status` | Public configured metadata only. |
| `POST /api/prisma/admin/auth/login` | Exact accepted Origin and strict string credentials; issues an opaque session cookie and CSRF token. |
| `GET /api/prisma/admin/auth/session` | Authenticated administrator and expiry metadata plus stable CSRF. |
| `POST /api/prisma/admin/auth/logout` | Authenticated, CSRF-protected revocation and cookie clearing. |

The host-only cookie contains a random 256-bit session ID; SQLite stores only its SHA-256
digest. It is `HttpOnly`, `SameSite=Strict`, scoped to `/api/prisma/admin`, and `Secure` for an
HTTPS public origin. Idle and absolute defaults are 15 minutes and 8 hours. Responses are
`Cache-Control: no-store`.

Passwords use persisted, allowlisted `hashlib.scrypt` parameters (`n=2**15`, `r=8`, `p=3`,
32-byte output, 16-byte random salt, 64 MiB `maxmem`). Input preserves Unicode and whitespace,
requires at least 15 characters, supports at least 64, and rejects more than 1024 UTF-8 bytes.
Unknown users take the configured dummy-hash path. A process-wide hashing semaphore and bounded
persisted throttles run before verification. Offline reset revokes sessions and failures.

Protected SQLite state uses connection-per-operation transactions. Linux requires current-UID
ownership, `0700` directories, `0600` files, safe ancestors, and safe sidecars. Windows uses the
bounded ACL operation and invariant SIDs for the current identity, SYSTEM, and Administrators.
Unexpected inheritance/access, linked or reparse ancestors, and insecure sidecars fail closed;
ordinary startup never repairs permissions.

## PAC-2 key custody and credential API

`PRISMA_CREDENTIAL_MASTER_KEY_FILE` names an absolute raw 32-byte key outside runtime state.
Its parent is protected independently; lexical and existing ancestors must be free of links or
reparse points. Runtime never generates the key. Offline provisioning fails if the key or
credential database already exists and never prints the key or path.

The dedicated database is `credentials/provider-credentials.sqlite3` below runtime state.
Stores are bound to the master-key fingerprint. Each Gemini or Telegram record contains only
provider, format version, internal SHA-256 key ID, fresh 12-byte nonce, and AES-256-GCM
ciphertext/tag. Canonical UTF-8 JSON AAD contains exactly `formatVersion`, `keyId`, and
`provider`. Plaintext is encrypted before SQL receives values; writes use `BEGIN IMMEDIATE`.

Secrets are strings of 1–4096 UTF-8 bytes. Empty or whitespace-only values are rejected; accepted
content is not trimmed. Unknown formats/providers, bad types or sizes, wrong key/AAD, invalid tag,
schema drift, malformed rows, and corruption fail closed without raw details.

Authentication precedes provider validation and key/store access. PUT and DELETE also require an
exact accepted Origin and ASCII CSRF value checked in constant time.

| Route | Contract |
|---|---|
| `GET /api/prisma/admin/credentials` | Configured booleans for Gemini and Telegram; never secret values. |
| `PUT /api/prisma/admin/credentials/<provider>` | Exact `{"secret": string}`; stores after Origin and CSRF validation. |
| `DELETE /api/prisma/admin/credentials/<provider>` | Idempotent removal; returns `204`. |

The decoded limit is 4096 UTF-8 bytes; the independent wire limit is `4096 * 6 + 1024` bytes.
Credential-route success, failures, OPTIONS, HEAD, and method errors are non-cacheable. Stable
errors cover authentication `401`, transport/CSRF `403`, unsupported provider `404`, invalid
request `400`, content type `415`, wire size `413`, and sanitized storage failure `503`.

This protects ciphertext-only theft, accidental disclosure, and backups that omit the key. It
does not protect against a compromised service identity, process, or host able to read both key
and plaintext memory. Losing every key copy makes the ciphertext unrecoverable.

## PAC-3A accepted Gemini and session boundary

### Gemini credential selection

A nonblank `PRISMA_CREDENTIAL_MASTER_KEY_FILE` selects authoritative protected mode. Gemini
resolves the stored credential only when actual provider work dequeues. Missing, deleted,
unavailable, mismatched, or corrupt protected storage never falls through to `GEMINI_API_KEY`.
The environment key is a legacy source only when protected mode is not selected.

Startup, credential save, health, and replay never contact Gemini. Health distinguishes source,
configured, available, and verified; `verified` remains false without an explicit provider action.
Replacement credentials apply to new provider work. Deleted credentials block new attachments
and queued client construction; already attached subscribers and in-flight provider I/O may finish
within existing bounds.

### Anonymous document capability

Presentation mints 32 random bytes and returns their canonical URL-safe value only in
`X-Prisma-Session-Capability`. It stores only the SHA-256 digest plus an internal random UUID
owner. The browser keeps the bearer capability in one document-level client in memory only—not
in localStorage, sessionStorage, URLs, logs, domain objects, or UI state.

The capability grants access to that anonymous document's owned context; it is not user account,
device identity, theft-proof authentication, or authority to grant access to others. Browser role
state cannot mint or transfer server ownership.

One capability covers snapshot publication, ask, own-event polling, and event-bound TTS. A fresh
document or reload gets a new capability. Explicit DELETE revokes it. `pagehide` close is best
effort, so crash/reload orphans can survive until expiry. State is process-local and non-durable;
restart invalidates capabilities. Default limits are 64 live sessions, 30-minute idle expiry,
and 8-hour absolute expiry.

### Exact session routes

All exact session/TTS responses are `Cache-Control: no-store`. The capability header is
allowlisted only for these paths and is never forwarded to admin, voice-config, health,
telemetry, or another origin.

| Browser route | Fixed upstream | Contract |
|---|---|---|
| `POST /api/prisma/session` | `POST /hmi/session` | Exact `{}` JSON, 128-byte wire cap; `201` plus public expiries and capability header. |
| `DELETE /api/prisma/session` | `DELETE /hmi/session` | No body; capability required; revokes and returns bodyless `204`. |
| `POST /api/prisma/snapshot` | `POST /hmi/current-snapshot` | Capability required; maximum 1 MiB; replaces only that owner's latest view. |
| `GET /api/prisma/events/latest` | `GET /hmi/voice/latest` | Capability required; `204` when empty, otherwise only the owner's latest event. |
| `POST /api/prisma/ask` | `POST /local/ask` | Exact `{"question": string}`, 1–4096 UTF-8 bytes, 32 KiB wire cap; no recipient. |
| `POST /api/prisma/tts/live` | `POST /prisma/speak-live` | Exact `{"eventId": string}` plus capability; foreign events are nondisclosing `404`. |

Missing, expired, revoked, malformed, non-ASCII, wrong-type, or oversized capabilities produce
controlled `401 PRISMA_SESSION_REQUIRED`. Malformed bodies return controlled `400`/`413`.
Authority failure precedes credential reads, coordinator/cache admission, and provider work.
Public responses never expose capability digests, owner IDs, keys, recipients, paths, or raw
exceptions. Raw text TTS `/prisma/speak` returns `410 RAW_TTS_DISABLED`.

### Session-owned state and browser behavior

Each owner has one latest snapshot, at most 16 five-minute voice events, and one latest-event
pointer; aggregate event retention is 256. HMI `/local/ask` has no fallback to the installation
legacy JSON snapshot. Telegram can still use its installation snapshot for private text, but it
does not publish HMI events, select a browser session, or receive automatic paid audio.

Voice validates canonical owner/event data and keys coordinator state, PCM, tombstones, retry,
subscribers, replay, and cancellation by `(owner_id, event_id)`. New attachment and dequeue both
revalidate authority. The queued capability exists only transiently for that check and is cleared
on completion, failure, timeout, capacity release, eviction, removal, retry replacement, and
coordinator close.

Browser bootstrap is single-flight. One cancelled waiter does not cancel shared bootstrap, but
that caller cannot send work after cancellation. Every authorized request captures a session
epoch; stale responses are rejected before UI, dedupe, or playback updates. A `401` fences the
old epoch and starts a fresh bootstrap without replaying an old snapshot, question, or TTS POST.
TTS abort wiring remains active through headers and body EOF, error, cancellation, or reset.
Reset stops buffered playback locally. The first valid own event is delivered; same-epoch listener
restart does not replay it. No chat UI or stored browser history was added.

### Bounded shared execution

The supported topology is one voice-service process, one coordinator, and one provider worker,
with the reloader disabled. Shared infrastructure is fair but conversation state stays isolated.

| Limit | Accepted default |
|---|---:|
| Eligible/admission records | 64 / five-minute event lifetime |
| Queued jobs | 8 aggregate / 2 per owner, round-robin |
| Provider workers / active jobs | 1 / 1 |
| PCM | 16 MiB per event / 64 MiB aggregate, including active bytes |
| Buffered chunks | 4096 aggregate |
| Subscribers | 16 per event / 8 per owner / 32 aggregate |
| Lookup / queue wait | 2 s / 30 s |
| Provider SDK / stream idle / whole job | 45 s / 15 s / 60 s |
| Idle subscriber | 15 s |
| Failed retry | One after 30 s, only if zero PCM was published |

Subscriber capacity is reserved before state creation, retry, enqueue, credential work, or
generation and released idempotently on every close path. Admitted PCM is pinned through final
detachment. Eviction never silently regenerates completed work; tombstones retain retry state.
Only one provider/DSP/PCM generation runs per owned event, while subscribers and replay add no
paid side effect.

An independent deadline monitor marks logical timeout, releases subscribers, suppresses late
chunks/success, and requests cooperative cleanup. Python cannot safely kill a non-cooperative
provider iterator: its producer slot remains quarantined and replacement work is rejected until
physical return. The 45-second SDK I/O timeout is the bounded provider-unblock mechanism. Multiple
workers or horizontal replicas remain unsupported; arbitrary external WSGI topology cannot be
detected reliably, and replay/attempt guarantees last only for one process lifetime.

## Implementation map

| Path | Responsibility |
|---|---|
| `services/prisma-runtime/src/prisma_runtime/admin_auth.py` | Administrator sessions, password verification, throttling, and reset. |
| `services/prisma-runtime/src/prisma_runtime/admin_http.py` | Strict administrator HTTP boundary and CSRF. |
| `services/prisma-runtime/src/prisma_runtime/credential_store.py` | Protected AES-256-GCM provider storage. |
| `services/prisma-runtime/src/prisma_runtime/gemini_credentials.py` | Authoritative protected-mode Gemini resolution and legacy-source selection. |
| `services/prisma-runtime/src/prisma_runtime/hmi_sessions.py` | Digest-only bounded document capabilities and context registry. |
| `services/prisma-runtime/src/prisma_runtime/voice_events.py` | Immutable owner-partitioned event retention and latest pointers. |
| `services/prisma-runtime/src/prisma_runtime/local_presentation.py` | Session bootstrap/close, snapshot, ask, own-event, and internal lookup routes. |
| `services/prisma-runtime/src/prisma_runtime/voice_service.py` | Event-only TTS, credential consumption, fixed lookup, and no-store responses. |
| `services/prisma-runtime/src/prisma_runtime/event_audio.py` | Owner/event admission, fair queueing, replay, resource accounting, and deadlines. |
| `hmi-app/src/services/prismaSessionClient.ts` | Memory-only capability, bootstrap, epoch fencing, allowlisted fetch, close, and stream abort. |
| `hmi-app/src/services/dashboardSnapshotExport.service.ts` | Session-owned current-view publication. |
| `hmi-app/src/services/voiceEventListener.service.ts` | Own-event polling and per-epoch dedupe. |
| `hmi-app/src/services/prismaVoiceTtsAudioSource.ts` | Session-authorized event-only progressive PCM source. |
| `hmi-app/vite.prismaProxy.config.ts` | Exact same-origin development proxies. |

Tests are co-located in the corresponding backend and HMI test files, including
`test_hmi_sessions.py`, `test_hmi_session_isolation.py`, `test_event_audio.py`,
`test_local_presentation.py`, `test_voice_service.py`, and `prismaSessionClient.test.ts`.

## Acceptance evidence

Independent session `ses_f4dfe1a75ffeB6xoyWsWbimrSF` returned final `PASS`:

- Focused backend: 63 tests—sessions 9, presentation 14, audio coordinator 20, voice 20.
- Focused HMI: 53 tests.
- Full backend: 209 tests.
- Full HMI: 1844 tests.
- HMI coverage: 86.64% statements, 80.00% branches, 85.87% functions, 87.46% lines.
- Static/tooling: 40 Python AST files, `pip check`, both TypeScript checks, production build,
  lint, and `git diff --check` passed.
- Parent spotcheck: 14 session-client tests plus source-boundary readback passed.
- Actual two-client Flask/fake-bridge proof retained separate snapshots, equal-question but
  distinct events/PCM, foreign-pair `404`, close-A isolation with B replay, and exactly one
  provider job per owned event.
- Prior deadline, quarantine, late-chunk, PCM ownership, capacity, unstarted-close, strict lookup,
  and response-close correction remained passing.

All five S1 correction groups passed: bootstrap caller cancellation, post-header stream abort,
strict capability/metadata validation, exact bootstrap/ask/close contracts, and terminal authority
cleanup plus TTS no-store policy. Backend numeric coverage was unavailable because `coverage.py`
is absent; no installation was authorized.

### RED and review history

The first isolated backend invocation failed because `prisma_runtime` was not importable from that
focused discovery path; that was not behavioral RED. Later meaningful RED proved missing session
routes/first-event delivery, then deadline, admission/subscriber ownership, PCM retention, lookup
closure, cancellation, strict transport, metadata, transient authority, and caching defects.
Bounded corrections were independently rechecked before parent acceptance. Full historical
snapshots remain in Engram revisions; this file keeps only the recovery-relevant ledger.

## Rollback and limitations

PAC-1 rollback removes administrator auth/recovery modules and wiring. PAC-2 rollback removes
credential modules, API wiring, and direct dependency provenance while preserving PAC-1.
PAC-3A/S1 rollback removes Gemini adoption, `hmi_sessions.py`, `prismaSessionClient.ts`, their
tests/types, and session-owner/event/audio wiring. That rollback restores the known-unsafe global
baseline and must not be described as acceptable isolation.

Offline acceptance is not live provider or deployment acceptance. Open items include clean
installation and real startup, new-key Windows permissions, native Linux/reparse behavior,
backup/restore, TLS, proxy trust, production identity/supervisor, IT forwarding, durable recovery,
and explicit retirement of the external legacy installation. Existing `/hmi/prisma-config`
access policy was not secured by PAC-1–PAC-3A.

## Exact next step

Implement only `PAC-3B`:

1. Read the Telegram token from protected storage under the same authoritative-source rules.
2. Model desired and applied configuration generations explicitly.
3. Apply/restart only through an authenticated explicit operation.
4. Stop and join the current poller before replacement; never overlap bots.
5. Preserve pairing and pending updates; do not introduce `drop_pending_updates` data loss.
6. Keep Telegram private text-only unless a later unit explicitly adopts audio.

Then independently verify PAC-3B before starting PAC-4. Do not invent chat UI, stored browser
history, automatic paid Telegram audio, or broader account identity. Canonical backlog details are
`backlog/prisma-runtime-monorepo-integration` and `backlog/prisma-dual-channel-assistant`; active
rows remain `PW-002` and `PW-003` in `docs/PENDING_WORK.md`.
