"""Check schema shape and complete generated Prisma audio projections."""
import json
import importlib.util
import re
from pathlib import Path

if __package__:
    from .generate_prisma_audio_bindings import render_python, render_typescript, source_hash
else:
    generator_path = Path(__file__).resolve().with_name("generate_prisma_audio_bindings.py")
    generator_spec = importlib.util.spec_from_file_location("prisma_audio_bindings_generator", generator_path)
    if generator_spec is None or generator_spec.loader is None:
        raise RuntimeError(f"Unable to load {generator_path}")
    generator = importlib.util.module_from_spec(generator_spec)
    generator_spec.loader.exec_module(generator)
    render_python = generator.render_python
    render_typescript = generator.render_typescript
    source_hash = generator.source_hash


# Anchored on this file's own location so the check behaves identically
# regardless of the working directory it is invoked from.
REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_NAME = "prisma-audio-record.v1.schema.json"
PYTHON_PROJECTION_RELATIVE = Path("services") / "prisma-runtime" / "src" / "prisma_runtime" / "audio_record_types.py"
PYTHON_PROJECTION = REPOSITORY_ROOT / PYTHON_PROJECTION_RELATIVE
TYPESCRIPT_NAME = "prismaAudioMetric.generated.ts"


def _normalized_text(path):
    return path.read_bytes().decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")


def check_bindings(repository=REPOSITORY_ROOT):
    root = Path(repository).resolve()
    errors = []
    schema_path = root / "schemas" / SCHEMA_NAME
    projection = root / PYTHON_PROJECTION_RELATIVE
    typescript = root / "hmi-app" / "src" / "domain" / TYPESCRIPT_NAME
    if not schema_path.is_file(): return ["schema missing"]
    if not projection.is_file(): return ["generated projection missing"]
    if not typescript.is_file(): return ["generated TypeScript projection missing"]
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if schema.get("$id") != "prisma-audio-record.v1" or schema.get("additionalProperties") is not False: errors.append("schema is not a closed versioned contract")
    expected = source_hash(schema_path)
    expected_python = render_python(schema, expected)
    expected_typescript = render_typescript(schema, expected)
    python_text = _normalized_text(projection)
    ts_text = _normalized_text(typescript)
    actual = re.search(r'SCHEMA_SOURCE_SHA256 = "([0-9a-f]+)"', python_text)
    if actual is None or actual.group(1) != expected: errors.append("generated source hash is stale")
    if f"PRISMA_AUDIO_METRIC_SCHEMA_SOURCE_SHA256 = \"{expected}\"" not in ts_text: errors.append("generated TypeScript source hash is stale")
    if "schemaVersion" in ts_text or "runId" in ts_text: errors.append("generated TypeScript projection uses non-canonical field names")
    if python_text != expected_python: errors.append("generated Python projection body differs from expected content")
    if ts_text != expected_typescript: errors.append("generated TypeScript projection body differs from expected content")
    return errors


if __name__ == "__main__":
    import sys
    problems = check_bindings(REPOSITORY_ROOT)
    for problem in problems: print(problem)
    raise SystemExit(1 if problems else 0)
