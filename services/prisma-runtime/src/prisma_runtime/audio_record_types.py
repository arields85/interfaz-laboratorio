# Generated from the Prisma audio record contract; do not edit manually.
SCHEMA_SOURCE_SHA256 = "55014f3629d92983ff7d3fcab8e6f740a793f6654912fac12d6469eb6d3a1fb0"
SCHEMA_VERSION = "1"
ALLOWED_RECORD_TYPES = {"provider": ["dispatch", "completion"], "backend": ["receipt", "dsp", "yield", "finalization"], "browser": ["request-start", "first-readable-audio", "buffering-complete", "eof", "canonical-decode", "playback-started", "playback-ended", "underflow", "error", "cancel"]}
TERMINAL_STATUSES = {"success", "error", "cancel"}
PAYLOAD_KEYS = {"dispatch": set(), "completion": {"status"}, "receipt": set(), "dsp": {"sample_count"}, "yield": {"sample_count"}, "finalization": {"sample_count", "duration_ms", "status"}, "request-start": set(), "first-readable-audio": {"elapsed_ms", "pcm_bytes"}, "buffering-complete": {"elapsed_ms", "pcm_bytes", "pcm_duration_seconds"}, "eof": {"elapsed_ms", "pcm_duration_seconds", "pcm_bytes", "transport"}, "canonical-decode": {"elapsed_ms", "pcm_duration_seconds", "pcm_bytes", "transport"}, "playback-started": {"underflow_count", "transport", "elapsed_ms", "pcm_bytes", "pcm_duration_seconds"}, "playback-ended": {"underflow_count", "transport", "elapsed_ms", "pcm_bytes", "pcm_duration_seconds"}, "underflow": {"underflow_count"}, "error": {"error_code", "elapsed_ms", "status", "code"}, "cancel": {"elapsed_ms", "status", "code"}}
PAYLOAD_KINDS = {"status": "enum", "code": "enum", "sample_count": "nonnegative-integer", "duration_ms": "nonnegative-number", "elapsed_ms": "nonnegative-number", "transport": "enum", "pcm_bytes": "nonnegative-number", "pcm_duration_seconds": "nullable-nonnegative-number", "underflow_count": "nonnegative-integer", "error_code": "enum"}
PAYLOAD_VALUES = {"status": ["success", "error", "cancel"], "code": ["provider-failure", "backend-failure", "browser-failure", "cancelled", "invalid-format", "unknown"], "transport": ["progressive", "buffer-before-playback"], "error_code": ["audio-failure"]}


def make_record(run_id, layer, record_type, sequence, monotonic_ms, elapsed_ms, payload):
    import math

    if not isinstance(run_id, str) or not run_id.startswith("prisma-") or len(run_id[7:]) < 16 or len(run_id) > 71 or any(c not in "0123456789abcdef-" for c in run_id[7:]):
        raise ValueError("opaque run_id required")
    if layer not in ALLOWED_RECORD_TYPES or record_type not in ALLOWED_RECORD_TYPES[layer]:
        raise ValueError("record type is not allowed for layer")
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 0:
        raise ValueError("sequence must be a non-negative integer")
    if not isinstance(monotonic_ms, (int, float)) or isinstance(monotonic_ms, bool) or monotonic_ms < 0 or not math.isfinite(monotonic_ms):
        raise ValueError("monotonic_ms must be finite and non-negative")
    if not isinstance(elapsed_ms, (int, float)) or isinstance(elapsed_ms, bool) or elapsed_ms < 0 or not math.isfinite(elapsed_ms):
        raise ValueError("elapsed_ms must be finite and non-negative")
    if not isinstance(payload, dict) or not set(payload).issubset(PAYLOAD_KEYS[record_type]):
        raise ValueError("payload field is not allowlisted")
    for key, value in payload.items():
        kind = PAYLOAD_KINDS.get(key)
        if kind == "enum" and (not isinstance(value, str) or value not in PAYLOAD_VALUES[key]):
            raise ValueError("payload value is not typed")
        if kind == "nonnegative-integer" and (not isinstance(value, int) or isinstance(value, bool) or value < 0):
            raise ValueError("count must be a non-negative integer")
        if kind == "nonnegative-number" and (not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0):
            raise ValueError("value must be non-negative")
        if kind == "nullable-nonnegative-number" and value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0):
            raise ValueError("value must be non-negative or null")
    return {"schema_version": SCHEMA_VERSION, "run_id": run_id, "layer": layer, "record_type": record_type, "sequence": sequence, "monotonic_ms": float(monotonic_ms), "elapsed_ms": float(elapsed_ms), "payload": dict(payload)}


class RecordStream:
    def __init__(self, run_id):
        self.run_id, self.sequence, self.last_monotonic_ms, self.last_elapsed_ms = run_id, 0, -1.0, -1.0

    def emit(self, layer, record_type, monotonic_ms, elapsed_ms, payload):
        if monotonic_ms < self.last_monotonic_ms or elapsed_ms < self.last_elapsed_ms:
            raise ValueError("clock moved backwards")
        item = make_record(self.run_id, layer, record_type, self.sequence, monotonic_ms, elapsed_ms, payload)
        self.sequence += 1
        self.last_monotonic_ms, self.last_elapsed_ms = monotonic_ms, elapsed_ms
        return item
