import importlib
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime import voice_transcription as vt


class LimitsTests(unittest.TestCase):
    def test_duration_within_bound_is_accepted(self):
        vt.validate_voice_note_duration(1)
        vt.validate_voice_note_duration(vt.MAX_VOICE_NOTE_DURATION_SECONDS - 1)

    def test_duration_over_bound_is_rejected(self):
        with self.assertRaises(vt.VoiceNoteTooLong):
            vt.validate_voice_note_duration(vt.MAX_VOICE_NOTE_DURATION_SECONDS + 1)

    def test_duration_reported_as_exactly_the_bound_is_rejected(self):
        # Telegram reports whole seconds: a note shown as 0:30 lasts 30.0-30.9 s,
        # i.e. it already exceeds the 30 s limit the reply announces.
        with self.assertRaises(vt.VoiceNoteTooLong):
            vt.validate_voice_note_duration(vt.MAX_VOICE_NOTE_DURATION_SECONDS)

    def test_duration_missing_or_invalid_is_rejected(self):
        for bad in (None, "30", 0, -1, True, 3.5):
            with self.assertRaises(vt.VoiceNoteTooLong):
                vt.validate_voice_note_duration(bad)

    def test_size_within_bound_is_accepted(self):
        vt.validate_voice_note_size(vt.MAX_VOICE_NOTE_FILE_SIZE_BYTES)

    def test_size_none_is_accepted(self):
        # Telegram does not always report file_size before download.
        vt.validate_voice_note_size(None)

    def test_size_over_bound_is_rejected(self):
        with self.assertRaises(vt.VoiceNoteTooLarge):
            vt.validate_voice_note_size(vt.MAX_VOICE_NOTE_FILE_SIZE_BYTES + 1)

    def test_size_invalid_type_is_rejected(self):
        for bad in ("5", True, -1):
            with self.assertRaises(vt.VoiceNoteTooLarge):
                vt.validate_voice_note_size(bad)


class PromptBuilderTests(unittest.TestCase):
    def test_prompt_includes_static_domain_vocabulary(self):
        prompt = vt.build_transcription_prompt()
        for term in vt.DOMAIN_VOCABULARY_TERMS:
            self.assertIn(term, prompt)

    def test_prompt_includes_extra_terms(self):
        prompt = vt.build_transcription_prompt(extra_terms=("Prensa 3",))
        self.assertIn("Prensa 3", prompt)

    def test_prompt_ignores_non_string_extra_terms(self):
        prompt = vt.build_transcription_prompt(extra_terms=(None, 42, "  ", "Horno 1"))
        self.assertIn("Horno 1", prompt)

    def test_a_bare_extra_terms_string_is_treated_as_one_term_not_split_into_letters(self):
        prompt = vt.build_transcription_prompt(extra_terms="Prensa 3")
        self.assertIn("Prensa 3", prompt)
        self.assertNotIn(", P, r, e", prompt)

    def test_prompt_is_formal_usted_spanish(self):
        prompt = vt.build_transcription_prompt()
        self.assertIn("Transcriba", prompt)
        self.assertNotIn("Transcribí", prompt)

    def test_too_long_reply_states_the_actual_configured_limit(self):
        self.assertIn(str(vt.MAX_VOICE_NOTE_DURATION_SECONDS), vt.VOICE_NOTE_TOO_LONG_REPLY)


def _fake_genai_module(response_text="lote actual", raise_on_generate=None):
    part_cls = SimpleNamespace(from_bytes=Mock(return_value="AUDIO_PART"))
    # F7 (live test 2026-09-25): the config classes echo back whatever
    # kwargs they were built with, as plain attributes, so a test can
    # inspect exactly what transcribe_voice_note passed.
    thinking_config_cls = Mock(side_effect=lambda **kwargs: SimpleNamespace(**kwargs))
    generate_content_config_cls = Mock(side_effect=lambda **kwargs: SimpleNamespace(**kwargs))
    types_ns = SimpleNamespace(
        Part=part_cls, ThinkingConfig=thinking_config_cls, GenerateContentConfig=generate_content_config_cls
    )
    module = SimpleNamespace(types=types_ns)

    def generate_content(*, model, contents, config=None):
        if raise_on_generate is not None:
            raise raise_on_generate
        return SimpleNamespace(text=response_text)

    return module, generate_content


