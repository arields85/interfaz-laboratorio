# Leda Channel B: self-registration with admin approval — ODD feature document

> ODD feature task (not SDD). Branch `feat/leda-channel-b-open-access` from `main` `a15ac95`.
> Engram mirror: `odd/leda-channel-b-open-access/tasks`. Backlog: PW-022 (`backlog/leda-channel-b-open-access`).

## Objective

Today the Channel B Telegram bot serves exactly one private chat: the first person who sends `/start` claims it. After this change:

- any person who writes to the bot can ask for access;
- the HMI admin approves, rejects or revokes each person;
- approved people use the bot as the single paired chat does today.

## Problem and why

The user wants more people to use the bot (PW-022). The master document (§6.3, Aclaración 2.0.12) records the single-chat limit and forbids widening admission without a new agreement. It also requires per-identity authorization, limits, cancellation, redacted audit and revocation.

## User decisions (2026-10-01)

- Admission model: **self-registration with admin approval**. Fully open admission and a hand-maintained allowlist were rejected.
- Scope: **admission only**. Every approved person sees the same data the bot shows today: the snapshot of the most recently updated HMI session (`hmi_sessions.py:245`). A per-channel data source stays in PW-003. This is recorded in the master document as a known limitation.

- Where requests are managed (2026-10-01): **both** in Configuración general → Leda (the full list under the Channel B credential) **and** in the topbar bell, which becomes the admin notification entry point. Pending Channel B requests are its first notification type.

## Defaults taken (the user can override)

- A private chat that sends `/start` and is not yet known becomes a **pending** request. The bot replies that the request is waiting for approval.
- Pending, rejected and revoked chats get a fixed usted reply and nothing else. They get no typing indicator, no download and no answer.
- A rejected or revoked chat cannot re-request by itself. The admin can still approve it later from the list.
- The number of pending requests is capped, to stop spam from filling the state file.
- On approval, the bot sends the person a short "acceso aprobado" message.
- The existing paired chat is migrated as **approved**, so nothing changes for the current user.
- Groups stay ignored, as today.
- Audit: an append-only log of admission events (requested, approved, rejected, revoked) with the chat id, the event and the time. It never stores message content.
- Per-chat limit: a cap on messages per minute for each approved chat, with a fixed usted reply when the cap is reached.

## Design notes

- State schema v3 (`telegram_lifecycle.py`): a per-bot map of chat id to record (status, Telegram display name and username, requestedAt, decidedAt). It replaces `pairedPrivateChatIds`. A v2 file is migrated by marking its paired ids approved. The key set stays strict.
- The admin routes and the poll loop write the same state file, so writes go through one locked owner. An admin decision must never lose the poll loop's `nextUpdateOffset`, and the reverse must hold too.
- Admin API (admin-protected like the existing credential routes): list chats, approve, reject, revoke.
- HMI: a Channel B access list next to the Channel B credential row, showing pending first, with approve, reject and revoke actions. The UI copy is in Spanish (usted).
- These are HMI configuration actions, not plant control, so the read-only rule is kept.
- Known risk, out of scope: voice-note download and transcription run inline on the poll thread, so one slow voice note delays every chat. It is recorded as a follow-up, not fixed here.

## Tasks

- [x] B1 — Runtime: state schema v3 with migration from v2 and a locked writer. Route: delegated (state module + tests).
- [x] B2 — Runtime: admission flow in the bot (request on `/start`, status replies, pending cap, approval notice). Route: delegated.
- [x] B3 — Runtime: per-chat message limit and the redacted admission audit log. Route: delegated.
- [ ] B4 — Runtime: admin HTTP routes to list, approve, reject and revoke chats. Route: delegated.
- [ ] B5 — HMI: service, hook and admin UI for the Channel B access list. Route: delegated (several non-trivial files).
- [ ] B5b — HMI: enable the topbar bell (`Topbar.tsx:198-206`, today a disabled placeholder) as a notification panel that lists pending Channel B requests, with approve and reject actions and a pending-count badge. It is only active with an admin session (`shouldShowAdminActions`). Other viewers keep today's disabled bell, so requester names are never shown to them. It polls only while the admin session is active. Route: delegated.
- [ ] B6 — Docs: new Aclaración in `LEDA_DOCUMENTO_MAESTRO.md` §6.3, the poll-thread follow-up, and the PW-022 closure in `PENDING_WORK.md`. Route: inline.
- [ ] B7 — Live check with the real bot (request, approve, use, revoke) and native review of the work-unit commits.

## TDD

Strict mode ON (source: global user configuration). Runners:

