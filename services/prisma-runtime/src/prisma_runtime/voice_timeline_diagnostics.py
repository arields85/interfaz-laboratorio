"""HMI browser-side voice timeline diagnostics.

T16: makes the browser voice timeline observable without asking the user
to copy anything out of the browser console. The HMI batches structured,
schema-validated records (see audio_record_types.py, generated from
schemas/prisma-audio-record.v1.schema.json) describing voice-event
delivery, orb phase, speak-live request/response timing, session resets,
stale-response discards and AudioContext resume outcomes, and POSTs them
through the existing session-capability transport to
POST /hmi/voice/timeline (see local_presentation.py's voice_timeline()
route). Each accepted record becomes one compact WARNING line in the same
prisma-presentation-stderr.log this runtime already relies on for every
other timing signal (T5, T10, T13) -- never a question, an answer, a
capability or a real event id; only an opaque per-page run id and typed,
enum/numeric payload fields the closed schema allows.
"""

from __future__ import annotations

import threading
import time
from collections import deque

from .audio_record_types import make_record

# One HMI tab flushes a small batch every couple of seconds at most (see
# prismaVoiceTimelineDiagnosticsSink.ts); this bounds one POST body and is
# comfortably above real usage while still rejecting a runaway caller.
MAX_TIMELINE_BATCH_RECORDS = 40
# Matches this runtime's other in-memory bounds (e.g. HMI_ASK_MAX_BYTES):
# generous for a batch of small, enum/numeric-only records, tiny next to
# anything that could carry real text.
TIMELINE_ENVELOPE_KEYS = frozenset({
    "schema_version", "run_id", "layer", "record_type", "sequence", "monotonic_ms", "elapsed_ms", "payload",
})


class VoiceTimelineRateLimiter:
    """A simple in-memory, per-owner sliding-window limiter. One HMI tab
    posts a small, bounded batch every couple of seconds at most, so a
    generous window comfortably covers normal use while still bounding a
    runaway or hostile caller. Not shared across processes -- diagnostics
    volume is bounded per this process only, matching every other
    in-memory bound in this runtime (VoiceEventStore, HmiSessionRegistry)."""

    def __init__(self, *, max_requests: int = 30, window_seconds: float = 60.0, clock=time.monotonic):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.clock = clock
        self._lock = threading.Lock()
        self._hits: dict[str, deque] = {}

    def allow(self, owner_id: str) -> bool:
        now = self.clock()
        owner_id = str(owner_id)
        with self._lock:
            hits = self._hits.setdefault(owner_id, deque())
            while hits and now - hits[0] > self.window_seconds:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return False
            hits.append(now)
            return True


def validate_timeline_batch(data, *, max_records: int = MAX_TIMELINE_BATCH_RECORDS) -> list[dict]:
    """Validate one client-submitted diagnostics batch against the closed
    audio-record schema. Raises ValueError for anything that does not
    match the contract; never partially accepts a malformed batch (an
    error on any record rejects the whole POST, so the caller never has
    to guess which records landed)."""
    if not isinstance(data, dict) or set(data) != {"records"}:
        raise ValueError("VOICE_TIMELINE_SHAPE_INVALID")
    records = data["records"]
    if not isinstance(records, list) or not records or len(records) > max_records:
        raise ValueError("VOICE_TIMELINE_BATCH_SIZE_INVALID")
    validated = []
    for entry in records:
        if not isinstance(entry, dict) or set(entry) - TIMELINE_ENVELOPE_KEYS:
            raise ValueError("VOICE_TIMELINE_RECORD_INVALID")
        if entry.get("schema_version") != "1" or entry.get("layer") != "browser":
            raise ValueError("VOICE_TIMELINE_RECORD_INVALID")
        try:
            validated.append(make_record(
                entry.get("run_id"),
                "browser",
                entry.get("record_type"),
                entry.get("sequence"),
                entry.get("monotonic_ms"),
                entry.get("elapsed_ms"),
                entry.get("payload"),
            ))
        except (ValueError, KeyError, TypeError):
            raise ValueError("VOICE_TIMELINE_RECORD_INVALID") from None
    return validated


def format_timeline_log_line(record: dict) -> str:
    """One compact WARNING line per accepted record, e.g.:
    'HMI voice timeline: run=prisma-... seq=3 type=orb-phase t_ms=812 extra=phase=visible'
    Every payload value is already schema-typed (an enum or a number), so
    this can never carry free text, a capability, or a real event/chat
    id -- only the opaque per-page/per-playback run_id the browser
    minted for correlation."""
    payload = record.get("payload") or {}
    extra = " ".join(f"{key}={payload[key]}" for key in sorted(payload))
    line = "HMI voice timeline: run=%s seq=%d type=%s t_ms=%d" % (
        record["run_id"], record["sequence"], record["record_type"], round(record["elapsed_ms"]),
    )
    return f"{line} extra={extra}" if extra else line
