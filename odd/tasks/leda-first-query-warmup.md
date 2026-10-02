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

- [x] W1 — Instrumentation: one redacted timing line per Channel B message (stage names and milliseconds only, no text, no chat names) in the presentation process (received → status → answer → text sent → voice requested) and in the voice process (job create, Gemini time to first byte, sendVoice, total). Both must be visible in the runtime log files. Route: delegated.
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
- 2026-10-02: W1 done in `136b994` (`feat(leda-runtime): log redacted Channel B stage timings`, route: delegated writer). RED observed first: 17 new tests failed because no timing line existed (the 11 pure `timing_log` helper tests were written after the small helper module, so they have no RED). GREEN: full runtime suite, 2102 tests OK (`unittest discover -s services/leda-runtime -p 'test_*.py'`, fresh state dir, `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN` unset).
  - **Visibility:** a dedicated `leda_runtime.timing` logger (INFO, `propagate=False`) with its own timestamped stderr handler, installed by each process' `main()` (`timing_log.install_timing_log_handler`). No global INFO logging; every other logger keeps its visibility. Each line is prefixed with `YYYY-MM-DD HH:MM:SS,mmm` so the two processes' lines can be correlated by time.
  - **Redaction:** values are only ints, booleans or `[A-Za-z0-9_]{1,40}` tokens, anything else is written as `redacted`; keys are plain identifiers; emitting never raises.
  - **`leda-presentation-stderr.log`:**
    - `Leda Channel B timing: outcome=<answered|start|command|unapproved|limited|voice_failed|error> [telegram_lag_s=N] [status_ms=N] [download_ms=N] [transcription_ms=N] [answer_ms=N] [text_send_ms=N] [voice_enqueue_ms=N] total_ms=N` (one per handled private message; `telegram_lag_s` is wall-clock now minus Telegram's message `date`; `download_ms` and `transcription_ms` only for voice notes; `status_ms` is rate-limit admission plus the pairing-status read);
    - `Leda Channel B voice request timing: outcome=<dispatched|failed> queue_wait_ms=N mint_ms=N voice_request_ms=N [http_status=N] total_ms=N` (one per queued voice request, from the voice worker thread; `voice_request_ms` is the loopback round trip, i.e. the voice process' whole TTS plus sendVoice);
    - `Leda Channel B poll timing: updates=N poll_wait_ms=N offset_ms=N` (one per non-empty `getUpdates` batch; `offset_ms` is the summed `set_offset` cost).
  - **`leda-voice-stderr.log`:**
    - `Leda Channel B voice timing: outcome=<sent|send_failed|error> job_create_ms=N [gemini_client_reused=true|false] [gemini_ttfb_ms=N] [tts_total_ms=N] [opus_finish_ms=N] [send_voice_ms=N] total_ms=N` (one per Channel B voice reply; `tts_total_ms` runs from generator start to the start of delivery; `gemini_*` are absent on an exact-text cache hit; HMI voice and Channel A jobs log no such line);
    - `Leda Gemini warm-up: outcome=ok elapsed_ms=N` or `Leda Gemini warm-up: outcome=failed stage=<credential|client|connect> error_type=<ExceptionTypeName> elapsed_ms=N` (once at boot; a missing credential also logs `failed stage=credential`).
  - **Limits:** the voice-side token resolve (loopback call back to the presentation process) has no stage of its own: it is the gap between `voice_request_ms` and the voice line's `total_ms`. Open: none blocking W2.
