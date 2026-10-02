import io
import logging
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime import timing_log
from leda_runtime.timing_log import StageTimer, format_timing_line, install_timing_log_handler, log_timing


class FakeClock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FormatTimingLineTests(unittest.TestCase):
    def test_renders_ints_booleans_and_short_tokens_in_order(self):
        line = format_timing_line("Leda test timing:", {"outcome": "answered", "status_ms": 12, "reused": True, "ok": False})
        self.assertEqual(line, "Leda test timing: outcome=answered status_ms=12 reused=true ok=false")

    def test_redacts_anything_that_could_carry_content(self):
        line = format_timing_line(
            "Leda test timing:",
            {"outcome": "¿Cuál es el OEE?", "chat": "995701520 Pepe", "url": "https://api.telegram.org/bot123:abc/x", "ratio": 1.5, "unknown": None},
        )
        self.assertEqual(line, "Leda test timing: outcome=redacted chat=redacted url=redacted ratio=redacted")

    def test_drops_keys_that_are_not_plain_identifiers(self):
        line = format_timing_line("Leda test timing:", {"Bad Key": 1, "good_ms": 2})
        self.assertEqual(line, "Leda test timing: good_ms=2")


class StageTimerTests(unittest.TestCase):
    def test_stage_start_stop_and_total_use_the_injected_clock(self):
        clock = FakeClock()
        timer = StageTimer(clock)
        with timer.stage("status"):
            clock.advance(0.012)
        timer.start("answer")
        clock.advance(0.250)
        timer.stop("answer")
        clock.advance(0.003)
        self.assertEqual(timer.fields, {"status_ms": 12, "answer_ms": 250})
        self.assertEqual(timer.total_ms(), 265)

    def test_repeated_stages_accumulate_and_a_failing_stage_is_still_recorded(self):
        clock = FakeClock()
        timer = StageTimer(clock)
        with timer.stage("send"):
            clock.advance(0.010)
        with self.assertRaises(RuntimeError):
            with timer.stage("send"):
                clock.advance(0.005)
                raise RuntimeError("boom")
        self.assertEqual(timer.fields, {"send_ms": 15})

    def test_emit_puts_leading_tokens_first_and_total_last(self):
        clock = FakeClock()
        timer = StageTimer(clock)
        with timer.stage("a"):
            clock.advance(0.002)
        with self.assertLogs(timing_log.TIMING_LOGGER_NAME, level="INFO") as observed:
            timer.emit("Leda test timing:", outcome="ok")
        self.assertEqual(observed.records[0].getMessage(), "Leda test timing: outcome=ok a_ms=2 total_ms=2")


class TimingLoggerVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.logger = logging.getLogger(timing_log.TIMING_LOGGER_NAME)
        self.original_handlers = list(self.logger.handlers)
        for handler in self.original_handlers:
            self.logger.removeHandler(handler)
        self.addCleanup(self._restore)

    def _restore(self):
        for handler in list(self.logger.handlers):
            self.logger.removeHandler(handler)
        for handler in self.original_handlers:
            self.logger.addHandler(handler)

    def test_logger_is_info_level_and_isolated_from_the_root_logger(self):
        self.assertEqual(self.logger.level, logging.INFO)
        self.assertFalse(self.logger.propagate)

    def test_installed_handler_writes_info_lines_to_the_given_stream_with_a_timestamp(self):
        stream = io.StringIO()
        install_timing_log_handler(stream)
        log_timing("Leda test timing:", {"total_ms": 5})
        written = stream.getvalue()
        self.assertTrue(written.endswith("Leda test timing: total_ms=5\n"), written)
        self.assertRegex(written, r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}")

    def test_install_is_idempotent(self):
        stream = io.StringIO()
        install_timing_log_handler(stream)
        install_timing_log_handler(stream)
        log_timing("Leda test timing:", {"total_ms": 1})
        self.assertEqual(stream.getvalue().count("Leda test timing:"), 1)

    def test_default_install_targets_stderr_and_does_not_enable_other_info_logging(self):
        install_timing_log_handler()
        handler = self.logger.handlers[0]
        self.assertIs(handler.stream, sys.stderr)
        self.assertEqual(handler.level, logging.INFO)
        self.assertGreater(logging.getLogger("leda_runtime.voice_service").getEffectiveLevel(), logging.INFO)
        self.assertGreater(logging.getLogger("leda_runtime.local_presentation").getEffectiveLevel(), logging.INFO)

    def test_log_timing_never_raises(self):
        class Exploding(logging.Handler):
            def emit(self, record):
                raise RuntimeError("handler failure")

        self.logger.addHandler(Exploding())
        logging.raiseExceptions = False
        try:
            log_timing("Leda test timing:", {"total_ms": 1})
        finally:
            logging.raiseExceptions = True


class ProcessEntrypointTests(unittest.TestCase):
    """Both processes must install the timing handler, or the lines never reach the launcher's stderr log files."""

    def test_voice_main_installs_the_timing_handler_before_serving(self):
        from leda_runtime import voice_service

        order = []
        with patch.object(voice_service, "install_timing_log_handler", side_effect=lambda: order.append("install")) as install,                 patch.object(voice_service, "_validate_single_process_environment"),                 patch.object(voice_service.threading, "Thread"),                 patch.object(voice_service, "install_access_log_query_redaction"),                 patch.object(voice_service.app, "run", side_effect=lambda **_kwargs: order.append("run")):
            voice_service.main()
        install.assert_called_once_with()
        self.assertEqual(order, ["install", "run"])

    def test_presentation_main_installs_the_timing_handler_before_serving(self):
        from leda_runtime import local_presentation

        order = []
        app = Mock()
        app.config.get.return_value = None
        app.run.side_effect = lambda **_kwargs: order.append("run")
        with patch.object(local_presentation, "install_timing_log_handler", side_effect=lambda: order.append("install")) as install,                 patch.object(local_presentation, "read_telegram_config"),                 patch.object(local_presentation, "runtime_paths"),                 patch.object(local_presentation, "JsonFileStore"),                 patch.object(local_presentation, "VoiceEventStore"),                 patch.object(local_presentation, "create_app", return_value=app),                 patch.object(local_presentation, "install_access_log_query_redaction"):
            local_presentation.main()
        install.assert_called_once_with()
        self.assertEqual(order, ["install", "run"])


if __name__ == "__main__":
    unittest.main()
