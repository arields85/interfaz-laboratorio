"""Leda's fixed messages in every copy register (usted, rioplatense or neutro).

Each message is written once per register as a whole sentence, never derived from another register by
swapping words. Templates keep their ``str.format`` placeholders. The ``usted`` variants are the
product's historical wording and must stay byte-identical: the default register changes nothing.

Messages that read the same in every register (impersonal wording) are not listed here; they stay as
plain constants next to the code that sends them. Data answers (``answer_from_snapshot``) are
third person and out of scope.
"""

from __future__ import annotations

from .copy_register import DEFAULT_COPY_REGISTER, COPY_REGISTERS

_BOT_HELP_TOPICS = "lote, producto, orden, cliente, OEE, estado, actividad, potencia, progreso, tiempo restante, alertas o pedir un resumen."

# message id -> {register: template}. Every message must define all of COPY_REGISTERS.
_MESSAGES: dict[str, dict[str, str]] = {
    # Channel B: access flow and chat replies.
    "no_dashboard_open": {
        "usted": "En este momento no hay ningún dashboard abierto en la HMI. Vuelva a consultar cuando haya uno en pantalla.",
        "rioplatense": "En este momento no hay ningún dashboard abierto en la HMI. Volvé a consultar cuando haya uno en pantalla.",
        "neutro": "En este momento no hay ningún dashboard abierto en la HMI. Vuelve a consultar cuando haya uno en pantalla.",
    },
    "access_requested": {
        "usted": "Su solicitud de acceso quedó registrada. Se le avisará cuando un administrador la apruebe.",
        "rioplatense": "Tu solicitud de acceso quedó registrada. Te vamos a avisar cuando un administrador la apruebe.",
        "neutro": "Tu solicitud de acceso quedó registrada. Te avisaremos cuando un administrador la apruebe.",
    },
    "access_requests_full": {
        "usted": "En este momento no es posible registrar nuevas solicitudes. Intente más tarde.",
        "rioplatense": "En este momento no es posible registrar nuevas solicitudes. Intentá más tarde.",
        "neutro": "En este momento no es posible registrar nuevas solicitudes. Intenta más tarde.",
    },
    "access_request_hint": {
        "usted": "Para solicitar acceso, envíe /start.",
        "rioplatense": "Para solicitar acceso, enviá /start.",
        "neutro": "Para solicitar acceso, envía /start.",
    },
    "access_pending": {
        "usted": "Su solicitud de acceso está pendiente de aprobación.",
        "rioplatense": "Tu solicitud de acceso está pendiente de aprobación.",
        "neutro": "Tu solicitud de acceso está pendiente de aprobación.",
    },
    "access_denied": {
        "usted": "No tiene acceso a este asistente.",
        "rioplatense": "No tenés acceso a este asistente.",
        "neutro": "No tienes acceso a este asistente.",
    },
    "access_approved": {
        "usted": "Su acceso fue aprobado. Ya puede realizar sus consultas.",
        "rioplatense": "Tu acceso fue aprobado. Ya podés realizar tus consultas.",
        "neutro": "Tu acceso fue aprobado. Ya puedes realizar tus consultas.",
    },
    "message_limit": {
        "usted": "Ha enviado demasiadas consultas seguidas. Espere un momento y vuelva a intentarlo.",
        "rioplatense": "Enviaste demasiadas consultas seguidas. Esperá un momento y volvé a intentarlo.",
        "neutro": "Has enviado demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo.",
    },
    "migration_restart": {
        "usted": "Envíe /start nuevamente cuando finalice la migración.",
        "rioplatense": "Enviá /start nuevamente cuando finalice la migración.",
        "neutro": "Envía /start nuevamente cuando finalice la migración.",
    },
    "bot_ready": {
        "usted": "Leda está lista para responder sus consultas.",
        "rioplatense": "Leda está lista para responder tus consultas.",
        "neutro": "Leda está lista para responder tus consultas.",
    },
    "bot_help": {
        "usted": "Puede consultar " + _BOT_HELP_TOPICS,
        "rioplatense": "Podés consultar " + _BOT_HELP_TOPICS,
        "neutro": "Puedes consultar " + _BOT_HELP_TOPICS,
    },
    # Voice-note replies, shared by both channels. ``{max_seconds}`` is the configured duration limit.
    "voice_note_too_long": {
        "usted": "La nota de voz dura más de {max_seconds} segundos. Por favor, envíe una nota más breve.",
        "rioplatense": "La nota de voz dura más de {max_seconds} segundos. Por favor, enviá una nota más breve.",
        "neutro": "La nota de voz dura más de {max_seconds} segundos. Por favor, envía una nota más breve.",
    },
    "voice_note_too_large": {
        "usted": "La nota de voz es demasiado pesada. Por favor, envíe una nota más breve.",
        "rioplatense": "La nota de voz es demasiado pesada. Por favor, enviá una nota más breve.",
        "neutro": "La nota de voz es demasiado pesada. Por favor, envía una nota más breve.",
    },
    "voice_note_download_failed": {
        "usted": "No se pudo descargar su nota de voz. Intente nuevamente.",
        "rioplatense": "No se pudo descargar tu nota de voz. Intentá nuevamente.",
        "neutro": "No se pudo descargar tu nota de voz. Intenta nuevamente.",
    },
    "voice_note_transcription_empty": {
        "usted": "No se pudo entender la nota de voz. Intente nuevamente o escriba su pregunta.",
        "rioplatense": "No se pudo entender la nota de voz. Intentá nuevamente o escribí tu pregunta.",
        "neutro": "No se pudo entender la nota de voz. Intenta nuevamente o escribe tu pregunta.",
    },
    "voice_note_transcription_unavailable": {
        "usted": "El servicio de voz no está disponible en este momento. Intente nuevamente en unos minutos o escriba su pregunta.",
        "rioplatense": "El servicio de voz no está disponible en este momento. Intentá nuevamente en unos minutos o escribí tu pregunta.",
        "neutro": "El servicio de voz no está disponible en este momento. Intenta nuevamente en unos minutos o escribe tu pregunta.",
    },
    # Channel A: pairing dialogue and query notices. ``{label}`` is the HMI destination name.
    "confirmation_prompt": {
        "usted": "Un teléfono quiere conectarse con:\n{label}\n\nConfirme para hacerle preguntas a Leda desde aquí; le responderá en pantalla y con voz.",
        "rioplatense": "Un teléfono quiere conectarse con:\n{label}\n\nConfirmá para hacerle preguntas a Leda desde aquí; te responderá en pantalla y con voz.",
        "neutro": "Un teléfono quiere conectarse con:\n{label}\n\nConfirma para hacerle preguntas a Leda desde aquí; te responderá en pantalla y con voz.",
    },
    "welcome": {
        "usted": "Vinculación confirmada con:\n{label}\n\nYa puede realizar sus consultas. Use el botón «Desvincular» de este chat para dejar de recibir respuestas en este teléfono.",
        "rioplatense": "Vinculación confirmada con:\n{label}\n\nYa podés realizar tus consultas. Usá el botón «Desvincular» de este chat para dejar de recibir respuestas en este teléfono.",
        "neutro": "Vinculación confirmada con:\n{label}\n\nYa puedes realizar tus consultas. Usa el botón «Desvincular» de este chat para dejar de recibir respuestas en este teléfono.",
    },
    "destination_unavailable": {
        "usted": "{label} ya no está disponible. Genere un código nuevo desde la pantalla.",
        "rioplatense": "{label} ya no está disponible. Generá un código nuevo desde la pantalla.",
        "neutro": "{label} ya no está disponible. Genera un código nuevo desde la pantalla.",
    },
    "action_refused": {
        "usted": "Ese botón ya no es válido. Genere un código nuevo desde la pantalla del HMI.",
        "rioplatense": "Ese botón ya no es válido. Generá un código nuevo desde la pantalla del HMI.",
        "neutro": "Ese botón ya no es válido. Genera un código nuevo desde la pantalla del HMI.",
    },
    "inactivity_warning": {
        "usted": "La vinculación con {label} se va a cerrar por inactividad.\nUse el botón para seguir conectado, o el botón «Desvincular» de este chat para desvincular este teléfono.",
        "rioplatense": "La vinculación con {label} se va a cerrar por inactividad.\nUsá el botón para seguir conectado, o el botón «Desvincular» de este chat para desvincular este teléfono.",
        "neutro": "La vinculación con {label} se va a cerrar por inactividad.\nUsa el botón para seguir conectado, o el botón «Desvincular» de este chat para desvincular este teléfono.",
    },
    "unlink_confirm_prompt": {
        "usted": "¿Confirma que desea desvincular este teléfono? Ya no recibirá respuestas de Leda en este chat.",
        "rioplatense": "¿Confirmás que querés desvincular este teléfono? Ya no vas a recibir respuestas de Leda en este chat.",
        "neutro": "¿Confirmas que deseas desvincular este teléfono? Ya no recibirás respuestas de Leda en este chat.",
    },
    "query_unavailable": {
        "usted": "No se pudieron leer los datos de {label} en este momento. Intente de nuevo en unos segundos.",
        "rioplatense": "No se pudieron leer los datos de {label} en este momento. Intentá de nuevo en unos segundos.",
        "neutro": "No se pudieron leer los datos de {label} en este momento. Intenta de nuevo en unos segundos.",
    },
}

LEDA_MESSAGE_IDS: tuple[str, ...] = tuple(_MESSAGES)


def leda_template(message_id: str, register: object) -> str:
    """The raw template of a message in a register; an unknown register reads as ``usted``.

    An unknown ``message_id`` is a programming error and raises ``KeyError``.
    """
    variants = _MESSAGES[message_id]
    return variants[register if register in COPY_REGISTERS else DEFAULT_COPY_REGISTER]


def leda_text(message_id: str, register: object, **params: object) -> str:
    """A message in a register with its placeholders filled; templates without parameters come back raw."""
    template = leda_template(message_id, register)
    return template.format(**params) if params else template
