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
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests
from flask import Flask, Response, jsonify, request

from .paths import runtime_paths
from .telegram_config import TelegramConfig, read_telegram_config


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5057
DEFAULT_PRISMA_VOICE_URL = "http://127.0.0.1:5056"
DEFAULT_TELEGRAM_API_URL = "https://api.telegram.org"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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


class VoiceEventStore:
    def __init__(self):
        self.lock = threading.RLock()
        self._event = {"id": f"startup-{int(time.time() * 1000)}", "timestamp": utc_now_iso(), "text": "", "question": "inicio-local"}

    def publish(self, question: str, answer_text: str, chat_id: int | None) -> dict[str, Any]:
        with self.lock:
            event = {"id": f"local-{int(time.time() * 1000)}", "timestamp": utc_now_iso(), "text": answer_text, "question": question}
            if chat_id is not None: event["telegramChatId"] = chat_id
            self._event = event
            return dict(event)

    def latest(self) -> dict[str, Any]:
        with self.lock:
            return dict(self._event)


class TelegramLocalBot:
    def __init__(self, token, snapshot_store, state_store, voice_events, api_base=DEFAULT_TELEGRAM_API_URL):
        self.token, self.snapshot_store, self.state_store, self.voice_events = token.strip(), snapshot_store, state_store, voice_events
        self.api_base, self.session = api_base.rstrip("/"), requests.Session()
        self.stop_event, self.thread = threading.Event(), None
        self.last_error, self.bot_username = None, None

    @property
    def paired_chat_ids(self) -> set[int]:
        values = [part.strip() for part in os.environ.get("PRISMA_LOCAL_ALLOWED_CHAT_IDS", "").split(",") if part.strip()]
        result = {int(value) for value in values if value.lstrip("-").isdigit()}
        state = self.state_store.read() or {}
        result.update(value for value in state.get("allowedChatIds", []) if isinstance(value, int))
        return result

    def _call(self, method, *, timeout=35, **kwargs):
        response = self.session.post(f"{self.api_base}/bot{self.token}/{method}", timeout=timeout, **kwargs)
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"): raise RuntimeError(payload.get("description") or f"Telegram rejected {method}")
        return payload

    def send_message(self, chat_id, text): self._call("sendMessage", timeout=20, data={"chat_id": chat_id, "text": text})

    def _pair(self, chat_id):
        state = self.state_store.read() or {}; allowed = [value for value in state.get("allowedChatIds", []) if isinstance(value, int)]
        if chat_id not in allowed: allowed.append(chat_id)
        state["allowedChatIds"] = allowed; self.state_store.write(state)

    def _handle_message(self, message):
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}; chat_id, text = chat.get("id"), message.get("text")
        if not isinstance(chat_id, int) or not isinstance(text, str): return
        command, paired = normalize(text.split()[0]) if text.strip() else "", self.paired_chat_ids
        if command.startswith("/start"):
            if not paired: self._pair(chat_id); self.send_message(chat_id, "Prisma Local quedó vinculada a este chat. Abrí la HMI en modo presentación y ya podés consultar los datos visibles.")
            elif chat_id in paired: self.send_message(chat_id, "Prisma Local está lista para responder sobre la HMI visible.")
            else: self.send_message(chat_id, "Este bot local ya está vinculado a otro chat.")
            return
        if chat_id not in paired: self.send_message(chat_id, "Enviá /start para vincular este bot local."); return
        if command.startswith("/status"):
            snapshot = self.snapshot_store.read(); self.send_message(chat_id, f"Prisma Local está activa. Último snapshot: {snapshot.get('timestamp') if snapshot else 'sin datos' }."); return
        if command.startswith("/help"):
            self.send_message(chat_id, "Podés consultar lote, producto, orden, cliente, OEE, estado, actividad, potencia, progreso, tiempo restante, alertas o pedir un resumen."); return
        answer = answer_from_snapshot(self.snapshot_store.read(), text); self.send_message(chat_id, answer.answer_text); self.voice_events.publish(text, answer.answer_text, chat_id)

    def run(self):
        try:
            self._call("deleteWebhook", timeout=20, data={"drop_pending_updates": "true"}); self.bot_username = self._call("getMe", timeout=20).get("result", {}).get("username")
        except Exception as error: self.last_error = str(error)
        offset = None
        while not self.stop_event.is_set():
            try:
                payload = self._call("getUpdates", timeout=35, data={"timeout": 25, **({"offset": offset} if offset is not None else {})}); self.last_error = None
                for update in payload.get("result", []):
                    if isinstance(update.get("update_id"), int): offset = update["update_id"] + 1
                    if isinstance(update.get("message"), dict): self._handle_message(update["message"])
            except Exception as error:
                self.last_error = str(error); self.stop_event.wait(5)

    def start(self):
        if not self.thread or not self.thread.is_alive(): self.thread = threading.Thread(target=self.run, name="prisma-local-telegram", daemon=True); self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive(): self.thread.join(timeout=3)


