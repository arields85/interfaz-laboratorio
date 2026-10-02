"""TCP keep-alive for every Leda connection to Telegram (PW-026 W3b).

Live measurement (2026-10-02, after ~11 min idle) showed the first Telegram
``sendMessage`` taking ~21 s, against ~0.4 s for the next one. About 21 s is how
long Windows retransmits on a dead connection before giving up: the network
(NAT/firewall idle timeout) silently dropped a pooled connection without an RST,
and urllib3 only noticed on the next send. Keep-alive probes make the OS keep the
mapping alive, or detect the loss while the connection is idle, so a real request
never meets a dead socket.

This is connection-level only. No request retries are configured: a retried POST
(``sendMessage``/``sendVoice``) could be delivered twice.

W3c: IPv6 to api.telegram.org fails intermittently from the deployment network
(measured: IPv4 6/6 connects OK in ~235 ms, IPv6 1/6 timed out). urllib3 tries
addresses in getaddrinfo order (IPv6 first), so a new connection that hit the bad
IPv6 attempt waited the whole connect timeout (20 s for ``sendMessage``) before
falling back. The adapter makes ONLY its own sessions try IPv4 first, IPv6 after;
nothing process-wide (``allowed_gai_family``, ``getaddrinfo``) is patched.
Proxied requests use urllib3's ProxyManager, which bypasses this adapter's pool
classes and socket options (as it already did for keep-alive).
"""

import socket

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError

# Idle time before the first probe: well inside common NAT idle timeouts.
TCP_KEEPALIVE_IDLE_SECONDS = 20
# Gap between unanswered probes, and how many may go unanswered before the OS
# drops the connection (so a dead one is detected in ~50 s while idle).
TCP_KEEPALIVE_INTERVAL_SECONDS = 10
TCP_KEEPALIVE_PROBE_COUNT = 3


def keepalive_socket_options():
    """urllib3's default options plus keep-alive; unavailable TCP_* options are skipped."""
    options = list(HTTPConnection.default_socket_options)
    options.append((socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1))
    for name, value in (
        ("TCP_KEEPIDLE", TCP_KEEPALIVE_IDLE_SECONDS),
        ("TCP_KEEPINTVL", TCP_KEEPALIVE_INTERVAL_SECONDS),
        ("TCP_KEEPCNT", TCP_KEEPALIVE_PROBE_COUNT),
    ):
        if hasattr(socket, name):
            options.append((socket.IPPROTO_TCP, getattr(socket, name), value))
    return options


def _resolve_addresses(host, port):
    """IP literals for ``host`` as (ipv4, ipv6), each in resolver order without duplicates."""
    ipv4, ipv6 = [], []
    for family, _type, _proto, _canon, sockaddr in socket.getaddrinfo(
        host, port, socket.AF_UNSPEC, socket.SOCK_STREAM
    ):
        bucket = ipv4 if family == socket.AF_INET else ipv6
        if sockaddr[0] not in bucket:
            bucket.append(sockaddr[0])
    return ipv4, ipv6


class _IPv4FirstMixin:
    """Connect to IPv4 addresses first, then IPv6.

    Only the address urllib3's own ``_new_conn`` dials changes (``_dns_host``);
    ``self.host``, which TLS uses for SNI and certificate checks, is untouched, so
    verification still targets the hostname. Each attempt keeps the connect timeout.
    Name-resolution failures and IPv6-only hosts take urllib3's unchanged path.
    """

    def _new_conn(self):
        original = self._dns_host
        try:
            ipv4, ipv6 = _resolve_addresses(original, self.port)
        except OSError:
            return super()._new_conn()  # urllib3 raises its own wrapped error
        if not ipv4:
            return super()._new_conn()
        last_error = None
        try:
            for address in ipv4 + ipv6:
                self._dns_host = address
                try:
                    return super()._new_conn()
                except (NewConnectionError, ConnectTimeoutError) as error:
                    last_error = error
        finally:
            self._dns_host = original
        raise last_error


class _IPv4FirstHTTPConnection(_IPv4FirstMixin, HTTPConnection):
    pass


class _IPv4FirstHTTPSConnection(_IPv4FirstMixin, HTTPSConnection):
    pass


class _IPv4FirstHTTPConnectionPool(HTTPConnectionPool):
    ConnectionCls = _IPv4FirstHTTPConnection


class _IPv4FirstHTTPSConnectionPool(HTTPSConnectionPool):
    ConnectionCls = _IPv4FirstHTTPSConnection


class KeepAliveHTTPAdapter(HTTPAdapter):
    """HTTPAdapter whose pooled connections set TCP keep-alive options and prefer IPv4."""

    def init_poolmanager(self, *args, **kwargs):
        kwargs["socket_options"] = keepalive_socket_options()
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {
            "http": _IPv4FirstHTTPConnectionPool,
            "https": _IPv4FirstHTTPSConnectionPool,
        }


def mount_keepalive(session):
    """Mount the keep-alive adapter on ``session`` (other settings untouched) and return it."""
    adapter = KeepAliveHTTPAdapter()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def keepalive_session():
    return mount_keepalive(requests.Session())
