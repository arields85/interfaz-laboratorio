"""Tests for the repository-owned Python environment and interpreter resolution.

Every test is offline: no virtual environment is created, no package is
downloaded, and no runtime service is launched. PowerShell seams are replaced
with recording stubs, following the harness style of ``test_operations.py``.
"""

import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = RUNTIME_ROOT.parents[1]
OPERATIONS_ROOT = RUNTIME_ROOT / "operations"
ENVIRONMENT_LIBRARY = OPERATIONS_ROOT / "runtime-environment.ps1"
PREFLIGHT_LIBRARY = OPERATIONS_ROOT / "startup-preflight.ps1"
POWERSHELL = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
LEGACY_INTERPRETER = "C:\\hmi_tts\\.venv\\Scripts\\python.exe"


# ``Emit`` writes straight to the process stdout. PowerShell wraps formatted
# pipeline strings at the host buffer width, which would split long paths across
# lines and make message assertions unreliable.
PREAMBLE = (
    "Set-StrictMode -Version Latest\n"
    "$ErrorActionPreference = 'Stop'\n"
    "function global:Emit { param([string]$Text) [Console]::Out.WriteLine($Text) }\n"
)


def run_powershell(body: str, working_directory: Path | None = None) -> subprocess.CompletedProcess:
    """Run a PowerShell body with strict mode and a fail-fast error preference."""
    script = PREAMBLE + body
    return subprocess.run(
        [str(POWERSHELL), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        check=False,
        cwd=str(working_directory) if working_directory else None,
    )


def read_operation(name: str) -> str:
    return (OPERATIONS_ROOT / name).read_text(encoding="utf-8-sig")


def canonical(directory: str) -> Path:
    """Expand 8.3 short components, which .NET path normalisation also expands.

    ``tempfile`` inherits ``%TEMP%``, which on this platform can carry a short
    name such as ``ARIELD~1``. Comparing that against a PowerShell-normalised
    path would fail even though both name the same directory.
    """
    return Path(directory).resolve()


class InterpreterResolutionTests(unittest.TestCase):
    def test_resolution_returns_the_repository_owned_virtual_environment_path(self) -> None:
        body = (
            f". '{ENVIRONMENT_LIBRARY}'\n"
            f"Emit (Get-PrismaVirtualEnvironmentPython -RuntimeRoot '{RUNTIME_ROOT}')\n"
        )
        result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), str(RUNTIME_ROOT / ".venv" / "Scripts" / "python.exe"))

    def test_resolution_never_falls_back_to_an_interpreter_on_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            body = (
                f". '{ENVIRONMENT_LIBRARY}'\n"
                "$env:PRISMA_PYTHON = 'C:\\definitely\\not\\used\\python.exe'\n"
                f"try {{ $found = Resolve-PrismaPython -RuntimeRoot '{temporary}'; Emit \"RESOLVED|$found\"; exit 11 }}\n"
                "catch { Emit \"ERROR|$($_.Exception.Message)\"; exit 0 }\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertTrue(result.stdout.startswith("ERROR|"), result.stdout)
        self.assertNotIn("definitely", result.stdout)

    def test_missing_interpreter_error_names_the_path_and_the_bootstrap_remedy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime_root = canonical(temporary)
            body = (
                f". '{ENVIRONMENT_LIBRARY}'\n"
                f"try {{ Resolve-PrismaPython -RuntimeRoot '{runtime_root}' | Out-Null; exit 11 }}\n"
                "catch { Emit $_.Exception.Message; exit 0 }\n"
            )
            result = run_powershell(body)
            expected = str(runtime_root / ".venv" / "Scripts" / "python.exe")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(expected, result.stdout)
        self.assertIn("bootstrap-local.ps1", result.stdout)

    def test_launchers_delete_the_path_fallback_and_the_silent_override(self) -> None:
        for name in ("start-local.ps1", "verify-local.ps1", "stop-local.ps1", "startup-preflight.ps1", "bootstrap-local.ps1"):
            source = read_operation(name)
            with self.subTest(script=name):
                self.assertNotIn("Get-Command python.exe", source)
                self.assertNotIn("PRISMA_PYTHON", source)

    def test_launchers_share_one_interpreter_resolution_helper(self) -> None:
        for name in ("start-local.ps1", "verify-local.ps1"):
            source = read_operation(name)
            with self.subTest(script=name):
                self.assertIn("runtime-environment.ps1", source)
                self.assertIn("Resolve-PrismaPython", source)


class WorkingDirectoryPortabilityTests(unittest.TestCase):
    def test_runtime_root_is_independent_of_the_current_working_directory(self) -> None:
        body = (
            f". '{ENVIRONMENT_LIBRARY}'\n"
            "Emit (Get-PrismaRuntimeRoot)\n"
            "Emit (Get-PrismaVirtualEnvironmentPython -RuntimeRoot (Get-PrismaRuntimeRoot))\n"
        )
        with tempfile.TemporaryDirectory() as temporary:
            result = run_powershell(body, working_directory=Path(temporary))
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [line for line in result.stdout.splitlines() if line.strip()]
        self.assertEqual(lines[0], str(RUNTIME_ROOT))
        self.assertEqual(lines[1], str(RUNTIME_ROOT / ".venv" / "Scripts" / "python.exe"))

    def test_launchers_anchor_every_path_on_the_script_location(self) -> None:
        for name in ("start-local.ps1", "stop-local.ps1", "verify-local.ps1", "bootstrap-local.ps1"):
            source = read_operation(name)
            with self.subTest(script=name):
                self.assertIn("$PSScriptRoot", source)
        for name in ("start-local.cmd", "stop-local.cmd", "verify-local.cmd", "bootstrap-local.cmd"):
            source = read_operation(name)
            with self.subTest(script=name):
                self.assertIn("%~dp0", source)


class VirtualEnvironmentBootstrapTests(unittest.TestCase):
    @staticmethod
    def _preamble(runtime_root: Path) -> str:
        return (
            f". '{ENVIRONMENT_LIBRARY}'\n"
            f"$root = '{runtime_root}'\n"
            "function global:Get-PrismaInterpreterVersion { param([string]$Interpreter) return '3.14.7' }\n"
            "function global:Resolve-PrismaBootstrapInterpreter { return 'C:\\stub\\python.exe' }\n"
            "function global:Install-PrismaLockedDependencies { param([string]$Interpreter, [string]$LockFile) Emit 'INSTALL' }\n"
        )

    def _prepare(self, temporary: str, *, with_venv: bool, required_version: str = "3.14") -> Path:
        runtime_root = canonical(temporary)
        (runtime_root / ".python-version").write_text(required_version + "\n", encoding="utf-8")
        (runtime_root / "requirements.lock.txt").write_text("", encoding="utf-8")
        if with_venv:
            scripts = runtime_root / ".venv" / "Scripts"
            scripts.mkdir(parents=True)
            (scripts / "python.exe").write_text("stub", encoding="utf-8")
        return runtime_root

    def test_bootstrap_does_not_recreate_an_existing_virtual_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime_root = self._prepare(temporary, with_venv=True)
            body = self._preamble(runtime_root) + (
                "function global:New-PrismaVirtualEnvironment { param([string]$Interpreter, [string]$VenvRoot) Emit 'VENV-CREATED' }\n"
                "$result = Initialize-PrismaVirtualEnvironment -RuntimeRoot $root\n"
                "Emit \"CREATEDFLAG=$($result.Created)\"\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("VENV-CREATED", result.stdout)
        self.assertIn("CREATEDFLAG=False", result.stdout)
        self.assertIn("INSTALL", result.stdout)

    def test_bootstrap_creates_the_virtual_environment_when_it_is_absent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime_root = self._prepare(temporary, with_venv=False)
            body = self._preamble(runtime_root) + (
                "function global:New-PrismaVirtualEnvironment { param([string]$Interpreter, [string]$VenvRoot)\n"
                "    New-Item -ItemType Directory -Path (Join-Path $VenvRoot 'Scripts') -Force | Out-Null\n"
                "    Set-Content -LiteralPath (Join-Path $VenvRoot 'Scripts\\python.exe') -Value 'stub'\n"
                "    Emit 'VENV-CREATED' }\n"
                "$result = Initialize-PrismaVirtualEnvironment -RuntimeRoot $root\n"
                "Emit \"CREATEDFLAG=$($result.Created)\"\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("VENV-CREATED", result.stdout)
        self.assertIn("CREATEDFLAG=True", result.stdout)

    def test_bootstrap_asserts_the_python_version_before_creating_the_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime_root = self._prepare(temporary, with_venv=False, required_version="3.99")
            body = self._preamble(runtime_root) + (
                "function global:New-PrismaVirtualEnvironment { param([string]$Interpreter, [string]$VenvRoot) Emit 'VENV-CREATED' }\n"
                "try { Initialize-PrismaVirtualEnvironment -RuntimeRoot $root | Out-Null; exit 11 }\n"
                "catch { Emit \"ERROR|$($_.Exception.Message)\"; exit 0 }\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("VENV-CREATED", result.stdout)
        self.assertIn("3.99", result.stdout)
        self.assertIn("3.14.7", result.stdout)


class RuntimeStateBootstrapTests(unittest.TestCase):
    def _template(self, directory: Path) -> Path:
        template = directory / "prisma_voice_config.example.json"
        template.write_text('{"source": "template"}', encoding="utf-8")
        return template

    def test_bootstrap_does_not_overwrite_an_existing_effective_configuration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            template = self._template(base)
            state_root = base / "state"
            state_root.mkdir()
            config = state_root / "prisma_voice_config.json"
            config.write_text('{"source": "operator-owned"}', encoding="utf-8")
            body = (
                f". '{ENVIRONMENT_LIBRARY}'\n"
                f"Initialize-PrismaRuntimeState -StateRoot '{state_root}' -Template '{template}' | Out-Null\n"
            )
            result = run_powershell(body)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(config.read_text(encoding="utf-8"), '{"source": "operator-owned"}')
            self.assertTrue((state_root / "logs").is_dir())
            self.assertTrue((state_root / "run").is_dir())

    def test_bootstrap_copies_the_template_when_no_configuration_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            template = self._template(base)
            state_root = base / "state"
            body = (
                f". '{ENVIRONMENT_LIBRARY}'\n"
                f"Initialize-PrismaRuntimeState -StateRoot '{state_root}' -Template '{template}' | Out-Null\n"
            )
            result = run_powershell(body)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual((state_root / "prisma_voice_config.json").read_text(encoding="utf-8"), '{"source": "template"}')


class OwnedInterpreterPreflightTests(unittest.TestCase):
    def test_preflight_rejects_a_foreign_interpreter_without_executing_it(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            body = (
                f". '{PREFLIGHT_LIBRARY}'\n"
                "function global:Get-PrismaInterpreterPrefix { param([string]$Interpreter) Emit 'EXECUTED'; return 'C:\\hmi_tts\\.venv' }\n"
                f"try {{ Assert-PrismaOwnedInterpreter -Interpreter '{LEGACY_INTERPRETER}' -RuntimeRoot '{temporary}'; exit 11 }}\n"
                "catch { Emit \"ERROR|$($_.Exception.Message)\"; exit 0 }\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("EXECUTED", result.stdout)
        self.assertIn("ERROR|", result.stdout)
        self.assertIn(LEGACY_INTERPRETER, result.stdout)

    def test_preflight_rejects_an_interpreter_whose_prefix_escapes_the_owned_environment(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime_root = Path(temporary)
            scripts = runtime_root / ".venv" / "Scripts"
            scripts.mkdir(parents=True)
            (scripts / "python.exe").write_text("stub", encoding="utf-8")
            body = (
                f". '{PREFLIGHT_LIBRARY}'\n"
                "function global:Get-PrismaInterpreterPrefix { param([string]$Interpreter) return 'C:\\hmi_tts\\.venv' }\n"
                f"try {{ Assert-PrismaOwnedInterpreter -Interpreter '{scripts / 'python.exe'}' -RuntimeRoot '{runtime_root}'; exit 11 }}\n"
                "catch { Emit \"ERROR|$($_.Exception.Message)\"; exit 0 }\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("ERROR|", result.stdout)
        self.assertIn("sys.prefix", result.stdout)

    def test_preflight_accepts_the_repository_owned_interpreter(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime_root = Path(temporary)
            venv_root = runtime_root / ".venv"
            scripts = venv_root / "Scripts"
            scripts.mkdir(parents=True)
            (scripts / "python.exe").write_text("stub", encoding="utf-8")
            body = (
                f". '{PREFLIGHT_LIBRARY}'\n"
                f"function global:Get-PrismaInterpreterPrefix {{ param([string]$Interpreter) return '{venv_root}' }}\n"
                f"Assert-PrismaOwnedInterpreter -Interpreter '{scripts / 'python.exe'}' -RuntimeRoot '{runtime_root}'\n"
                "Emit 'ACCEPTED'\n"
            )
            result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("ACCEPTED", result.stdout)

    def test_start_asserts_the_owned_interpreter_before_launching_any_process(self) -> None:
        source = read_operation("start-local.ps1")
        self.assertLess(source.index("Assert-PrismaOwnedInterpreter"), source.index("Start-Process"))


class RuntimeDependencyPreflightTests(unittest.TestCase):
    def test_real_missing_import_is_normalized_to_bootstrap_remedy_under_stop_preference(self) -> None:
        interpreter = RUNTIME_ROOT / ".venv" / "Scripts" / "python.exe"
        body = (
            f". '{PREFLIGHT_LIBRARY}'\n"
            f"function global:Invoke-PrismaPythonWithoutSite {{ & '{interpreter}' -B -S @args }}\n"
            "try { Assert-PrismaRuntimeDependencies -Interpreter 'Invoke-PrismaPythonWithoutSite'; exit 11 }\n"
            "catch { Emit \"ID=$($_.FullyQualifiedErrorId)|MESSAGE=$($_.Exception.Message)\"; exit 0 }\n"
        )
        result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("operations\\bootstrap-local.ps1", result.stdout)
        self.assertNotIn("NativeCommandError", result.stdout)
        self.assertNotIn("ModuleNotFoundError", result.stdout + result.stderr)
        self.assertNotIn("No module named", result.stdout + result.stderr)

    def test_missing_runtime_dependencies_fail_with_exact_bootstrap_remedy(self) -> None:
        body = (
            f". '{PREFLIGHT_LIBRARY}'\n"
            "function global:Test-PrismaRuntimeDependencies { param([string]$Interpreter) return $false }\n"
            "try { Assert-PrismaRuntimeDependencies -Interpreter 'C:\\owned\\python.exe'; exit 11 }\n"
            "catch { Emit $_.Exception.Message; exit 0 }\n"
        )
        result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("operations\\bootstrap-local.ps1", result.stdout)
        self.assertNotIn("pip install", result.stdout)

    def test_present_runtime_dependencies_pass_without_installing(self) -> None:
        body = (
            f". '{PREFLIGHT_LIBRARY}'\n"
            "function global:Test-PrismaRuntimeDependencies { param([string]$Interpreter) return $true }\n"
            "Assert-PrismaRuntimeDependencies -Interpreter 'C:\\owned\\python.exe'\n"
            "Emit 'READY'\n"
        )
        result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("READY", result.stdout)

    def test_bootstrap_remains_the_only_launcher_that_initializes_the_environment(self) -> None:
        bootstrap = read_operation("bootstrap-local.ps1")
        start = read_operation("start-local.ps1")
        self.assertIn("Initialize-PrismaVirtualEnvironment", bootstrap)
        self.assertNotIn("Initialize-PrismaVirtualEnvironment", start)
        self.assertNotIn("Install-PrismaLockedDependencies", start)


class DependencyDeclarationTests(unittest.TestCase):
    DIRECT = RUNTIME_ROOT / "requirements.in"
    LOCK = RUNTIME_ROOT / "requirements.lock.txt"

    def test_direct_dependencies_are_declared_separately_from_the_lock(self) -> None:
        self.assertTrue(self.DIRECT.is_file(), f"missing {self.DIRECT}")
        self.assertTrue(self.LOCK.is_file(), f"missing {self.LOCK}")

    def test_lock_pins_every_distribution_with_hashes(self) -> None:
        text = self.LOCK.read_text(encoding="utf-8")
        pinned = re.findall(r"^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?==", text, flags=re.MULTILINE)
        self.assertGreater(len(pinned), 10, "the lock must contain the full transitive graph")
        self.assertIn("--hash=sha256:", text)
        for name in pinned:
            with self.subTest(distribution=name):
                self.assertRegex(text.split("\n" + name, 1)[1][:4000], r"--hash=sha256:[0-9a-f]{64}")

    def test_lock_covers_every_direct_dependency(self) -> None:
        lock_names = {name.lower().replace("_", "-") for name in re.findall(r"^([A-Za-z0-9._-]+)(?:\[[^\]]*\])?==", self.LOCK.read_text(encoding="utf-8"), flags=re.MULTILINE)}
        for line in self.DIRECT.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            name = re.split(r"[=<>!~\[ ]", stripped, maxsplit=1)[0].lower().replace("_", "-")
            with self.subTest(distribution=name):
                self.assertIn(name, lock_names)

    def test_python_version_is_pinned_in_a_versioned_file(self) -> None:
        pin = RUNTIME_ROOT / ".python-version"
        self.assertTrue(pin.is_file(), f"missing {pin}")
        self.assertRegex(pin.read_text(encoding="utf-8").strip(), r"^\d+\.\d+$")

    def test_bootstrap_consumes_the_lock_with_stock_pip_only(self) -> None:
        source = read_operation("runtime-environment.ps1")
        self.assertIn("--require-hashes", source)
        self.assertIn("requirements.lock.txt", source)
        for forbidden in ("uv ", "pip-compile", "pip-tools", "poetry", "pipenv"):
            with self.subTest(tool=forbidden):
                self.assertNotIn(forbidden, source)


class InterpreterProbeTests(unittest.TestCase):
    """The probes actually run an interpreter, so they must survive PowerShell
    native-argument quoting. Unit seams stub them out and cannot catch that."""

    VENV_PYTHON = RUNTIME_ROOT / ".venv" / "Scripts" / "python.exe"

    def test_probes_contain_no_quote_characters(self) -> None:
        # PowerShell strips embedded double quotes when building a native
        # command line, which silently corrupts the expression Python receives.
        for name in ("runtime-environment.ps1", "startup-preflight.ps1"):
            for line in read_operation(name).splitlines():
                stripped = line.strip()
                if stripped.startswith("$reported = & $Interpreter -c"):
                    with self.subTest(script=name, probe=stripped):
                        self.assertNotIn('"', stripped)

    @unittest.skipUnless(VENV_PYTHON.is_file(), "the owned environment has not been bootstrapped")
    def test_version_probe_reports_the_declared_series(self) -> None:
        body = (
            f". '{ENVIRONMENT_LIBRARY}'\n"
            "$root = Get-PrismaRuntimeRoot\n"
            "$python = Resolve-PrismaPython -RuntimeRoot $root\n"
            "Emit (Assert-PrismaInterpreterVersion -Interpreter $python -RequiredVersion (Get-PrismaRequiredPythonVersion -RuntimeRoot $root))\n"
        )
        result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        declared = (RUNTIME_ROOT / ".python-version").read_text(encoding="utf-8").strip()
        self.assertTrue(result.stdout.strip().startswith(declared + "."), result.stdout)

    @unittest.skipUnless(VENV_PYTHON.is_file(), "the owned environment has not been bootstrapped")
    def test_prefix_probe_accepts_the_real_owned_interpreter(self) -> None:
        body = (
            f". '{PREFLIGHT_LIBRARY}'\n"
            "$root = Get-PrismaRuntimeRoot\n"
            "Assert-PrismaOwnedInterpreter -Interpreter (Resolve-PrismaPython -RuntimeRoot $root) -RuntimeRoot $root\n"
            "Emit 'OWNED'\n"
        )
        result = run_powershell(body)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("OWNED", result.stdout)


class LegacyRuntimeReferenceTests(unittest.TestCase):
    def test_operations_and_schema_tools_do_not_reference_the_legacy_runtime_root(self) -> None:
        candidates = list(OPERATIONS_ROOT.iterdir()) + list((REPOSITORY_ROOT / "schemas").glob("*.py"))
        for path in candidates:
            if path.suffix.lower() not in {".ps1", ".cmd", ".py"}:
                continue
            with self.subTest(script=path.name):
                self.assertNotIn("hmi_tts", path.read_text(encoding="utf-8-sig"))

    def test_schema_binding_targets_resolve_inside_the_repository(self) -> None:
        import importlib.util

        for module_name in ("generate_prisma_audio_bindings", "check_prisma_audio_bindings"):
            spec = importlib.util.spec_from_file_location(module_name, REPOSITORY_ROOT / "schemas" / f"{module_name}.py")
            assert spec and spec.loader
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            with self.subTest(module=module_name):
                self.assertTrue(hasattr(module, "PYTHON_PROJECTION"))
                projection = Path(module.PYTHON_PROJECTION)
                self.assertTrue(projection.is_absolute())
                self.assertTrue(projection.is_relative_to(REPOSITORY_ROOT), projection)
                self.assertTrue(projection.is_file(), f"{projection} does not exist")


class GitIgnoreTests(unittest.TestCase):
    def test_repository_ignores_the_owned_virtual_environment(self) -> None:
        ignored = (REPOSITORY_ROOT / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("services/prisma-runtime/.venv/", ignored)


if __name__ == "__main__":
    unittest.main()