class TranscribeVoiceNoteTests(unittest.TestCase):
    def _client_with(self, generate_content):
        client = Mock()
        client.models.generate_content = Mock(side_effect=generate_content)
        return client

    def _patched_import(self, module):
        import importlib

        original = importlib.import_module

        def fake_import(name, *args, **kwargs):
            if name == "google.genai":
                return module
            return original(name, *args, **kwargs)

        return fake_import

    def test_successful_transcription_returns_stripped_text(self):
        module, generate_content = _fake_genai_module(response_text="  lote 42 en progreso  ")
        client = self._client_with(generate_content)

        with patch.object(importlib, "import_module", side_effect=self._patched_import(module)):
            result = vt.transcribe_voice_note(client, b"audio-bytes", "audio/ogg")
        self.assertEqual(result, "lote 42 en progreso")

    def test_empty_audio_bytes_raises_empty(self):
        client = self._client_with(lambda **_: SimpleNamespace(text="x"))
        with self.assertRaises(vt.VoiceTranscriptionEmpty):
            vt.transcribe_voice_note(client, b"", "audio/ogg")

    def test_empty_transcript_raises_empty(self):
        module, generate_content = _fake_genai_module(response_text="   ")
        client = self._client_with(generate_content)

        with patch.object(importlib, "import_module", side_effect=self._patched_import(module)):
            with self.assertRaises(vt.VoiceTranscriptionEmpty):
                vt.transcribe_voice_note(client, b"audio-bytes", "audio/ogg")

    def test_provider_failure_raises_unavailable(self):
        module, generate_content = _fake_genai_module(raise_on_generate=RuntimeError("boom"))
        client = self._client_with(generate_content)

        with patch.object(importlib, "import_module", side_effect=self._patched_import(module)):
            with self.assertRaises(vt.VoiceTranscriptionUnavailable):
                vt.transcribe_voice_note(client, b"audio-bytes", "audio/ogg")

    def test_model_used_matches_named_constant(self):
        module, generate_content = _fake_genai_module(response_text="ok")
        client = self._client_with(generate_content)

        with patch.object(importlib, "import_module", side_effect=self._patched_import(module)):
            vt.transcribe_voice_note(client, b"audio-bytes", "audio/ogg")
        _, kwargs = client.models.generate_content.call_args
        self.assertEqual(kwargs["model"], vt.GEMINI_TRANSCRIPTION_MODEL)

    def test_generation_config_disables_thinking_and_uses_named_constants(self):
        """F7 (live test 2026-09-25, authorized benchmark: google-genai
        2.17.0, model gemini-3.8-flash, 5 synthesized Spanish questions):
        warm median 2292 ms with no config vs 1224 ms with
        thinking_budget=0/temperature=0/max_output_tokens=128, identical
        accuracy -- pass this config on every transcription call."""
        module, generate_content = _fake_genai_module(response_text="ok")
        client = self._client_with(generate_content)

        with patch.object(importlib, "import_module", side_effect=self._patched_import(module)):
            vt.transcribe_voice_note(client, b"audio-bytes", "audio/ogg")
        _, kwargs = client.models.generate_content.call_args
        config = kwargs["config"]
        self.assertEqual(config.temperature, vt.GEMINI_TRANSCRIPTION_TEMPERATURE)
        self.assertEqual(config.max_output_tokens, vt.GEMINI_TRANSCRIPTION_MAX_OUTPUT_TOKENS)
        self.assertEqual(config.thinking_config.thinking_budget, vt.GEMINI_TRANSCRIPTION_THINKING_BUDGET)


class SpanishCopyTests(unittest.TestCase):
    def test_every_reply_constant_is_formal_usted_and_nonempty(self):
        replies = (
            vt.VOICE_NOTE_TOO_LONG_REPLY,
            vt.VOICE_NOTE_TOO_LARGE_REPLY,
            vt.VOICE_NOTE_DOWNLOAD_FAILED_REPLY,
            vt.VOICE_NOTE_TRANSCRIPTION_EMPTY_REPLY,
            vt.VOICE_NOTE_TRANSCRIPTION_UNAVAILABLE_REPLY,
        )
        voseo_or_tuteo_markers = ("enviá", "envia ", "intentá", "intenta ", "escribí", "probá", "podés")
        for reply in replies:
            self.assertIsInstance(reply, str)
            self.assertTrue(reply.strip())
            lowered = reply.lower()
            for marker in voseo_or_tuteo_markers:
                self.assertNotIn(marker, lowered)


if __name__ == "__main__":
    unittest.main()
