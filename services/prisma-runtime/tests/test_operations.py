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

    def test_operations_keep_credentials_in_process_environment(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$env:GEMINI_API_KEY", source)
        self.assertIn("$env:PRISMA_LOCAL_TELEGRAM_BOT_TOKEN", source)
        self.assertNotIn("SetEnvironmentVariable", source)
        self.assertNotIn("Get-SavedEnvironmentValue", source)


if __name__ == "__main__":
    unittest.main()
