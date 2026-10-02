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
- [x] W2 — Live measurement with the user: restart; question after 2+ min idle; question right after; question after 30 s; question after 90 s. Note whether the text or only the voice note is late.
- [x] W3 — Fix according to the evidence. If the Gemini keep-alive is confirmed: a lightweight periodic keep-warm (e.g. `client.models.get` every ~45 s while Channel B or the voice service is active; no tokens). Possibly also keep the Telegram voice session warm, or pre-warm ffmpeg at boot if W2 points there. Route: delegated.
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
- 2026-10-02: W1 native review (slice `71215f9..a2f8b40`, medium, 753 lines): granted under standing consent, **approved** and acknowledged (lineage `review-48a663bd7925fa2a`).
  - Follow-ups not fixed: `R3-flaky-worker-line-leak` (`test_telegram_lifecycle.py:1427-1429`), `R3-answered-before-send`, `R3-document-fallback-mislabel`.
  - Boot warm-up logged `outcome=ok elapsed_ms=2024`.
- 2026-10-02: **W2 live measurement** (user; the first question came after ~32 min idle):

  | Question | Idle before | Text total | Voice total | gemini_ttfb | send_voice |
  |---|---|---|---|---|---|
  | 1 | ~32 min | 391 ms | 7619 ms | 816 ms | **5300 ms** |
  | 2 | ~16 min | 938 ms | 6995 ms | 754 ms | **4531 ms** |
  | 3 | 33 s | 384 ms | 2781 ms | 542 ms | 838 ms |
  | 4 | 52 s | 391 ms | 1145 ms | cache hit | 1056 ms |

  - The **text is never slow** (under 1 s even cold).
  - The cold penalty is almost entirely **Telegram `sendVoice` in the voice process**: about 4.5-5.3 s cold against about 0.8-1 s warm.
  - **Gemini is not the cause**: 0.8 s cold against 0.5 s warm. The main hypothesis is refuted.
  - `job_create_ms=774` only on the first voice note after a restart (ffmpeg spawn), 1 ms afterwards.
  - PW-022/PW-025 are not the cause: the voice path is untouched.
- 2026-10-02: connection probe to api.telegram.org (no credentials):
  - DNS 38 ms; IPv6 and IPv4 connect about 235 ms; TLS about 235 ms;
  - a new `requests` session GET takes about 1.5 s.
  - A fresh connection therefore does not explain about 4 s extra. The likely cause is reusing a pooled connection that the network silently dropped while idle, then waiting and reconnecting. This is inferred, not proven.
  - Fix chosen for W3: keep the voice process's Telegram session warm (lightweight `getMe` about every 30 s while Channel B is enabled), plus a Gemini keep-warm (`models.get`, no tokens) inside the 55 s keep-alive window.
- 2026-10-02: W3 done in `4d79686` (`feat(leda-runtime): keep the voice service's Telegram and Gemini connections warm`, route: delegated writer). RED observed first: `tests/test_keep_warm.py` failed with `ImportError` (no `keep_warm` module). GREEN: full runtime suite, 2122 tests OK (2102 + 20 new; fresh state dir, `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN` unset, no real network I/O: injected wait/stop event, mocked session and client).
  - **Telegram:** `keep_warm.run_keep_warm_loop` probes `getMe` on the shared `_TELEGRAM_HTTP_SESSION` every 30 s (`TELEGRAM_KEEP_WARM_INTERVAL_SECONDS`), first probe at boot, holding `_TELEGRAM_HTTP_LOCK` so it never overlaps a send. Token resolved by `_telegram_token()`; no token means no call.
  - **Gemini:** `models.get` (no tokens) on the `WarmGeminiClient` every 45 s (`GEMINI_KEEP_WARM_INTERVAL_SECONDS`, below the 55 s keep-alive; a test enforces it). The credential is re-resolved each cycle and `WarmGeminiClient.get` rebuilds on rotation; `GeminiCredentialUnavailable` means skip, silently.
  - **Logging (`leda_runtime.timing`, leda-voice-stderr.log):** one `Leda keep-warm: target=telegram|gemini interval_s=N` line per loop start, then `outcome=failed error_type=<Type>` and `outcome=recovered` on state changes only (exception type only, never message, URL or token). Daemon threads plus a stop event set when `app.run` returns.
  - **Stale-connection guard: not added.** urllib3 retries a dead pooled socket as a read error, the case where a non-idempotent `sendVoice` could be duplicated, and a connect-only retry does not address a silent drop. The keep-warm is the fix; W4 live re-check decides whether anything more is needed.
