"""Local-only Prisma voice service.

The productive path uses Gemini Interactions TTS, streams processed PCM to the
HMI, and optionally sends the same processed audio to Telegram. No Gemini Live
session, central configuration endpoint, VPN binding, or industrial write path
is part of this service.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import wave
from array import array

import requests
from flask import Flask, Response, jsonify, request

from .audio_observability import BoundedAudioSink
from .paths import runtime_paths
from .voice_dsp import PrismaStreamingDSP, apply_prisma_dsp_full_pcm


app = Flask(__name__)
TTS_MODEL = "gemini-3.1-flash-tts-preview"
VOICE = "Leda"
SAMPLE_RATE = 24000
CHANNELS = 1
SAMPLE_WIDTH = 2
PRISMA_VOICE_HOST = "127.0.0.1"
prisma_audio_sink = BoundedAudioSink()
_TELEGRAM_HTTP_SESSION = requests.Session()
_TELEGRAM_HTTP_LOCK = threading.Lock()


def _telegram_post(url, **kwargs):
    with _TELEGRAM_HTTP_LOCK:
        return _TELEGRAM_HTTP_SESSION.post(url, **kwargs)


def _valid_telegram_chat_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value != 0 and abs(value) <= 9007199254740991


def _safe_event_id(value):
    raw = str(value or "").strip()
    return "sin_event_id" if not raw else "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in raw)[:100]


def _telegram_token():
    return os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()


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
        self.event_id = _safe_event_id(event_id); self.input_queue = queue.Queue(); self.ogg_parts = []; self.stderr_parts = []
        self.done, self.cancelled, self.finish_requested = threading.Event(), threading.Event(), threading.Event(); self.failed = None; self.process = None
        threading.Thread(target=self._run, name=f"PrismaOpus-{self.event_id}", daemon=True).start()

    def feed(self, pcm):
        if pcm and not self.done.is_set() and not self.cancelled.is_set(): self.input_queue.put(pcm)

    def request_finish(self):
        if not self.finish_requested.is_set(): self.finish_requested.set(); self.input_queue.put(_TELEGRAM_ENCODER_END)

    def cancel(self):
        if self.cancelled.is_set(): return
        self.cancelled.set(); self.input_queue.put(_TELEGRAM_ENCODER_END)
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
    threading.Thread(target=worker, name=f"PrismaTelegramAction-{_safe_event_id(job.get('event_id'))}", daemon=True).start()


def _cancel_telegram_job(job):
    if not job: return
    stop = job.get("telegram_chat_action_stop")
    if stop is not None: stop.set()
    encoder = job.get("telegram_encoder")
    if encoder is not None: encoder.cancel()


def _send_same_prisma_audio_to_telegram(job):
    if not job or not _valid_telegram_chat_id(job.get("telegram_chat_id")): return
    if job.get("cancelled") is not None and job["cancelled"].is_set(): _cancel_telegram_job(job); return
    token, encoder = _telegram_token(), job.get("telegram_encoder")
    if not token: _cancel_telegram_job(job); return
    ogg_data = encoder.finish_and_get(timeout=15) if encoder else None; base = os.environ.get("TELEGRAM_BOT_API_BASE", "https://api.telegram.org").rstrip("/"); chat_id = job["telegram_chat_id"]; event_id = _safe_event_id(job.get("event_id"))
    if ogg_data:
        try:
            response = _telegram_post(f"{base}/bot{token}/sendVoice", data={"chat_id": str(chat_id)}, files={"voice": (f"prisma_{event_id}.ogg", ogg_data, "audio/ogg")}, timeout=60)
            if 200 <= response.status_code < 300: return
        except Exception: pass
        try:
            response = _telegram_post(f"{base}/bot{token}/sendDocument", data={"chat_id": str(chat_id), "caption": "Respuesta por voz de Prisma"}, files={"document": (f"prisma_{event_id}.ogg", ogg_data, "audio/ogg")}, timeout=60)
            if 200 <= response.status_code < 300: return
        except Exception: pass
    pcm = b"".join(job.get("telegram_pcm_parts") or [])
    if pcm:
        try: _telegram_post(f"{base}/bot{token}/sendDocument", data={"chat_id": str(chat_id), "caption": "Respuesta por voz de Prisma"}, files={"document": (f"prisma_{event_id}.wav", pcm_to_wav(pcm), "audio/wav")}, timeout=60)
        except Exception: pass


def _queue_same_prisma_audio_to_telegram(job):
    if not job or job.get("telegram_delivery_queued") or not _valid_telegram_chat_id(job.get("telegram_chat_id")) or not job.get("telegram_pcm_parts"): return
    if job.get("cancelled") is not None and job["cancelled"].is_set(): _cancel_telegram_job(job); return
    job["telegram_delivery_queued"] = True; stop = job.get("telegram_chat_action_stop")
    if stop is not None: stop.set()
    threading.Thread(target=_send_same_prisma_audio_to_telegram, args=(job,), name=f"PrismaTelegram-{_safe_event_id(job.get('event_id'))}", daemon=True).start()


DEFAULT_PRISMA_VOICE_CONFIG = {"effectEnabled": True, "preset": "robotic_medium_light", "effectIntensity": 100, "robotic": {"modulationHz": 30, "baseGain": 0.78, "modulationDepth": 0.22, "quantizationSteps": 260, "metallicHz": 410, "metallicMix": 0.04, "echo1DelayMs": 40, "echo1Gain": 0.22, "echo2DelayMs": 95, "echo2Gain": 0.10, "normalizationTarget": 29500, "normalizationMaxGain": 1.6}}
PRISMA_VOICE_PRESETS = {"clean", "robotic_medium_light"}
PRISMA_ROBOTIC_FIELDS = set(DEFAULT_PRISMA_VOICE_CONFIG["robotic"])


def clone_json(value): return json.loads(json.dumps(value))
def _is_number(value): return isinstance(value, (int, float)) and not isinstance(value, bool)


def validate_prisma_voice_config(config):
    if not isinstance(config, dict) or set(config) != {"effectEnabled", "preset", "effectIntensity", "robotic"}: raise ValueError("CONFIG_FIELDS_INVALID")
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
    return clone_json(config)


class PrismaVoiceConfigStore:
    def __init__(self, path, config_mode="local", config_url=""):
        self.path, self.config_mode, self.config_url, self.lock = str(path), config_mode, config_url, threading.RLock(); self.config = self._load(); self.source = "local"; self.last_sync_at = None; self.last_sync_error = None; self.stop_event = threading.Event(); self.thread = None

    def allows_local_updates(self): return True

    def _load(self):
        try: return validate_prisma_voice_config(json.loads(open(self.path, encoding="utf-8").read()))
        except (OSError, ValueError, json.JSONDecodeError): return clone_json(DEFAULT_PRISMA_VOICE_CONFIG)

    def _write(self, config):
        directory = os.path.dirname(self.path); os.makedirs(directory, exist_ok=True); temporary = self.path + ".tmp"
        with open(temporary, "w", encoding="utf-8") as stream: json.dump(config, stream, ensure_ascii=False, indent=2); stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, self.path)

    def get(self):
        with self.lock: return clone_json(self.config)

    def update_local(self, candidate):
        config = validate_prisma_voice_config(candidate)
        with self.lock: self._write(config); self.config = clone_json(config); return clone_json(config)

    def status(self): return {"source": "local", "centralUrlConfigured": False, "lastSyncAt": None, "lastSyncError": None}


prisma_voice_config_store = PrismaVoiceConfigStore(runtime_paths().voice_config)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"; response.headers["Access-Control-Allow-Headers"] = "Content-Type"; response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"; response.headers["Access-Control-Expose-Headers"] = "X-Prisma-Audio-Format, X-Prisma-Sample-Rate, X-Prisma-Channels"; return response


@app.route("/prisma/config", methods=["GET", "PUT", "OPTIONS"])
def prisma_config():
    if request.method == "OPTIONS": return Response(status=204)
    if request.method == "GET": return jsonify({"config": prisma_voice_config_store.get(), "sync": prisma_voice_config_store.status()})
    try: config = prisma_voice_config_store.update_local(request.get_json(silent=True))
    except ValueError as error: return jsonify({"ok": False, "error": "INVALID_PRISMA_VOICE_CONFIG", "message": str(error)}), 400
    return jsonify({"config": config, "sync": prisma_voice_config_store.status()})


def get_gemini_client():
    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key: raise RuntimeError("GEMINI_API_KEY_MISSING")
    from google import genai
    return genai.Client(api_key=api_key)


def build_tts_prompt(text):
    return f"""
