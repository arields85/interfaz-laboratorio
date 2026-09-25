"""Local-only Prisma voice service.

The productive path uses Gemini Interactions TTS, streams processed PCM to the
HMI, and optionally sends the same processed audio to Telegram. No Gemini Live
session, central configuration endpoint, VPN binding, or industrial write path
is part of this service.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import logging
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import wave
from collections import OrderedDict
from datetime import datetime, timezone
from uuid import UUID

import requests
from flask import Flask, Response, jsonify, request

from .access_log_redaction import install_access_log_query_redaction
from .audio_observability import BoundedAudioSink
from .credential_store import CredentialService
from .event_audio import AudioCapacityError, AudioCoordinator, AudioCoordinatorError
from .hmi_sessions import CAPABILITY_HEADER
from .gemini_credentials import GeminiCredentialResolver, GeminiCredentialUnavailable, WarmGeminiClient, create_gemini_client
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions
from .telegram_config import read_telegram_config
from .telegram_credentials import TelegramCredentialError, TelegramCredentialResolver
from .voice_dsp import PrismaStreamingDSP, apply_prisma_dsp_full_pcm
from .voice_events import validate_voice_event
from .voice_transcription import (
    MAX_VOICE_NOTE_FILE_SIZE_BYTES,
    VoiceTranscriptionEmpty,
    VoiceTranscriptionError,
    VoiceTranscriptionUnavailable,
    transcribe_voice_note,
)


app = Flask(__name__)
# T5: no `logging.basicConfig` exists anywhere in this runtime (see the T16
# comment in `channel_a_manager.py`), so a module logger with no handler
# falls back to `logging`'s own WARNING-or-above "handler of last resort".
# PW-011 M4: every timing/diagnostic line in this module is routine, not a
# warning-worthy condition, so it is logged at INFO -- invisible to that
# last-resort handler by default, exactly as intended; enable it locally
# (e.g. `logging.basicConfig(level=logging.INFO)`) to see it. Only a
# duration is ever logged, never an event id, question or answer text.
_logger = logging.getLogger(__name__)
# T11: switched from gemini-3.1-flash-tts-preview (Interactions API,
# client.interactions.create) to the stable gemini-3.8-flash-lite-tts model
# via client.models.generate_content_stream -- user-authorized decision
# (2026-09-23) after a benchmark showed the new pairing both averages a much
# lower Gemini time-to-first-byte and, at "normal" style (plain transcript,
# no style/prompt instructions), reads the transcript verbatim by default,
# unlike the 3.1 preview model, which needed the 45-line build_tts_prompt as
# guard rails.
TTS_MODEL = "gemini-3.8-flash-lite-tts"
VOICE = "Leda"
SAMPLE_RATE = 24000
CHANNELS = 1
SAMPLE_WIDTH = 2
PRISMA_VOICE_HOST = "127.0.0.1"
prisma_audio_sink = BoundedAudioSink()
_TELEGRAM_HTTP_SESSION = requests.Session()
_TELEGRAM_HTTP_LOCK = threading.Lock()
_VOICE_EVENT_URL = "http://127.0.0.1:5057/internal/prisma/voice-events"
_VOICE_EVENT_MAX_BYTES = 32 * 1024
# B1: Channel B (the remote personal Telegram bot) has no HMI owner and no
# published voice event -- resolving its own bearer token round-trips to this
# dedicated presentation route instead of /internal/prisma/voice-events/<id>,
# so it can never reach the shared voice_events store (see
# VoiceEventStore.mint_channel_b_reply_token's own docstring).
_CHANNEL_B_VOICE_REPLY_URL = "http://127.0.0.1:5057/internal/prisma/channel-b/voice-reply"
_CHANNEL_B_VOICE_REPLY_MAX_TEXT_BYTES = 16 * 1024
# PW-013: same loopback round-trip discipline as the Channel B reply token
# above, for a voice-note *question* -- presentation downloads and bounds
# the audio, mints a token, and this process resolves it back here before
# running Gemini transcription (see VoiceEventStore.mint_voice_transcription_
# token's own docstring). The base64 bound is sized off the same audio-size
# cap both bots already enforce before minting (MAX_VOICE_NOTE_FILE_SIZE_
# BYTES), plus base64's ~4/3 expansion and a small fixed margin.
_VOICE_TRANSCRIPTION_URL = "http://127.0.0.1:5057/internal/prisma/voice-transcription"
_VOICE_TRANSCRIPTION_MAX_AUDIO_BASE64_CHARS = (MAX_VOICE_NOTE_FILE_SIZE_BYTES * 4 // 3) + 64
gemini_credentials = GeminiCredentialResolver()
# T10 unit 2: one warm Gemini client reused across requests instead of one
# new client per request; see WarmGeminiClient's docstring for the
# invalidation design (implicit, via a secret-hash comparison on every call,
# not a cross-process signal from the presentation process's admin routes).
_warm_gemini_client = WarmGeminiClient()
voice_event_http = requests.Session()
voice_event_http.trust_env = False


def _default_telegram_credential_service() -> CredentialService:
    # F1 (live test 2026-09-25): identical construction to
    # gemini_credentials._default_service -- the same protected store, same
    # permission checker, same runtime paths -- so the Channel B bot token
    # (provider "telegram") resolves from exactly the store the presentation
    # process's own TelegramLifecycleManager already reads it from.
    paths = runtime_paths()
    permissions = SecureStoragePermissions()
    return CredentialService(
        paths.credential_database,
        os.environ.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", ""),
        paths.root,
        permissions.verify,
    )


# F1: mirrors gemini_credentials's own module-level resolver -- cached
# (mtime-based, see TelegramCredentialResolver) so a chat action or a TTS
# job creation (both call _telegram_token() far more often than
# presentation's own construction-time-only resolve) never pays a fresh
# protected-store read on every call.
telegram_credentials = TelegramCredentialResolver(credential_service_factory=_default_telegram_credential_service)


def _telegram_post(url, **kwargs):
    with _TELEGRAM_HTTP_LOCK:
        return _TELEGRAM_HTTP_SESSION.post(url, **kwargs)


def _valid_telegram_chat_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value != 0 and abs(value) <= 9007199254740991


def _safe_event_id(value):
    raw = str(value or "").strip()
    return "sin_event_id" if not raw else "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in raw)[:100]


def _telegram_token():
    # F1 (live test 2026-09-25): telegram_config.telegram_token() always
    # returns "" in protected mode (PRISMA_CREDENTIAL_MASTER_KEY_FILE set) --
    # that silently cancelled every Channel B voice-note reply job
    # (_send_same_prisma_audio_to_telegram / _create_interactions_tts_job's
    # encoder creation, both gated on this). Protected mode resolves the
    # SAME "telegram" secret the presentation process's own Channel B bot
    # construction already reads (see local_presentation.create_app's
    # TelegramCredentialResolver(os.environ, lambda: credentials)); the
    # PRISMA_LOCAL_TELEGRAM_ENABLED opt-in gate still applies in both modes,
    # exactly as read_telegram_config already enforced for environment mode.
    config = read_telegram_config()
    if not config.enabled:
        return ""
    if config.source != "protected":
        return config.token
    try:
        return telegram_credentials.resolve()
    except TelegramCredentialError:
        _logger.warning("Telegram voice delivery: protected bot token unavailable")
        return ""


def _telegram_chat_action(chat_id, action):
    token = _telegram_token()
    if not token or not _valid_telegram_chat_id(chat_id):
        return False
    try:
        return _telegram_post(f"{os.environ.get('TELEGRAM_BOT_API_BASE', 'https://api.telegram.org').rstrip('/')}/bot{token}/sendChatAction", data={"chat_id": str(chat_id), "action": action}, timeout=5).ok
    except Exception:
        return False


_TELEGRAM_ENCODER_END = object()


class TelegramOpusStreamEncoder:
    """Incrementally encode post-DSP PCM to OGG/Opus without blocking HMI streaming."""

    def __init__(self, event_id):
        self.event_id = _safe_event_id(event_id); self.input_queue = queue.Queue(maxsize=32); self.ogg_parts = []; self.stderr_parts = []; self.output_bytes = 0
        self.done, self.cancelled, self.finish_requested = threading.Event(), threading.Event(), threading.Event(); self.failed = None; self.process = None
        self.thread = threading.Thread(target=self._run, name=f"PrismaOpus-{self.event_id}", daemon=True); self.thread.start()

    def feed(self, pcm):
        if pcm and not self.done.is_set() and not self.cancelled.is_set():
            try: self.input_queue.put(pcm, timeout=1)
            except queue.Full: self.failed = "FFMPEG_INPUT_CAPACITY"; self.cancel(); raise PrismaTtsProviderError("TTS_ENCODER_CAPACITY") from None

    def request_finish(self):
        if not self.finish_requested.is_set():
            self.finish_requested.set()
            try: self.input_queue.put(_TELEGRAM_ENCODER_END, timeout=1)
            except queue.Full: self.failed = self.failed or "FFMPEG_INPUT_CAPACITY"; self.cancel()

    def cancel(self):
        if self.cancelled.is_set(): return
        self.cancelled.set()
        try: self.input_queue.put_nowait(_TELEGRAM_ENCODER_END)
        except queue.Full: pass
        if self.process is not None and self.process.poll() is None:
            try: self.process.terminate()
            except Exception: pass

    def finish_and_get(self, timeout=15):
        self.request_finish()
        if not self.done.wait(timeout): self.failed = self.failed or "FFMPEG_FINALIZE_TIMEOUT"; self.cancel(); return None
        if self.cancelled.is_set() or self.failed: return None
        data = b"".join(self.ogg_parts); return data or None

    def _reader(self, stream, target):
        try:
            while True:
                chunk = stream.read(8192)
                if not chunk: break
                self.output_bytes += len(chunk)
                if self.output_bytes > 16 * 1024 * 1024: self.failed = "FFMPEG_OUTPUT_CAPACITY"; self.cancel(); break
                target.append(chunk)
        except Exception as error:
            if not self.cancelled.is_set(): self.failed = self.failed or f"FFMPEG_READ_ERROR:{error!r}"

    def _run(self):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            try:
                import imageio_ffmpeg

                ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
            except (ImportError, RuntimeError):
                ffmpeg = None
        if not ffmpeg: self.failed = "FFMPEG_NOT_FOUND"; self.done.set(); return
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS), "-i", "pipe:0", "-vn", "-c:a", "libopus", "-b:a", os.environ.get("PRISMA_TELEGRAM_OPUS_BITRATE", "32k"), "-vbr", "on", "-compression_level", "10", "-application", "voip", "-f", "ogg", "pipe:1"]
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        try:
            self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0, creationflags=flags)
            stdout = threading.Thread(target=self._reader, args=(self.process.stdout, self.ogg_parts), daemon=True); stderr = threading.Thread(target=self._reader, args=(self.process.stderr, self.stderr_parts), daemon=True); stdout.start(); stderr.start()
            while True:
                item = self.input_queue.get()
                if item is _TELEGRAM_ENCODER_END or self.cancelled.is_set(): break
                try: self.process.stdin.write(item)
                except Exception as error:
                    if not self.cancelled.is_set(): self.failed = f"FFMPEG_STDIN_ERROR:{error!r}"
                    break
            if self.cancelled.is_set():
                if self.process.poll() is None: self.process.terminate()
            else: self.process.stdin.close()
            try: code = self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.failed = self.failed or "FFMPEG_WAIT_TIMEOUT"; self.process.kill(); code = self.process.wait(timeout=3)
            stdout.join(timeout=2); stderr.join(timeout=2)
            if code != 0 and not self.cancelled.is_set(): self.failed = self.failed or f"FFMPEG_EXIT_{code}:" + b"".join(self.stderr_parts).decode("utf-8", "replace")[-500:]
        except Exception as error:
            if not self.cancelled.is_set(): self.failed = f"FFMPEG_START_ERROR:{error!r}"
        finally: self.done.set()


def _start_telegram_recording_indicator(job):
    chat_id, stop = job.get("telegram_chat_id"), job.get("telegram_chat_action_stop")
    if not _valid_telegram_chat_id(chat_id) or not _telegram_token() or stop is None: return
    def worker():
        while not stop.is_set():
            _telegram_chat_action(chat_id, "record_voice")
            if stop.wait(4.0): break
    job["telegram_action_thread"] = threading.Thread(target=worker, name=f"PrismaTelegramAction-{_safe_event_id(job.get('event_id'))}", daemon=True)
    job["telegram_action_thread"].start()


def _cancel_telegram_job(job):
    if not job: return
    stop = job.get("telegram_chat_action_stop")
    if stop is not None: stop.set()
    action_thread = job.get("telegram_action_thread")
    if action_thread is not None and action_thread is not threading.current_thread(): action_thread.join(timeout=1)
    encoder = job.get("telegram_encoder")
    if encoder is not None: encoder.cancel()


def _send_same_prisma_audio_to_telegram(job):
    if not job or not _valid_telegram_chat_id(job.get("telegram_chat_id")): return
    event_id = _safe_event_id(job.get("event_id"))
    if job.get("cancelled") is not None and job["cancelled"].is_set(): _cancel_telegram_job(job); return
    token, encoder = _telegram_token(), job.get("telegram_encoder")
    if not token:
        # F1 (live test 2026-09-25): this used to cancel silently -- the
        # exact failure mode that made every Channel B voice-note reply
        # vanish with no trace in protected credential mode. No secret here
        # (there is none to log): only the safe, already-sanitized event id.
        _logger.warning("Telegram voice delivery cancelled: no bot token available (event_id=%s)", event_id)
        _cancel_telegram_job(job)
        return
    ogg_data = encoder.finish_and_get(timeout=15) if encoder else None; base = os.environ.get("TELEGRAM_BOT_API_BASE", "https://api.telegram.org").rstrip("/"); chat_id = job["telegram_chat_id"]
    # B1: reply to the question message when one was bound at job creation
    # (Channel B), so text and audio stay visually paired under overlapping
    # questions. Absent for every other caller (Channel A, HMI prefetch),
    # which never set telegram_reply_to_message_id -- omitted entirely
    # rather than sent as null, matching Telegram's own optional-field
    # convention for every other field here.
    reply_to = job.get("telegram_reply_to_message_id")
    reply_data = {"reply_to_message_id": reply_to} if reply_to else {}
    if ogg_data:
        try:
            response = _telegram_post(f"{base}/bot{token}/sendVoice", data={"chat_id": str(chat_id), **reply_data}, files={"voice": (f"prisma_{event_id}.ogg", ogg_data, "audio/ogg")}, timeout=15)
            if 200 <= response.status_code < 300: return
        except Exception: pass
        try:
            response = _telegram_post(f"{base}/bot{token}/sendDocument", data={"chat_id": str(chat_id), "caption": "Respuesta por voz de Prisma", **reply_data}, files={"document": (f"prisma_{event_id}.ogg", ogg_data, "audio/ogg")}, timeout=15)
            if 200 <= response.status_code < 300: return
        except Exception: pass
    pcm = b"".join(job.get("telegram_pcm_parts") or [])
    if pcm:
        try: _telegram_post(f"{base}/bot{token}/sendDocument", data={"chat_id": str(chat_id), "caption": "Respuesta por voz de Prisma", **reply_data}, files={"document": (f"prisma_{event_id}.wav", pcm_to_wav(pcm), "audio/wav")}, timeout=15)
        except Exception: pass
    # F1: every earlier branch above returns as soon as a 2xx response is
    # observed; reaching here means sendVoice and sendDocument(ogg) both
    # failed (and the pcm/wav fallback, if attempted, is fire-and-forget
    # with no observable outcome) -- never silent.
    _logger.warning("Telegram voice delivery: exhausted sendVoice/sendDocument attempts (event_id=%s)", event_id)


def _queue_same_prisma_audio_to_telegram(job):
    if not job or job.get("telegram_delivery_queued") or not _valid_telegram_chat_id(job.get("telegram_chat_id")) or not job.get("telegram_pcm_parts"): return
    if job.get("cancelled") is not None and job["cancelled"].is_set(): _cancel_telegram_job(job); return
    job["telegram_delivery_queued"] = True; stop = job.get("telegram_chat_action_stop")
    if stop is not None: stop.set()
    _send_same_prisma_audio_to_telegram(job)


DEFAULT_PRISMA_VOICE_CONFIG = {"effectEnabled": True, "preset": "robotic_medium_light", "effectIntensity": 100, "robotic": {"modulationHz": 30, "baseGain": 0.78, "modulationDepth": 0.22, "quantizationSteps": 260, "metallicHz": 410, "metallicMix": 0.04, "echo1DelayMs": 40, "echo1Gain": 0.22, "echo2DelayMs": 95, "echo2Gain": 0.10, "normalizationTarget": 29500, "normalizationMaxGain": 1.6}, "playbackBuffer": {"mode": "automatic", "manualSeconds": 0.2}}
PRISMA_VOICE_PRESETS = {"clean", "robotic_medium_light"}
PRISMA_ROBOTIC_FIELDS = set(DEFAULT_PRISMA_VOICE_CONFIG["robotic"])
PRISMA_PLAYBACK_BUFFER_FIELDS = set(DEFAULT_PRISMA_VOICE_CONFIG["playbackBuffer"])
PRISMA_PLAYBACK_BUFFER_MODES = {"automatic", "manual"}
# T4 design decision (2026-09-24, user-approved): manual buffer range
# 0.1-3.0 s in 0.1 s steps, default 0.2 s. Mirrors the HMI's
# `domain/prismaVoiceConfig.ts` constants of the same name/values -- one
# documented source per side, kept equal by hand (no shared schema for this
# plain config, unlike the generated audio-record types).
PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN = 0.1
PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX = 3.0
PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP = 0.1


def clone_json(value): return json.loads(json.dumps(value))
def _is_number(value): return isinstance(value, (int, float)) and not isinstance(value, bool)


def _is_valid_playback_buffer_manual_seconds(value):
    if not _is_number(value): return False
    if value < PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN - 1e-9 or value > PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX + 1e-9: return False
    steps = value / PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP
    return abs(steps - round(steps)) < 1e-6


def _migrate_prisma_voice_config(config):
    """T4 backward compatibility: a config persisted (or PUT by an old HMI
    client) before `playbackBuffer` existed has no such key at all. Backfill
    the default here, in front of `validate_prisma_voice_config`'s strict
    exact-field-set check, instead of loosening that check itself -- an
    actually unexpected/unknown field must keep failing validation."""
    if isinstance(config, dict) and "playbackBuffer" not in config:
        config = dict(config)
        config["playbackBuffer"] = clone_json(DEFAULT_PRISMA_VOICE_CONFIG["playbackBuffer"])
    return config


def validate_prisma_voice_config(config):
    if not isinstance(config, dict) or set(config) != {"effectEnabled", "preset", "effectIntensity", "robotic", "playbackBuffer"}: raise ValueError("CONFIG_FIELDS_INVALID")
    if not isinstance(config["effectEnabled"], bool): raise ValueError("effectEnabled must be boolean")
    if config["preset"] not in PRISMA_VOICE_PRESETS: raise ValueError("preset must be clean or robotic_medium_light")
    if not _is_number(config["effectIntensity"]) or not 0 <= config["effectIntensity"] <= 100: raise ValueError("effectIntensity must be between 0 and 100")
    robotic = config["robotic"]
    if not isinstance(robotic, dict) or set(robotic) != PRISMA_ROBOTIC_FIELDS: raise ValueError("robotic fields invalid")
    ranges = {"modulationHz": (0, 1000), "baseGain": (0, 4), "modulationDepth": (0, 1), "metallicHz": (0, SAMPLE_RATE / 2), "metallicMix": (0, 1), "echo1DelayMs": (0, 2000), "echo1Gain": (0, 1), "echo2DelayMs": (0, 2000), "echo2Gain": (0, 1), "normalizationTarget": (1, 32767), "normalizationMaxGain": (0, 10)}
    for field, (minimum, maximum) in ranges.items():
        value = robotic[field]
        if not _is_number(value): raise ValueError(f"{field} must be numeric")
        if value < minimum or value > maximum: raise ValueError(f"{field} out of range")
    steps = robotic["quantizationSteps"]
    if not isinstance(steps, int) or isinstance(steps, bool) or not 2 <= steps <= 65536: raise ValueError("quantizationSteps must be an integer between 2 and 65536")
    playback_buffer = config["playbackBuffer"]
    if not isinstance(playback_buffer, dict) or set(playback_buffer) != PRISMA_PLAYBACK_BUFFER_FIELDS: raise ValueError("playbackBuffer fields invalid")
    if playback_buffer["mode"] not in PRISMA_PLAYBACK_BUFFER_MODES: raise ValueError("playbackBuffer.mode must be automatic or manual")
    if not _is_valid_playback_buffer_manual_seconds(playback_buffer["manualSeconds"]): raise ValueError(f"playbackBuffer.manualSeconds must be between {PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN} and {PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX} in {PRISMA_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP} s steps")
    return clone_json(config)


class PrismaVoiceConfigStore:
    def __init__(self, path, config_mode="local", config_url=""):
        self.path, self.config_mode, self.config_url, self.lock = str(path), config_mode, config_url, threading.RLock(); self.config = self._load(); self.source = "local"; self.last_sync_at = None; self.last_sync_error = None; self.stop_event = threading.Event(); self.thread = None

    def allows_local_updates(self): return True

    def _load(self):
        try: return validate_prisma_voice_config(_migrate_prisma_voice_config(json.loads(open(self.path, encoding="utf-8").read())))
        except (OSError, ValueError, json.JSONDecodeError): return clone_json(DEFAULT_PRISMA_VOICE_CONFIG)

    def _write(self, config):
        directory = os.path.dirname(self.path); os.makedirs(directory, exist_ok=True); temporary = self.path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as stream: json.dump(config, stream, ensure_ascii=False, indent=2); stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    def get(self):
        with self.lock: return clone_json(self.config)

    def update_local(self, candidate):
        config = validate_prisma_voice_config(_migrate_prisma_voice_config(candidate))
        with self.lock: self._write(config); self.config = clone_json(config); return clone_json(config)

    def status(self): return {"source": "local", "centralUrlConfigured": False, "lastSyncAt": None, "lastSyncError": None}


prisma_voice_config_store = PrismaVoiceConfigStore(runtime_paths().voice_config)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"; response.headers["Access-Control-Allow-Headers"] = f"Content-Type, {CAPABILITY_HEADER}"; response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"; response.headers["Access-Control-Expose-Headers"] = "X-Prisma-Audio-Format, X-Prisma-Sample-Rate, X-Prisma-Channels"
    if request.path == "/prisma/speak-live": response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/prisma/config", methods=["GET", "PUT", "OPTIONS"])
def prisma_config():
    if request.method == "OPTIONS": return Response(status=204)
    if request.method == "GET": return jsonify({"config": prisma_voice_config_store.get(), "sync": prisma_voice_config_store.status()})
    try: config = prisma_voice_config_store.update_local(request.get_json(silent=True))
    except ValueError as error: return jsonify({"ok": False, "error": "INVALID_PRISMA_VOICE_CONFIG", "message": str(error)}), 400
    return jsonify({"config": config, "sync": prisma_voice_config_store.status()})


def gemini_configuration_status(environ=None):
    return GeminiCredentialResolver(environ).status() if environ is not None else gemini_credentials.status()


def _gemini_unavailable_response():
    return jsonify({"ok": False, "error": "GEMINI_CREDENTIAL_UNAVAILABLE", "message": "Gemini speech is unavailable."}), 503


def get_gemini_client(secret=None):
    # T10 unit 1: split credential-resolve time from client-build time so the
    # two very different costs (local/keyring read vs SDK/HTTP client setup)
    # are visible separately in the logs. No secret is ever logged.
    resolve_start = time.monotonic()
    resolved = secret if secret is not None else gemini_credentials.resolve()
    resolve_elapsed_ms = round((time.monotonic() - resolve_start) * 1000)
    build_start = time.monotonic()
    client, reused = _warm_gemini_client.get(resolved)
    build_elapsed_ms = round((time.monotonic() - build_start) * 1000)
    _logger.info(
        "Prisma Gemini client: resolve_elapsed_ms=%d build_elapsed_ms=%d reused=%s",
        resolve_elapsed_ms,
        build_elapsed_ms,
        reused,
    )
    return client


def _parse_event_publish_epoch(timestamp):
    """Parse the voice event's own ISO-8601 UTC `timestamp` field into epoch
    seconds, or None if missing/invalid. Reusing the event's own timestamp
    (instead of a second cross-process hash-correlation scheme) lets the
    delta be computed and logged directly here, in one number, without
    requiring a human to grep and subtract two separate log lines -- and it
    only needs comparable wall-clock time, unlike time.monotonic(), which is
    not comparable across processes."""
    if not isinstance(timestamp, str) or not timestamp.endswith("Z"):
        return None
    try:
        return datetime.fromisoformat(timestamp[:-1] + "+00:00").timestamp()
    except ValueError:
        return None


class PrismaTtsStreamError(RuntimeError):
    def __init__(self, code): self.code = code; super().__init__(code)
class PrismaTtsProviderError(PrismaTtsStreamError): pass
class PrismaTtsFormatError(PrismaTtsStreamError): pass


class ProviderStreamIdleGuard:
    def __init__(self, timeout=15):
        self.timeout = timeout
        self.condition = threading.Condition()
        self.last_activity = time.monotonic()
        self.stream = None
        self.stopped = False
        self.thread = None

    def start(self, stream):
        self.stream = stream
        self.thread = threading.Thread(target=self._run, name="PrismaProviderIdleGuard", daemon=True)
        self.thread.start()

    def touch(self):
        with self.condition:
            self.last_activity = time.monotonic()
            self.condition.notify_all()

    def close(self):
        with self.condition:
            self.stopped = True
            self.condition.notify_all()
        if self.thread is not None and self.thread is not threading.current_thread():
            self.thread.join(timeout=1)

    def _run(self):
        with self.condition:
            while not self.stopped:
                remaining = self.timeout - (time.monotonic() - self.last_activity)
                if remaining > 0:
                    self.condition.wait(remaining)
                    continue
                _close_tts_stream(self.stream)
                return


class S16LeChunkAssembler:
    def __init__(self): self.carry = b""
    def push(self, chunk):
        data = self.carry + bytes(chunk); size = len(data) // SAMPLE_WIDTH * SAMPLE_WIDTH; raw, self.carry = data[:size], data[size:]; return raw
    def finish(self):
        if self.carry: raise PrismaTtsFormatError("INCOMPLETE_PCM_S16LE_SAMPLE")


# T11: gemini-3.8-flash-lite-tts is spoken via the plain content-generation
# contract (client.models.generate_content_stream / generate_content), not
# the Interactions API the 3.1 preview model used. "Normal" style (the only
# style implemented -- see the task notes) sends the transcript as-is in
# `contents`, with no wrapping prompt: this model treats its input as a
# verbatim transcript by default, unlike 3.1, which needed 45 lines of guard
# rails (the removed build_tts_prompt) to avoid paraphrasing.
def _tts_generate_content_config():
    # Imported the same way as gemini_credentials.create_gemini_client
    # (importlib.import_module, resolved through sys.modules) for the same
    # test-time mockability at this exact SDK boundary.
    import importlib

    genai = importlib.import_module("google.genai")
    types = genai.types
    return types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE))
        ),
    )


def _create_tts_stream(client, text):
    return client.models.generate_content_stream(model=TTS_MODEL, contents=text, config=_tts_generate_content_config())


def _create_tts_response(client, text):
    return client.models.generate_content(model=TTS_MODEL, contents=text, config=_tts_generate_content_config())


def _close_tts_stream(stream):
    if stream is not None:
        try: stream.close()
        except Exception: pass


def _iter_inline_audio_parts(chunk):
    """A `generate_content_stream` chunk (or a non-streaming `generate_content`
    response, same shape) carries zero or more audio parts at
    candidates[].content.parts[].inline_data. Unlike the retired Interactions
    API, there is no separate per-delta event envelope to unwrap."""
    for candidate in getattr(chunk, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) if content is not None else None
        for part in parts or []:
            inline_data = getattr(part, "inline_data", None)
            if inline_data is not None and getattr(inline_data, "data", None):
                yield inline_data


def _mime_rate_param(normalized_mime_type):
    for parameter in normalized_mime_type.split(";")[1:]:
        name, _, value = parameter.strip().partition("=")
        if name == "rate":
            try: return int(value)
            except ValueError: return None
    return None


def _validate_audio_inline_data(inline_data):
    # Gemini TTS audio parts carry a mime type such as
    # "audio/L16;codec=pcm;rate=24000"; accept any audio/L16 variant and
    # only reject an explicit, different rate. No channel count is exposed
    # on inline_data (24 kHz mono PCM is this model's fixed TTS output), so
    # unlike the retired Interactions delta shape, channels are not checked
    # here.
    mime_type = getattr(inline_data, "mime_type", None)
    if mime_type is None: return
    normalized = str(mime_type).strip().lower()
    if not normalized.startswith("audio/l16"): raise PrismaTtsFormatError("UNSUPPORTED_TTS_AUDIO_MIME_TYPE")
    rate = _mime_rate_param(normalized)
    if rate is not None and rate != SAMPLE_RATE: raise PrismaTtsFormatError("UNSUPPORTED_TTS_SAMPLE_RATE")


def _decode_audio_inline_data(inline_data):
    _validate_audio_inline_data(inline_data)
    data = getattr(inline_data, "data", None)
    if isinstance(data, (bytes, bytearray)):
        # google-genai 2.17 delivers inline_data.data as raw bytes already.
        decoded = bytes(data)
    elif isinstance(data, str) and data:
        # Defensive fallback for an SDK/response shape that base64-encodes it.
        try: decoded = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError, TypeError): raise PrismaTtsFormatError("TTS_AUDIO_DATA_INVALID") from None
    else:
        raise PrismaTtsFormatError("TTS_AUDIO_DATA_MISSING")
    if not decoded: raise PrismaTtsFormatError("TTS_AUDIO_DATA_EMPTY")
    return decoded


def _iter_tts_audio_parts(stream, on_activity=lambda: None):
    """Yield each inline_data audio part across the stream. Unlike the
    retired Interactions API, generate_content_stream has no explicit
    "interaction.completed" terminal event -- the stream simply ends when
    Gemini is done; the caller's own "no audio at all" check covers a
    stream that ends without ever yielding anything."""
    try:
        for chunk in stream:
            on_activity()
            yield from _iter_inline_audio_parts(chunk)
    except GeneratorExit: raise
    except PrismaTtsStreamError: raise
    except Exception: raise PrismaTtsProviderError("TTS_STREAM_PROVIDER_FAILED") from None


class VoiceAudioCache:
    """T10 unit 4: exact-text audio cache.

    Identical answer text plus identical voice settings (and TTS model,
    voice, and active credential -- see `_voice_audio_cache_key`) replay
    already-generated, already-DSP-processed PCM instantly instead of
    calling Gemini again. Bounded by both entry count and total bytes
    (whichever limit is hit first evicts the least-recently-used entry);
    thread-safe for Flask's threaded workers.
    """

    def __init__(self, max_entries=32, max_bytes=64 * 1024 * 1024):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self._entries = OrderedDict()
        self._total_bytes = 0

    def get(self, key):
        with self._lock:
            data = self._entries.get(key)
            if data is None:
                return None
            self._entries.move_to_end(key)
            return data

    def put(self, key, data):
        if not data or len(data) > self.max_bytes:
            return
        with self._lock:
            existing = self._entries.pop(key, None)
            if existing is not None:
                self._total_bytes -= len(existing)
            self._entries[key] = data
            self._total_bytes += len(data)
            while self._entries and (len(self._entries) > self.max_entries or self._total_bytes > self.max_bytes):
                _, evicted = self._entries.popitem(last=False)
                self._total_bytes -= len(evicted)

    def clear(self):
        with self._lock:
            self._entries.clear()
            self._total_bytes = 0


_voice_audio_cache = VoiceAudioCache()


def _voice_audio_cache_key(job):
    """Bind the cache to exactly the inputs that determine the audio bytes:
    the transcript, the voice/DSP settings, the fixed model/voice constants,
    and the currently active credential's hash (read for free from the warm
    client, never forcing an extra resolve) so a credential rotation
    invalidates every prior entry without an explicit signal."""
    payload = json.dumps(
        {
            "text": job["text"],
            "voiceConfig": job["voice_config"],
            "model": TTS_MODEL,
            "voice": VOICE,
            "secretHash": _warm_gemini_client.current_secret_hash(),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _create_interactions_tts_job(text, event_id=None, telegram_chat_id=None, voice_config=None, telegram_reply_to_message_id=None):
    # T10: times the whole job-creation step, including the conditional
    # TelegramOpusStreamEncoder subprocess spin-up (ffmpeg) and recording
    # indicator thread start -- both skipped, and this staying near-zero, for
    # a plain HMI voice query with no Telegram chat attached.
    create_start = time.monotonic()
    config = clone_json(voice_config if voice_config is not None else prisma_voice_config_store.get()); valid_chat = telegram_chat_id if _valid_telegram_chat_id(telegram_chat_id) else None
    # B1: validated once here, exactly like valid_chat above, then trusted
    # verbatim by _send_same_prisma_audio_to_telegram.
    valid_reply_to = (
        telegram_reply_to_message_id
        if isinstance(telegram_reply_to_message_id, int) and not isinstance(telegram_reply_to_message_id, bool) and telegram_reply_to_message_id > 0
        else None
    )
    job = {"text": text, "cancelled": threading.Event(), "voice_config": config, "dsp": PrismaStreamingDSP(config), "event_id": str(event_id).strip() if event_id is not None and str(event_id).strip() else None, "telegram_chat_id": valid_chat, "telegram_reply_to_message_id": valid_reply_to, "telegram_pcm_parts": [], "telegram_pcm_bytes": 0, "telegram_delivery_queued": False, "telegram_encoder": None, "telegram_chat_action_stop": threading.Event()}
    prisma_audio_sink.emit("backend", "receipt", {})
    if valid_chat is not None and _telegram_token(): job["telegram_encoder"] = TelegramOpusStreamEncoder(job["event_id"])
    if valid_chat is not None: _start_telegram_recording_indicator(job)
    _logger.info(
        "Prisma TTS job create: elapsed_ms=%d telegram=%s",
        round((time.monotonic() - create_start) * 1000),
        valid_chat is not None,
    )
    return job


def _append_post_dsp_pcm(job, pcm):
    if not pcm: return None
    if job["telegram_pcm_bytes"] + len(pcm) > 16 * 1024 * 1024: raise PrismaTtsProviderError("TTS_AUDIO_CAPACITY")
    job["telegram_pcm_bytes"] += len(pcm)
    job["telegram_pcm_parts"].append(pcm)
    if job.get("telegram_encoder") is not None: job["telegram_encoder"].feed(pcm)
    return pcm


def _discard_tts_job(job):
    job["cancelled"].set(); _cancel_telegram_job(job); job["telegram_pcm_parts"].clear()


def _full_file_fallback_pcm(client, job):
    try:
        response = _create_tts_response(client, job["text"])
        pcm = b"".join(_decode_audio_inline_data(inline_data) for inline_data in _iter_inline_audio_parts(response))
    except Exception: raise PrismaTtsProviderError("TTS_FALLBACK_PROVIDER_FAILED") from None
    if not pcm or len(pcm) % SAMPLE_WIDTH: raise PrismaTtsFormatError("TTS_FALLBACK_AUDIO_INVALID")
    processed = apply_prisma_dsp_full_pcm(pcm, job["voice_config"])
    if not processed: raise PrismaTtsFormatError("TTS_FALLBACK_AUDIO_EMPTY")
    return processed


def _generate_tts_audio(job, secret=None, control=None):
    # T10 unit 4: exact-text audio cache, checked before any provider work.
    # A hit replays already-DSP-processed PCM straight from memory and never
    # calls Gemini; a miss falls through to the normal streaming path below,
    # which stores its result in the cache once it completes successfully.
    cache_key = _voice_audio_cache_key(job)
    cached = _voice_audio_cache.get(cache_key)
    if cached is not None:
        _logger.info("Prisma TTS cache: hit bytes=%d", len(cached))
        try:
            if control is not None and control.cancelled.is_set(): return
            delivered = _append_post_dsp_pcm(job, cached)
            prisma_audio_sink.emit("backend", "dsp", {"sample_count": len(cached) // SAMPLE_WIDTH})
            if delivered is not None: yield delivered
            if control is not None and control.cancelled.is_set(): return
            _queue_same_prisma_audio_to_telegram(job)
            prisma_audio_sink.emit("backend", "finalization", {"status": "success", "sample_count": len(cached) // SAMPLE_WIDTH})
        except GeneratorExit:
            _discard_tts_job(job)
            raise
        except Exception:
            prisma_audio_sink.emit("backend", "finalization", {"status": "error"})
            _discard_tts_job(job)
            raise PrismaTtsProviderError("TTS_STREAM_INTERNAL_FAILURE") from None
        return
    _logger.info("Prisma TTS cache: miss")

    client = stream = idle_guard = None; audio_accepted = False
    prisma_audio_sink.emit("provider", "dispatch", {})
    try:
        try:
            # T10 unit 2: `client` is now the shared warm singleton, so it is
            # never registered for cancel-callback close, and never closed in
            # this generator's `finally` below -- only the per-request stream
            # and idle guard are.
            client = get_gemini_client(secret)
            stream_requested_at = time.monotonic()
            stream = _create_tts_stream(client, job["text"])
            if control is not None: control.add_cancel_callback(lambda resource=stream: _close_tts_stream(resource))
            assembler = S16LeChunkAssembler(); idle_guard = ProviderStreamIdleGuard(); idle_guard.start(stream)
            if control is not None: control.add_cancel_callback(idle_guard.close)
            first_byte_at = None; first_yield_logged = False
            for inline_data in _iter_tts_audio_parts(stream, idle_guard.touch):
                if control is not None and control.cancelled.is_set(): return
                if first_byte_at is None:
                    first_byte_at = time.monotonic()
                    _logger.info(
                        "Prisma Gemini TTS: time_to_first_byte_ms=%d",
                        round((first_byte_at - stream_requested_at) * 1000),
                    )
                audio_accepted = True; canonical = assembler.push(_decode_audio_inline_data(inline_data))
                if canonical:
                    delivered = _append_post_dsp_pcm(job, job["dsp"].process(canonical))
                    prisma_audio_sink.emit("backend", "dsp", {"sample_count": len(delivered or b"") // SAMPLE_WIDTH})
                    if delivered is not None:
                        if not first_yield_logged:
                            _logger.info(
                                "Prisma Gemini TTS: first_yield_processing_elapsed_ms=%d",
                                round((time.monotonic() - first_byte_at) * 1000),
                            )
                            first_yield_logged = True
                        yield delivered
            assembler.finish()
            if not audio_accepted or not job["telegram_pcm_parts"]: raise PrismaTtsProviderError("TTS_STREAM_AUDIO_MISSING")
            prisma_audio_sink.emit("provider", "completion", {"status": "success"})
        except (PrismaTtsFormatError, GeneratorExit): raise
        except Exception as error:
            if control is not None and control.cancelled.is_set(): return
            if audio_accepted: raise error if isinstance(error, PrismaTtsProviderError) else PrismaTtsProviderError("TTS_STREAM_PROVIDER_FAILED") from None
            if idle_guard is not None: idle_guard.close(); idle_guard = None
            _close_tts_stream(stream); stream = None; delivered = _append_post_dsp_pcm(job, _full_file_fallback_pcm(client, job))
            prisma_audio_sink.emit("provider", "completion", {"status": "success"})
            if delivered is not None: yield delivered
        if control is not None and control.cancelled.is_set(): return
        _voice_audio_cache.put(cache_key, b"".join(job["telegram_pcm_parts"]))
        _queue_same_prisma_audio_to_telegram(job)
        prisma_audio_sink.emit("backend", "finalization", {"status": "success", "sample_count": sum(len(part) for part in job["telegram_pcm_parts"]) // SAMPLE_WIDTH})
    except GeneratorExit: _discard_tts_job(job); raise
    except PrismaTtsStreamError:
        prisma_audio_sink.emit("backend", "finalization", {"status": "error"})
        _discard_tts_job(job)
        raise
    except Exception:
        prisma_audio_sink.emit("backend", "finalization", {"status": "error"})
        _discard_tts_job(job)
        raise PrismaTtsProviderError("TTS_STREAM_INTERNAL_FAILURE") from None
    finally:
        if idle_guard is not None: idle_guard.close()
        _close_tts_stream(stream)


def pcm_to_wav(pcm):
    output = io.BytesIO()
    with wave.open(output, "wb") as result: result.setnchannels(CHANNELS); result.setsampwidth(SAMPLE_WIDTH); result.setframerate(SAMPLE_RATE); result.writeframes(pcm)
    return output.getvalue()


class VoiceSessionUnauthorized(RuntimeError):
    pass


def resolve_voice_event(event_id, capability="", http=None):
    try:
        canonical = str(UUID(str(event_id)))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("INVALID_VOICE_EVENT_REQUEST") from None
    session = http or voice_event_http
    session.trust_env = False
    response = None
    # T10: this internal HTTP round-trip to the presentation process (5057)
    # runs up to 3 times per HMI voice query (once in the /prisma/speak-live
    # route handler, once in AudioCoordinator.subscribe's admission
    # validation, once again in its worker thread right before generation),
    # so its own elapsed time is logged on every call, success or failure.
    # T12 evaluated removing one of the two AudioCoordinator-internal calls
    # but kept both: admission's revalidation is what lets a genuinely
    # invalid/unauthorized event map to a clean synchronous 404/401 instead
    # of a mid-stream failure (Flask has already committed the streaming
    # response's 200 status by the time a generator first yields), and the
    # worker's revalidation is what protects a job that waited in the queue
    # (see event_audio.py's own comment on subscribe() for the credential
    # resolve, which WAS safely reduced from 2x to 1x for the same request).
    resolve_start = time.monotonic()
    try:
        request_options = {
            "timeout": 2,
            "allow_redirects": False,
            "stream": True,
        }
        if capability:
            request_options["headers"] = {CAPABILITY_HEADER: capability}
        response = session.get(
            f"{_VOICE_EVENT_URL}/{canonical}",
            **request_options,
        )
        if response.status_code == 401:
            raise VoiceSessionUnauthorized("PRISMA_SESSION_REQUIRED")
        if response.status_code == 404:
            raise LookupError("VOICE_EVENT_NOT_FOUND")
        if response.status_code != 200 or 300 <= response.status_code < 400:
            raise RuntimeError("VOICE_EVENT_LOOKUP_UNAVAILABLE")
        raw = bytearray()
        for chunk in response.iter_content(4096):
            raw.extend(chunk)
            if len(raw) > _VOICE_EVENT_MAX_BYTES:
                raise RuntimeError("VOICE_EVENT_LOOKUP_UNAVAILABLE")
        payload = json.loads(raw)
        return validate_voice_event(payload, canonical, require_owner=bool(capability))
    except VoiceSessionUnauthorized:
        raise
    except LookupError:
        raise
    except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError):
        raise RuntimeError("VOICE_EVENT_LOOKUP_UNAVAILABLE") from None
    finally:
        if response is not None:
            try: response.close()
            except Exception: pass
        _logger.info(
            "Prisma voice event resolve: elapsed_ms=%d",
            round((time.monotonic() - resolve_start) * 1000),
        )


def _resolve_channel_b_voice_reply_payload(token, http=None):
    """B1: resolve a Channel-B voice-reply bearer token (minted by
    VoiceEventStore.mint_channel_b_reply_token) into its bound chat id,
    answer text and question message id. Same shape as resolve_voice_event
    (fixed target, disabled proxy, bounded, no redirect), but against the
    dedicated presentation route -- Channel B never resolves through
    /internal/prisma/voice-events/<id> and never reaches the shared
    voice_events store."""
    session = http or voice_event_http
    session.trust_env = False
    response = None
    resolve_start = time.monotonic()
    try:
        response = session.get(
            _CHANNEL_B_VOICE_REPLY_URL,
            headers={CAPABILITY_HEADER: token},
            timeout=2,
            allow_redirects=False,
        )
        if response.status_code == 401:
            raise VoiceSessionUnauthorized("PRISMA_SESSION_REQUIRED")
        if response.status_code != 200:
            raise RuntimeError("CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE")
        chat_id, text, reply_to = payload.get("chatId"), payload.get("text"), payload.get("replyToMessageId")
        if (
            not _valid_telegram_chat_id(chat_id)
            or not isinstance(text, str)
            or not text.strip()
            or len(text.encode("utf-8")) > _CHANNEL_B_VOICE_REPLY_MAX_TEXT_BYTES
            or not (reply_to is None or (isinstance(reply_to, int) and not isinstance(reply_to, bool) and reply_to > 0))
        ):
            raise RuntimeError("CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE")
        return {"chatId": chat_id, "text": text, "replyToMessageId": reply_to}
    except VoiceSessionUnauthorized:
        raise
    except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError):
        raise RuntimeError("CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE") from None
    finally:
        if response is not None:
            try: response.close()
            except Exception: pass
        _logger.warning(
            "Prisma channel B voice reply resolve: elapsed_ms=%d",
            round((time.monotonic() - resolve_start) * 1000),
        )


def _resolve_voice_transcription_payload(token, http=None):
    """PW-013: resolve a voice-transcription bearer token (minted by either
    bot right after downloading and bounding a voice note, see
    VoiceEventStore.mint_voice_transcription_token) into its bound base64
    audio, MIME type and domain-vocabulary hints. Same shape as
    _resolve_channel_b_voice_reply_payload (fixed target, disabled proxy,
    bounded, no redirect), against its own dedicated presentation route --
    this never touches the shared voice_events store either."""
    session = http or voice_event_http
    session.trust_env = False
    response = None
    resolve_start = time.monotonic()
    try:
        response = session.get(
            _VOICE_TRANSCRIPTION_URL,
            headers={CAPABILITY_HEADER: token},
            timeout=2,
            allow_redirects=False,
        )
        if response.status_code == 401:
            raise VoiceSessionUnauthorized("PRISMA_SESSION_REQUIRED")
        if response.status_code != 200:
            raise RuntimeError("VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE")
        payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE")
        audio_base64, mime_type, extra_terms = (
            payload.get("audioBase64"),
            payload.get("mimeType"),
            payload.get("extraTerms"),
        )
        if (
            not isinstance(audio_base64, str)
            or not audio_base64
            or len(audio_base64) > _VOICE_TRANSCRIPTION_MAX_AUDIO_BASE64_CHARS
            or not isinstance(mime_type, str)
            or not mime_type
            or not isinstance(extra_terms, list)
            or not all(isinstance(term, str) for term in extra_terms)
        ):
            raise RuntimeError("VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE")
        return {"audioBase64": audio_base64, "mimeType": mime_type, "extraTerms": extra_terms}
    except VoiceSessionUnauthorized:
        raise
    except (requests.RequestException, ValueError, TypeError, json.JSONDecodeError):
        raise RuntimeError("VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE") from None
    finally:
        if response is not None:
            try: response.close()
            except Exception: pass
        _logger.warning(
            "Prisma voice transcription resolve: elapsed_ms=%d",
            round((time.monotonic() - resolve_start) * 1000),
        )


def _deliver_channel_b_voice_reply(payload):
    """B1: the exact same Gemini TTS + Opus + Telegram delivery pipeline
    Channel A's telegramChatId path already exercises (_create_interactions_
    tts_job -> _generate_tts_audio -> _queue_same_prisma_audio_to_telegram on
    completion), but reached directly -- never through AudioCoordinator or
    the shared voice_events store, since Channel B has no HMI owner and no
    published voice event. The generator is drained for its Telegram-delivery
    side effect only; nothing streams back over HTTP here."""
    job = _create_interactions_tts_job(
        payload["text"],
        telegram_chat_id=payload["chatId"],
        telegram_reply_to_message_id=payload.get("replyToMessageId"),
    )
    for _chunk in _generate_tts_audio(job):
        pass


def _generate_event_audio(event, voice_config, secret, control):
    job = _create_interactions_tts_job(
        event["text"],
        event["id"],
        event.get("telegramChatId"),
        voice_config,
    )
    control.add_cancel_callback(lambda: _discard_tts_job(job))
    yield from _generate_tts_audio(job, secret, control)


def _revalidate_voice_event(event):
    authoritative = resolve_voice_event(event["id"], event.get("_capability", ""))
    if authoritative.get("ownerId") != event.get("ownerId"):
        raise LookupError("VOICE_EVENT_NOT_FOUND")


audio_coordinator = AudioCoordinator(gemini_credentials.resolve, _generate_event_audio, event_validator=_revalidate_voice_event)


@app.route("/prisma/speak", methods=["POST", "OPTIONS"])
def prisma_speak():
    if request.method == "OPTIONS": return Response(status=204)
    return jsonify({"ok": False, "error": "RAW_TTS_DISABLED"}), 410


@app.route("/health", methods=["GET"])
def health():
    config = prisma_voice_config_store.get()
    return jsonify({"ok": True, "ready": True, "mode": "local", "service": "prisma-voice", "assistant": "Prisma", "provider": "Google Gemini", "providerStatus": gemini_configuration_status(), "model": TTS_MODEL, "voice": VOICE, "streaming": True, "liveReady": False, "config": prisma_voice_config_store.status(), "voiceConfig": {"preset": config["preset"], "effectEnabled": config["effectEnabled"], "effectIntensity": config["effectIntensity"]}})


def _pcm_stream_response(generate_audio):
    stream = generate_audio(); response = Response(stream, mimetype="application/octet-stream"); response.headers["Cache-Control"] = "no-store"; response.headers["X-Accel-Buffering"] = "no"; response.headers["X-Prisma-Audio-Format"] = "pcm_s16le"; response.headers["X-Prisma-Sample-Rate"] = str(SAMPLE_RATE); response.headers["X-Prisma-Channels"] = str(CHANNELS)
    close = getattr(stream, "close", None)
    if callable(close): response.call_on_close(close)
    return response


def _timed_pcm_stream(stream, request_received):
    """Wrap a speak-live PCM generator with T5 timing, never altering its bytes.

    Logs the elapsed time from the request being received to the first yielded
    chunk (once), and again from the request being received to stream end
    (always, including on an early close or a generator error).
    """
    first_chunk_logged = False
    try:
        for chunk in stream:
            if not first_chunk_logged:
                _logger.info(
                    "Prisma speak-live: first_chunk_elapsed_ms=%d",
                    round((time.monotonic() - request_received) * 1000),
                )
                first_chunk_logged = True
            yield chunk
    finally:
        _logger.info(
            "Prisma speak-live: stream_end_elapsed_ms=%d",
            round((time.monotonic() - request_received) * 1000),
        )


@app.route("/prisma/speak-live", methods=["POST", "OPTIONS"])
def prisma_speak_live():
    request_received = time.monotonic()
    if request.method == "OPTIONS": return Response(status=204)
    if request.content_length is not None and request.content_length > 1024:
        return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {"eventId"} or not isinstance(data.get("eventId"), str):
        return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
    capability = request.headers.get(CAPABILITY_HEADER, "")
    if not capability:
        try:
            UUID(data["eventId"])
        except (ValueError, TypeError, AttributeError):
            return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    try:
        event = resolve_voice_event(data["eventId"], capability)
        published_epoch = _parse_event_publish_epoch(event.get("timestamp"))
        _logger.info(
            "Prisma speak-live: event_publish_to_received_ms=%s",
            round((time.time() - published_epoch) * 1000) if published_epoch is not None else None,
        )
        event["_capability"] = capability
        stream = audio_coordinator.subscribe(event, prisma_voice_config_store.get())
    except ValueError:
        return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
    except LookupError:
        return jsonify({"ok": False, "error": "VOICE_EVENT_NOT_FOUND"}), 404
    except VoiceSessionUnauthorized:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    except GeminiCredentialUnavailable:
        return _gemini_unavailable_response()
    except AudioCapacityError as error:
        status = 429 if str(error) == "VOICE_SUBSCRIBER_LIMIT" else 503
        return jsonify({"ok": False, "error": str(error)}), status
    except (AudioCoordinatorError, RuntimeError):
        return jsonify({"ok": False, "error": "VOICE_SERVICE_UNAVAILABLE"}), 503
    return _pcm_stream_response(lambda: _timed_pcm_stream(stream, request_received))


@app.route("/internal/prisma/prefetch", methods=["POST"])
def prisma_prefetch():
    """T10 unit 3: presentation calls this right after publishing a voice
    event (fire-and-forget, on its own background thread, never blocking the
    HMI answer response) so synthesis starts immediately instead of waiting
    for the browser's own poll-then-POST /prisma/speak-live round trip.

    Reuses the exact same resolve+admission path, capability/session/auth
    checks, and error taxonomy as /prisma/speak-live: prefetch can never see
    or generate audio the caller isn't already authorized for.

    No separate TTL/reaper is needed for an abandoned prefetch: the
    subscription is closed immediately below (this endpoint never streams
    audio back), and AudioCoordinator already buffers the shared generation
    for a later subscriber under the event's own existing expiry and
    capacity-eviction rules -- the same rules that already bound how long
    any completed generation stays buffered, prefetch or not. Subscribing
    again for the same event id from the real /prisma/speak-live request
    attaches to that same buffered/in-flight generation instead of starting
    a duplicate one, exactly as two ordinary concurrent subscribers would.
    """
    if request.content_length is not None and request.content_length > 1024:
        return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {"eventId"} or not isinstance(data.get("eventId"), str):
        return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
    capability = request.headers.get(CAPABILITY_HEADER, "")
    if not capability:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    try:
        event = resolve_voice_event(data["eventId"], capability)
        event["_capability"] = capability
        subscription = audio_coordinator.subscribe(event, prisma_voice_config_store.get())
    except ValueError:
        return jsonify({"ok": False, "error": "INVALID_VOICE_EVENT_REQUEST"}), 400
    except LookupError:
        return jsonify({"ok": False, "error": "VOICE_EVENT_NOT_FOUND"}), 404
    except VoiceSessionUnauthorized:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    except GeminiCredentialUnavailable:
        return _gemini_unavailable_response()
    except AudioCapacityError as error:
        status = 429 if str(error) == "VOICE_SUBSCRIBER_LIMIT" else 503
        return jsonify({"ok": False, "error": str(error)}), status
    except (AudioCoordinatorError, RuntimeError):
        return jsonify({"ok": False, "error": "VOICE_SERVICE_UNAVAILABLE"}), 503
    subscription.close()
    return jsonify({"ok": True})


@app.route("/internal/prisma/channel-b/telegram-voice-reply", methods=["POST"])
def channel_b_telegram_voice_reply():
    """B1: Channel B's own on-answer voice-note delivery. Presentation fires
    this on its own background thread right after TelegramLocalBot sends the
    text answer (see _fire_channel_b_voice_reply /
    mint_channel_b_reply_token in local_presentation.py), carrying a
    single-use bearer token in place of an eventId. Never blocks the caller's
    receive loop and never reports failure to the chat: a resolve or
    synthesis failure here is swallowed and logged (redacted), because the
    caller is a fire-and-forget background thread and the text answer has
    already been delivered."""
    if request.content_length is not None and request.content_length > 1024:
        return jsonify({"ok": False, "error": "INVALID_CHANNEL_B_VOICE_REPLY_REQUEST"}), 400
    capability = request.headers.get(CAPABILITY_HEADER, "")
    if not capability:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    try:
        payload = _resolve_channel_b_voice_reply_payload(capability)
    except VoiceSessionUnauthorized:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    except RuntimeError:
        return jsonify({"ok": False, "error": "CHANNEL_B_VOICE_REPLY_LOOKUP_UNAVAILABLE"}), 503
    try:
        _deliver_channel_b_voice_reply(payload)
    except Exception:
        _logger.warning("Prisma channel B voice reply: synthesis or delivery failed")
        return jsonify({"ok": False, "error": "CHANNEL_B_VOICE_REPLY_FAILED"}), 502
    return jsonify({"ok": True})


@app.route("/internal/prisma/voice-transcription", methods=["POST"])
def voice_transcription():
    """PW-013: transcribe one already-downloaded Telegram voice-note question
    for either channel. Presentation downloads and bounds the audio
    (transport-specific), mints a single-use bearer token carrying the audio
    bytes and domain terms (mirrors channel_b_telegram_voice_reply's token
    indirection), and fires this route; this process resolves the token back
    via one loopback GET (_resolve_voice_transcription_payload), then runs
    the shared Gemini transcription and returns the transcript text
    synchronously -- unlike the fire-and-forget Channel B voice-reply route,
    the caller here blocks on this response to continue answering the
    question, so a failure must be reported with a real status, never
    swallowed."""
    if request.content_length is not None and request.content_length > 1024:
        return jsonify({"ok": False, "error": "INVALID_VOICE_TRANSCRIPTION_REQUEST"}), 400
    capability = request.headers.get(CAPABILITY_HEADER, "")
    if not capability:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    try:
        payload = _resolve_voice_transcription_payload(capability)
    except VoiceSessionUnauthorized:
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401
    except RuntimeError:
        return jsonify({"ok": False, "error": "VOICE_TRANSCRIPTION_LOOKUP_UNAVAILABLE"}), 503
    try:
        audio_bytes = base64.b64decode(payload["audioBase64"], validate=True)
    except (binascii.Error, ValueError):
        return jsonify({"ok": False, "error": "INVALID_VOICE_TRANSCRIPTION_REQUEST"}), 400
    try:
        client = get_gemini_client()
    except GeminiCredentialUnavailable:
        return _gemini_unavailable_response()
    # F2 (live test 2026-09-25): every transcription failure/timeout must be
    # diagnosable from the log alone -- elapsed_ms and a redacted reason,
    # never the audio, the transcript or a secret.
    transcribe_started = time.monotonic()
    try:
        transcript = transcribe_voice_note(
            client, audio_bytes, payload["mimeType"], extra_terms=payload["extraTerms"]
        )
    except VoiceTranscriptionEmpty:
        _logger.warning(
            "Prisma voice transcription: empty transcript elapsed_ms=%d",
            round((time.monotonic() - transcribe_started) * 1000),
        )
        return jsonify({"ok": False, "error": "VOICE_NOTE_TRANSCRIPT_EMPTY"}), 422
    except VoiceTranscriptionError:
        _logger.warning(
            "Prisma voice transcription: provider failed elapsed_ms=%d",
            round((time.monotonic() - transcribe_started) * 1000),
        )
        return jsonify({"ok": False, "error": "VOICE_TRANSCRIPTION_UNAVAILABLE"}), 502
    return jsonify({"ok": True, "transcript": transcript})


def _validate_single_process_environment(environ=None):
    values = environ if environ is not None else os.environ
    worker_count = values.get("WEB_CONCURRENCY", "").strip()
    if worker_count.isdigit() and int(worker_count) > 1:
        raise RuntimeError("PRISMA_VOICE_SINGLE_PROCESS_REQUIRED")
    if values.get("WERKZEUG_RUN_MAIN", "").lower() in {"true", "1"}:
        raise RuntimeError("PRISMA_VOICE_RELOADER_UNSUPPORTED")


def _warm_up_gemini_client_in_background():
    """T10 unit 2: pre-build the Gemini client at boot so the first real
    voice request does not pay for it. Runs on its own daemon thread so it
    can never block process startup or the /health endpoint; every step is
    best-effort (missing credential, unreachable provider) and never raises
    or logs the secret, leaving the client to be built/warmed lazily on the
    first real request instead.

    F2 (live test 2026-09-25): building the client OBJECT alone never opens
    a real TCP/TLS connection -- the genai SDK's httpx client connects
    lazily on the first real call. Without a genuine network round trip
    here, the very first live request after boot (often a voice-note
    transcription, blocking a human-facing reply) pays the full
    cold-connection cost instead of this warm-up (~30s vs ~3s once warm,
    observed live 2026-09-25). A cheap, non-generating client.models.get(...)
    lookup -- the same call GeminiVerificationService already uses to
    verify a key, consuming no generation quota -- forces that connection
    now, at boot, where nobody is waiting on it."""
    try:
        secret = gemini_credentials.resolve()
    except Exception:
        return
    try:
        client, _reused = _warm_gemini_client.get(secret)
    except Exception:
        return
    try:
        client.models.get(model=TTS_MODEL)
    except Exception:
        pass


def main():
    _validate_single_process_environment()
    threading.Thread(target=_warm_up_gemini_client_in_background, name="PrismaGeminiWarmup", daemon=True).start()
    install_access_log_query_redaction()
    app.run(host=PRISMA_VOICE_HOST, port=5056, threaded=True, use_reloader=False)


if __name__ == "__main__": main()