- runtime: `python -m unittest discover -s services/leda-runtime -p 'test_*.py'`, run from the monorepo root with a clean environment (see `services/leda-runtime/operations/verify-local.ps1`);
- HMI: `npm test` in `hmi-app`.

## Delivery

- Forecast: about 1,200–1,600 authored changed lines.
- Strategy: `ask-on-risk` with the `feature-branch-chain` chain, the user's earlier choice (trend-chart-v2). The user can override it.
- Work-unit commits on this branch. Push, PR and merge are the user's decision.
- RDD: on (global).

## Progress

- 2026-10-01: decisions taken, code mapped, feature document created.
- 2026-10-01: B1 done in `1914f6d` (delegated writer). RED: 20 of 94 new/changed tests in `test_telegram_lifecycle.py` failed (schema still 2, no v3 validation, no repository operations). GREEN: that file 94 tests OK; full runtime suite via the clean-env gate, 1921 tests OK. The bot still persists whole-state through `read`/`write`; B2 must move its offset and pairing writes onto the repository operations.
  - Parent spot check: `test_telegram_lifecycle.py` re-run, 94 OK.
  - Native review (slice `a15ac95..d362da4`, medium, `slice_budget_reached`): granted under standing consent, one reliability lens, **approved** and acknowledged (lineage `review-b6f8a7aa524fd8a4`, authority burned). The next reviewed boundary is `d362da4`.
  - Advisory findings, non-blocking, folded into B2: `R3-pair-timestamp-roundtrip` (`local_presentation.py:955-956`) and `R3-v2-migration-clock-unstable` (`telegram_lifecycle.py:108`, the v2 migration stamps a new time on every read until the first write).
- 2026-10-01: B2 done in `3fd64e6` (delegated writer). RED: 15 of 32 tests in the new `ChannelBAdmissionTests` and the repository operations tests failed (no admission replies, no pending cap, no approval notice, the bot still wrote whole-state, v2 reads re-stamped times). GREEN: full runtime suite 1938 tests OK (clean env, temp `LEDA_RUNTIME_STATE_DIR`). The bot now reads admission fresh on every message, persists only through `add_pending`, `update` and `set_offset`, and exposes `send_approval_notice(chat_id) -> bool` for B4. The v2 migration is persisted on the first read (R3 findings folded in). Test doubles are now `TelegramStateRepository` subclasses over a dict.
  - Parent spot check: `test_telegram_*.py` re-run, 191 OK.
  - Native review (slice `d362da4..7ba6fbe`, medium, `slice_budget_reached`): granted under standing consent, one reliability lens, **approved** and acknowledged (lineage `review-db9ecb038d26aa8a`, authority burned). The next reviewed boundary is `7ba6fbe`.
  - Advisory findings, non-blocking, folded into B3/B4:
    - `R3-v2-read-now-writes` (`telegram_lifecycle.py:185-188`): `read()` writes the migrated file, so a read has a side effect. It must stay under the lock and be idempotent, and the admin list must cope with it.
    - `R3-add-pending-result-ignored` (`local_presentation.py:974-975`): the pending-cap check and `add_pending` are two separate steps. Do them in one locked `update`.
    - `R3-approval-notice-cross-thread` (`local_presentation.py:979-981`): `send_approval_notice` will be called from the admin HTTP thread. Make the send safe across threads.
- 2026-10-01: B3 done in `abb39c2` (delegated writer). RED: both new/changed test modules failed to import (`leda_runtime.channel_b_admission` did not exist), so all 19 new limiter/audit tests and the 12 new bot/repository tests failed. GREEN: full runtime suite 1969 tests OK (clean env, temp `LEDA_RUNTIME_STATE_DIR`). New `channel_b_admission.py` holds the bounded in-memory `ChatMessageLimiter` (10 messages per 60 s per chat, injectable clock, LRU-bounded at 1,024 chats) and `AdmissionAuditLog` (`leda_channel_b_admission_audit.jsonl` in the state directory, 1 MiB then one `.1` backup, never raises). `TelegramStateRepository.request_access` does the pending-cap check and the insert in one locked step (`R3-add-pending-result-ignored`). `R3-v2-read-now-writes`: `read()` already ran the migrate-and-write under the repository lock; a concurrency test now pins that the migration is written once (it passed on first run, a characterization test, not a RED).
- Route evidence: B3 delegated (writer for several non-trivial files).

## Acceptance criteria

- An unknown private chat that sends `/start` appears as pending in the HMI and gets no data until it is approved.
- An approved chat gets answers as today. A revoked chat stops getting them on its next message.
- The current paired chat keeps working after the upgrade, with no action needed.
- The audit log records every admission decision and contains no message text.
- All runtime and HMI tests pass.
