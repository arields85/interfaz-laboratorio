# PW-006 Prisma channel A and HMI voice responsiveness — ODD feature tracker

> ODD feature task (not SDD). Branch `feat/prisma-responsiveness-and-scaling` (from `main` b20edba),
> shared with PW-007 (`odd/tasks/pw-007-responsive-scaling.md`). Every commit belongs to one task of
> one feature. Engram mirror: `odd/pw-006-prisma-responsiveness/tasks`. Backlog detail:
> `backlog/prisma-channel-a-responsiveness`.

## Objective

Make Prisma feel responsive again in Telegram (channel A) and in HMI voice queries, and apply the
approved Telegram UX improvements.

## Problem and evidence (user-reported 2026-09-23)

1. After the QR scan the HMI popover reacts instantly, but the Telegram confirmation message arrives
   with a large lag (~1 min between messages in the pairing/confirm flow).
2. Confirmation copy is unclear: "Confirme para recibir en este teléfono las respuestas de ese
   documento." mentions "documento".
3. Keep-connected/unlink buttons scroll away in the chat.
4. No feedback while Prisma prepares an answer (dead time).
5. HMI voice queries lag, the orb is often missing, and there is often no audio. Behavior was more
   fluid before the migration from `C:\hmi_tts`. The user doubts QR pairing is the cause.

Root cause is unknown; diagnosis with real measurements comes first.

## Scope and constraints

- Read-only plant constraint unaffected (Prisma assistant and HMI configuration only).
- User-facing Spanish always uses formal "usted"; no "presentación" wording.
- Fixed ports 5056/5057/5173; single Prisma runtime and launcher; no git worktrees.
- Approved UX decisions:
  - Confirmation copy: "Está a un paso: confirme y Prisma responderá sus consultas en este chat."
  - Keep/unlink buttons: evaluate pinning the message (`pinChatMessage`) and a persistent reply
    keyboard with "Desvincular"; show both options to the user before implementing.
  - Telegram "typing…" chat action (`sendChatAction`) while preparing an answer.
- Out of scope: PW-003 semantic query (parked), channel B behavior changes, push/PR.

## TDD

Strict TDD: enabled (source: global orchestrator config). Runners:
- hmi-app: `cd hmi-app && npm test` (vitest; focused: `npx vitest run <file>`).
- prisma-runtime: `services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s services\prisma-runtime -p "test_*.py"`
  (focused: single test module).

## Delivery

Strategy: `ask-on-risk`. Forecast pending until diagnosis defines the fixes. RDD: off (global) —
no native review. Work-unit commits on the shared branch; `.gga` and `CLAUDE.md` stay untracked.
Integrate to `main` by fast-forward at the end together with PW-007; NO push.

## Tasks

- [x] **T1 — Root-cause diagnosis (read-only, static).** Route: delegated (mapping trigger).
  Findings (2026-09-23) — no root cause confirmed; current logs hold no evidence of the incident
  (logs are recreated on every launcher start, `start-local.ps1:209-210`):
  - Channel A: `getUpdates` long poll (25 s), batches handled serially on the poll thread
    (`channel_a_lifecycle.py` `_process_batch`/`_loop`). Query answering (`answer_from_snapshot`) is
    local and fast — ruled out as the blocker.
  - Likely cause 1: any transient poll failure ends the activation and `ChannelAManager` reconnects
    with backoff 5→10→20→40→80 s (cap 300 s) (`channel_a_manager.py:81-91`, verified) — matches the
    "~1 min" lag. Failures log `Canal A background failure: code=... next_delay_s=...`.
  - Discarded by the user (2026-09-23): VPN keep-alive (`C:\hmi_tts\mantener_vpn_steigen.ps1`)
    belonged to a first version where queries went through Node-RED over the VPN; Prisma and the
    snapshot are local, so the VPN plays no role. External poller on the same token (409): the bot
    token was rotated several times, so no other process can hold it.
  - HMI voice: 1 s HTTP polling (`voiceEventListener.service.ts`), progressive live PCM playback
    (`prismaVoiceAudioEngine.ts` `playProgressiveLive`) — architecture sound. Unconfirmed
    candidates: session-boundary gating dropping events (`prismaSessionClient`), AudioContext
    autoplay/resume after idle, TTS network latency; orb no-ops without `event.id`
    (`usePrismaOrbPresentation.ts:55-63`).
  - No timing instrumentation exists for update→send or query→first audio byte.
  - UX hooks: copy `channel_a_bot.py:154-159` (`CONFIRMATION_PROMPT_TEMPLATE`); buttons
    `channel_a_bot.py:151-152`, `_keyboard()` 485-491, attached at 1096-1097 and 1409-1410;
    typing needs `send_chat_action` on `ChannelATextTransport` (`channel_a_bot.py:313-326`) and
    `ChannelATransport` (`channel_a_transport.py`), call site `_handle_query` (~874).
- [ ] **T2 — Confirmation copy.** Replace the pairing confirmation text with the approved copy.
- [ ] **T3 — Keep/unlink buttons reachable.** Present pinned-message vs persistent-keyboard options
  to the user, then implement the chosen one.
- [ ] **T4 — Typing indicator.** Send Telegram "typing…" while an answer is being prepared.
- [ ] **T5 — Timing instrumentation.** Monotonic timing logs for Channel A update received →
  message sent, and HMI voice query → first audio byte, so the lag can be measured.
- [ ] **T6 — Live repro and confirmation (user manual).** Tail the presentation log and watch the
  admin reconnecting indicator during a QR pairing and voice queries; check VPN state and stray
  processes polling the same token.
- [ ] **T7+ — Root-cause fixes.** Defined from T5/T6 evidence.

## Acceptance criteria

- Pairing/confirm messages in Telegram arrive without perceptible lag (measured before/after).
- HMI voice queries show the orb and play audio consistently, with latency comparable to
  pre-migration behavior.
- Approved copy, reachable keep/unlink control, and typing indicator in place.
- All gates green: vitest, `tsc`, eslint, prisma-runtime unittest discover.

## Progress

- 2026-09-23: branch created; feature document created. T1 static diagnosis done (no
  confirmed root cause).

## Next step

T2 copy + T4 typing + T5 instrumentation (writer), then T6 live repro with the user; T3 needs the
user's choice.
