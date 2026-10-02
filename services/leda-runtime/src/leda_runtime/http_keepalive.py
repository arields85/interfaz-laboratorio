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
"""

import socket

import requests
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection

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


class KeepAliveHTTPAdapter(HTTPAdapter):
    """HTTPAdapter whose pooled connections set TCP keep-alive socket options."""

    def init_poolmanager(self, *args, **kwargs):
        kwargs["socket_options"] = keepalive_socket_options()
        super().init_poolmanager(*args, **kwargs)


def mount_keepalive(session):
    """Mount the keep-alive adapter on ``session`` (other settings untouched) and return it."""
    adapter = KeepAliveHTTPAdapter()
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def keepalive_session():
    return mount_keepalive(requests.Session())
