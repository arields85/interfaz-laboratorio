import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
GENERATOR_PATH = REPOSITORY_ROOT / "schemas" / "generate_prisma_audio_bindings.py"
CHECKER_PATH = REPOSITORY_ROOT / "schemas" / "check_prisma_audio_bindings.py"
SCHEMA_PATH = REPOSITORY_ROOT / "schemas" / "prisma-audio-record.v1.schema.json"
PYTHON_PROJECTION = (
    REPOSITORY_ROOT
    / "services"
    / "prisma-runtime"
    / "src"
    / "prisma_runtime"
    / "audio_record_types.py"
)
TYPESCRIPT_PROJECTION = (
    REPOSITORY_ROOT
    / "hmi-app"
    / "src"
    / "domain"
    / "prismaAudioMetric.generated.ts"
)


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AudioBindingsGenerationTests(unittest.TestCase):
    def test_repository_projections_match_current_generator(self) -> None:
        checker = load_module("audio_bindings_checker_repository", CHECKER_PATH)

        self.assertEqual(checker.check_bindings(REPOSITORY_ROOT), [])

    def test_source_hash_normalizes_only_newlines(self) -> None:
        generator = load_module("audio_bindings_generator_hash", GENERATOR_PATH)
        schema_lf = SCHEMA_PATH.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lf_path = root / "lf.json"
            crlf_path = root / "crlf.json"
            changed_path = root / "changed.json"
            lf_path.write_bytes(schema_lf)
            crlf_path.write_bytes(schema_lf.replace(b"\n", b"\r\n"))
            changed_path.write_bytes(schema_lf + b" ")

            self.assertEqual(generator.source_hash(lf_path), generator.source_hash(crlf_path))
            self.assertNotEqual(generator.source_hash(lf_path), generator.source_hash(changed_path))

    def test_import_is_safe_and_generate_writes_only_explicit_outputs(self) -> None:
        python_before = PYTHON_PROJECTION.read_bytes()
        typescript_before = TYPESCRIPT_PROJECTION.read_bytes()
        generator = load_module("audio_bindings_generator_safe", GENERATOR_PATH)

        self.assertEqual(PYTHON_PROJECTION.read_bytes(), python_before)
        self.assertEqual(TYPESCRIPT_PROJECTION.read_bytes(), typescript_before)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            python_output = root / "generated.py"
            typescript_output = root / "generated.ts"
            generator.generate(SCHEMA_PATH, python_output, typescript_output)

            data = generator.schema_data(SCHEMA_PATH)
            digest = generator.source_hash(SCHEMA_PATH)
            self.assertEqual(python_output.read_text(encoding="utf-8"), generator.render_python(data, digest))
            self.assertEqual(typescript_output.read_text(encoding="utf-8"), generator.render_typescript(data, digest))
            self.assertEqual(PYTHON_PROJECTION.read_bytes(), python_before)
            self.assertEqual(TYPESCRIPT_PROJECTION.read_bytes(), typescript_before)

    def test_checker_accepts_generated_content_with_checkout_newline_differences(self) -> None:
        generator = load_module("audio_bindings_generator_newlines", GENERATOR_PATH)
        checker = load_module("audio_bindings_checker_newlines", CHECKER_PATH)

        with tempfile.TemporaryDirectory() as directory:
            root, python_output, typescript_output = self._generated_repository(Path(directory), generator)
            python_output.write_bytes(python_output.read_bytes().replace(b"\n", b"\r\n"))
            typescript_output.write_bytes(typescript_output.read_bytes().replace(b"\n", b"\r\n"))

            self.assertEqual(checker.check_bindings(root), [])

    def test_checker_rejects_python_and_typescript_body_drift_with_valid_hashes(self) -> None:
        generator = load_module("audio_bindings_generator_drift", GENERATOR_PATH)
        checker = load_module("audio_bindings_checker_drift", CHECKER_PATH)

        with tempfile.TemporaryDirectory() as directory:
            root, python_output, typescript_output = self._generated_repository(Path(directory), generator)
            python_output.write_text(
                python_output.read_text(encoding="utf-8").replace(
                    'TERMINAL_STATUSES = {"success", "error", "cancel"}',
                    'TERMINAL_STATUSES = {"success"}',
                ),
                encoding="utf-8",
            )
            typescript_output.write_text(
                typescript_output.read_text(encoding="utf-8").replace(
                    "Prisma audio metric violates the browser allowlist",
                    "edited error",
                ),
                encoding="utf-8",
            )

            errors = checker.check_bindings(root)
            self.assertIn("generated Python projection body differs from expected content", errors)
            self.assertIn("generated TypeScript projection body differs from expected content", errors)

    def _generated_repository(self, root: Path, generator):
        schema_output = root / "schemas" / SCHEMA_PATH.name
        python_output = root / "services" / "prisma-runtime" / "src" / "prisma_runtime" / "audio_record_types.py"
        typescript_output = root / "hmi-app" / "src" / "domain" / "prismaAudioMetric.generated.ts"
        schema_output.parent.mkdir(parents=True)
        python_output.parent.mkdir(parents=True)
        typescript_output.parent.mkdir(parents=True)
        schema_output.write_text(json.dumps(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")), indent=2), encoding="utf-8")
        generator.generate(schema_output, python_output, typescript_output)
        return root, python_output, typescript_output


if __name__ == "__main__":
    unittest.main()
