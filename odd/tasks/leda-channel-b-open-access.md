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
- [x] B4 — Runtime: admin HTTP routes to list, approve, reject and revoke chats. Route: delegated.
- [x] B4b — Runtime: review follow-ups. Guard every use of the shared Telegram session (not only `sendMessage`) against the HTTP-thread notice, test the `create_app` Channel B access wiring, and keep limiter counts on eviction where cheap. HMI: clear the bell decision feedback and share the in-flight guard between the bell and the Leda tab. Route: delegated.
- [x] B5 — HMI: service, hook and admin UI for the Channel B access list. Route: delegated (several non-trivial files).
- [x] B5b — HMI: enable the topbar bell (`Topbar.tsx:198-206`, today a disabled placeholder) as a notification panel that lists pending Channel B requests, with approve and reject actions and a pending-count badge. It is only active with an admin session (`shouldShowAdminActions`). Other viewers keep today's disabled bell, so requester names are never shown to them. It polls only while the admin session is active. Route: delegated.
- [x] B8 — Runtime: Channel B is enabled from the admin, not from the server. User decision (2026-10-02): everything must be controlled from the admin. Today the bot only starts with `LEDA_LOCAL_TELEGRAM_ENABLED=1` (`telegram_config.py:33`); without it, ▶ fails with `TELEGRAM_DISABLED` and every reboot leaves Channel B off. Mirror Channel A (`channel_a_manager.py:753`): in protected mode the bot is enabled exactly when its credential is stored and starts on boot; 🗑 deletion stops it. Remove the variable from `docs/DEPLOYMENT.md`. Route: delegated.
- [x] B9 — HMI: show the same notification bell inside the admin (AdminLayout context bar, next to "SESIÓN ADMIN ACTIVA"). User request (2026-10-02, live check). It reuses `NotificationBell` and the shared query, with no duplicate polling logic. Route: delegated.
- [ ] B10 — Bug found in the live check (2026-10-02): Channel B answers "Todavía no hay datos del dashboard cargados." to approved chats while the HMI shows live data and keeps posting `/hmi/current-snapshot` (202). The branch did not touch that path. Root cause under investigation by a read-only explorer.
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
- 2026-10-01: B4 done in `db0e462` (delegated writer). RED: `test_channel_b_access_http.py` failed to import (`channel_b_access` missing) and `test_telegram_lifecycle.py` failed to import (`TelegramChatNotFound`/`TelegramInvalidTransition` missing); after adding the repository `apply_decision` the one remaining failure was the cross-thread send test (6 concurrent sends instead of 1). GREEN: full runtime suite 1991 tests OK (clean env, temp `LEDA_RUNTIME_STATE_DIR`). Routes (all admin-protected like the credential routes: loopback peer, session, and Origin plus CSRF on writes): `GET /api/leda/admin/channel-b/access` and `POST /api/leda/admin/channel-b/access/<chatId>/{approve|reject|revoke}`. Errors: 400 `INVALID_CHAT_ID`, 404 `CHANNEL_B_CHAT_NOT_FOUND`, 409 `CHANNEL_B_INVALID_TRANSITION`, 503 `CHANNEL_B_ACCESS_UNAVAILABLE` (no running bot identity) and 503 `TELEGRAM_STATE_UNAVAILABLE`. Decisions answer `{ok, chat, noticeSent}`; the notice is best effort and never undoes an approval (`R3-approval-notice-cross-thread` folded in: `send_message` is serialized by a lock). Every decision writes an admin audit event.
  - Parent spot check: `test_channel_b_*.py` re-run, 37 OK.
  - Native review (slice `7ba6fbe..42c6d1e`, B3+B4 together, medium, 1148 lines): granted under standing consent, one reliability lens, **approved** and acknowledged (lineage `review-a33d2505f1db35d1`). The next reviewed boundary is `42c6d1e`.
  - Advisory findings, handled in B4b:
    - `R3-send-lock-partial-session-guard` (`local_presentation.py:812-815`): the lock covers `sendMessage` only, so the HTTP-thread notice can still overlap the poll thread's `getUpdates`, chat actions or downloads on the shared session.
    - `R3-production-access-wiring-untested` (`local_presentation.py:1584`): the `ChannelBAccess` wiring in `create_app` has no test. B7's live check covers it too.
    - `R3-limiter-lru-eviction-resets-count` (`channel_b_admission.py:75-76`): evicting a chat resets its window.
  - Open decision taken as default: with the bot stopped, the list and the decisions answer 503 `CHANNEL_B_ACCESS_UNAVAILABLE`. The UI shows "not available" instead of an empty list.
