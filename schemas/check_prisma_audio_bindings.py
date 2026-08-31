"""Check schema shape and the source hash embedded in the generated projection."""
import hashlib
import json
import re
from pathlib import Path


SCHEMA_NAME = "prisma-audio-record.v1.schema.json"
PYTHON_NAME = "prisma_audio_record_types.py"
TYPESCRIPT_NAME = "prismaAudioMetric.generated.ts"


def check_bindings(repository):
    root = Path(repository)
    errors = []
    schema_path = root / "schemas" / SCHEMA_NAME
    projection = Path(r"C:\hmi_tts") / PYTHON_NAME
    typescript = root / "hmi-app" / "src" / "domain" / TYPESCRIPT_NAME
    if not schema_path.is_file(): return ["schema missing"]
    if not projection.is_file(): return ["generated projection missing"]
    if not typescript.is_file(): return ["generated TypeScript projection missing"]
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if schema.get("$id") != "prisma-audio-record.v1" or schema.get("additionalProperties") is not False: errors.append("schema is not a closed versioned contract")
    expected = hashlib.sha256(schema_path.read_bytes()).hexdigest()
    actual = re.search(r'SCHEMA_SOURCE_SHA256 = "([0-9a-f]+)"', projection.read_text(encoding="utf-8"))
    if actual is None or actual.group(1) != expected: errors.append("generated source hash is stale")
    ts_text = typescript.read_text(encoding="utf-8")
    if f"PRISMA_AUDIO_METRIC_SCHEMA_SOURCE_SHA256 = \"{expected}\"" not in ts_text: errors.append("generated TypeScript source hash is stale")
    if "schemaVersion" in ts_text or "runId" in ts_text: errors.append("generated TypeScript projection uses non-canonical field names")
    return errors


if __name__ == "__main__":
    import sys
    problems = check_bindings(Path(__file__).parent.parent)
    for problem in problems: print(problem)
    raise SystemExit(1 if problems else 0)