Synthesize speech for the transcript below.

Do not speak, repeat, paraphrase, or mention any of these instructions.
Speak only the text inside the TRANSCRIPT section.
Do not add, remove, rewrite, or improvise words.

AUDIO PROFILE:
Youthful female voice.
Professional, warm, approachable, and confident.
Natural and human, without sounding theatrical or exaggerated.

SCENE:
You are Prisma, the voice assistant of an industrial HMI in a professional production environment.
The listener needs to understand operational information quickly and clearly.

DIRECTOR'S NOTES:
Style:
Professional, warm, calm, and reliable.
Friendly but restrained.
Natural emotional expression.
Avoid advertising, radio-announcer, dramatic, or overly cheerful delivery.

Accent:
Neutral Latin American Spanish.
Avoid a marked Spain Spanish accent.
Avoid a strongly identifiable regional Latin American accent.

Pacing:
Medium and fluid.
Use natural short pauses between ideas.
Do not rush technical information.

Articulation:
Pronounce machine names, product names, acronyms, numbers, percentages,
dates, times, and measurement units clearly.
Keep technical terms precise and easy to understand.

Dynamics:
Maintain a stable, controlled delivery.
Use subtle natural emphasis only where it improves comprehension.
Do not exaggerate changes in pitch, volume, or emotion.

