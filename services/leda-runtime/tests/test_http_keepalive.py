import socket
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch

import requests
from urllib3 import PoolManager
from urllib3.connection import HTTPConnection
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError

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


V4 = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("149.154.166.110", 443))
V6 = (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:67c:4e8:f004::9", 443, 0, 0))
V4_ADDRESS, V6_ADDRESS = "149.154.166.110", "2001:67c:4e8:f004::9"


def _connection():
    pool = http_keepalive.KeepAliveHTTPAdapter().poolmanager.connection_from_url("https://api.telegram.org")
    return pool._new_conn()


class IPv4FirstTests(unittest.TestCase):
    def _connect(self, infos, failing=()):
        """Run _new_conn with a fake resolver; return (attempted hosts, result, connection)."""
        attempted = []

        def fake_create(address, timeout=None, source_address=None, socket_options=None):
            attempted.append(address[0])
            if address[0] in failing:
                raise socket.timeout("timed out")
            return Mock(name="sock")

        conn = _connection()
        with patch("socket.getaddrinfo", return_value=infos), patch(
            "urllib3.util.connection.create_connection", side_effect=fake_create
        ):
            try:
                result = conn._new_conn()
            except (ConnectTimeoutError, NewConnectionError) as error:
                result = error
        return attempted, result, conn

    def test_ipv4_is_tried_before_ipv6(self):
        attempted, _, _ = self._connect([V6, V4])
        self.assertEqual(attempted, [V4_ADDRESS])

    def test_falls_back_to_ipv6_when_ipv4_fails(self):
        attempted, result, _ = self._connect([V6, V4], failing=(V4_ADDRESS,))
        self.assertEqual(attempted, [V4_ADDRESS, V6_ADDRESS])
        self.assertNotIsInstance(result, Exception)

    def test_ipv6_only_host_uses_ipv6(self):
        attempted, result, _ = self._connect([V6])
        self.assertEqual(attempted, ["api.telegram.org"])
        self.assertNotIsInstance(result, Exception)

    def test_all_addresses_failing_raises_urllib3_error(self):
        _, result, _ = self._connect([V6, V4], failing=(V4_ADDRESS, V6_ADDRESS))
        self.assertIsInstance(result, (ConnectTimeoutError, NewConnectionError))

    def test_hostname_is_kept_for_tls_and_restored(self):
        _, _, conn = self._connect([V6, V4])
        self.assertEqual(conn.host, "api.telegram.org")
        self.assertEqual(conn._dns_host, "api.telegram.org")

    def test_keepalive_socket_options_reach_the_connection(self):
        self.assertIn((socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1), _connection().socket_options)

    def test_plain_urllib3_and_requests_pools_are_unchanged(self):
        plain = PoolManager().connection_from_url("https://api.telegram.org")
        default = requests.Session().get_adapter("https://api.telegram.org").poolmanager
        for pool in (plain, default.connection_from_url("https://api.telegram.org")):
            self.assertNotIsInstance(pool._new_conn(), http_keepalive._IPv4FirstMixin)


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
