"""Keep the voice process's outbound connections warm (PW-026 W3).

Live measurement showed a Channel B voice note after a long idle pays about
4 s extra inside Telegram ``sendVoice`` (a pooled connection the network dropped
silently while idle), and Gemini's pooled connection expires after
``GEMINI_HTTP_KEEPALIVE_EXPIRY_SECONDS``. A tiny read-only call on the SAME
session/client, repeated inside those windows, keeps the connection alive so a
real request never meets a dead one.

This module is transport-agnostic: the loop only knows a ``probe`` callable that
returns ``True`` (touched the network), ``False`` (nothing to do, e.g. no
credential) or raises. Logging goes through the redacted ``leda_runtime.timing``
logger: one start line, then lines only on state changes (never per probe),
carrying the exception TYPE only, never a message, URL or token.
"""

import threading

from .timing_log import log_timing

# Telegram drops idle connections after an unknown, network-dependent time; 30 s
# is well inside any common NAT/firewall idle timeout and costs one tiny getMe.
TELEGRAM_KEEP_WARM_INTERVAL_SECONDS = 30.0
# Must stay below gemini_credentials.GEMINI_HTTP_KEEPALIVE_EXPIRY_SECONDS (55 s).
GEMINI_KEEP_WARM_INTERVAL_SECONDS = 45.0


def run_keep_warm_loop(target, interval_s, probe, stop_event, *, probe_first=False, wait=None):
    """Probe every ``interval_s`` seconds until ``stop_event`` is set.

    ``wait(interval)`` must return True when stopped (default ``stop_event.wait``);
    tests inject a fake so no real sleeping happens. Never raises."""
    wait = stop_event.wait if wait is None else wait
    log_timing("Leda keep-warm:", {"target": target, "interval_s": int(interval_s)})
    failed_type = None
    first = probe_first
    while True:
        if first:
            first = False
        elif wait(interval_s):
            return
        if stop_event.is_set():
            return
        try:
            probe()
        except Exception as error:
            error_type = type(error).__name__
            if error_type != failed_type:
                log_timing("Leda keep-warm:", {"target": target, "outcome": "failed", "error_type": error_type})
            failed_type = error_type
        else:
            if failed_type is not None:
                log_timing("Leda keep-warm:", {"target": target, "outcome": "recovered"})
            failed_type = None


def start_keep_warm_thread(target, interval_s, probe, stop_event, *, probe_first=False):
    thread = threading.Thread(
        target=run_keep_warm_loop,
        args=(target, interval_s, probe, stop_event),
        kwargs={"probe_first": probe_first},
        name=f"LedaKeepWarm-{target}",
        daemon=True,
    )
    thread.start()
    return thread
