"""Prisma Local presentation bridge.

The bridge receives the visible HMI snapshot, answers from that snapshot,
publishes the latest voice event, and proxies local voice configuration.
Telegram and Gemini remain outbound integrations; industrial systems are not
written to by this service.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import requests
from flask import Flask, Response, jsonify, request

from .admin_auth import AdminAuthRepository, AdminAuthService, ScryptPasswordHasher
from .admin_http import AdminHttpBoundary
from .bot_identity_reservation import process_bot_identity_reservation
from .channel_a_activation import ChannelAActivation
from .channel_a_configuration import ChannelAConfigurationStore
from .channel_a_manager import ChannelAManager
from .channel_a_transport import ChannelATransport
from .credential_store import CredentialService
from .hmi_sessions import (
    CAPABILITY_HEADER, HmiSessionCapacity, HmiSessionContextTooLarge,
    HmiSessionContextUnavailable, HmiSessionError, HmiSessionRegistry, HmiSessionUnauthorized,
)
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions
from .telegram_config import TelegramConfig, read_telegram_config
from .telegram_credentials import TelegramCredentialResolver
from .telegram_lifecycle import TelegramLifecycleManager, TelegramStateRepository, TelegramStateUnavailable, empty_telegram_state, project_telegram_diagnostic, validate_telegram_state
from .voice_events import VoiceEventCapacity, VoiceEventStore


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5057
DEFAULT_PRISMA_VOICE_URL = "http://127.0.0.1:5056"
DEFAULT_TELEGRAM_API_URL = "https://api.telegram.org"
HMI_SESSION_BOOTSTRAP_MAX_BYTES = 128
HMI_ASK_MAX_BYTES = 32 * 1024
HMI_QUESTION_MAX_BYTES = 4096
TELEGRAM_STOPPING = "TELEGRAM_STOPPING"

# Approved Channel A composition settings: the accepted Channel B request/poll/
# read/join bounds plus the explicit poll pause, and the fresh live-owner label
# receipt bound. No guaranteed stop completion is claimed for the join bound.
CHANNEL_A_REQUEST_TIMEOUT_SECONDS = 20
CHANNEL_A_POLL_TIMEOUT_SECONDS = 25
CHANNEL_A_READ_TIMEOUT_SECONDS = 35
CHANNEL_A_JOIN_TIMEOUT_SECONDS = 40
CHANNEL_A_POLL_PAUSE_SECONDS = 0.1
CHANNEL_A_OWNER_NAME_MAX_AGE_SECONDS = 15.0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _safe_response_status(response: Any) -> int | None:
    status = getattr(response, "status_code", None)
    return status if isinstance(status, int) and not isinstance(status, bool) and 100 <= status <= 599 else None


TELEGRAM_DIAGNOSTIC_STATE_STAGES = ("state_read", "persist")


def _telegram_failure_category(error: BaseException, stage: str | None) -> tuple[str, int | None]:
    """Type-derived category from a fixed allowlist; JSON must be tested before the
    broad RequestException branch because requests.exceptions.JSONDecodeError
    inherits from both json.JSONDecodeError and requests.RequestException."""
    if isinstance(error, (requests.exceptions.JSONDecodeError, json.JSONDecodeError)):
        return "response_json", None
    if isinstance(error, requests.HTTPError):
        return "http", _safe_response_status(getattr(error, "response", None))
    if isinstance(error, requests.RequestException):
        return "transport", None
    if isinstance(error, TelegramStateUnavailable) or stage in TELEGRAM_DIAGNOSTIC_STATE_STAGES:
        return "state", None
    return "unexpected", None


def _safe_voice_target(voice_url: str) -> dict[str, Any]:
    try:
        parsed = urlsplit(voice_url)
        scheme = parsed.scheme.lower() if re.fullmatch(r"[a-zA-Z][a-zA-Z0-9+.-]{0,15}", parsed.scheme) else None
        host = parsed.hostname
        if host is not None and (len(host) > 253 or not re.fullmatch(r"[a-zA-Z0-9.:%-]+", host)):
            host = None
        port = parsed.port
        if port is None and scheme in {"http", "https"}:
            port = 80 if scheme == "http" else 443
    except ValueError:
        scheme, host, port = None, None, None
    return {"scheme": scheme, "host": host, "port": port, "path": "/health"}


def _voice_probe_error(category: str, error_type: str, message: str) -> dict[str, str]:
    return {"category": category, "type": error_type, "message": message[:160]}


def _probe_voice(local_http: requests.Session, voice_url: str) -> tuple[bool, dict[str, Any]]:
    probe: dict[str, Any] = {"target": _safe_voice_target(voice_url), "status": None, "ok": None, "error": None}
    try:
        response = local_http.get(f"{voice_url}/health", timeout=1)
        probe["status"] = _safe_response_status(response)
        try:
            payload = response.json()
        except (TypeError, ValueError):
            probe["error"] = _voice_probe_error("response", "malformed_json", "Upstream health response was not valid JSON.")
            return False, probe
        if not isinstance(payload, dict) or not isinstance(payload.get("ok"), bool):
            probe["error"] = _voice_probe_error("response", "malformed_json", "Upstream health response had an invalid JSON shape.")
            return False, probe
        probe["ok"] = payload["ok"]
        if not payload["ok"]:
            probe["error"] = _voice_probe_error("upstream", "ok_false", "Upstream health reported ok=false.")
        return payload["ok"], probe
    except requests.Timeout as error:
        probe["status"] = _safe_response_status(getattr(error, "response", None))
        probe["error"] = _voice_probe_error("request", "timeout", "Voice health request timed out.")
    except requests.ConnectionError as error:
        probe["status"] = _safe_response_status(getattr(error, "response", None))
        probe["error"] = _voice_probe_error("request", "connection", "Voice health request failed to connect.")
    except requests.RequestException as error:
        probe["status"] = _safe_response_status(getattr(error, "response", None))
        probe["error"] = _voice_probe_error("request", "request_error", "Voice health request failed.")
    return False, probe


def normalize(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or "").lower())
    return "".join(char for char in text if unicodedata.category(char) != "Mn")


def first_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, bool) or value is None:
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number == number and number not in (float("inf"), float("-inf")):
            return number
    return None


def format_number(value: float | int, decimals: int = 1) -> str:
    rounded = round(float(value), decimals)
    if rounded.is_integer():
        return str(int(rounded))
    return f"{rounded:.{decimals}f}".rstrip("0").rstrip(".").replace(".", ",")


def map_machine_state(value: Any) -> str | None:
    raw = normalize(value)
    if not raw:
        return None
    if any(term in raw for term in ("running", "produccion", "produciendo")):
        return "En producción"
    if any(term in raw for term in ("stopped", "detenida", "detenido", "stop")):
        return "Detenida"
    if "setup" in raw:
        return "Setup"
    if "offline" in raw:
        return "Offline"
    if "online" in raw:
        return "Online"
    return str(value)


def _widget_by_type(widgets: list[dict[str, Any]], widget_type: str) -> dict[str, Any] | None:
    target = normalize(widget_type)
    return next((widget for widget in widgets if normalize(widget.get("type")) == target), None)


def _widget_by_title(widgets: list[dict[str, Any]], *parts: str) -> dict[str, Any] | None:
    targets = [normalize(part) for part in parts]
    return next((widget for widget in widgets if all(target in normalize(widget.get("title")) for target in targets)), None)


def _widget_by_id(widgets: list[dict[str, Any]], widget_id: str) -> dict[str, Any] | None:
    target = normalize(widget_id)
    return next((widget for widget in widgets if normalize(widget.get("id")) == target or normalize(widget.get("widgetId")) == target), None)


def _extract_lot(widgets: list[dict[str, Any]]) -> str | None:
    candidates = []
    lot_widget = _widget_by_title(widgets, "lote") or _widget_by_type(widgets, "text-title")
    if lot_widget:
        candidates.append(json.dumps(lot_widget, ensure_ascii=False))
    candidates.append(json.dumps(widgets, ensure_ascii=False))
    for candidate in candidates:
        match = re.search(r"lote\s*:\s*([A-Za-z0-9_-]+)", candidate, re.IGNORECASE)
        if match:
            return match.group(1)
    return None


def _extract_product(widgets: list[dict[str, Any]]) -> tuple[str | None, str | None, str | None]:
    widget = _widget_by_id(widgets, "producto_receta") or _widget_by_title(widgets, "producto") or _widget_by_title(widgets, "receta") or _widget_by_type(widgets, "info-card")
    if not widget:
        return None, None, None
    data = widget.get("data") if isinstance(widget.get("data"), dict) else {}
    product, order, client = data.get("producto"), data.get("orden"), data.get("cliente")
    fields = data.get("fields") if isinstance(data.get("fields"), list) else []
    values = data.get("valuesByFieldId") if isinstance(data.get("valuesByFieldId"), dict) else {}
    for field in fields:
        if not isinstance(field, dict):
            continue
        label = normalize(field.get("label"))
        raw_value = field.get("text") or field.get("value") or values.get(field.get("id"))
        explicit_product = field.get("text") or values.get(field.get("id"))
        if explicit_product and not product:
            product = str(explicit_product).strip()
        elif raw_value and not product and not any(key in label for key in ("orden", "cliente")):
            product = str(raw_value).strip()
        metadata = " ".join(str(field.get(key)) for key in ("label", "subtext", "tag", "helpText") if field.get(key))
        if not order:
            match = re.search(r"orden\s*:\s*([A-Za-z0-9_-]+)", metadata, re.IGNORECASE)
            order = match.group(1).strip() if match else (str(raw_value).strip() if "orden" in label and raw_value else None)
        if not client:
            match = re.search(r"cliente\s*:\s*(.+?)(?:\s{2,}|$)", metadata, re.IGNORECASE)
            client = match.group(1).strip() if match else (str(raw_value).strip() if "cliente" in label and raw_value else None)
    return (str(product).strip() if product else None, str(order).strip() if order else None, str(client).strip() if client else None)


@dataclass(frozen=True)
class LocalAnswer:
    question: str
    answer_text: str
    relevant_data: list[dict[str, Any]]

    def as_dict(self) -> dict[str, Any]:
        return {"ok": True, "source": "prisma_local_snapshot_parser", "question": self.question, "answerText": self.answer_text, "datosRelevantes": self.relevant_data}


def answer_from_snapshot(snapshot: dict[str, Any] | None, question: str) -> LocalAnswer:
    question = str(question or "").strip()
    if not question:
        return LocalAnswer(question, "La pregunta está vacía.", [])
    if not snapshot or not isinstance(snapshot.get("widgets"), list):
        return LocalAnswer(question, "Todavía no hay datos del dashboard cargados.", [])
    widgets = [widget for widget in snapshot["widgets"] if isinstance(widget, dict)]
    q = normalize(question)
    machine = snapshot.get("machine") if isinstance(snapshot.get("machine"), dict) else {}
    screen = snapshot.get("screen") if isinstance(snapshot.get("screen"), dict) else {}
    machine_id, machine_name = machine.get("id") or machine.get("machineId"), machine.get("name") or screen.get("ownerNodeName")
    lot = _extract_lot(widgets)
    product, order, client = _extract_product(widgets)
    progress_widget = _widget_by_title(widgets, "progreso", "lote")
    progress_data = progress_widget.get("data", {}) if progress_widget else {}
    progress = first_number(progress_data.get("avancePorcentaje"), progress_widget.get("value") if progress_widget else None)
    progress_unit = progress_widget.get("unit", "%") if progress_widget else "%"
    time_widget = _widget_by_title(widgets, "tiempo", "restante")
    time_data = time_widget.get("data", {}) if time_widget else {}
    remaining = first_number(time_data.get("tiempoEstimadoRestante"), time_widget.get("value") if time_widget else None)
    remaining_unit = time_widget.get("unit", "") if time_widget else ""
    status_widget = _widget_by_type(widgets, "status")
    status_data = status_widget.get("data", {}) if status_widget else {}
    machine_state = map_machine_state(status_data.get("estado") or (status_widget or {}).get("value"))
    connection_widget = _widget_by_type(widgets, "connection-status")
    connection_data = connection_widget.get("data", {}) if connection_widget else {}
    online_raw = connection_data.get("online", (connection_widget or {}).get("value"))
    online = online_raw is True or "online" in normalize(online_raw)
    oee_widget = _widget_by_id(widgets, "oee") or _widget_by_title(widgets, "oee")
    oee_data = oee_widget.get("data", {}) if oee_widget else {}
    oee = first_number(oee_data.get("value"), oee_widget.get("value") if oee_widget else None)
    oee_unit = oee_widget.get("unit", "%") if oee_widget else "%"
    activity_widget = _widget_by_id(widgets, "actividad_maquina") or _widget_by_type(widgets, "machine-activity") or _widget_by_title(widgets, "actividad", "maquina")
    activity_data = activity_widget.get("data", {}) if activity_widget else {}
    activity_state = activity_data.get("estadoActividad") or activity_data.get("state") or (activity_widget or {}).get("state")
    activity = first_number(activity_data.get("actividadPorcentaje"), (activity_widget or {}).get("value"))
    activity_unit, power = (activity_widget or {}).get("unit", "%"), first_number(activity_data.get("potencia"))
    power_unit = activity_data.get("potenciaUnit") or "kW"
    alerts_widget = _widget_by_id(widgets, "historico_alertas") or _widget_by_type(widgets, "alert-history") or _widget_by_title(widgets, "alertas")
    alerts_data = alerts_widget.get("data", {}) if alerts_widget else {}
    alert_items = alerts_data.get("items") if isinstance(alerts_data.get("items"), list) else []
    alert_count = first_number(alerts_data.get("count"))
    asks = {
        "product": any(term in q for term in ("producto", "receta", "haciendo", "fabricando")),
        "order": "orden" in q or bool(re.search(r"\bop\b", q)), "client": "cliente" in q, "lot": "lote" in q,
        "status": "estado" in q and any(term in q for term in ("maquina", "equipo")), "online": any(term in q for term in ("online", "conexion", "conectada", "conectado")),
        "activity": any(term in q for term in ("actividad", "detenida", "detenido", "produciendo", "setup")), "power": any(term in q for term in ("potencia", "consumo", "kw")),
        "oee": "oee" in q or "eficiencia" in q, "time": any(term in q for term in ("falta", "terminar", "tiempo restante", "restante")),
        "progress": any(term in q for term in ("avance", "progreso", "porcentaje")), "alerts": any(term in q for term in ("alerta", "alarma", "advertencia", "historico")),
        "summary": any(term in q for term in ("resumen", "como viene", "situacion", "dashboard")),
    }
    relevant: list[dict[str, Any]] = []
    answer: str | None = None
    if asks["product"] and product:
        answer = f"El producto visible en el dashboard es {product}{', correspondiente al lote ' + lot if lot else ''}."; relevant.append({"tema": "producto_receta", "producto": product, "orden": order, "cliente": client, "loteActual": lot})
    elif asks["order"] and order:
        answer = f"La orden visible en el dashboard es {order}{', para el producto ' + product if product else ''}."; relevant.append({"tema": "orden", "orden": order, "producto": product})
    elif asks["client"] and client:
        answer = f"El cliente visible en el dashboard es {client}{', asociado al producto ' + product if product else ''}."; relevant.append({"tema": "cliente", "cliente": client, "producto": product})
    elif asks["time"] and remaining is not None:
        answer = f"Según el dashboard actual, el tiempo restante estimado es {format_number(remaining, 1)}{' ' + remaining_unit if remaining_unit else ''}{' para el lote ' + lot if lot else ''}."; relevant.append({"tema": "tiempo_restante_estimado", "value": remaining, "unit": remaining_unit})
    elif asks["progress"] and progress is not None:
        answer = f"El progreso del lote{' ' + lot if lot else ''} es de {format_number(progress, 1)} {progress_unit}."; relevant.append({"tema": "progreso_lote", "value": progress, "unit": progress_unit})
    elif asks["lot"] and lot:
        answer = f"El lote activo es {lot}."; relevant.append({"tema": "lote", "loteActual": lot})
    elif asks["oee"] and oee is not None:
        answer = f"El OEE actual es {format_number(oee, 1)} {oee_unit}."; relevant.append({"tema": "oee", "value": oee, "unit": oee_unit})
    elif asks["status"] and (machine_state or machine_name):
        parts = [f"La máquina {machine_name}" if machine_name else "La máquina"]
        if machine_state: parts.append(f"está {machine_state.lower()}")
        if online: parts.append("y está online")
        answer = " ".join(parts) + "."; relevant.append({"tema": "estado_maquina", "machineId": machine_id, "machineName": machine_name, "estado": machine_state, "online": online})
    elif asks["online"]:
        answer = f"La máquina{' ' + str(machine_name) if machine_name else ''} {'está online' if online else 'no figura online'}."; relevant.append({"tema": "conexion", "online": online})
    elif asks["activity"] and (activity_state or activity is not None):
        parts = []
        if activity_state: parts.append(f"La actividad de máquina figura como {str(activity_state).lower()}")
        if activity is not None: parts.append(f"con {format_number(activity, 1)} {activity_unit}")
        if power is not None: parts.append(f"y una potencia de {format_number(power, 2)} {power_unit}")
        answer = " ".join(parts) + "."; relevant.append({"tema": "actividad_maquina", "estado": activity_state, "actividad": activity, "potencia": power})
    elif asks["power"] and power is not None:
        answer = f"La potencia actual visible en actividad de máquina es {format_number(power, 2)} {power_unit}."; relevant.append({"tema": "potencia", "value": power, "unit": power_unit})
    elif asks["alerts"] and (alert_count is not None or alert_items):
        visible = []
        for item in alert_items[:3]:
            if isinstance(item, dict):
                text = f"{item.get('level') or 'alerta'}: {item.get('title') or 'sin título'}"
                if item.get("age"): text += f", {item['age']}"
                if item.get("value"): text += f", valor {item['value']}"
                visible.append(text)
        count = int(alert_count) if alert_count is not None else len(alert_items)
        answer = f"Hay {count} alertas registradas en el histórico." + (f" Últimas visibles: {'; '.join(visible)}." if visible else ""); relevant.append({"tema": "historico_alertas", "count": count, "items": alert_items})
    elif asks["summary"]:
        parts = []
        if machine_name and machine_state: parts.append(f"{machine_name} está {machine_state.lower()}")
        if activity_state: parts.append(f"actividad {str(activity_state).lower()}")
        if lot: parts.append(f"lote activo {lot}")
        if product: parts.append(f"producto {product}")
        if progress is not None: parts.append(f"progreso {format_number(progress, 1)} {progress_unit}")
        if oee is not None: parts.append(f"OEE {format_number(oee, 1)} {oee_unit}")
        if remaining is not None: parts.append(f"tiempo restante estimado {format_number(remaining, 1)} {remaining_unit}")
        if alert_count is not None: parts.append(f"{int(alert_count)} alertas en histórico")
        if parts: answer = f"Resumen actual: {', '.join(parts)}."; relevant.append({"tema": "resumen"})
    return LocalAnswer(question, answer or "Ese dato no está visible en el dashboard actual.", relevant)


class JsonFileStore:
    def __init__(self, path):
        self.path, self.lock = path, threading.RLock()

    def read(self) -> dict[str, Any] | None:
        with self.lock:
            try:
                value = json.loads(self.path.read_text(encoding="utf-8"))
                return value if isinstance(value, dict) else None
            except (FileNotFoundError, OSError, json.JSONDecodeError):
                return None

    def write(self, value: dict[str, Any]) -> None:
        with self.lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temporary, self.path)


@dataclass(frozen=True)
class TelegramBotIdentity:
    """The identity Telegram reports for this token; an observation, not authority."""

    bot_id: int
    username: str | None


class TelegramLocalBot:
    """One guarded Telegram channel-B bot lifecycle object.

    Channel B is the autonomous local text channel. The object owns its own
    cooperative lease on the observed bot identity, so neither the manager, the
    standalone build/run path nor the intended future channel A consumer of the
    same process-local registry can start a second live bot for an identity that
    is already taken. A replacement object is a new activation epoch that can
    never overwrite a live lease.
    """

    def __init__(self, token, snapshot_store, state_store, voice_events, api_base=DEFAULT_TELEGRAM_API_URL, reservation=None):
        self.token, self.snapshot_store, self.state_store, self.voice_events = token, snapshot_store, state_store, voice_events
        self.api_base, self.session = api_base.rstrip("/"), requests.Session()
        self.stop_event, self.thread = threading.Event(), None
        self.last_error, self.bot_username, self.bot_id = None, None, None
        self._state = None
        self._diagnostic_lock = threading.Lock()
        self._diagnostic = {"stage": None, "category": None, "httpStatus": None, "failureAt": None, "lastSuccessAt": None}
        self._diagnostic_stage = None
        # An explicit None selects the shared process registry; the guard is
        # never disabled. Tests inject a fresh registry instance instead.
        self._reservation = reservation if reservation is not None else process_bot_identity_reservation()
        self._activation_epoch = object()
        self._lifecycle_lock = threading.RLock()
        self._lease = None
        self._prepared = False
        self._stopping = False
        self._stopped = False
        # A failed activation is terminal: cleanup may have been uncertain, so
        # no later prepare, run or start may revive this exact object.
        self._activation_failed = False
        # Owned activity, not a thread handle, decides quiescence: a direct
        # ``run()`` never publishes ``self.thread``, so release must wait for the
        # real preparation/runner work instead of a field a caller can skip.
        self._preparation_active = 0
        self._runner_active = False

    @property
    def prepared(self) -> bool:
        """True only while a guarded preparation is complete and not stopped."""
        return self._prepared

    def telegram_diagnostic(self) -> dict[str, Any]:
        with self._diagnostic_lock:
            return dict(self._diagnostic)

    def _note_stage(self, stage: str) -> None:
        self._diagnostic_stage = stage

    def _record_failure(self, error: BaseException) -> None:
        # Defensive totality: instrumentation must never alter the original
        # exception handling, so any unexpected failure here is swallowed.
        try:
            stage = self._diagnostic_stage
            category, http_status = _telegram_failure_category(error, stage)
            with self._diagnostic_lock:
                self._diagnostic = {
                    "stage": stage,
                    "category": category,
                    "httpStatus": http_status,
                    "failureAt": utc_now_iso(),
                    "lastSuccessAt": self._diagnostic["lastSuccessAt"],
                }
        except Exception:
            return

    def _note_poll_success(self) -> None:
        # A clock or timestamp fault must never turn a successful poll into a failure.
        try:
            succeeded_at = utc_now_iso()
        except Exception:
            return
        with self._diagnostic_lock:
            self._diagnostic = {"stage": None, "category": None, "httpStatus": None, "failureAt": None, "lastSuccessAt": succeeded_at}

    @property
    def paired_chat_ids(self) -> set[int]:
        if self.bot_id is None or self._state is None:
            return set()
        return set(self._record()["pairedPrivateChatIds"])

    def _call(self, method, *, timeout=35, **kwargs):
        response = self.session.post(f"{self.api_base}/bot{self.token}/{method}", timeout=timeout, **kwargs)
        try:
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not payload.get("ok"):
                raise RuntimeError("TELEGRAM_PROVIDER_UNAVAILABLE")
            return payload
        finally:
            response.close()

    def send_message(self, chat_id, text):
        if self.stop_event.is_set():
            raise RuntimeError("TELEGRAM_UPDATE_CANCELLED")
        self._call("sendMessage", timeout=20, data={"chat_id": chat_id, "text": text})

    def _load_state(self):
        value = self.state_store.read()
        if value is None or (isinstance(value, dict) and "schemaVersion" not in value):
            self._state = empty_telegram_state()
            return
        self._state = validate_telegram_state(value)

    def _record(self):
        if self._state is None or self.bot_id is None:
            raise TelegramStateUnavailable("TELEGRAM_STATE_UNAVAILABLE")
        return self._state["bots"][str(self.bot_id)]

    def _persist(self):
        self.state_store.write(self._state)

    def observe_identity(self) -> TelegramBotIdentity:
        """Return the identity Telegram reports for this token, with no effect.

        Observation validates the identifier shape before anything else happens,
        but it is neither readiness nor ownership: only a complete guarded
        preparation claims the observed bot.
        """
        result = self._call("getMe", timeout=20).get("result")
        bot_id = result.get("id") if isinstance(result, dict) else None
        if isinstance(bot_id, bool) or not isinstance(bot_id, int) or bot_id <= 0:
            raise RuntimeError("TELEGRAM_PROVIDER_UNAVAILABLE")
        username = result.get("username") if isinstance(result.get("username"), str) else None
        return TelegramBotIdentity(bot_id, username)

    def _activity_quiescent_locked(self) -> bool:
        """No preparation and no runner can still use this object."""
        return not self._preparation_active and not self._runner_active

    def _quiescent_locked(self, thread) -> bool:
        """Full stop quiescence: no owned activity and no live managed thread."""
        if not self._activity_quiescent_locked():
            return False
        return thread is None or not thread.is_alive()

    def _finalize_owned_quiescent_locked(self) -> bool:
        """Close resources and release our exact lease after quiescence is proven.

        Finalization is terminal and idempotent: once a stop has completed, a
        repeated stop or a runner that settles later reports the same clean
        outcome instead of tearing the object down a second time. A teardown
        fault is uncertain cleanup, so ``_stopped`` is only set after a
        successful close and release, which keeps a retry possible. Caller holds
        the lifecycle lock and has already confirmed quiescence.
        """
        if self._stopped:
            return True
        try:
            self.session.close()
        except Exception:
            return False
        lease = self._lease
        if lease is not None:
            try:
                self._reservation.release(lease)
            except Exception:
                return False
            if self._lease is lease:
                self._lease = None
        self._prepared = False
        self._stopped = True
        return True

    def _settle_locked(self) -> bool:
        """Owned cleanup after the last activity leaves a fenced object."""
        if not self._activity_quiescent_locked():
            return False
        return self._finalize_owned_quiescent_locked()

    def _check_active_locked(self) -> None:
        """Abort an in-flight effect once a stop or a failed activation fenced us."""
        if self._stopping or self._stopped or self._activation_failed:
            raise RuntimeError(TELEGRAM_STOPPING)

    def prepare(self):
        """Observe the identity, reserve it, then apply the preparation effects.

        A successful preparation keeps its lease until a stop fences the object.
        A failed preparation is known-quiescent, so it settles immediately: when
        the cleanup succeeds it releases its own lease and closes its resources
        instead of stranding a live identity until some later caller remembers to
        stop it, and when that cleanup faults the lease is retained for a later
        stop to confirm. Either way the failure is terminal for this object, and
        the fence is revalidated after every foreign call, so a stop that lands
        mid-preparation can never be followed by later effects.
        """
        with self._lifecycle_lock:
            if self._stopping or self._stopped or self._activation_failed:
                raise RuntimeError(TELEGRAM_STOPPING)
            if self._prepared:
                return
            self._note_stage("prepare")
            self._preparation_active += 1
            failed = False
            try:
                if self._lease is None:
                    identity = self.observe_identity()
                    self._check_active_locked()
                    self._lease = self._reservation.acquire(
                        identity.bot_id, owner=self, epoch=self._activation_epoch
                    )
                    self.bot_id, self.bot_username = identity.bot_id, identity.username
                self._call("deleteWebhook", timeout=20, data={"drop_pending_updates": "false"})
                self._check_active_locked()
                self._load_state()
                key = str(self.bot_id)
                if key not in self._state["bots"]:
                    self._check_active_locked()
                    self._state["bots"][key] = {
                        "pairedPrivateChatIds": [],
                        "nextUpdateOffset": None,
                        "migrationActive": True,
                    }
                    self._check_active_locked()
                    self._persist()
                self._check_active_locked()
                self._prepared = True
            except Exception as error:
                failed = True
                # Record before re-raising so preparation failures are observable even
                # when prepare() runs outside the poll loop (manager startup/apply).
                self._record_failure(error)
                raise
            finally:
                self._preparation_active -= 1
                if failed:
                    # Sticky before the settle attempt: a cleanup that faults
                    # retains the lease, and nothing may revive this object.
                    self._activation_failed = True
                if failed or self._stopping or self._stopped:
                    self._settle_locked()

    def _pair(self, chat_id):
        record = self._record()
        if chat_id not in record["pairedPrivateChatIds"]:
            record["pairedPrivateChatIds"].append(chat_id)
            try:
                self._persist()
            except Exception:
                record["pairedPrivateChatIds"].remove(chat_id)
                raise

    def _handle_message(self, message, *, migration_active=False):
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}; chat_id, text = chat.get("id"), message.get("text")
        if chat.get("type") != "private" or isinstance(chat_id, bool) or not isinstance(chat_id, int) or not isinstance(text, str): return
        command, paired = normalize(text.split()[0]) if text.strip() else "", self.paired_chat_ids
        if command.startswith("/start"):
            if migration_active:
                self.send_message(chat_id, "Send /start again after migration completes.")
            elif not paired and self.bot_id is not None: self._pair(chat_id); self.send_message(chat_id, "Prisma Local quedó vinculada a este chat. Abrí la HMI en modo presentación y ya podés consultar los datos visibles.")
            elif chat_id in paired: self.send_message(chat_id, "Prisma Local está lista para responder sobre la HMI visible.")
            else: self.send_message(chat_id, "Este bot local ya está vinculado a otro chat.")
            return
        if chat_id not in paired: self.send_message(chat_id, "Send /start to pair this local bot."); return
        if command.startswith("/status"):
            snapshot = self.snapshot_store.read(); self.send_message(chat_id, f"Prisma Local está activa. Último snapshot: {snapshot.get('timestamp') if snapshot else 'sin datos' }."); return
        if command.startswith("/help"):
            self.send_message(chat_id, "Podés consultar lote, producto, orden, cliente, OEE, estado, actividad, potencia, progreso, tiempo restante, alertas o pedir un resumen."); return
        answer = answer_from_snapshot(self.snapshot_store.read(), text); self.send_message(chat_id, answer.answer_text)

    def run(self):
        """Claim the single runner slot, then poll under owned activity.

        Direct and managed callers share one slot, so a duplicate or mixed call
        can never become a second poll loop for the same identity.
        """
        with self._lifecycle_lock:
            if self._stopping or self._stopped or self._activation_failed:
                return
            if self._runner_active:
                return
            self._runner_active = True
        failed = False
        try:
            failed = self._run_claimed()
        finally:
            with self._lifecycle_lock:
                self._runner_active = False
                if failed or self._stopping or self._stopped:
                    self._settle_locked()

    def _run_claimed(self) -> bool:
        """Run the guarded preparation and poll loop; True when preparation failed."""
        if not self._prepared:
            # An observed but unprepared bot must not poll: the guarded
            # preparation has to succeed before any update is fetched.
            try:
                self.prepare()
            except Exception as error:
                if self._stopping:
                    # A stop owns the release decision for a fenced object.
                    return False
                self.last_error = "TELEGRAM_PREPARATION_FAILED"
                self._record_failure(error)
                return True
        with self._lifecycle_lock:
            if self._stopping or self._stopped or self._activation_failed or not self._prepared:
                return False
        while not self.stop_event.is_set():
            try:
                self._note_stage("state_read")
                record = self._record()
                migration_active = record["migrationActive"]
                offset = record["nextUpdateOffset"]
                request_data = {"timeout": 0 if migration_active else 25, **({"offset": offset} if offset is not None else {})}
                self._note_stage("poll")
                payload = self._call("getUpdates", timeout=35, data=request_data)
                self._note_stage("validate")
                updates = payload.get("result")
                if not isinstance(updates, list):
                    raise RuntimeError("TELEGRAM_PROVIDER_UNAVAILABLE")
                if migration_active and not updates:
                    if self.stop_event.is_set():
                        # A fence that lands while the long poll is in flight must
                        # not let a late empty payload complete the migration.
                        break
                    self._note_stage("persist")
                    record["migrationActive"] = False
                    try:
                        self._persist()
                    except Exception:
                        record["migrationActive"] = True
                        raise
                    self.last_error = None
                    self._note_poll_success()
                    continue
                validated_updates = []
                for update in updates:
                    if not isinstance(update, dict):
                        raise RuntimeError("TELEGRAM_UPDATE_INVALID")
                    update_id = update.get("update_id")
                    if isinstance(update_id, bool) or not isinstance(update_id, int) or update_id < 0:
                        raise RuntimeError("TELEGRAM_UPDATE_INVALID")
                    validated_updates.append((update_id, update))
                seen = set()
                for update_id, update in sorted(validated_updates, key=lambda item: item[0]):
                    if self.stop_event.is_set():
                        break
                    if update_id in seen or (record["nextUpdateOffset"] is not None and update_id < record["nextUpdateOffset"]):
                        continue
                    seen.add(update_id)
                    message = update.get("message")
                    if isinstance(message, dict):
                        self._note_stage("handle")
                        self._handle_message(message, migration_active=migration_active)
                    self._note_stage("persist")
                    previous_offset = record["nextUpdateOffset"]
                    record["nextUpdateOffset"] = update_id + 1
                    try:
                        self._persist()
                    except Exception:
                        record["nextUpdateOffset"] = previous_offset
                        raise
                self.last_error = None
                self._note_poll_success()
            except Exception as error:
                self.last_error = "TELEGRAM_POLL_FAILED"
                self._record_failure(error)
                self.stop_event.wait(5)
        return False

    def start(self):
        """Start polling once; a fenced or already active runner is never duplicated."""
        with self._lifecycle_lock:
            if self._stopping or self._stopped or self._activation_failed:
                return
            if self._runner_active or (self.thread is not None and self.thread.is_alive()):
                return
            self.thread = threading.Thread(target=self.run, name="prisma-local-telegram", daemon=True)
            self.thread.start()

    def stop(self):
        """Fence the object, then release its lease only once it is quiescent.

        A managed runner is joined under the existing bounded timeout, but the
        calling thread is never joined to itself. While any preparation or runner
        is still active the lease is retained and this reports False; the owner
        that finishes last performs the same idempotent cleanup. A teardown fault
        keeps the lease so a later stop can retry.
        """
        current = threading.current_thread()
        with self._lifecycle_lock:
            self._stopping = True
            self.stop_event.set()
            thread = self.thread
        if thread is not None and thread is not current and thread.is_alive():
            thread.join(timeout=40)
        with self._lifecycle_lock:
            if not self._quiescent_locked(thread):
                return False
            return self._finalize_owned_quiescent_locked()


def build_telegram_bot(snapshot_store, state_store, voice_events, api_base=DEFAULT_TELEGRAM_API_URL, config=None, reservation=None):
    """Build the standalone opt-in bot bound to the shared identity registry.

    ``api_base`` remains the fifth positional parameter. The reservation stays
    keyword-only and always resolves to the process-wide registry unless a test
    injects a fresh one, so no construction path can create a disjoint guard.
    """
    config: TelegramConfig = config or read_telegram_config()
    if not config.configured:
        return None
    return TelegramLocalBot(
        config.token,
        snapshot_store,
        state_store,
        voice_events,
        api_base,
        reservation=reservation if reservation is not None else process_bot_identity_reservation(),
    )


def create_app(snapshot_store=None, voice_events=None, telegram_bot=None, telegram_configuration=None, admin_http=None, session_registry=None, telegram_manager=None) -> Flask:
    paths = runtime_paths()
    snapshot_store = snapshot_store or JsonFileStore(paths.snapshot)
    voice_events = voice_events or VoiceEventStore()
    session_registry = session_registry or HmiSessionRegistry(on_remove=voice_events.remove_owner)
    telegram_configuration = telegram_configuration or read_telegram_config()
    voice_url = (os.environ.get("PRISMA_LOCAL_VOICE_URL") or DEFAULT_PRISMA_VOICE_URL).rstrip("/")
    local_http = requests.Session(); local_http.trust_env = False
    app = Flask(__name__)
    # One process-local identity registry, shared by the manager factory, the
    # standalone bot builder and any later channel A wiring.
    identity_reservation = process_bot_identity_reservation()
    # Channel A is composed only when this root builds the protected boundary
    # itself: an injected admin boundary already owns its collaborators, so no
    # duplicate manager is ever created for it.
    channel_a_manager = None
    if admin_http is None:
        permissions = SecureStoragePermissions()
        repository = AdminAuthRepository(paths.auth_database, permission_checker=permissions.verify)
        credentials = CredentialService(
            paths.credential_database,
            Path(os.environ.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", "")),
            paths.root,
            permissions.verify,
        )
        if telegram_bot is None and telegram_manager is None:
            resolver = TelegramCredentialResolver(os.environ, lambda: credentials)
            state_store = TelegramStateRepository(paths.chat_state)
            telegram_manager = TelegramLifecycleManager(
                telegram_configuration,
                resolver,
                credentials,
                lambda token: TelegramLocalBot(
                    token, snapshot_store, state_store, voice_events, reservation=identity_reservation
                ),
            )

        def channel_a_destination_label(owner_id):
            """Read only a fresh live owner's display label, never global identity."""
            return session_registry.get_owner_name(
                owner_id, max_age_seconds=CHANNEL_A_OWNER_NAME_MAX_AGE_SECONDS
            )

        def channel_a_on_outcome(outcome):
            """Publish the delivered answer through the existing store; the store
            owns the fail-closed read-time guard and no outcome is retained here."""
            envelope = outcome.answer_envelope
            if envelope is None:
                return
            voice_events.publish(
                "",
                envelope.answer_text,
                owner_id=envelope.owner_id,
                # Late-bound: the manager is inert during construction and only
                # its already-published running authority may authorize delivery.
                is_current=lambda: channel_a_manager.is_query_envelope_current(envelope),
            )

        def build_channel_a_activation(token, desired, epoch, reservation):
            """Compose one real activation; the manager keeps this call lazy, so no
            credential, transport effect, thread or provider call runs here."""
            transport = ChannelATransport(token, request_timeout=CHANNEL_A_REQUEST_TIMEOUT_SECONDS)
            return ChannelAActivation(
                transport=transport,
                sessions=session_registry,
                destination_label=channel_a_destination_label,
                parse=answer_from_snapshot,
                on_outcome=channel_a_on_outcome,
                clock=time.monotonic,
                pairing_clock=time.monotonic,
                query_clock=time.monotonic,
                warning_lead=desired.warning_lead_seconds,
                max_question_bytes=HMI_QUESTION_MAX_BYTES,
                poll_timeout=CHANNEL_A_POLL_TIMEOUT_SECONDS,
                read_timeout=CHANNEL_A_READ_TIMEOUT_SECONDS,
                join_timeout=CHANNEL_A_JOIN_TIMEOUT_SECONDS,
                poll_pause=CHANNEL_A_POLL_PAUSE_SECONDS,
                reservation=reservation,
            )

        # The root builds Channel A before its admin boundary and injects that
        # exact instance, so admin A routes share the composed manager's
        # generation accounting; the manager stays inert here (no startup Apply).
        channel_a_manager = ChannelAManager(
            credential_service=credentials,
            configuration_store=ChannelAConfigurationStore(paths.channel_a_configuration),
            activation_factory=build_channel_a_activation,
            reservation=identity_reservation,
        )

        admin_http = AdminHttpBoundary(
            AdminAuthService(repository, ScryptPasswordHasher()),
            credential_service=credentials,
            telegram_manager=telegram_manager,
            channel_a_manager=channel_a_manager,
            public_origin=os.environ.get("PRISMA_PUBLIC_ORIGIN"),
        )
    app.config.update(snapshot_store=snapshot_store, voice_events=voice_events, telegram_bot=telegram_bot, telegram_manager=telegram_manager, session_registry=session_registry, channel_a_manager=channel_a_manager)
    admin_http.register(app)

    @app.after_request
    def add_local_cors(response):
        origin = request.headers.get("Origin"); allowed = {"http://127.0.0.1:5173", "http://localhost:5173"}
        response.headers["Access-Control-Allow-Origin"] = origin if origin in allowed else "http://127.0.0.1:5173"; response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = f"Content-Type, X-CSRF-Token, {CAPABILITY_HEADER}"; response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        if request.path in {"/hmi/session", "/hmi/current-snapshot", "/hmi/voice/latest", "/local/ask"} or request.path.startswith("/internal/prisma/voice-events/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    def session_error():
        return jsonify({"ok": False, "error": "PRISMA_SESSION_REQUIRED"}), 401

    def session_owner(*, touch=True):
        try:
            return session_registry.authorize(request.headers.get(CAPABILITY_HEADER, ""), touch=touch)
        except HmiSessionUnauthorized:
            return None

    def request_bytes_within(limit):
        if request.content_length is not None and request.content_length > limit:
            return None
        payload = request.stream.read(limit + 1)
        return payload if len(payload) <= limit else None

    def parse_json_bytes(payload):
        try:
            return json.loads(payload)
        except (UnicodeDecodeError, ValueError, TypeError):
            return None

    @app.post("/hmi/session")
    def create_hmi_session():
        payload = request_bytes_within(HMI_SESSION_BOOTSTRAP_MAX_BYTES)
        if payload is None or parse_json_bytes(payload) != {}:
            return jsonify({"ok": False, "error": "INVALID_REQUEST"}), 400
        try:
            capability, metadata = session_registry.create()
        except HmiSessionCapacity:
            return jsonify({"ok": False, "error": "PRISMA_SESSION_CAPACITY"}), 503
        response = jsonify(metadata); response.status_code = 201
        response.headers[CAPABILITY_HEADER] = capability; response.headers["Cache-Control"] = "no-store"
        return response

    @app.delete("/hmi/session")
    def close_hmi_session():
        try:
            capability = request.headers.get(CAPABILITY_HEADER, "")
            session_registry.authorize(capability)
        except HmiSessionUnauthorized:
            return session_error()
        if request_bytes_within(0) != b"":
            return jsonify({"ok": False, "error": "INVALID_REQUEST"}), 400
        try:
            session_registry.close(capability)
        except HmiSessionUnauthorized:
            return session_error()
        return Response(status=204)

    @app.route("/health", methods=["GET"])
    def health():
        snapshot = snapshot_store.read(); voice_ok, voice_probe = _probe_voice(local_http, voice_url)
        telegram_status = telegram_manager.status() if telegram_manager is not None else None
        return jsonify({"ok": True, "ready": voice_ok, "service": "prisma-local-presentation", "mode": "local", "snapshotReady": snapshot is not None, "snapshotTimestamp": snapshot.get("timestamp") if snapshot else None, "telegramEnabled": telegram_status["enabled"] if telegram_status else telegram_configuration.enabled, "telegramConfigured": telegram_status["configured"] if telegram_status else telegram_configuration.configured, "telegramConnected": telegram_status["running"] if telegram_status else bool(telegram_bot and telegram_bot.bot_username), "telegramVerified": telegram_status["verified"] if telegram_status else False, "telegramConfigurationError": telegram_status["lastError"] if telegram_status and not telegram_status["configured"] else (None if telegram_status else telegram_configuration.configuration_error), "telegramLastError": telegram_status["lastError"] if telegram_status else (telegram_bot.last_error if telegram_bot else None), "telegramDesiredGeneration": telegram_status["desiredGeneration"] if telegram_status else None, "telegramAppliedGeneration": telegram_status["appliedGeneration"] if telegram_status else None, "telegramRestartRequired": telegram_status["restartRequired"] if telegram_status else False, "telegramDiagnostic": project_telegram_diagnostic(telegram_status.get("telegramDiagnostic")) if isinstance(telegram_status, dict) else None, "prismaVoiceReady": voice_ok, "voiceProbe": voice_probe})

    @app.route("/hmi/current-snapshot", methods=["GET", "POST", "OPTIONS"])
    def current_snapshot():
        if request.method == "OPTIONS": return Response(status=204)
        capability = request.headers.get(CAPABILITY_HEADER, "")
        if session_owner(touch=False) is None: return session_error()
        if request.method == "GET":
            _owner_id, snapshot = session_registry.get_context(capability)
            return (jsonify({"ok": False, "error": "NO_SNAPSHOT"}), 404) if snapshot is None else jsonify(snapshot)
        payload = request_bytes_within(session_registry.max_context_bytes)
        if payload is None:
            return jsonify({"ok": False, "error": "PRISMA_SESSION_CONTEXT_TOO_LARGE"}), 413
        try:
            applied = session_registry.apply_context_command(capability, parse_json_bytes(payload))
        except HmiSessionContextTooLarge:
            return jsonify({"ok": False, "error": "PRISMA_SESSION_CONTEXT_TOO_LARGE"}), 413
        except HmiSessionUnauthorized:
            return session_error()
        except (ValueError, TypeError, UnicodeError, RecursionError, OverflowError):
            return jsonify({"ok": False, "error": "INVALID_SNAPSHOT"}), 400
        return jsonify({"ok": True, "status": "accepted" if applied else "stale"}), 202 if applied else 200

    @app.route("/hmi/voice/latest", methods=["GET", "OPTIONS"])
    def latest_voice():
        if request.method == "OPTIONS": return Response(status=204)
        owner_id = session_owner()
        if owner_id is None: return session_error()
        event = voice_events.latest(owner_id)
        return Response(status=204) if event is None else jsonify(event)

    @app.route("/internal/prisma/voice-events/<event_id>", methods=["GET"])
    def voice_event(event_id):
        owner_id = session_owner()
        if owner_id is None: return session_error()
        event = voice_events.get_internal(event_id, owner_id)
        return (jsonify({"ok": False, "error": "VOICE_EVENT_NOT_FOUND"}), 404) if event is None else jsonify(event)

    @app.route("/local/ask", methods=["POST", "OPTIONS"])
    def local_ask():
        if request.method == "OPTIONS": return Response(status=204)
        payload = request_bytes_within(HMI_ASK_MAX_BYTES)
        if payload is None:
            return jsonify({"ok": False, "error": "INVALID_LOCAL_ASK_REQUEST"}), 400
        owner_id = session_owner()
        if owner_id is None: return session_error()
        data = parse_json_bytes(payload)
        if not isinstance(data, dict): return jsonify({"ok": False, "error": "INVALID_LOCAL_ASK_REQUEST"}), 400
        if "telegramChatId" in data: return jsonify({"ok": False, "error": "TELEGRAM_RECIPIENT_NOT_ALLOWED"}), 400
        if set(data) != {"question"} or not isinstance(data.get("question"), str):
            return jsonify({"ok": False, "error": "INVALID_LOCAL_ASK_REQUEST"}), 400
        question = data["question"].strip()
        try:
            question_bytes = len(question.encode("utf-8"))
        except UnicodeEncodeError:
            return jsonify({"ok": False, "error": "INVALID_LOCAL_ASK_REQUEST"}), 400
        if not 1 <= question_bytes <= HMI_QUESTION_MAX_BYTES:
            return jsonify({"ok": False, "error": "QUESTION_REQUIRED"}), 400
        try:
            _age, snapshot, revision = session_registry.capture_owner_context(
                owner_id, max_age_seconds=session_registry.absolute_ttl,
            )
        except HmiSessionContextUnavailable:
            # Preserve the existing context-free local answer/event contract.
            snapshot, revision = None, None
        except HmiSessionError:
            return jsonify({"ok": False, "error": "NO_SNAPSHOT"}), 409
        answer = answer_from_snapshot(snapshot, question)
        if revision is not None and not session_registry.is_owner_context_current(owner_id, revision):
            return jsonify({"ok": False, "error": "NO_SNAPSHOT"}), 409
        try:
            event = voice_events.publish(question, answer.answer_text, owner_id=owner_id)
        except VoiceEventCapacity:
            return jsonify({"ok": False, "error": "VOICE_EVENT_CAPACITY"}), 503
        return jsonify({**answer.as_dict(), "voiceEvent": event})

    @app.route("/hmi/prisma-config", methods=["GET", "PUT", "OPTIONS"])
    def prisma_config_proxy():
        if request.method == "OPTIONS": return Response(status=204)
        try: upstream = local_http.request(request.method, f"{voice_url}/prisma/config", json=request.get_json(silent=True) if request.method == "PUT" else None, timeout=8)
        except requests.RequestException as error: return jsonify({"ok": False, "error": "PRISMA_VOICE_UNAVAILABLE", "message": str(error)}), 503
        return Response(upstream.content, status=upstream.status_code, content_type=upstream.headers.get("Content-Type", "application/json"))
    return app


def main():
    telegram_configuration = read_telegram_config()
    paths = runtime_paths(); snapshot_store = JsonFileStore(paths.snapshot); events = VoiceEventStore()
    app = create_app(snapshot_store, events, None, telegram_configuration)
    telegram_manager = app.config.get("telegram_manager")
    channel_a_manager = app.config.get("channel_a_manager")
    # Only Channel B has an accepted startup Apply; A stays inert until an
    # explicit operator Apply, and neither stop path claims guaranteed closure.
    if telegram_manager: telegram_manager.startup_apply()
    try: app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, threaded=True, use_reloader=False)
    finally:
        if channel_a_manager: channel_a_manager.stop()
        if telegram_manager: telegram_manager.stop()


if __name__ == "__main__": main()