TRANSCRIPT:
{text}
"""


class PrismaTtsStreamError(RuntimeError):
    def __init__(self, code): self.code = code; super().__init__(code)
class PrismaTtsProviderError(PrismaTtsStreamError): pass
class PrismaTtsFormatError(PrismaTtsStreamError): pass


class S16LeChunkAssembler:
    def __init__(self): self.carry = b""
    def push(self, chunk):
        data = self.carry + bytes(chunk); size = len(data) // SAMPLE_WIDTH * SAMPLE_WIDTH; raw, self.carry = data[:size], data[size:]; return raw
    def finish(self):
        if self.carry: raise PrismaTtsFormatError("INCOMPLETE_PCM_S16LE_SAMPLE")


def _tts_interaction_request(text): return {"model": TTS_MODEL, "input": build_tts_prompt(text), "response_format": {"type": "audio"}, "generation_config": {"speech_config": [{"voice": VOICE}]}}
def _create_tts_interaction(client, text, stream=False):
    payload = _tts_interaction_request(text)
    if stream: payload["stream"] = True
    return client.interactions.create(**payload)
def _close_interaction_stream(stream):
    if stream is not None:
        try: stream.close()
        except Exception: pass
def _close_gemini_client(client):
    if client is not None:
        try: client.close()
        except Exception: pass


def _validate_audio_delta(delta):
    if getattr(delta, "mime_type", None) is not None and str(delta.mime_type).lower() != "audio/l16": raise PrismaTtsFormatError("UNSUPPORTED_TTS_AUDIO_MIME_TYPE")
    if getattr(delta, "sample_rate", None) is not None and delta.sample_rate != SAMPLE_RATE: raise PrismaTtsFormatError("UNSUPPORTED_TTS_SAMPLE_RATE")
    if getattr(delta, "channels", None) is not None and delta.channels != CHANNELS: raise PrismaTtsFormatError("UNSUPPORTED_TTS_CHANNELS")


def _decode_audio_delta(delta):
    _validate_audio_delta(delta); data = getattr(delta, "data", None)
    if not isinstance(data, str) or not data: raise PrismaTtsFormatError("TTS_AUDIO_DATA_MISSING")
    try: decoded = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError, TypeError): raise PrismaTtsFormatError("TTS_AUDIO_DATA_INVALID") from None
    if not decoded: raise PrismaTtsFormatError("TTS_AUDIO_DATA_EMPTY")
    return decoded


def _iter_interaction_audio_deltas(stream):
    completed = False
    try:
        for event in stream:
            if getattr(event, "event_type", None) == "step.delta":
                delta = getattr(event, "delta", None)
                if getattr(delta, "type", None) == "audio": yield delta
            elif getattr(event, "event_type", None) == "interaction.completed":
                if getattr(getattr(event, "interaction", None), "status", None) != "completed": raise PrismaTtsProviderError("TTS_STREAM_NOT_COMPLETED")
                completed = True; break
            elif getattr(event, "event_type", None) == "interaction.status_update" and getattr(event, "status", None) in {"failed", "cancelled", "incomplete", "budget_exceeded"}: raise PrismaTtsProviderError("TTS_STREAM_TERMINATED")
            elif getattr(event, "event_type", None) == "error": raise PrismaTtsProviderError("TTS_STREAM_PROVIDER_ERROR")
    except GeneratorExit: raise
    except PrismaTtsStreamError: raise
    except Exception: raise PrismaTtsProviderError("TTS_STREAM_PROVIDER_FAILED") from None
    if not completed: raise PrismaTtsProviderError("TTS_STREAM_TERMINAL_MISSING")


def _create_interactions_tts_job(text, event_id=None, telegram_chat_id=None):
    config = prisma_voice_config_store.get(); valid_chat = telegram_chat_id if _valid_telegram_chat_id(telegram_chat_id) else None
    job = {"text": text, "cancelled": threading.Event(), "voice_config": config, "dsp": PrismaStreamingDSP(config), "event_id": str(event_id).strip() if event_id is not None and str(event_id).strip() else None, "telegram_chat_id": valid_chat, "telegram_pcm_parts": [], "telegram_delivery_queued": False, "telegram_encoder": None, "telegram_chat_action_stop": threading.Event()}
    prisma_audio_sink.emit("backend", "receipt", {})
    if valid_chat is not None and _telegram_token(): job["telegram_encoder"] = TelegramOpusStreamEncoder(job["event_id"])
    if valid_chat is not None: _start_telegram_recording_indicator(job)
    return job


def _append_post_dsp_pcm(job, pcm):
    if not pcm: return None
    job["telegram_pcm_parts"].append(pcm)
    if job.get("telegram_encoder") is not None: job["telegram_encoder"].feed(pcm)
    return pcm


def _discard_interactions_tts_job(job):
    job["cancelled"].set(); _cancel_telegram_job(job); job["telegram_pcm_parts"].clear()


def _full_file_fallback_pcm(client, job):
    try: interaction = _create_tts_interaction(client, job["text"]); pcm = base64.b64decode(interaction.output_audio.data, validate=True)
    except Exception: raise PrismaTtsProviderError("TTS_FALLBACK_PROVIDER_FAILED") from None
    if not pcm or len(pcm) % SAMPLE_WIDTH: raise PrismaTtsFormatError("TTS_FALLBACK_AUDIO_INVALID")
    processed = apply_prisma_dsp_full_pcm(pcm, job["voice_config"])
    if not processed: raise PrismaTtsFormatError("TTS_FALLBACK_AUDIO_EMPTY")
    return processed


def _generate_interactions_tts_audio(job):
    client = stream = None; audio_accepted = False
    prisma_audio_sink.emit("provider", "dispatch", {})
    try:
        try:
            client = get_gemini_client(); stream = _create_tts_interaction(client, job["text"], stream=True); assembler = S16LeChunkAssembler()
            for delta in _iter_interaction_audio_deltas(stream):
                audio_accepted = True; canonical = assembler.push(_decode_audio_delta(delta))
                if canonical:
                    delivered = _append_post_dsp_pcm(job, job["dsp"].process(canonical))
                    prisma_audio_sink.emit("backend", "dsp", {"sample_count": len(delivered or b"") // SAMPLE_WIDTH})
                    if delivered is not None: yield delivered
            assembler.finish()
            if not audio_accepted or not job["telegram_pcm_parts"]: raise PrismaTtsProviderError("TTS_STREAM_AUDIO_MISSING")
            prisma_audio_sink.emit("provider", "completion", {"status": "success"})
        except (PrismaTtsFormatError, GeneratorExit): raise
        except Exception as error:
            if audio_accepted: raise error if isinstance(error, PrismaTtsProviderError) else PrismaTtsProviderError("TTS_STREAM_PROVIDER_FAILED") from None
            _close_interaction_stream(stream); stream = None; delivered = _append_post_dsp_pcm(job, _full_file_fallback_pcm(client, job))
            prisma_audio_sink.emit("provider", "completion", {"status": "success"})
            if delivered is not None: yield delivered
        _queue_same_prisma_audio_to_telegram(job)
        prisma_audio_sink.emit("backend", "finalization", {"status": "success", "sample_count": sum(len(part) for part in job["telegram_pcm_parts"]) // SAMPLE_WIDTH})
    except GeneratorExit: _discard_interactions_tts_job(job); raise
    except PrismaTtsStreamError:
        prisma_audio_sink.emit("backend", "finalization", {"status": "error"})
        _discard_interactions_tts_job(job)
        raise
    except Exception:
        prisma_audio_sink.emit("backend", "finalization", {"status": "error"})
        _discard_interactions_tts_job(job)
        raise PrismaTtsProviderError("TTS_STREAM_INTERNAL_FAILURE") from None
    finally: _close_interaction_stream(stream); _close_gemini_client(client)


def pcm_to_wav(pcm):
    output = io.BytesIO()
    with wave.open(output, "wb") as result: result.setnchannels(CHANNELS); result.setsampwidth(SAMPLE_WIDTH); result.setframerate(SAMPLE_RATE); result.writeframes(pcm)
    return output.getvalue()


@app.route("/prisma/speak", methods=["POST", "OPTIONS"])
def prisma_speak():
    if request.method == "OPTIONS": return Response(status=204)
    text = str((request.get_json(silent=True) or {}).get("text", "")).strip()
    if not text: return jsonify({"ok": False, "error": "TEXT_REQUIRED"}), 400
    try:
        prisma_audio_sink.emit("provider", "dispatch", {})
        client = get_gemini_client(); pcm = base64.b64decode(_create_tts_interaction(client, text).output_audio.data, validate=True); _close_gemini_client(client); return Response(pcm_to_wav(apply_prisma_dsp_full_pcm(pcm, prisma_voice_config_store.get())), mimetype="audio/wav", headers={"Cache-Control": "no-cache"})
    except Exception as error: return jsonify({"ok": False, "error": str(error)}), 500


@app.route("/health", methods=["GET"])
def health():
    config = prisma_voice_config_store.get()
    return jsonify({"ok": True, "ready": True, "mode": "local", "service": "prisma-voice", "assistant": "Prisma", "provider": "Google Gemini", "model": TTS_MODEL, "voice": VOICE, "streaming": True, "liveReady": False, "config": prisma_voice_config_store.status(), "voiceConfig": {"preset": config["preset"], "effectEnabled": config["effectEnabled"], "effectIntensity": config["effectIntensity"]}})


def _pcm_stream_response(generate_audio):
    response = Response(generate_audio(), mimetype="application/octet-stream"); response.headers["Cache-Control"] = "no-cache"; response.headers["X-Accel-Buffering"] = "no"; response.headers["X-Prisma-Audio-Format"] = "pcm_s16le"; response.headers["X-Prisma-Sample-Rate"] = str(SAMPLE_RATE); response.headers["X-Prisma-Channels"] = str(CHANNELS); return response


@app.route("/prisma/speak-live", methods=["POST", "OPTIONS"])
def prisma_speak_live():
    if request.method == "OPTIONS": return Response(status=204)
    data = request.get_json(silent=True) or {}; text = str(data.get("text", "")).strip()
    if not text: return jsonify({"ok": False, "error": "TEXT_REQUIRED"}), 400
    if not os.environ.get("GEMINI_API_KEY"): return jsonify({"ok": False, "error": "GEMINI_API_KEY_MISSING"}), 500
    job = _create_interactions_tts_job(text, data.get("eventId"), data.get("telegramChatId"))
    return _pcm_stream_response(lambda: (chunk for chunk in _generate_interactions_tts_audio(job)))


if __name__ == "__main__": app.run(host=PRISMA_VOICE_HOST, port=5056, threaded=True, use_reloader=False)
