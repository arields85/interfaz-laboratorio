"""Redacted stage-timing log lines for Channel B latency diagnosis (PW-026).

Why a dedicated logger: this runtime configures no ``logging.basicConfig``
(see the T5 notes in ``local_presentation.py`` and ``voice_service.py``), so
every INFO line is dropped by ``logging``'s WARNING-level "handler of last
resort". Turning INFO on globally would also surface every routine line of
both processes. Instead the timing lines go through their own
``leda_runtime.timing`` logger at INFO, which owns a single stderr handler
(installed by each process' ``main()``) and does not propagate. The launcher
already redirects each process' stderr to its log file, so these lines land in
``leda-presentation-stderr.log`` and ``leda-voice-stderr.log`` while every other
logger keeps its current visibility.

Redaction contract: a line carries only stage names, integers (milliseconds or
counts), booleans and short lowercase outcome tokens. Anything else (message
text, ids, names, URLs, exception messages) is replaced by ``redacted`` before
it can be written, and emitting a line never raises.
"""

import logging
import re
import sys
import time
from contextlib import contextmanager

TIMING_LOGGER_NAME = "leda_runtime.timing"
_TIMING_HANDLER_MARK = "_leda_timing_handler"
_TIMING_LINE_FORMAT = "%(asctime)s %(message)s"
_KEY_PATTERN = re.compile(r"[a-z][a-z0-9_]{0,39}")
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]{1,40}")

_timing_logger = logging.getLogger(TIMING_LOGGER_NAME)
_timing_logger.setLevel(logging.INFO)
_timing_logger.propagate = False


def install_timing_log_handler(stream=None):
    """Attach the timing logger's own stderr handler, once per process.

    Idempotent. Called from both processes' ``main()``; tests that never call
    it get no output at all (INFO is below the last-resort handler's level)."""
    if any(getattr(handler, _TIMING_HANDLER_MARK, False) for handler in _timing_logger.handlers):
        return
    handler = logging.StreamHandler(stream if stream is not None else sys.stderr)
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter(_TIMING_LINE_FORMAT))
    setattr(handler, _TIMING_HANDLER_MARK, True)
    _timing_logger.addHandler(handler)


def _render_value(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str) and _TOKEN_PATTERN.fullmatch(value):
        return value
    return "redacted"


def format_timing_line(label, fields):
    """``<label> key=value key=value``; values are sanitized by ``_render_value``."""
    parts = [label]
    for key, value in fields.items():
        if value is not None and _KEY_PATTERN.fullmatch(key):
            parts.append(f"{key}={_render_value(value)}")
    return " ".join(parts)


def log_timing(label, fields):
    """Emit one timing line. Never raises."""
    try:
        _timing_logger.info(format_timing_line(label, fields))
    except Exception:
        pass


def elapsed_ms(started, now=None):
    return max(0, round(((time.monotonic() if now is None else now) - started) * 1000))


class StageTimer:
    """Accumulates per-stage durations (ms) plus a total, then emits one line."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._started = clock()
        self._open = {}
        self.fields = {}
        self.outcome = None

    @contextmanager
    def stage(self, name):
        started = self._clock()
        try:
            yield
        finally:
            self.add(name, elapsed_ms(started, self._clock()))

    def start(self, name):
        self._open[name] = self._clock()

    def stop(self, name):
        started = self._open.pop(name, None)
        if started is not None:
            self.add(name, elapsed_ms(started, self._clock()))

    def add(self, name, milliseconds):
        key = f"{name}_ms"
        self.fields[key] = self.fields.get(key, 0) + milliseconds

    def set(self, key, value):
        self.fields[key] = value

    def total_ms(self):
        return elapsed_ms(self._started, self._clock())

    def emit(self, label, **leading):
        log_timing(label, {**leading, **self.fields, "total_ms": self.total_ms()})
