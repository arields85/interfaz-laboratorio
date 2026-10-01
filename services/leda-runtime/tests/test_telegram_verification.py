import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime.telegram_verification import (
    TELEGRAM_API_BASE,
    TELEGRAM_VERIFY_TIMEOUT_MS,
    TelegramTokenVerification,
    TelegramTokenVerificationInProgress,
    TelegramTokenVerificationService,
    _default_http_post,
)


def ok_body(username="leda_channel_a_bot", bot_id=123):
    return {"ok": True, "result": {"id": bot_id, "is_bot": True, "username": username}}


class TelegramTokenVerificationServiceTests(unittest.TestCase):
    def _resolver(self, *, token="123:real-looking-token"):
        resolver = Mock()
        if token is None:
            resolver.side_effect = RuntimeError("CREDENTIAL_MISSING")
        else:
            resolver.return_value = token
        return resolver

    def test_snapshot_starts_not_checked(self):
        service = TelegramTokenVerificationService(self._resolver(), http_post=Mock())
        snapshot = service.snapshot()
        self.assertEqual(snapshot.state, "not_checked")
        self.assertIsNone(snapshot.checked_at)
        self.assertIsNone(snapshot.username)

    def test_missing_credential_is_not_configured_without_any_http_call(self):
        http_post = Mock()
        service = TelegramTokenVerificationService(self._resolver(token=None), http_post=http_post, clock=lambda: 42.0)

        result = service.verify()

        self.assertEqual(result, TelegramTokenVerification("not_configured", 42.0, None))
        http_post.assert_not_called()
        self.assertEqual(service.snapshot(), result)

    def test_blank_resolved_token_is_also_not_configured(self):
        http_post = Mock()
        service = TelegramTokenVerificationService(self._resolver(token="  "), http_post=http_post, clock=lambda: 1.0)

        result = service.verify()

        self.assertEqual(result.state, "not_configured")
        http_post.assert_not_called()

    def test_successful_get_me_is_verified_and_captures_the_username(self):
        http_post = Mock(return_value=(200, ok_body(username="leda_channel_a_bot")))
        service = TelegramTokenVerificationService(self._resolver(), http_post=http_post, clock=lambda: 5.0)

        result = service.verify()

        self.assertEqual(result, TelegramTokenVerification("verified", 5.0, "leda_channel_a_bot"))

    def test_default_http_post_uses_the_configured_timeout(self):
        service = TelegramTokenVerificationService(self._resolver(token="123:tok"), clock=lambda: 9.0)
        self.assertEqual(service.timeout_ms, TELEGRAM_VERIFY_TIMEOUT_MS)

    def test_401_maps_to_invalid_token_without_a_username(self):
        http_post = Mock(return_value=(401, {"ok": False, "error_code": 401, "description": "Unauthorized"}))
        service = TelegramTokenVerificationService(self._resolver(), http_post=http_post, clock=lambda: 2.0)

        result = service.verify()

        self.assertEqual(result, TelegramTokenVerification("invalid_token", 2.0, None))

    def test_network_failure_maps_to_unreachable(self):
        http_post = Mock(return_value=(None, None))
        service = TelegramTokenVerificationService(self._resolver(), http_post=http_post, clock=lambda: 3.0)

        result = service.verify()

        self.assertEqual(result.state, "unreachable")

    def test_server_error_maps_to_unreachable_never_invalid(self):
        http_post = Mock(return_value=(503, {"ok": False, "error_code": 503, "description": "Bad Gateway"}))
        service = TelegramTokenVerificationService(self._resolver(), http_post=http_post, clock=lambda: 4.0)

        result = service.verify()

        self.assertEqual(result.state, "unreachable")

    def test_malformed_2xx_body_fails_closed_to_unreachable(self):
        for status, body in (
            (200, {"ok": True, "result": {"id": 1}}),  # missing is_bot/username
            (200, {"ok": True, "result": {"id": 1, "is_bot": True, "username": "x"}}),  # username too short
            (200, {"ok": False}),
            (200, None),
        ):
            with self.subTest(status=status, body=body):
                service = TelegramTokenVerificationService(
                    self._resolver(), http_post=Mock(return_value=(status, body)), clock=lambda: 1.0,
                )
                self.assertEqual(service.verify().state, "unreachable")

    def test_reset_returns_to_not_checked_and_clears_the_username(self):
        http_post = Mock(return_value=(200, ok_body()))
        service = TelegramTokenVerificationService(self._resolver(), http_post=http_post, clock=lambda: 6.0)
        service.verify()

        service.reset()

        snapshot = service.snapshot()
        self.assertEqual(snapshot.state, "not_checked")
        self.assertIsNone(snapshot.checked_at)
        self.assertIsNone(snapshot.username)

    def test_a_verification_in_flight_rejects_a_concurrent_request(self):
        observed = {}

        def http_post(token, timeout_ms):
            try:
                service.verify()
            except TelegramTokenVerificationInProgress as error:
                observed["nested_error"] = error
            return 200, ok_body()

        service = TelegramTokenVerificationService(self._resolver(), http_post=http_post, clock=lambda: 7.0)

        result = service.verify()

        self.assertEqual(result.state, "verified")
        self.assertIsInstance(observed.get("nested_error"), TelegramTokenVerificationInProgress)

    def test_never_leaks_the_token_or_a_raw_provider_body_in_the_result(self):
        secret_token = "999:super-secret-token-value"
        http_post = Mock(return_value=(200, ok_body()))
        service = TelegramTokenVerificationService(self._resolver(token=secret_token), http_post=http_post, clock=lambda: 8.0)

        result = service.verify()

        self.assertNotIn(secret_token, repr(result))
        self.assertNotIn(secret_token, str(result))


class DefaultHttpPostTests(unittest.TestCase):
    def test_posts_getme_to_the_exact_bot_url_with_the_converted_timeout(self):
        response = Mock(status_code=200)
        response.json.return_value = ok_body()
        session = Mock()
        session.post.return_value = response
        session_type = Mock(return_value=session)

        with patch("leda_runtime.telegram_verification.requests.Session", session_type):
            status, body = _default_http_post("123:tok", timeout_ms=5_000)

        session.post.assert_called_once_with(
            f"{TELEGRAM_API_BASE}/bot123:tok/getMe", timeout=5.0, allow_redirects=False,
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, ok_body())
        self.assertFalse(session.trust_env)
        response.close.assert_called_once()
        session.close.assert_called_once()

    def test_a_raised_network_error_returns_none_status_and_none_body(self):
        session = Mock()
        session.post.side_effect = ConnectionError("refused")
        session_type = Mock(return_value=session)

        with patch("leda_runtime.telegram_verification.requests.Session", session_type):
            status, body = _default_http_post("123:tok", timeout_ms=5_000)

        self.assertIsNone(status)
        self.assertIsNone(body)


if __name__ == "__main__":
    unittest.main()
