"""Defense-in-depth: redact query strings from Werkzeug's per-request
access log line.

T13b should-fix: the voice-events SSE route used to carry the HMI session
capability in ``?capability=...``, and Werkzeug's dev server (used by both
Flask processes in this runtime -- see local_presentation.py's and
voice_service.py's ``main()``) logs the full request line -- method,
path+query, protocol -- to the "werkzeug" logger once per request,
regardless of which route it hit. That specific leak is fixed at its
source (the query-string fallback was removed from the SSE route itself).
This filter is a safety net for the whole runtime: if any future or
third-party route ever accepted a secret via query string, its value would
still never reach leda-*-stderr.log through this access log line. It
does not replace fixing individual endpoints, only backstops them.
"""

from __future__ import annotations

import logging
import re

# Matches exactly the request-line shape Werkzeug's WSGIRequestHandler.
# log_request() builds: f"{self.command} {path} {self.request_version}",
# e.g. "GET /hmi/voice/events?capability=xyz HTTP/1.1".
_REQUEST_LINE_RE = re.compile(r"^(?P<method>\S+) (?P<path>\S+) (?P<protocol>HTTP/\S+)$")


class QueryStringRedactingFilter(logging.Filter):
    """A logging.Filter that never drops a record -- it only rewrites the
    request-line argument (record.args[0]) when that argument is present,
    a string, and shaped like a request line carrying a query string.
    Anything else (a plain informational log line, an unexpected argument
    shape) passes through completely unchanged."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple) or not args:
            return True
        requestline = args[0]
        if not isinstance(requestline, str):
            return True
        match = _REQUEST_LINE_RE.match(requestline)
        if match is None:
            return True
        path = match.group("path")
        if "?" not in path:
            return True
        redacted_path = path.split("?", 1)[0] + "?[REDACTED]"
        redacted_requestline = f"{match.group('method')} {redacted_path} {match.group('protocol')}"
        record.args = (redacted_requestline,) + args[1:]
        return True


def install_access_log_query_redaction() -> None:
    """Installed once per process, right before app.run(), in both
    local_presentation.py's and voice_service.py's main(). Idempotent: a
    second call (e.g. a test process that builds the app more than once)
    never stacks a duplicate filter."""
    logger = logging.getLogger("werkzeug")
    if any(isinstance(existing, QueryStringRedactingFilter) for existing in logger.filters):
        return
    logger.addFilter(QueryStringRedactingFilter())
