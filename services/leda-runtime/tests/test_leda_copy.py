import re
import sys
import unittest
from pathlib import Path
from string import Formatter

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.copy_register import (
    COPY_REGISTER_KEY,
    COPY_REGISTERS,
    COPY_REGISTER_TTL_SECONDS,
    CopyRegisterResolver,
    active_register,
)
from leda_runtime.hmi_config_store import HmiConfigUnavailable
from leda_runtime.leda_copy import LEDA_MESSAGE_IDS, leda_template, leda_text
from leda_runtime.voice_transcription import MAX_VOICE_NOTE_DURATION_SECONDS

LABEL = "Sala 3 — Reactor"

# The fixed messages that depend on the register, with the sample parameters their templates take.
EXPECTED_PARAMS = {
    "no_dashboard_open": {},
    "access_requested": {},
    "access_requests_full": {},
    "access_request_hint": {},
    "access_pending": {},
    "access_denied": {},
    "access_approved": {},
    "message_limit": {},
    "migration_restart": {},
    "bot_ready": {},
    "bot_help": {},
    "voice_note_too_long": {"max_seconds": MAX_VOICE_NOTE_DURATION_SECONDS},
    "voice_note_too_large": {},
    "voice_note_download_failed": {},
    "voice_note_transcription_empty": {},
    "voice_note_transcription_unavailable": {},
    "confirmation_prompt": {"label": LABEL},
    "welcome": {"label": LABEL},
    "destination_unavailable": {"label": LABEL},
    "action_refused": {},
    "inactivity_warning": {"label": LABEL},
    "unlink_confirm_prompt": {},
    "query_unavailable": {"label": LABEL},
}

# The literals the product sent before the register existed. The usted variants must match them byte for byte.
USTED_LITERALS = {
    "no_dashboard_open": "En este momento no hay ningún dashboard abierto en la HMI. Vuelva a consultar cuando haya uno en pantalla.",
    "access_requested": "Su solicitud de acceso quedó registrada. Se le avisará cuando un administrador la apruebe.",
    "access_requests_full": "En este momento no es posible registrar nuevas solicitudes. Intente más tarde.",
    "access_request_hint": "Para solicitar acceso, envíe /start.",
    "access_pending": "Su solicitud de acceso está pendiente de aprobación.",
    "access_denied": "No tiene acceso a este asistente.",
    "access_approved": "Su acceso fue aprobado. Ya puede realizar sus consultas.",
    "message_limit": "Ha enviado demasiadas consultas seguidas. Espere un momento y vuelva a intentarlo.",
    "migration_restart": "Envíe /start nuevamente cuando finalice la migración.",
    "bot_ready": "Leda está lista para responder sus consultas.",
    "bot_help": "Puede consultar lote, producto, orden, cliente, OEE, estado, actividad, potencia, progreso, tiempo restante, alertas o pedir un resumen.",
    "voice_note_too_long": f"La nota de voz dura más de {MAX_VOICE_NOTE_DURATION_SECONDS} segundos. Por favor, envíe una nota más breve.",
    "voice_note_too_large": "La nota de voz es demasiado pesada. Por favor, envíe una nota más breve.",
    "voice_note_download_failed": "No se pudo descargar su nota de voz. Intente nuevamente.",
    "voice_note_transcription_empty": "No se pudo entender la nota de voz. Intente nuevamente o escriba su pregunta.",
    "voice_note_transcription_unavailable": "El servicio de voz no está disponible en este momento. Intente nuevamente en unos minutos o escriba su pregunta.",
    "confirmation_prompt": f"Un teléfono quiere conectarse con:\n{LABEL}\n\nConfirme para hacerle preguntas a Leda desde aquí; le responderá en pantalla y con voz.",
    "welcome": f"Vinculación confirmada con:\n{LABEL}\n\nYa puede realizar sus consultas. Use el botón «Desvincular» de este chat para dejar de recibir respuestas en este teléfono.",
    "destination_unavailable": f"{LABEL} ya no está disponible. Genere un código nuevo desde la pantalla.",
    "action_refused": "Ese botón ya no es válido. Genere un código nuevo desde la pantalla del HMI.",
    "inactivity_warning": f"La vinculación con {LABEL} se va a cerrar por inactividad.\nUse el botón para seguir conectado, o el botón «Desvincular» de este chat para desvincular este teléfono.",
    "unlink_confirm_prompt": "¿Confirma que desea desvincular este teléfono? Ya no recibirá respuestas de Leda en este chat.",
    "query_unavailable": f"No se pudieron leer los datos de {LABEL} en este momento. Intente de nuevo en unos segundos.",
}

