import unittest

from prisma_runtime.audio_observability import BoundedAudioSink


class AudioObservabilityTests(unittest.TestCase):
    def test_default_sink_is_disabled(self) -> None:
        sink = BoundedAudioSink()
        self.assertIsNone(sink.emit("provider", "dispatch", {}))
        self.assertEqual(sink.records, [])

    def test_enabled_sink_is_bounded_and_layer_separated(self) -> None:
        sink = BoundedAudioSink(enabled=True, limit=2)
        sink.emit("provider", "dispatch", {})
        sink.emit("provider", "completion", {"status": "success"})
        sink.emit("backend", "receipt", {})
        self.assertEqual(len(sink.records), 2)
        self.assertEqual([item["layer"] for item in sink.records], ["provider", "backend"])
        self.assertEqual([item["sequence"] for item in sink.records], [1, 2])

    def test_terminal_records_do_not_contain_content(self) -> None:
        sink = BoundedAudioSink(enabled=True)
        error = sink.emit("backend", "finalization", {"status": "error"})
        cancel = sink.emit("browser", "cancel", {"status": "cancel"})
        self.assertNotIn("text", error)
        self.assertNotIn("audio", cancel)


if __name__ == "__main__":
    unittest.main()
