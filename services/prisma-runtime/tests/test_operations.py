import unittest
import os
import subprocess
from pathlib import Path


OPERATIONS_ROOT = Path(__file__).resolve().parents[1] / "operations"


class RuntimeOperationTests(unittest.TestCase):
    def test_port_preflight_fails_closed_and_stops_at_first_occupied_port(self) -> None:
        helper = OPERATIONS_ROOT / "startup-preflight.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        script = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$script:portsChecked = @()
function global:Get-NetTCPConnection {{
    param([int]$LocalPort, [string]$State)
    $script:portsChecked += $LocalPort
    if ($LocalPort -eq 5056) {{ return [pscustomobject]@{{ LocalPort = 5056; OwningProcess = 1234 }} }}
    return @()
}}
try {{ Assert-PrismaLocalPortsAvailable -Ports @(5056, 5057); exit 11 }}
catch {{ Write-Output "$($_.Exception.Message)|ports=$($script:portsChecked -join ',')"; exit 0 }}
"""
        result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("5056", result.stdout)
        self.assertIn("ports=5056", result.stdout)
        self.assertNotIn("5057", result.stdout)

    def test_start_preflights_both_ports_before_starting_voice_and_does_not_kill_unknown_processes(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        preflight_index = source.index("Assert-PrismaLocalPortsAvailable")
        start_index = source.index("Start-Process")
        self.assertLess(preflight_index, start_index)
        self.assertIn("@(5056, 5057)", source)
        self.assertIn("stop-local.ps1", source)

    def test_operations_are_self_relative_and_do_not_reference_legacy_source(self) -> None:
        for script in OPERATIONS_ROOT.iterdir():
            if script.suffix.lower() not in {".ps1", ".cmd"}:
                continue
            source = script.read_text(encoding="utf-8-sig")
            with self.subTest(script=script.name):
                self.assertNotIn("Get-SavedEnvironmentValue", source)

        start = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$PSScriptRoot", start)
        self.assertIn("127.0.0.1:5056", start)
        self.assertIn("127.0.0.1:5057", start)
        self.assertIn("$env:PRISMA_CONFIG_MODE = 'local'", start)
        self.assertIn("$env:PRISMA_VOICE_HOST = '127.0.0.1'", start)

    def test_operations_never_persist_credentials(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$env:PRISMA_LOCAL_TELEGRAM_BOT_TOKEN", source)
        self.assertNotIn("SetEnvironmentVariable", source)
        self.assertNotIn("Get-SavedEnvironmentValue", source)

    def test_normal_start_does_not_require_credentials_or_invoke_bootstrap(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn("GEMINI_API_KEY must be provided", source)
        self.assertNotIn("PRISMA_LOCAL_TELEGRAM_BOT_TOKEN must be provided", source)
        self.assertNotIn("bootstrap-local.ps1", source)
        self.assertNotIn("Initialize-PrismaVirtualEnvironment", source)
        self.assertNotIn("Install-PrismaLockedDependencies", source)

    def test_normal_start_initializes_state_and_checks_dependencies_before_process_launch(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        transaction = source[source.index("function Invoke-PrismaStartTransaction"):]
        first_process = transaction.index("Start-Process")
        self.assertLess(source.index("Initialize-PrismaRuntimeState"), source.index("Invoke-PrismaManifestLock -LockPath"))
        self.assertLess(transaction.index("Assert-PrismaRuntimeDependencies"), first_process)
        self.assertIn("Get-PrismaConfigurationTemplate", source)

    def test_development_start_and_release_use_the_same_manifest_lock(self) -> None:
        start = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        release = (OPERATIONS_ROOT / "release-dev-local.ps1").read_text(encoding="utf-8-sig")
        stop = (OPERATIONS_ROOT / "stop-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("Invoke-PrismaManifestLock", start)
        self.assertIn("Invoke-PrismaManifestLock", release)
        self.assertIn("Invoke-PrismaManifestLock", stop)
        self.assertIn("DevelopmentOwnerToken", start)
        self.assertIn("DevelopmentReceiptPath", start)
        self.assertNotIn("bootstrap-local.ps1", start)

    def test_development_start_has_bounded_cancellation_seams(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("DevelopmentCancellationPath", source)
        self.assertIn("Test-PrismaDevelopmentCancellation", source)
        self.assertIn("LockTimeoutMilliseconds", source)
        self.assertLess(source.index("Test-PrismaDevelopmentCancellation"), source.index("Start-Process"))


if __name__ == "__main__":
    unittest.main()
