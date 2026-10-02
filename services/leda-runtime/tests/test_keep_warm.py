import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime import gemini_credentials, keep_warm
from leda_runtime import voice_service as service

TIMING = "leda_runtime.timing"


class FakeWait:
    """Stands in for ``stop_event.wait``: records intervals and reports a stop
    after ``ticks`` waits, so a loop runs a fixed number of cycles with no sleeping."""

    def __init__(self, ticks):
        self.ticks = ticks
        self.intervals = []

    def __call__(self, interval):
        self.intervals.append(interval)
        return len(self.intervals) > self.ticks


def messages(observed):
    return [record.getMessage() for record in observed.records]


class KeepWarmLoopTests(unittest.TestCase):
    def test_probes_once_per_interval_and_stops_when_the_wait_reports_stop(self):
        probe = Mock(return_value=True)
        wait = FakeWait(ticks=3)
        keep_warm.run_keep_warm_loop("telegram", 30.0, probe, threading.Event(), wait=wait)
        self.assertEqual(probe.call_count, 3)
        self.assertEqual(wait.intervals, [30.0] * 4)

    def test_probe_first_probes_before_the_first_wait(self):
        order = []
        probe = Mock(side_effect=lambda: order.append("probe") or True)
        wait = FakeWait(ticks=0)
        wait_spy = lambda interval: order.append("wait") or wait(interval)
        keep_warm.run_keep_warm_loop("telegram", 30.0, probe, threading.Event(), probe_first=True, wait=wait_spy)
        self.assertEqual(order, ["probe", "wait"])

    def test_default_does_not_probe_before_the_first_wait(self):
        probe = Mock(return_value=True)
        keep_warm.run_keep_warm_loop("gemini", 45.0, probe, threading.Event(), wait=FakeWait(ticks=0))
        probe.assert_not_called()

    def test_logs_one_redacted_start_line(self):
        with self.assertLogs(TIMING, level="INFO") as observed:
            keep_warm.run_keep_warm_loop("telegram", 30.0, Mock(return_value=True), threading.Event(), wait=FakeWait(ticks=2))
        self.assertEqual(messages(observed), ["Leda keep-warm: target=telegram interval_s=30"])

    def test_a_skipped_probe_is_silent_and_not_a_failure(self):
        with self.assertLogs(TIMING, level="INFO") as observed:
            keep_warm.run_keep_warm_loop("gemini", 45.0, Mock(return_value=False), threading.Event(), wait=FakeWait(ticks=3))
        self.assertEqual(len(messages(observed)), 1, messages(observed))

    def test_survives_exceptions_and_logs_only_the_exception_type_once(self):
        probe = Mock(side_effect=ConnectionError("https://api.telegram.org/bot123:SECRET/getMe"))
        with self.assertLogs(TIMING, level="INFO") as observed:
            keep_warm.run_keep_warm_loop("telegram", 30.0, probe, threading.Event(), wait=FakeWait(ticks=4))
        self.assertEqual(probe.call_count, 4)
        lines = messages(observed)
        self.assertEqual(lines[1:], ["Leda keep-warm: target=telegram outcome=failed error_type=ConnectionError"])
        self.assertNotIn("SECRET", " ".join(lines))

    def test_logs_recovery_after_a_failure(self):
        results = [RuntimeError("x"), True, True]

        def probe():
            result = results.pop(0)
            if isinstance(result, Exception):
                raise result
            return result

        with self.assertLogs(TIMING, level="INFO") as observed:
            keep_warm.run_keep_warm_loop("gemini", 45.0, probe, threading.Event(), wait=FakeWait(ticks=3))
        self.assertEqual(
            messages(observed)[1:],
            ["Leda keep-warm: target=gemini outcome=failed error_type=RuntimeError", "Leda keep-warm: target=gemini outcome=recovered"],
        )

    def test_a_new_failure_type_is_logged_again(self):
        errors = [RuntimeError("x"), ValueError("y")]
        probe = Mock(side_effect=errors)
        with self.assertLogs(TIMING, level="INFO") as observed:
            keep_warm.run_keep_warm_loop("gemini", 45.0, probe, threading.Event(), wait=FakeWait(ticks=2))
        self.assertEqual(len(messages(observed)), 3)

    def test_stops_on_the_real_stop_event(self):
        stop = threading.Event()
        stop.set()
        probe = Mock(return_value=True)
        keep_warm.run_keep_warm_loop("telegram", 30.0, probe, stop)  # default wait is stop.wait
        probe.assert_not_called()

    def test_start_runs_a_named_daemon_thread(self):
        stop = threading.Event()
        stop.set()
        thread = keep_warm.start_keep_warm_thread("telegram", 30.0, Mock(return_value=True), stop)
        thread.join(timeout=5)
        self.assertTrue(thread.daemon)
        self.assertFalse(thread.is_alive())

    def test_gemini_interval_is_inside_the_connection_keepalive_window(self):
        self.assertLess(keep_warm.GEMINI_KEEP_WARM_INTERVAL_SECONDS, gemini_credentials.GEMINI_HTTP_KEEPALIVE_EXPIRY_SECONDS)
        self.assertEqual(keep_warm.TELEGRAM_KEEP_WARM_INTERVAL_SECONDS, 30.0)


