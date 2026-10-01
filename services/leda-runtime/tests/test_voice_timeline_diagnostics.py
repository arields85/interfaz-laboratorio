import sys
import unittest
from pathlib import Path

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.voice_timeline_diagnostics import (
    VoiceTimelineRateLimiter,
    format_timeline_log_line,
    validate_timeline_batch,
)


def sample_record(**overrides):
    record = {
        "schema_version": "1",
        "run_id": "leda-0123456789abcdef",
        "layer": "browser",
        "record_type": "orb-phase",
        "sequence": 0,
        "monotonic_ms": 12.5,
        "elapsed_ms": 12.5,
        "payload": {"phase": "visible"},
    }
    record.update(overrides)
    return record


class ValidateTimelineBatchTests(unittest.TestCase):
    def test_accepts_a_well_formed_batch_and_normalizes_each_record(self) -> None:
        records = validate_timeline_batch({"records": [sample_record()]})
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["payload"], {"phase": "visible"})
        self.assertEqual(records[0]["record_type"], "orb-phase")

    def test_accepts_every_known_t16_record_type(self) -> None:
        cases = (
            ("voice-event-received", {"source": "poll"}),
            ("speak-live-request-start", {}),
            ("speak-live-response-received", {"http_status": 200, "elapsed_ms": 100}),
            ("speak-live-stale-discarded", {"elapsed_ms": 10}),
            ("session-reset", {"reason": "explicit", "epoch_after": 2}),
            ("audio-context-state", {"state": "running", "when": "after-resume"}),
        )
        for record_type, payload in cases:
            with self.subTest(record_type=record_type):
                records = validate_timeline_batch(
                    {"records": [sample_record(record_type=record_type, payload=payload)]}
                )
                self.assertEqual(records[0]["record_type"], record_type)

    def test_accepts_a_progressive_playback_ended_record_with_t1_prebuffer_fields(self) -> None:
        records = validate_timeline_batch({"records": [sample_record(
            record_type="playback-ended",
            payload={
                "elapsed_ms": 20,
                "transport": "progressive",
                "pcm_bytes": 48_000,
                "pcm_duration_seconds": 1,
                "underflow_count": 0,
                "prebuffer_ms": 200,
                "needed_prebuffer_ms": 65,
                "prebuffer_mode": "fixed",
            },
        )]})
        self.assertEqual(records[0]["payload"]["prebuffer_mode"], "fixed")
        self.assertEqual(records[0]["payload"]["needed_prebuffer_ms"], 65)

    def test_accepts_a_playback_ended_record_without_the_optional_prebuffer_fields(self) -> None:
        records = validate_timeline_batch({"records": [sample_record(
            record_type="playback-ended",
            payload={
                "elapsed_ms": 20,
                "transport": "buffer-before-playback",
                "pcm_bytes": 48_000,
                "pcm_duration_seconds": 1,
                "underflow_count": 0,
            },
        )]})
        self.assertNotIn("prebuffer_mode", records[0]["payload"])

    def test_rejects_an_unknown_prebuffer_mode_value(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record(
                record_type="playback-ended",
                payload={
                    "elapsed_ms": 20,
                    "transport": "progressive",
                    "pcm_bytes": 48_000,
                    "pcm_duration_seconds": 1,
                    "underflow_count": 0,
                    "prebuffer_ms": 200,
                    "needed_prebuffer_ms": 65,
                    "prebuffer_mode": "adaptive",
                },
            )]})

    def test_rejects_a_non_dict_envelope(self) -> None:
        for candidate in (None, [], "records", 5):
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                validate_timeline_batch(candidate)

    def test_rejects_an_envelope_with_extra_top_level_keys(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record()], "extra": 1})

    def test_rejects_an_empty_or_oversized_batch(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": []})
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record() for _ in range(5)]}, max_records=4)

    def test_rejects_a_record_outside_the_browser_layer(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record(layer="provider", record_type="dispatch", payload={})]})

    def test_rejects_a_wrong_schema_version(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record(schema_version="2")]})

    def test_rejects_free_text_in_the_payload(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record(payload={"phase": "visible", "note": "hola"})]})

    def test_rejects_an_unknown_record_type(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record(record_type="not-a-real-type", payload={})]})

    def test_rejects_a_record_with_extra_envelope_keys(self) -> None:
        record = sample_record()
        record["eventId"] = "should-not-be-here"
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [record]})

    def test_a_malformed_record_never_partially_accepts_the_batch(self) -> None:
        with self.assertRaises(ValueError):
            validate_timeline_batch({"records": [sample_record(), sample_record(sequence=1, payload={})]})


class FormatTimelineLogLineTests(unittest.TestCase):
    def test_formats_the_documented_shape_with_sorted_extra_fields(self) -> None:
        record = validate_timeline_batch(
            {"records": [sample_record(payload={"phase": "visible"}, elapsed_ms=812)]}
        )[0]
        line = format_timeline_log_line(record)
        self.assertEqual(
            line,
            "HMI voice timeline: run=leda-0123456789abcdef seq=0 type=orb-phase t_ms=812 extra=phase=visible",
        )

    def test_omits_extra_when_the_payload_is_empty(self) -> None:
        record = validate_timeline_batch(
            {"records": [sample_record(record_type="speak-live-request-start", payload={}, elapsed_ms=5)]}
        )[0]
        line = format_timeline_log_line(record)
        self.assertEqual(line, "HMI voice timeline: run=leda-0123456789abcdef seq=0 type=speak-live-request-start t_ms=5")

    def test_multi_field_payload_is_sorted_and_never_carries_free_text(self) -> None:
        record = validate_timeline_batch(
            {"records": [sample_record(
                record_type="speak-live-response-received",
                payload={"http_status": 200, "elapsed_ms": 143},
                elapsed_ms=143,
            )]}
        )[0]
        line = format_timeline_log_line(record)
        self.assertEqual(
            line,
            "HMI voice timeline: run=leda-0123456789abcdef seq=0 type=speak-live-response-received t_ms=143 "
            "extra=elapsed_ms=143 http_status=200",
        )


class VoiceTimelineRateLimiterTests(unittest.TestCase):
    def test_allows_requests_under_the_limit(self) -> None:
        limiter = VoiceTimelineRateLimiter(max_requests=2, window_seconds=60.0, clock=lambda: 0.0)
        self.assertTrue(limiter.allow("owner-1"))
        self.assertTrue(limiter.allow("owner-1"))

    def test_rejects_once_the_limit_is_reached_within_the_window(self) -> None:
        limiter = VoiceTimelineRateLimiter(max_requests=2, window_seconds=60.0, clock=lambda: 0.0)
        limiter.allow("owner-1")
        limiter.allow("owner-1")
        self.assertFalse(limiter.allow("owner-1"))

    def test_tracks_each_owner_independently(self) -> None:
        limiter = VoiceTimelineRateLimiter(max_requests=1, window_seconds=60.0, clock=lambda: 0.0)
        self.assertTrue(limiter.allow("owner-1"))
        self.assertFalse(limiter.allow("owner-1"))
        self.assertTrue(limiter.allow("owner-2"))

    def test_old_hits_expire_out_of_the_window(self) -> None:
        now = {"value": 0.0}
        limiter = VoiceTimelineRateLimiter(max_requests=1, window_seconds=10.0, clock=lambda: now["value"])
        self.assertTrue(limiter.allow("owner-1"))
        self.assertFalse(limiter.allow("owner-1"))
        now["value"] = 11.0
        self.assertTrue(limiter.allow("owner-1"))


if __name__ == "__main__":
    unittest.main()
