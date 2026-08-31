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


if __name__ == "__main__":
    unittest.main()