- 2026-10-02 16:15: **W4 attempt (live, ~11 min idle, W3 keep-warm active):**

  | Metric | Cold (first after idle) | Warm (next) |
  |---|---|---|
  | Voice process `send_voice_ms` | 762 ms | 769 ms |
  | Voice total (`voice_request_ms`) | 2094 ms | 2847 ms |
  | Presentation `text_send_ms` | **20932 ms** | 382 ms |

  - The voice process is fixed (was 4.5-5.3 s cold); W3 works there.
  - **Diagnosis:** ~21 s is Windows' TCP data-retransmission give-up time on a dead connection, after which urllib3 reconnects and succeeds. Idle pooled connections to api.telegram.org are silently dropped by the network (NAT/firewall idle timeout, no RST). `TelegramLocalBot.session` is shared by the long poll (one connection always busy) and by concurrent senders (`_typing` thread's `sendChatAction`, main `sendMessage`), so the pool holds a second connection that idles between questions and goes stale. The W3 `getMe` probe only exercises one connection and exists only in the voice process.
- 2026-10-02: W3b done in `5e07229` (`fix(leda-runtime): keep every Telegram connection alive at the TCP level`, route: delegated writer). RED observed first: `tests/test_http_keepalive.py` failed with `ImportError` (no `http_keepalive` module). GREEN: full runtime suite, 2132 tests OK (2122 + 10 new; fresh state dir, `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN` unset, no real network I/O).
  - **Mechanism:** `http_keepalive.KeepAliveHTTPAdapter` passes `socket_options` to urllib3: its defaults (`TCP_NODELAY`) plus `SO_KEEPALIVE=1`, `TCP_KEEPIDLE=20 s`, `TCP_KEEPINTVL=10 s`, `TCP_KEEPCNT=3`, each guarded by `hasattr(socket, ...)`. Probes keep the NAT mapping alive or detect a dead connection (~50 s) while idle. No request retries (POSTs are never duplicated).
  - **Sessions switched:** `TelegramLocalBot.session` and `_notice_session` (`local_presentation.py`), `_TELEGRAM_HTTP_SESSION` (`voice_service.py`), the Channel A default session (`channel_a_transport.py:_default_session`, `trust_env=False` kept).
  - **Not switched:** `telegram_verification.py` (one-shot verification session, outside the allowed surface) and loopback or non-Telegram sessions.
  - **W3 `getMe` keep-warm kept:** it is cheap and measured working; it also refreshes the connection at the application layer where TCP keep-alive cannot (for example a middlebox that ignores keep-alive probes).
- 2026-10-02: W3/W3b native review (slice `a2f8b40..c98f7f7`, medium, 527 lines): **approved** and acknowledged (lineage `review-97936ac8519484b3`).
  - Follow-ups: `R3-probe-holds-send-lock` (`voice_service.py:156-157`: a slow getMe can delay a send by up to 5 s), `R3-proxy-path-no-keepalive`, `R3-main-wiring-probe-first-unasserted`.
- 2026-10-02 16:44: **W4 attempt 2 failed for the text.** Cold `text_send_ms=20908` (second question 372 ms). Voice OK: `send_voice_ms` 778/833 ms.
  - The text delay is almost identical to the first attempt (20932 ms) and equals the 20 s `sendMessage` timeout plus about 0.9 s.
  - **Refined root cause (measured):** IPv6 to api.telegram.org fails intermittently from this network. Repeated connect probes: IPv4 149.154.166.110 succeeded 6 of 6 (about 235 ms); IPv6 2001:67c:4e8:f004::9 timed out 1 of 6.
  - urllib3 tries the IPv6 address first (getaddrinfo order). A NEW connection hitting the bad IPv6 attempt waits the whole connect timeout (20 s presentation `sendMessage`, 5 s voice `sendChatAction`/getMe) before falling back to IPv4.
  - This also explains the earlier 4.5-5.3 s voice cases.
  - TCP keep-alive (W3b) does not help, because the delay is in opening a connection, not in a stale one.
- [x] W3c — Prefer IPv4 for Telegram connections, with IPv6 fallback only when no IPv4 address exists. Route: delegated.
- 2026-10-02: W3c done in `144fa17` (`fix(leda-runtime): connect to Telegram over IPv4 first`, route: delegated writer). RED observed first: 3 failures and 1 error in `tests/test_http_keepalive.py` (IPv4 not tried first). GREEN: full runtime suite, 2139 tests OK (fresh state dir, `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN` unset, no real network I/O).
  - **Mechanism (urllib3 2.7.0):** `KeepAliveHTTPAdapter.init_poolmanager` sets `poolmanager.pool_classes_by_scheme` to pool classes whose `ConnectionCls` overrides `_new_conn`: it resolves the host, then dials IPv4 addresses first and IPv6 after by swapping `_dns_host` per attempt (`self.host` is untouched, so SNI and certificate verification use the hostname). Each attempt keeps the connect timeout; W3b socket options and no-retry are unchanged. Nothing process-wide is patched.
  - **Edge cases:** IPv6-only host or name-resolution failure takes urllib3's unchanged path. Proxied requests use `ProxyManager`, which bypasses the pool classes and the socket options (as already for keep-alive); documented, not worse.
  - **Smoke (public `GET https://api.telegram.org/`, fresh session each, no credentials):** 5/5 over IPv4 (149.154.167.99), 1521-1618 ms each (includes DNS, TCP and TLS from this network).