# Whole words that give a register away. Matched as words so "este" never trips the "te" marker.
VOSEO_WORDS = (
    "enviá", "intentá", "escribí", "podés", "tenés", "usá", "esperá", "volvé", "generá",
    "confirmá", "confirmás", "querés", "enviaste", "vas",
)
TUTEO_WORDS = (
    "envía", "intenta", "escribe", "puedes", "tienes", "usa", "espera", "vuelve", "genera",
    "deseas", "recibirás", "has",
)
USTED_WORDS = (
    "envíe", "intente", "escriba", "puede", "tiene", "use", "espere", "vuelva", "genere",
    "confirme", "desea", "ha", "su", "sus", "le",
)
# Second person singular pronouns and possessives: legitimate in vos and tú, never in usted.
INFORMAL_PRONOUN_WORDS = ("tu", "tus", "te", "ti", "vos")


def contains_word(text: str, words) -> list[str]:
    lowered = text.lower()
    return [word for word in words if re.search(rf"(?<![\w]){re.escape(word)}(?![\w])", lowered)]


def fields(template: str) -> set[str]:
    return {name for _, name, _, _ in Formatter().parse(template) if name}


class MessageTableTests(unittest.TestCase):
    def test_the_message_ids_are_exactly_the_documented_set(self) -> None:
        self.assertEqual(set(LEDA_MESSAGE_IDS), set(EXPECTED_PARAMS))
        self.assertEqual(len(LEDA_MESSAGE_IDS), len(set(LEDA_MESSAGE_IDS)))

    def test_every_message_has_the_three_registers_and_formats_with_its_parameters(self) -> None:
        for message_id, params in EXPECTED_PARAMS.items():
            for register in COPY_REGISTERS:
                with self.subTest(message=message_id, register=register):
                    text = leda_text(message_id, register, **params)
                    self.assertIsInstance(text, str)
                    self.assertTrue(text.strip())
                    self.assertNotIn("{", text)
                    for value in params.values():
                        self.assertIn(str(value), text)

    def test_the_informal_variants_differ_from_usted_and_keep_the_same_placeholders(self) -> None:
        # Vos and tú share some sentences ("Tu solicitud de acceso..."), so only usted must differ from both.
        for message_id, params in EXPECTED_PARAMS.items():
            with self.subTest(message=message_id):
                usted, rioplatense, neutro = (leda_template(message_id, register) for register in COPY_REGISTERS)
                self.assertNotEqual(rioplatense, usted)
                self.assertNotEqual(neutro, usted)
                for variant in (usted, rioplatense, neutro):
                    self.assertEqual(fields(variant), set(params))

    def test_the_usted_variants_are_byte_identical_to_the_previous_literals(self) -> None:
        for message_id, literal in USTED_LITERALS.items():
            with self.subTest(message=message_id):
                self.assertEqual(leda_text(message_id, "usted", **EXPECTED_PARAMS[message_id]), literal)

    def test_an_unknown_register_reads_as_usted(self) -> None:
        for register in ("voseo", "", None, 3, "USTED"):
            with self.subTest(register=register):
                self.assertEqual(leda_text("access_denied", register), USTED_LITERALS["access_denied"])

    def test_an_unknown_message_id_is_a_programming_error(self) -> None:
        with self.assertRaises(KeyError):
            leda_text("not_a_message", "usted")

    def test_a_template_without_parameters_is_returned_raw(self) -> None:
        self.assertIn("{label}", leda_template("welcome", "usted"))
        self.assertNotIn("{label}", leda_text("welcome", "usted", label="A"))


