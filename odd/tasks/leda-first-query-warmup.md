# Leda: the first question after idle is slow — ODD feature document

> ODD feature task (not SDD). Branch `feat/leda-first-query-warmup` from `main` `71215f9`.
> Engram mirror: `odd/leda-first-query-warmup/tasks`. Backlog: PW-026 (`backlog/leda-first-query-warmup`).

## Problem

The user reported on 2026-10-02 that the first question sent to the Channel B bot after some idle time, or after a restart, takes noticeably long to answer, while the following questions answer very fast. The user believes this did not happen before PW-022 or PW-025. That belief is not verified.

## Prior work (the user asked to check memory and docs first)

`odd/tasks/pw-006-leda-responsiveness.md` (2026-09-23/24) already worked on Leda's latency:

- **Warm client:** `WarmGeminiClient` builds the Gemini client once, and a boot warm-up thread (`voice_service.py:1328`, `_warm_up_gemini_client_in_background`) runs at start.
- **Keep-alive:** `GEMINI_HTTP_KEEPALIVE_EXPIRY_SECONDS = 55.0` (`gemini_credentials.py:34`). httpx's default 5 s keep-alive closed the pooled connection between humanly spaced questions. A cold call measured 1335 ms against 559 ms warm.
- **Recorded:** "first request slowest". First audio chunk at 2.3–6.7 s.

## Findings (read-only map, 2026-10-02)

- The text answer is local (`answer_from_snapshot`) and is sent on `self.session`, which the long poll keeps warm. The poll loop has no idle backoff: `getUpdates` timeout 25, read timeout 35, immediate re-poll (`local_presentation.py:1281-1333`).
- The voice note is the only cold-sensitive stage. It needs a loopback HTTP call to the voice process, an ffmpeg spawn, Gemini TTS (`generate_content_stream`) and Telegram `sendVoice` on `_TELEGRAM_HTTP_SESSION`.
- **Main hypothesis (inferred, not measured):** the Gemini connection closes after 55 s idle. The first TTS call after any longer gap pays TCP, TLS and HTTP setup again, plus possible server-side cold start. This also explains "slow after idle" without a restart.
- Other suspects:
  - a cold Telegram `sendVoice` connection;
  - the ffmpeg spawn and first-use init, after a restart;
  - a silent boot warm-up failure, which would put the client build on the first question (about 30 s, F2 notes).
- **PW-022/PW-025 changes since `a15ac95`:** one extra state-file read, one in-memory rate-limit check and one first-use SQLite open per message. They are milliseconds, off the voice path, and an unlikely cause.
- **Existing timing logs** (`time_to_first_byte_ms`, `Leda TTS job create: elapsed_ms`, Gemini `build_elapsed_ms`/`reused`) are INFO-level and probably hidden under the default WARNING handler. The presentation process has no per-message timing.

## Tasks

- [ ] W1 — Instrumentation: one redacted timing line per Channel B message (stage names and milliseconds only, no text, no chat names) in the presentation process (received → status → answer → text sent → voice requested) and in the voice process (job create, Gemini time to first byte, sendVoice, total). Both must be visible in the runtime log files. Route: delegated.
- [ ] W2 — Live measurement with the user: restart; question after 2+ min idle; question right after; question after 30 s; question after 90 s. Note whether the text or only the voice note is late.
- [ ] W3 — Fix according to the evidence. If the Gemini keep-alive is confirmed: a lightweight periodic keep-warm (e.g. `client.models.get` every ~45 s while Channel B or the voice service is active; no tokens). Possibly also keep the Telegram voice session warm, or pre-warm ffmpeg at boot if W2 points there. Route: delegated.
- [ ] W4 — Live re-check with the user, native review, and close PW-026.

## TDD

Default test-first policy:

- runtime runner: `services/leda-runtime/.venv/Scripts/python.exe -B -m unittest discover -s services/leda-runtime -p 'test_*.py'`, with a fresh `LEDA_RUNTIME_STATE_DIR` passed through `cygpath -w`.

## Acceptance criteria

- The cause of the slow first question is measured, not guessed.
- After the fix, a question after several minutes of idle answers (text and voice) close to a warm question, within the Gemini floor recorded in PW-006.
- No new costs per message; any keep-warm call uses no model tokens.
- All runtime tests pass.

## Progress

- 2026-10-02: prior work checked at the user's request (PW-006), path mapped, feature document created.
