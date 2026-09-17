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