- Route evidence: B4 delegated (writer for several non-trivial files).

- 2026-10-01: B5 done in `636e7cd` (delegated writer). RED: `channelBAccess.types.test.ts` failed to import (module missing); 11 new `AdminAuthClient Channel B access` tests failed (`channelBAccessList`/`channelBAccessDecision` not functions); the settings and hook suites failed to resolve their modules; one extended `VoiceSettingsTab` test failed (section not mounted). GREEN: full HMI suite 296 files, 3932 tests OK; `npx tsc -b` clean; `npm run lint` clean. New domain types and strict parsers (`domain/channelBAccess.types.ts`), `AdminAuthClient.channelBAccessList/Decision` (same session, Origin and CSRF transport as the credential POSTs), shared hook `useChannelBAccess` (query key `['leda','admin','channel-b-access']`, optional 30 s polling and focus refetch for B5b, cache purged when the admin session ends), and `components/admin/channelBAccess/` (container `ChannelBAccessSettings`, presentational `ChannelBAccessList` and `ChannelBAccessIdentity`, usted copy in `channelBAccessCopy.ts`) mounted under the credentials in the Leda tab. Revoke uses `AdminDestructiveDialog`. The existing `GlobalSettingsDialog.voice.integration` and `VoiceSettingsTab` tests now stub the new list route.
  - Route evidence: B5 delegated (writer for several non-trivial files).
  - Pre-commit review (GGA) passed; notes only: the date uses the browser locale, and the shared parsers reuse the `ADMIN_CREDENTIAL_RESPONSE_INVALID` code.

- 2026-10-01: B5b done in `991eaa4` (delegated writer). RED: `NotificationBell.test.tsx` failed to import (component missing) and the new Topbar wiring test failed (the admin session still rendered the disabled bell). GREEN: full HMI suite 297 files, 3952 tests OK; `npx tsc -b` clean; `npm run lint` clean. `Topbar` keeps the disabled bell for viewers and without hydration, and mounts the container `NotificationBell` (`components/layout/`) when `shouldShowAdminActions` is true: enabled button with the shared topbar styling, a pending-count badge (hidden at 0, `9+` above nine), label `Notificaciones: N pendientes`, and the presentational `NotificationPanel` (title Notificaciones, pending requests with Aprobar and Rechazar, empty, loading and 503 states, close on outside click and Escape). It reuses `useChannelBAccess` with `polling: true` (30 s plus focus refetch) and the B5 query key, so both views stay in sync. `Topbar.test.tsx` mocks `NotificationBell` for isolation.
  - Route evidence: B5b delegated (writer for several non-trivial files).
  - Pre-commit review (GGA) first rejected two points, both fixed: the decision subset is now derived from the domain (`allowedChannelBAccessDecisions('pending')`), and the badge uses the `text-xs` token instead of `text-[10px]`.
  - Omitted on purpose: the "Ver todas" link. `GlobalSettingsDialog` is mounted only in `AdminLayout` with local open and tab state; the viewer topbar has no way to open it on the Leda tab, and adding global plumbing was out of scope.

- 2026-10-01: parent spot check of B5/B5b: 7 suites, 118 tests OK. Native review (slice `42c6d1e..77c7674`, medium, 1717 lines): granted under standing consent, one reliability lens, **approved** and acknowledged (lineage `review-294a392cbb6401bc`). The next reviewed boundary is `77c7674`.
  - Advisory findings, handled in B4b:
    - `R3-bell-feedback-never-cleared` (`NotificationBell.tsx:37`): the decision feedback is never cleared.
    - `R3-inflight-guard-per-instance` (`useChannelBAccess.ts:57-58`): the in-flight guard is per hook instance, so the bell and the Leda tab can decide the same chat twice. The backend answers 409 for the second one.
  - Writer notes kept as defaults: dates use the browser locale like the rest of the HMI; the parsers reuse `ADMIN_CREDENTIAL_RESPONSE_INVALID`. "Ver todas" in the bell was left out because `GlobalSettingsDialog` cannot be opened on a tab from the viewer topbar.

