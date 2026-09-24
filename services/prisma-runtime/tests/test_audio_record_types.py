import unittest

from prisma_runtime.audio_record_types import ALLOWED_RECORD_TYPES, RecordStream, make_record


class AudioRecordTypeTests(unittest.TestCase):
    def test_allowlist_separates_runtime_layers(self) -> None:
        self.assertEqual(set(ALLOWED_RECORD_TYPES["provider"]), {"dispatch", "completion"})
        self.assertIn("dsp", ALLOWED_RECORD_TYPES["backend"])
        self.assertIn("canonical-decode", ALLOWED_RECORD_TYPES["browser"])
        self.assertNotIn("text", ALLOWED_RECORD_TYPES["browser"])

    def test_stream_rejects_non_monotonic_elapsed_time(self) -> None:
        stream = RecordStream("prisma-0123456789abcdef")
        stream.emit("backend", "receipt", 1, 1, {})
        with self.assertRaises(ValueError):
            stream.emit("backend", "dsp", 2, 0, {})

    def test_records_are_typed_and_opaque(self) -> None:
        record = make_record("prisma-0123456789abcdef", "provider", "completion", 4, 20, 20, {"status": "cancel"})
        self.assertEqual(record["payload"]["status"], "cancel")
        self.assertNotIn("external_id", record)
        with self.assertRaises(ValueError):
            make_record(record["run_id"], "provider", "completion", 5, 21, 21, {"status": "done"})

    def test_rejects_run_ids_that_do_not_exactly_match_the_schema_pattern(self) -> None:
        with self.assertRaises(ValueError):
            make_record("prisma-0123456789abcdef-", "provider", "dispatch", 0, 0, 0, {})

    def test_requires_each_first_readable_audio_payload_field(self) -> None:
        for payload in ({}, {"elapsed_ms": 1}, {"pcm_bytes": 48_000}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                make_record(
                    "prisma-0123456789abcdef",
                    "browser",
                    "first-readable-audio",
                    0,
                    1,
                    1,
                    payload,
                )

    def test_rejects_unknown_boolean_and_non_finite_payload_values(self) -> None:
        invalid_records = (
            ("dsp", {"unknown": 1}),
            ("dsp", {"sample_count": True}),
            ("finalization", {"duration_ms": float("nan")}),
            ("first-readable-audio", {"elapsed_ms": float("inf"), "pcm_bytes": 48_000}),
            ("buffering-complete", {"elapsed_ms": 1, "pcm_bytes": 48_000, "pcm_duration_seconds": float("-inf")}),
        )
        for record_type, payload in invalid_records:
            layer = "browser" if record_type in {"first-readable-audio", "buffering-complete"} else "backend"
            with self.subTest(record_type=record_type, payload=payload), self.assertRaises(ValueError):
                make_record("prisma-0123456789abcdef", layer, record_type, 0, 1, 1, payload)

    def test_allowlist_includes_the_t16_voice_timeline_record_types(self) -> None:
        for record_type in (
            "voice-event-received",
            "orb-phase",
            "speak-live-request-start",
            "speak-live-response-received",
            "speak-live-stale-discarded",
            "session-reset",
            "audio-context-state",
        ):
            with self.subTest(record_type=record_type):
                self.assertIn(record_type, ALLOWED_RECORD_TYPES["browser"])

    def test_accepts_complete_t16_voice_timeline_payloads(self) -> None:
        cases = (
            ("voice-event-received", {"source": "sse"}),
            ("orb-phase", {"phase": "visible"}),
            ("speak-live-request-start", {}),
            ("speak-live-response-received", {"http_status": 200, "elapsed_ms": 143}),
            ("speak-live-stale-discarded", {"elapsed_ms": 620}),
            ("session-reset", {"reason": "unauthorized-401", "epoch_after": 3}),
            ("audio-context-state", {"state": "suspended", "when": "at-play"}),
        )
        for record_type, payload in cases:
            with self.subTest(record_type=record_type):
                record = make_record("prisma-0123456789abcdef", "browser", record_type, 0, 1, 1, payload)
                self.assertEqual(record["payload"], payload)

    def test_rejects_t16_voice_timeline_payloads_missing_required_fields_or_free_text(self) -> None:
        invalid = (
            ("voice-event-received", {}),
            ("orb-phase", {"phase": "curious"}),
            ("speak-live-response-received", {"http_status": 200}),
            ("session-reset", {"reason": "explicit"}),
            ("audio-context-state", {"state": "running", "when": "at-play", "note": "free text"}),
        )
        for record_type, payload in invalid:
            with self.subTest(record_type=record_type, payload=payload), self.assertRaises(ValueError):
                make_record("prisma-0123456789abcdef", "browser", record_type, 0, 1, 1, payload)

    def test_accepts_complete_browser_payload_and_optional_runtime_payloads(self) -> None:
        browser = make_record(
            "prisma-0123456789abcdef",
            "browser",
            "first-readable-audio",
            10**30,
            1,
            1,
            {"elapsed_ms": 1, "pcm_bytes": 10**30},
        )
        provider = make_record("prisma-0123456789abcdef", "provider", "completion", 0, 0, 0, {})
        backend = make_record("prisma-0123456789abcdef", "backend", "finalization", 0, 0, 0, {})

        self.assertEqual(browser["payload"]["pcm_bytes"], 10**30)
        self.assertEqual(provider["payload"], {})
        self.assertEqual(backend["payload"], {})


if __name__ == "__main__":
    unittest.main()