class TelegramKeepWarmProbeTests(unittest.TestCase):
    def test_get_me_goes_through_the_shared_session_while_holding_the_lock(self):
        held = []
        session = Mock()

        def get(url, **kwargs):
            held.append(service._TELEGRAM_HTTP_LOCK.locked())
            return Mock(ok=True)

        session.get.side_effect = get
        with patch.object(service, "_telegram_token", return_value="123:TOKEN"), \
                patch.object(service, "_TELEGRAM_HTTP_SESSION", session), \
                patch.dict("os.environ", {"TELEGRAM_BOT_API_BASE": "https://telegram.test/"}):
            self.assertTrue(service._telegram_keep_warm_probe())
        session.get.assert_called_once()
        self.assertEqual(session.get.call_args.args[0], "https://telegram.test/bot123:TOKEN/getMe")
        self.assertEqual(held, [True])
        self.assertFalse(service._TELEGRAM_HTTP_LOCK.locked())

    def test_does_nothing_without_a_token(self):
        session = Mock()
        with patch.object(service, "_telegram_token", return_value=""), patch.object(service, "_TELEGRAM_HTTP_SESSION", session):
            self.assertFalse(service._telegram_keep_warm_probe())
        session.get.assert_not_called()

    def test_an_error_status_is_a_failure_without_leaking_the_token(self):
        response = Mock()
        response.raise_for_status.side_effect = RuntimeError("401 for url bot123:TOKEN")
        session = Mock()
        session.get.return_value = response
        with patch.object(service, "_telegram_token", return_value="123:TOKEN"), patch.object(service, "_TELEGRAM_HTTP_SESSION", session):
            with self.assertRaises(RuntimeError):
                service._telegram_keep_warm_probe()
        self.assertFalse(service._TELEGRAM_HTTP_LOCK.locked())

    def test_loop_wiring_swallows_a_probe_exception_and_logs_the_type_only(self):
        session = Mock()
        session.get.side_effect = ConnectionError("bot123:TOKEN")
        with patch.object(service, "_telegram_token", return_value="123:TOKEN"), patch.object(service, "_TELEGRAM_HTTP_SESSION", session), \
                self.assertLogs(TIMING, level="INFO") as observed:
            keep_warm.run_keep_warm_loop("telegram", 30.0, service._telegram_keep_warm_probe, threading.Event(), probe_first=True, wait=FakeWait(ticks=1))
        self.assertNotIn("TOKEN", " ".join(messages(observed)))
        self.assertIn("error_type=ConnectionError", " ".join(messages(observed)))


class GeminiKeepWarmProbeTests(unittest.TestCase):
    def test_models_get_only_through_the_warm_client(self):
        client = Mock()
        with patch.object(service.gemini_credentials, "resolve", return_value="secret"), \
                patch.object(service._warm_gemini_client, "get", return_value=(client, True)) as get:
            self.assertTrue(service._gemini_keep_warm_probe())
        get.assert_called_once_with("secret")
        client.models.get.assert_called_once_with(model=service.TTS_MODEL)
        client.models.generate_content_stream.assert_not_called()

    def test_skips_without_a_credential(self):
        with patch.object(service.gemini_credentials, "resolve", side_effect=service.GeminiCredentialUnavailable("x")), \
                patch.object(service._warm_gemini_client, "get") as get:
            self.assertFalse(service._gemini_keep_warm_probe())
        get.assert_not_called()

    def test_tolerates_a_rebuilt_client_after_credential_rotation(self):
        old, new = Mock(), Mock()
        with patch.object(service.gemini_credentials, "resolve", side_effect=["old-secret", "new-secret"]), \
                patch.object(service._warm_gemini_client, "get", side_effect=[(old, False), (new, False)]):
            service._gemini_keep_warm_probe()
            service._gemini_keep_warm_probe()
        old.models.get.assert_called_once()
        new.models.get.assert_called_once()

    def test_network_failure_propagates_to_the_loop(self):
        client = Mock()
        client.models.get.side_effect = TimeoutError("secret in message")
        with patch.object(service.gemini_credentials, "resolve", return_value="secret"), \
                patch.object(service._warm_gemini_client, "get", return_value=(client, True)):
            with self.assertRaises(TimeoutError):
                service._gemini_keep_warm_probe()


class MainWiringTests(unittest.TestCase):
    def test_main_starts_both_keep_warm_threads_and_stops_them_on_exit(self):
        started = []
        with patch.object(service, "_validate_single_process_environment"), \
                patch.object(service.threading, "Thread"), \
                patch.object(service, "install_access_log_query_redaction"), \
                patch.object(service, "install_timing_log_handler"), \
                patch.object(service.app, "run"), \
                patch.object(service, "start_keep_warm_thread", side_effect=lambda *args, **kwargs: started.append(args)) as start:
            service.main()
        targets = sorted(args[0] for args in started)
        self.assertEqual(targets, ["gemini", "telegram"])
        stop_event = start.call_args.args[3]
        self.assertTrue(stop_event.is_set())


if __name__ == "__main__":
    unittest.main()
