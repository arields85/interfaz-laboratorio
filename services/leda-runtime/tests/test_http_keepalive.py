import socket
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch

import requests
from urllib3.connection import HTTPConnection

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from leda_runtime import channel_a_transport, http_keepalive, local_presentation
from leda_runtime import voice_service as service


def _options(session):
    adapter = session.get_adapter("https://api.telegram.org")
    return adapter, adapter.poolmanager.connection_pool_kw["socket_options"]


class SocketOptionsTests(unittest.TestCase):
    def test_includes_urllib3_defaults_and_so_keepalive(self):
        options = http_keepalive.keepalive_socket_options()
        for default in HTTPConnection.default_socket_options:
            self.assertIn(default, options)
        self.assertIn((socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1), options)

    def test_includes_available_tcp_keepalive_options(self):
        options = http_keepalive.keepalive_socket_options()
        for name, value in (
            ("TCP_KEEPIDLE", http_keepalive.TCP_KEEPALIVE_IDLE_SECONDS),
            ("TCP_KEEPINTVL", http_keepalive.TCP_KEEPALIVE_INTERVAL_SECONDS),
            ("TCP_KEEPCNT", http_keepalive.TCP_KEEPALIVE_PROBE_COUNT),
        ):
            if hasattr(socket, name):
                self.assertIn((socket.IPPROTO_TCP, getattr(socket, name), value), options)

    def test_missing_tcp_constants_are_skipped(self):
        stub = types.SimpleNamespace(SOL_SOCKET=1, SO_KEEPALIVE=2, IPPROTO_TCP=3)
        with patch.object(http_keepalive, "socket", stub):
            options = http_keepalive.keepalive_socket_options()
        self.assertEqual(options, list(HTTPConnection.default_socket_options) + [(1, 2, 1)])

    def test_values_are_tight_enough_for_idle_nat(self):
        self.assertLessEqual(http_keepalive.TCP_KEEPALIVE_IDLE_SECONDS, 30)


class FactoryTests(unittest.TestCase):
    def test_session_mounts_keepalive_adapter_with_socket_options(self):
        session = http_keepalive.keepalive_session()
        adapter, options = _options(session)
        self.assertIsInstance(adapter, http_keepalive.KeepAliveHTTPAdapter)
        self.assertIn((socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1), options)

    def test_mount_preserves_existing_session_settings(self):
        session = requests.Session()
        session.trust_env = False
        session.headers["X-Test"] = "1"
        self.assertIs(http_keepalive.mount_keepalive(session), session)
        self.assertFalse(session.trust_env)
        self.assertEqual(session.headers["X-Test"], "1")
        self.assertIsInstance(session.get_adapter("https://x"), http_keepalive.KeepAliveHTTPAdapter)

    def test_no_request_retries_are_configured(self):
        adapter, _ = _options(http_keepalive.keepalive_session())
        self.assertEqual(adapter.max_retries.total, 0)
        self.assertFalse(adapter.max_retries.is_retry("POST", 503))


class SessionsUseFactoryTests(unittest.TestCase):
    def _assert_keepalive(self, session):
        self.assertIsInstance(session.get_adapter("https://api.telegram.org"), http_keepalive.KeepAliveHTTPAdapter)

    def test_voice_service_telegram_session(self):
        self._assert_keepalive(service._TELEGRAM_HTTP_SESSION)

    def test_presentation_bot_sessions(self):
        bot = local_presentation.TelegramLocalBot("secret-token", Mock(), Mock(), Mock())
        self._assert_keepalive(bot.session)
        self._assert_keepalive(bot._notice_session)
        self.assertIsNot(bot.session, bot._notice_session)

    def test_channel_a_default_session_keeps_trust_env_off(self):
        session = channel_a_transport._default_session()
        self._assert_keepalive(session)
        self.assertFalse(session.trust_env)


if __name__ == "__main__":
    unittest.main()
