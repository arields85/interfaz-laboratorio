import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
RUNTIME_ROOT = REPOSITORY_ROOT / "services" / "prisma-runtime"
VERIFY_SCRIPT = RUNTIME_ROOT / "operations" / "verify-local.ps1"
VERIFY_CHILD = os.environ.get("PRISMA_RUNTIME_VERIFY_CHILD") == "1"
POWERSHELL_EXECUTABLE = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
CONTROLLED_ENVIRONMENT = {
    name: os.environ[name]
    for name in ("SystemRoot", "SystemDrive", "TEMP", "TMP")
    if name in os.environ
}


class PrismaRuntimeSkeletonTests(unittest.TestCase):
    def run_verifier(self, suite: str, evidence_path: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                str(POWERSHELL_EXECUTABLE),
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(VERIFY_SCRIPT),
                "-Suite",
                suite,
                "-EvidencePath",
                str(evidence_path),
            ],
            cwd=REPOSITORY_ROOT,
            env=CONTROLLED_ENVIRONMENT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_repository_skeleton_is_owned_by_the_monorepo(self) -> None:
        expected_directories = (
            RUNTIME_ROOT / "src" / "prisma_runtime",
            RUNTIME_ROOT / "tests",
            RUNTIME_ROOT / "operations",
        )
        for directory in expected_directories:
            with self.subTest(directory=directory):
                self.assertTrue(directory.is_dir(), f"Missing owned directory: {directory}")

        self.assertTrue(
            (RUNTIME_ROOT / "src" / "prisma_runtime" / "__init__.py").is_file()
        )
        self.assertTrue((RUNTIME_ROOT / "tests" / "__init__.py").is_file())
        self.assertTrue(VERIFY_SCRIPT.is_file())

    @unittest.skipIf(VERIFY_CHILD, "Verifier child process runs the structural test only")
    def test_p1_verifier_runs_focused_tests_and_emits_bounded_evidence(self) -> None:
        with tempfile.TemporaryDirectory(prefix="prisma-p1-evidence-") as temporary_directory:
            evidence_path = Path(temporary_directory) / "p1.json"
            result = self.run_verifier("P1", evidence_path)

            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            self.assertTrue(evidence_path.is_file())
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["suite"], "P1")
            self.assertEqual(evidence["test_result"]["status"], "passed")
            self.assertEqual(evidence["test_result"]["tests_run"], 3)
            self.assertEqual(evidence["runtime_harness"]["status"], "not_applicable")
            self.assertNotRegex(evidence_path.read_text(encoding="utf-8"), r"(?i)(token|secret|password)")

    @unittest.skipIf(VERIFY_CHILD, "Verifier child process runs the structural test only")
    def test_p1_verifier_rejects_unsupported_suite_and_repository_evidence(self) -> None:
        with tempfile.TemporaryDirectory(prefix="prisma-p1-evidence-") as temporary_directory:
            external_evidence = Path(temporary_directory) / "unsupported.json"
            unsupported = self.run_verifier("P2", external_evidence)
            self.assertNotEqual(unsupported.returncode, 0)
            self.assertFalse(external_evidence.exists())

            repository_evidence = RUNTIME_ROOT / "unsafe-evidence.json"
            rejected = self.run_verifier("P1", repository_evidence)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertFalse(repository_evidence.exists())


if __name__ == "__main__":
    unittest.main()