def build_telegram_bot(snapshot_store, state_store, voice_events, api_base=DEFAULT_TELEGRAM_API_URL):
    config: TelegramConfig = read_telegram_config()
    if not config.enabled:
        return None
    return TelegramLocalBot(config.token, snapshot_store, state_store, voice_events, api_base)


def create_app(snapshot_store=None, voice_events=None, telegram_bot=None) -> Flask:
    paths = runtime_paths()
    snapshot_store = snapshot_store or JsonFileStore(paths.snapshot)
    voice_events = voice_events or VoiceEventStore()
    voice_url = os.environ.get("PRISMA_LOCAL_VOICE_URL", DEFAULT_PRISMA_VOICE_URL).rstrip("/")
    local_http = requests.Session(); local_http.trust_env = False
    app = Flask(__name__); app.config.update(snapshot_store=snapshot_store, voice_events=voice_events, telegram_bot=telegram_bot)

    @app.after_request
    def add_local_cors(response):
        origin = request.headers.get("Origin"); allowed = {"http://127.0.0.1:5173", "http://localhost:5173"}
        response.headers["Access-Control-Allow-Origin"] = origin if origin in allowed else "http://127.0.0.1:5173"; response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"; response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"; return response

    @app.route("/health", methods=["GET"])
    def health():
        snapshot = snapshot_store.read(); voice_ok = False
        try: voice_ok = bool(local_http.get(f"{voice_url}/health", timeout=1).json().get("ok"))
        except (requests.RequestException, ValueError): pass
        return jsonify({"ok": True, "ready": voice_ok, "service": "prisma-local-presentation", "mode": "local", "snapshotReady": snapshot is not None, "snapshotTimestamp": snapshot.get("timestamp") if snapshot else None, "telegramEnabled": telegram_bot is not None, "telegramConfigured": bool(telegram_bot and telegram_bot.token), "telegramConnected": bool(telegram_bot and telegram_bot.bot_username), "telegramLastError": telegram_bot.last_error if telegram_bot else None, "prismaVoiceReady": voice_ok})

    @app.route("/hmi/current-snapshot", methods=["GET", "POST", "OPTIONS"])
    def current_snapshot():
        if request.method == "OPTIONS": return Response(status=204)
        if request.method == "GET":
            snapshot = snapshot_store.read()
            return (jsonify({"ok": False, "error": "NO_SNAPSHOT"}), 404) if snapshot is None else jsonify(snapshot)
        snapshot = request.get_json(silent=True)
        if not isinstance(snapshot, dict) or not isinstance(snapshot.get("widgets"), list): return jsonify({"ok": False, "error": "INVALID_SNAPSHOT", "message": "widgets must be a list."}), 400
        if not snapshot.get("timestamp"): snapshot["timestamp"] = utc_now_iso()
        snapshot_store.write(snapshot); return jsonify({"ok": True, "status": "accepted", "timestamp": snapshot["timestamp"]}), 202

    @app.route("/hmi/voice/latest", methods=["GET", "OPTIONS"])
    def latest_voice(): return Response(status=204) if request.method == "OPTIONS" else jsonify(voice_events.latest())

    @app.route("/local/ask", methods=["POST", "OPTIONS"])
    def local_ask():
        if request.method == "OPTIONS": return Response(status=204)
        data = request.get_json(silent=True) or {}; question = str(data.get("question") or "").strip()
        if not question: return jsonify({"ok": False, "error": "QUESTION_REQUIRED"}), 400
        chat_id = data.get("telegramChatId") if isinstance(data.get("telegramChatId"), int) else None; answer = answer_from_snapshot(snapshot_store.read(), question); event = voice_events.publish(question, answer.answer_text, chat_id)
        return jsonify({**answer.as_dict(), "voiceEvent": event})

    @app.route("/hmi/prisma-config", methods=["GET", "PUT", "OPTIONS"])
    def prisma_config_proxy():
        if request.method == "OPTIONS": return Response(status=204)
        try: upstream = local_http.request(request.method, f"{voice_url}/prisma/config", json=request.get_json(silent=True) if request.method == "PUT" else None, timeout=8)
        except requests.RequestException as error: return jsonify({"ok": False, "error": "PRISMA_VOICE_UNAVAILABLE", "message": str(error)}), 503
        return Response(upstream.content, status=upstream.status_code, content_type=upstream.headers.get("Content-Type", "application/json"))
    return app


def main():
    read_telegram_config()
    paths = runtime_paths(); snapshot_store = JsonFileStore(paths.snapshot); state_store = JsonFileStore(paths.chat_state); events = VoiceEventStore(); bot = build_telegram_bot(snapshot_store, state_store, events)
    app = create_app(snapshot_store, events, bot)
    if bot: bot.start()
    try: app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, threaded=True, use_reloader=False)
    finally:
        if bot: bot.stop()


if __name__ == "__main__": main()
