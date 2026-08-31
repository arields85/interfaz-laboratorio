"""Default-disabled, bounded, opaque audio lifecycle observability."""

import time

from .audio_record_types import RecordStream


class BoundedAudioSink:
    def __init__(self, enabled=False, limit=256, run_id="prisma-0123456789abcdef"):
        if limit < 1:
            raise ValueError("limit must be positive")
        self.enabled, self.limit, self.records = bool(enabled), limit, []
        self.started_at = time.monotonic()
        self.stream = RecordStream(run_id)

    def emit(self, layer, record_type, payload, elapsed_ms=None):
        if not self.enabled:
            return None
        now = time.monotonic()
        elapsed = (now - self.started_at) * 1000 if elapsed_ms is None else elapsed_ms
        record = self.stream.emit(layer, record_type, now * 1000, elapsed, payload)
        self.records.append(record)
        del self.records[:-self.limit]
        return record