class RegisterVocabularyTests(unittest.TestCase):
    """Whole-sentence variants must read as their own register, never as a word swap of another."""

    def variants(self, register):
        for message_id, params in EXPECTED_PARAMS.items():
            yield message_id, leda_text(message_id, register, **params).replace(LABEL, "")

    def test_usted_has_no_voseo_tuteo_or_informal_pronouns(self) -> None:
        for message_id, text in self.variants("usted"):
            with self.subTest(message=message_id):
                self.assertEqual(contains_word(text, VOSEO_WORDS + TUTEO_WORDS + INFORMAL_PRONOUN_WORDS), [])

    def test_rioplatense_has_no_tuteo_or_usted_forms(self) -> None:
        for message_id, text in self.variants("rioplatense"):
            with self.subTest(message=message_id):
                self.assertEqual(contains_word(text, TUTEO_WORDS + USTED_WORDS), [])

    def test_neutro_has_no_voseo_or_usted_forms(self) -> None:
        for message_id, text in self.variants("neutro"):
            with self.subTest(message=message_id):
                self.assertEqual(contains_word(text, VOSEO_WORDS + USTED_WORDS), [])

    def test_the_addressed_messages_use_the_expected_forms(self) -> None:
        self.assertEqual(leda_text("access_request_hint", "rioplatense"), "Para solicitar acceso, enviá /start.")
        self.assertEqual(leda_text("access_request_hint", "neutro"), "Para solicitar acceso, envía /start.")
        self.assertEqual(leda_text("access_denied", "rioplatense"), "No tenés acceso a este asistente.")
        self.assertEqual(leda_text("access_denied", "neutro"), "No tienes acceso a este asistente.")


class FakeStore:
    def __init__(self, register=None):
        self.items = {} if register is None else {COPY_REGISTER_KEY: f'{{"version": 1, "register": "{register}"}}'}
        self.reads = 0
        self.error = None

    def read_document(self):
        self.reads += 1
        if self.error is not None:
            raise self.error
        return 1, dict(self.items)


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


class CopyRegisterResolverTests(unittest.TestCase):
    def test_the_ttl_is_a_few_seconds(self) -> None:
        self.assertEqual(COPY_REGISTER_TTL_SECONDS, 5.0)

    def test_it_reads_the_stored_register_and_caches_it_within_the_ttl(self) -> None:
        store, clock = FakeStore("neutro"), FakeClock()
        resolver = CopyRegisterResolver(store, clock=clock)
        self.assertEqual(resolver(), "neutro")
        clock.now += COPY_REGISTER_TTL_SECONDS - 0.1
        self.assertEqual(resolver(), "neutro")
        self.assertEqual(store.reads, 1)

    def test_a_changed_setting_applies_after_the_ttl_without_a_restart(self) -> None:
        store, clock = FakeStore("neutro"), FakeClock()
        resolver = CopyRegisterResolver(store, clock=clock)
        self.assertEqual(resolver(), "neutro")
        store.items = FakeStore("rioplatense").items
        self.assertEqual(resolver(), "neutro")
        clock.now += COPY_REGISTER_TTL_SECONDS
        self.assertEqual(resolver(), "rioplatense")
        self.assertEqual(store.reads, 2)

    def test_an_unset_setting_reads_as_usted(self) -> None:
        self.assertEqual(CopyRegisterResolver(FakeStore(), clock=FakeClock())(), "usted")

    def test_a_store_failure_reads_as_usted_and_never_raises(self) -> None:
        for error in (HmiConfigUnavailable("HMI_CONFIG_UNAVAILABLE"), RuntimeError("boom"), OSError("disk")):
            with self.subTest(error=type(error).__name__):
                store = FakeStore("neutro")
                store.error = error
                self.assertEqual(CopyRegisterResolver(store, clock=FakeClock())(), "usted")

    def test_it_recovers_after_the_ttl_once_the_store_works_again(self) -> None:
        store, clock = FakeStore("neutro"), FakeClock()
        store.error = RuntimeError("boom")
        resolver = CopyRegisterResolver(store, clock=clock)
        self.assertEqual(resolver(), "usted")
        store.error = None
        self.assertEqual(resolver(), "usted")
        clock.now += COPY_REGISTER_TTL_SECONDS
        self.assertEqual(resolver(), "neutro")


class ActiveRegisterTests(unittest.TestCase):
    def test_no_resolver_means_usted(self) -> None:
        self.assertEqual(active_register(None), "usted")

    def test_a_resolver_value_is_used_when_it_is_a_known_register(self) -> None:
        for register in COPY_REGISTERS:
            self.assertEqual(active_register(lambda register=register: register), register)

    def test_a_raising_or_unusable_resolver_means_usted(self) -> None:
        def broken():
            raise RuntimeError("boom")

        self.assertEqual(active_register(broken), "usted")
        for value in ("voseo", None, 3, ""):
            self.assertEqual(active_register(lambda value=value: value), "usted")


if __name__ == "__main__":
    unittest.main()