- 2026-10-01: B4b done in `5311366` (runtime) and `c457bbe` (HMI), delegated writer. RED: runtime, 3 of the 4 new notice tests failed (the notice waited on the long poll, no notice session, no close on stop) plus the changed notice test, and the eviction test failed (`ALLOWED` where the active chat's window should have survived); the `create_app` wiring test passed on first run (characterization test of existing wiring). HMI, the bell feedback tests failed (feedback never cleared, kept after closing) and the two-consumer hook test failed. GREEN: runtime suite 1997 tests OK (clean env, temp `LEDA_RUNTIME_STATE_DIR`); HMI 297 files, 3955 tests OK; `npx tsc -b` and `npm run lint` clean.
  - `R3-send-lock-partial-session-guard`: instead of a lock around every `_call` (a 35 s `getUpdates` long poll would hang the admin request), the approval notice now uses its own `requests` session (`_send_notice_message`, serialized by its own lock, closed with the bot). `send_message` no longer needs the lock.
  - `R3-production-access-wiring-untested`: new `CreateAppChannelBWiringTests` proves `create_app` wires `ChannelBAccess` to the manager's current bot and shares one `AdmissionAuditLog` with the bot.
  - `R3-limiter-lru-eviction-resets-count`: on overflow the limiter drops an expired chat first and the least recent chat only when all are active.
  - `R3-bell-feedback-never-cleared`: the feedback clears after `CHANNEL_B_FEEDBACK_VISIBLE_MS` (5 s, new named constant in `channelBAccessCopy.ts`; the only existing feedback timers are module-private, 1.5 s for a copy swap) and when the panel closes.
  - `R3-inflight-guard-per-instance`: decisions are TanStack mutations under one key; the guard reads the shared mutation cache per chat and `pendingChatId` comes from `useMutationState`, so the bell and the Leda tab see the same in-flight decision.
  - Pre-commit review (GGA) passed on the HMI commit; note only: `CHANNEL_B_INACTIVE_TEXT` and the bell labels live in the component, not the copy module.
  - Route evidence: B4b delegated (bounded writer).

- 2026-10-01: parent spot check of B4b: `test_channel_b_*.py` OK; HMI bell and hook suites 28 OK. Native review (slice `77c7674..3a3d856`, medium, 388 lines): granted under standing consent, **approved** and acknowledged (lineage `review-eab5f1832b17159c`).
  - Advisory finding `R3-wiring-test-after-main-guard` fixed inline in `e3f7129`: the wiring test class was defined after `if __name__ == "__main__"`, so running the module directly skipped it. With the guard moved to the end, a direct run gives 19 OK, wiring test included.
  - Remaining advisory findings, recorded as follow-ups and not fixed: `R3-notice-session-close-skipped-on-error` (`local_presentation.py:900-901`) and `R3-per-chat-guard-relaxes-global-serialization` (`useChannelBAccess.ts:118-124`).
- 2026-10-01 B7 prep:
  - Backed up the live v2 state file to `%LOCALAPPDATA%/CoreAnalytics/Leda/leda_local_state.v2-backup-20261001.json`, because the v3 migration is one-way.
  - Restarted the dev environment (stop-local, relaunch CoreAnalytics.cmd). Ports 5056, 5057 and 5173 are up.
  - The state file is still v2, because it migrates on the first read or write of the bot. Waiting for the user's live test.

- 2026-10-02 B7 live check, proxy route fix:
  - Bug: the browser could not reach `GET /api/leda/admin/channel-b/access` nor `POST .../access/<chatId>/approve|reject|revoke`; neither the dev proxy allowlist (`hmi-app/vite.ledaProxy.config.ts`) nor the nginx regex in `docs/DEPLOYMENT.md` listed them.
  - Fix: an exact GET list route plus one anchored POST decision route (chat id `-?[0-9]{1,19}`, matching the runtime's `parse_chat_id`, three actions only), both forwarded unchanged to 5057 with the session capability stripped; the nginx regex gained the same shape and now counts 22 routes. Tests written first (10 RED, then GREEN): commits `18e64fa` (dev proxy) and `357c4cf` (deployment doc).
  - Not edited, flagged: the route table in `docs/leda/LEDA_BROWSER_ROUTING.md` still lacks these routes.

- 2026-10-02 B8 Channel B enabled from the admin (commits 0c333b0 code+tests+README+master doc, 379fb45 DEPLOYMENT.md):
  - Rule: in protected mode (master key set) Channel B is enabled exactly when the Telegram credential is stored. `read_telegram_config` returns `enabled=True` there; the manager keeps the status field `enabled` equal to credential presence (starts false, true on save/successful apply, false on delete or a missing-credential apply), so it updates without a restart. `startup_apply` probes the resolver: missing credential is a pure no-op, any other failure is captured in `lastError`, nothing raises. The 10-field status shape is unchanged.
  - Env var decision: `LEDA_LOCAL_TELEGRAM_ENABLED` is ignored in protected mode (any value, no error, cannot block). Legacy environment mode is unchanged (still needs `=1`, still `TELEGRAM_DISABLED` otherwise). Removed from `docs/DEPLOYMENT.md`; README and the master doc scoped to legacy mode.
  - Behavior change: the voice process (`voice_service._telegram_token`) now resolves the stored credential in protected mode without the variable, so its obsolete test was replaced.
  - RED: new `test_telegram_channel_b_admin_enable.py`, 12 tests, 7 failures plus 1 error before the change; GREEN after.
  - Verification: full offline suite in Git Bash with a fresh temp state dir and override variables cleared: 2009 tests OK.
  - Flagged, not edited (outside the allowed surface): the stale comment in `voice_service.py:146-157` that still mentions the opt-in gate.

- 2026-10-02: native review of slice `3a3d856..331bbf6` (proxy route fix, B8, docs; medium, 490 lines): granted under standing consent, **approved** and acknowledged (lineage `review-1763dbc87d89fd83`).
  - `R3-startup-probe-outside-guard` (`telegram_lifecycle.py:502-506`) fixed in `8e04564`: an unexpected exception from the boot credential probe escaped `startup_apply` and could crash the runtime start. It is now reported as `CREDENTIAL_STORAGE_UNAVAILABLE`, like Channel A. RED: the new test failed with OSError. GREEN: the `test_telegram*.py` modules pass.
  - Follow-ups not fixed: `R3-enabled-diverges-from-credential-presence` (with storage unavailable at boot, `enabled` shows false until an apply) and `R3-voice-missing-credential-unproved` (test gap).
  - Live check: relaunched the dev env from the registry environment with NO `LEDA_LOCAL_TELEGRAM_ENABLED`. `/health` reports Telegram enabled, configured, connected and verified as `@Interfaz_hmi_bot`. B8 is confirmed live.

- 2026-10-02: B9 done in `c9837f6` (delegated writer). RED: the two new `AdminLayout` tests failed (no bell in the admin bar). GREEN: full HMI suite 297 files, 3988 tests OK; `npx tsc -b` and `npm run lint` clean. `AdminLayout` mounts the existing container `NotificationBell` first in the right-hand icon group, before Settings and the key icon; no refactor was needed (the panel is `fixed top-16 right-4`, within the viewport below the 3.5rem bar, and closes on outside click and Escape). Same hook, query key, in-flight guard and 30 s polling, so no duplicated logic. `AdminSessionLifecycle.integration` and `.replaced` tests render the real `AdminLayout`, so they now mock `NotificationBell` (the bell polls through the module-singleton client those tests do not drive; wrapping them in a `QueryClientProvider` still broke the StrictMode session-count assertion).
  - Route evidence: B9 delegated (bounded writer).

- 2026-10-02: B10 diagnosis (read-only explorer): it is not a code defect.
  - Channel B answers from the most recent live HMI context. The viewer publishes every 5 s only while it is open and visible (`Dashboard.tsx:71-92`), and it invalidates on route leave, hidden tab or offline. Publish and invalidate both answer 202.
  - The live log shows the last publish at 12:31:09, when the browser moved to the admin to approve, then a session reset. Channel B therefore had no context.
  - Options offered to the user: a clearer message (recommended for PW-022), retaining the last snapshot with an age, or PW-003. Waiting for the user's check with the viewer visible.
  - Test gap: there is no end-to-end test of publish → bot answer.
- 2026-10-02: native review of slice `331bbf6..4528464` (B9 + boot probe fix): high (it touches auth tests), four lenses, **approved** and acknowledged (lineage `review-3ac28598747f619a`).
  - `R2/R4-boot-probe-exception-swallowed` fixed in `1088678`: a redacted warning with the exception type only. RED: no log. GREEN: the `test_telegram*.py` modules pass.
  - Follow-ups not fixed: `R3-adminlayout-bell-hook-mocked`, `R3-bell-session-lifecycle-unproved` (the lifecycle tests mock the bell) and `R2-explode-stub-signature-masks-cause`.

## Acceptance criteria

- An unknown private chat that sends `/start` appears as pending in the HMI and gets no data until it is approved.
- An approved chat gets answers as today. A revoked chat stops getting them on its next message.
- The current paired chat keeps working after the upgrade, with no action needed.
- The audit log records every admission decision and contains no message text.
- All runtime and HMI tests pass.
