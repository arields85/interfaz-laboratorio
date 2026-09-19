import ctypes
import ctypes.wintypes
import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from prisma_runtime import local_presentation, voice_service
from prisma_runtime.telegram_config import read_telegram_config


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
OPERATIONS_ROOT = RUNTIME_ROOT / "operations"


class TelegramOptInTests(unittest.TestCase):
    def test_token_alone_is_disabled_and_does_not_construct_or_call_telegram(self) -> None:
        with patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "secret-token"}, clear=True):
            config = read_telegram_config()
            self.assertFalse(config.enabled)
            self.assertFalse(config.configured)
            self.assertIsNone(local_presentation.build_telegram_bot(Mock(), Mock(), Mock(), Mock()))
            self.assertEqual(voice_service._telegram_token(), "")

    def test_enabled_telegram_without_token_is_reported_without_bot_or_requests(self) -> None:
        with patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1"}, clear=True), patch.object(local_presentation.requests, "Session") as session:
            config = read_telegram_config()
            bot = local_presentation.build_telegram_bot(Mock(), Mock(), Mock(), Mock(), config=config)
        self.assertTrue(config.enabled)
        self.assertFalse(config.configured)
        self.assertEqual(config.configuration_error, "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING")
        self.assertIsNone(bot)
        session.assert_not_called()

    def test_explicit_opt_in_constructs_bot_and_preserves_normal_behavior(self) -> None:
        with patch.dict(
            os.environ,
            {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "secret-token"},
            clear=True,
        ):
            config = read_telegram_config()
            bot = local_presentation.build_telegram_bot(Mock(), Mock(), Mock(), Mock())
            self.assertTrue(config.enabled)
            self.assertTrue(config.configured)
            self.assertEqual(config.token, "secret-token")
            self.assertIsInstance(bot, local_presentation.TelegramLocalBot)
            self.assertEqual(bot.token, "secret-token")

    def test_voice_delivery_is_blocked_when_opt_in_is_disabled(self) -> None:
        job = {
            "telegram_chat_id": 12345,
            "telegram_encoder": None,
            "telegram_pcm_parts": [b"pcm"],
            "cancelled": Mock(is_set=Mock(return_value=False)),
            "event_id": "safety-check",
        }
        with patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "secret-token"}, clear=True), patch.object(voice_service, "_telegram_post") as telegram_post:
            voice_service._send_same_prisma_audio_to_telegram(job)
        telegram_post.assert_not_called()


class PresentationHealthTests(unittest.TestCase):
    def test_disabled_health_reports_telegram_not_configured_or_connected(self) -> None:
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"PRISMA_RUNTIME_STATE_DIR": temporary}, clear=True), patch.object(local_presentation.requests, "Session", return_value=fake_http):
            health = local_presentation.create_app(telegram_bot=None).test_client().get("/health").get_json()
        self.assertFalse(health["telegramEnabled"])
        self.assertFalse(health["telegramConfigured"])
        self.assertFalse(health["telegramConnected"])
        self.assertFalse(health["telegramVerified"])
        self.assertIsNone(health["telegramConfigurationError"])
        self.assertIsNone(health["telegramLastError"])
        self.assertTrue(health["ready"])

    def test_enabled_health_exposes_connection_observability(self) -> None:
        bot = Mock(token="secret-token", bot_username="prisma_bot", last_error="temporary")
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN": "secret-token", "PRISMA_RUNTIME_STATE_DIR": temporary}, clear=True), patch.object(local_presentation.requests, "Session", return_value=fake_http):
            health = local_presentation.create_app(telegram_bot=bot).test_client().get("/health").get_json()
        self.assertTrue(health["telegramEnabled"])
        self.assertTrue(health["telegramConfigured"])
        self.assertTrue(health["telegramConnected"])
        self.assertFalse(health["telegramVerified"])
        self.assertIsNone(health["telegramConfigurationError"])
        self.assertEqual(health["telegramLastError"], "temporary")
        self.assertTrue(health["ready"])

    def test_enabled_missing_token_health_stays_live_and_does_not_construct_bot_or_call_telegram(self) -> None:
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_RUNTIME_STATE_DIR": temporary}, clear=True), patch.object(local_presentation.requests, "Session", return_value=fake_http), patch.object(local_presentation, "TelegramLocalBot") as bot_type:
            config = read_telegram_config()
            bot = local_presentation.build_telegram_bot(Mock(), Mock(), Mock(), config=config)
            health = local_presentation.create_app(telegram_bot=bot, telegram_configuration=config).test_client().get("/health").get_json()
        self.assertIsNone(bot)
        bot_type.assert_not_called()
        self.assertTrue(health["ok"])
        self.assertTrue(health["ready"])
        self.assertTrue(health["telegramEnabled"])
        self.assertFalse(health["telegramConfigured"])
        self.assertFalse(health["telegramConnected"])
        self.assertFalse(health["telegramVerified"])
        self.assertEqual(health["telegramConfigurationError"], "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING")
        self.assertNotIn("secret-token", str(health))


class RuntimeOwnershipTests(unittest.TestCase):
    def run_powershell(self, command: str) -> subprocess.CompletedProcess[str]:
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        return subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)

    def test_listener_handoff_keeps_different_wrapper_alive_and_resolves_listener(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        command = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$global:stopped = @()
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ LocalPort = $LocalPort; OwningProcess = 200 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) if ($Filter -match '200') {{ [pscustomobject]@{{ ProcessId = 200; ExecutablePath = 'C:\\Python\\python.exe'; CommandLine = 'C:\\Python\\python.exe -m prisma_runtime.voice_service' }} }} elseif ($Filter -match '100') {{ [pscustomobject]@{{ ProcessId = 100; ExecutablePath = 'C:\\venv\\python.exe'; CommandLine = 'C:\\venv\\python.exe -m prisma_runtime.voice_service' }} }} }}
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
$listener = Resolve-PrismaVerifiedListener -Port 5056 -ExpectedModule 'prisma_runtime.voice_service'
Write-Output ('listener=' + $listener.pid + ';command=' + $listener.commandLine + ';stopped=' + ($global:stopped -join ','))
"""
        result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("listener=200", result.stdout)
        self.assertIn("-m prisma_runtime.voice_service", result.stdout)
        self.assertIn("stopped=", result.stdout)

    def test_startup_never_terminates_wrapper_after_listener_resolution(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn("Stop-PrismaWrapperIfSeparate", source)
        startup = source.index("$startupComplete = $false")
        startup_try = source[source.index("try {", startup):source.index("finally {")]
        self.assertNotIn("Stop-PrismaLaunchedProcess", startup_try)

        ownership = (OPERATIONS_ROOT / "process-ownership.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn("function Stop-PrismaWrapperIfSeparate", ownership)
        self.assertIn("Resolve-PrismaVerifiedListener", source)
        self.assertIn("New-ProcessRecord", source)

    def test_wrong_module_is_not_admitted(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        command = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ OwningProcess = 200 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) [pscustomobject]@{{ ProcessId = 200; ExecutablePath = 'C:\\Python\\python.exe'; CommandLine = 'C:\\Python\\python.exe -m other.service' }} }}
Write-Output ([bool](Resolve-PrismaVerifiedListener -Port 5056 -ExpectedModule 'prisma_runtime.voice_service'))
"""
        result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("False", result.stdout)

    def test_unknown_listener_executable_is_not_admitted_or_stopped(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        command = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$global:stopped = @()
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ OwningProcess = 999 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) [pscustomobject]@{{ ProcessId = 999; ExecutablePath = 'C:\\Other\\node.exe'; CommandLine = 'node.exe -m prisma_runtime.voice_service' }} }}
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
$listener = Resolve-PrismaVerifiedListener -Port 5056 -ExpectedModule 'prisma_runtime.voice_service'
Write-Output ('listener=' + [bool]$listener + ';stopped=' + ($global:stopped -join ','))
"""
        result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("listener=False", result.stdout)
        self.assertIn("stopped=", result.stdout)

    def test_wrong_pid_and_command_line_do_not_stop_current_listener(self) -> None:
        stop_script = OPERATIONS_ROOT / "stop-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            (state / "run" / "process-manifest.json").write_text(json.dumps({"schemaVersion": 1, "repositoryRoot": str(RUNTIME_ROOT), "processes": [{"service": "prisma-voice", "port": 5056, "pid": 201, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service --old",}]}), encoding="utf-8")
            powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            command = f"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ LocalPort = 5056; OwningProcess = 200 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) [pscustomobject]@{{ ProcessId = 200; ExecutablePath = 'C:\\Python.exe'; CommandLine = 'python.exe -m prisma_runtime.voice_service' }} }}
$global:stopped = @()
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
& '{stop_script}'
Write-Output ('stopped=' + ($global:stopped -join ','))
"""
            result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("stopped=", result.stdout)
        self.assertNotIn("stopped=200", result.stdout)

    def test_owned_listener_can_be_stopped_when_manifest_matches_exactly(self) -> None:
        stop_script = OPERATIONS_ROOT / "stop-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            (state / "run" / "process-manifest.json").write_text(json.dumps({"schemaVersion": 1, "repositoryRoot": str(RUNTIME_ROOT), "processes": [{"service": "prisma-voice", "port": 5056, "pid": 200, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service"}]}), encoding="utf-8")
            powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            command = f"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ LocalPort = 5056; OwningProcess = 200 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) [pscustomobject]@{{ ProcessId = 200; ParentProcessId = 1; CreationDate = '2026-08-31T10:00:00Z'; ExecutablePath = 'C:\\Python.exe'; CommandLine = 'python.exe -m prisma_runtime.voice_service' }} }}
$global:stopped = @()
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
& '{stop_script}'
Write-Output ('stopped=' + ($global:stopped -join ','))
"""
            result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("stopped=200", result.stdout)

    def test_stale_manifest_is_pruned_without_stopping_unknown_processes(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "process-manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "repositoryRoot": str(RUNTIME_ROOT), "processes": [{"service": "prisma-voice", "port": 5056, "pid": 111, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service"}]}), encoding="utf-8")
            command = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) return @() }}
Prune-PrismaProcessManifest -ManifestPath '{manifest}' -RepositoryRoot '{RUNTIME_ROOT}'
Write-Output ('exists=' + (Test-Path -LiteralPath '{manifest}'))
"""
            result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("exists=False", result.stdout)

    def test_start_keeps_preflight_before_start_and_manifest_adds_creation_identity(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertLess(source.index("Assert-PrismaLocalPortsAvailable"), source.index("Start-Process"))
        self.assertIn("pid = [int]$Listener.pid", source)
        self.assertIn("module = [string]$Listener.module", source)
        self.assertIn("commandLine = [string]$Listener.commandLine", source)
        self.assertIn("creationTimeUtc", source)
        self.assertNotIn("Stop-PrismaWrapperIfSeparate", source)
        ownership = (OPERATIONS_ROOT / "process-ownership.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn("ParentProcessId", ownership)
        self.assertIn("CreationDate", ownership)
        self.assertNotIn("IndexOf($RepositoryRoot", ownership)

    def test_failed_startup_removes_manifest_records_after_rollback(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        cleanup = source.index("if (-not $startupComplete)")
        startup = source.index("$startupComplete = $false")
        try_body = source[source.index("try {", startup):cleanup]
        cleanup_body = source[cleanup:]
        self.assertNotIn("Stop-PrismaLaunchedProcess -Process", try_body)
        self.assertIn("Stop-PrismaLaunchedProcess -Process $presentationProcess", cleanup_body)
        self.assertIn("Stop-PrismaLaunchedProcess -Process $voiceProcess", cleanup_body)
        self.assertLess(cleanup_body.index("Stop-PrismaLaunchedProcess"), cleanup_body.index("stop-local.ps1"))
        self.assertIn("stop-local.ps1", source[cleanup:])
        self.assertIn("Remove-Item -LiteralPath $manifestPath", source[cleanup:])
        launcher_cleanup = source[source.index("function Stop-PrismaLaunchedProcess"):source.index("$template = Get-PrismaConfigurationTemplate")]
        self.assertIn("Stop-Process -Id $Process.Id", launcher_cleanup)
        self.assertIn("$Process.HasExited", launcher_cleanup)
        self.assertIn("-ErrorAction SilentlyContinue", launcher_cleanup)
        self.assertNotIn("Get-Process", launcher_cleanup)

        stop_local = (OPERATIONS_ROOT / "stop-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("Stop-Process -Id $recordedPid", stop_local)

    def test_manifest_lock_serializes_real_cross_process_writers(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            lock_path = Path(temporary) / "manifest.lock"
            marker = Path(temporary) / "marker.txt"
            holder = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
Invoke-PrismaManifestLock -LockPath '{lock_path}' -TimeoutMilliseconds 3000 -Action {{
    Add-Content -LiteralPath '{marker}' -Value 'holder-enter'
    Start-Sleep -Milliseconds 500
    Add-Content -LiteralPath '{marker}' -Value 'holder-exit'
}}
"""
            waiter = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
Invoke-PrismaManifestLock -LockPath '{lock_path}' -TimeoutMilliseconds 3000 -Action {{
    Add-Content -LiteralPath '{marker}' -Value 'waiter-enter'
}}
"""
            powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            first = subprocess.Popen([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", holder], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            for _ in range(100):
                if lock_path.exists():
                    break
                time.sleep(0.01)
            second = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", waiter], capture_output=True, text=True, check=False)
            first_stdout, first_stderr = first.communicate(timeout=5)
            self.assertEqual(first.returncode, 0, first_stderr or first_stdout)
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(marker.read_text(encoding="utf-8").splitlines(), ["holder-enter", "holder-exit", "waiter-enter"])

    def test_development_owner_transaction_shares_generation_and_releases_only_last_owner(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        command = fr"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$manifest = [pscustomobject]@{{
    schemaVersion = 2
    repositoryRoot = 'C:\repo'
    processes = @()
    developmentOwnership = [pscustomobject]@{{ generation = 'generation'; owners = @('owner-a') }}
}}
Add-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken 'owner-b' -ExpectedGeneration 'generation'
$first = Remove-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken 'owner-a' -ExpectedGeneration 'generation'
$second = Remove-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken 'owner-b' -ExpectedGeneration 'generation'
Write-Output "owners=$($manifest.developmentOwnership.owners -join ',');first=$first;second=$second"
"""
        result = self.run_powershell(command)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("owners=;first=False;second=True", result.stdout)

    def test_actual_powershell_51_receipt_bytes_are_bomless_and_parse_in_actual_node(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            receipt = Path(temporary) / "receipt.json"
            command = fr"""
$ErrorActionPreference = 'Stop'
. '{helper}'
Save-PrismaJsonFile -Path '{receipt}' -Value ([ordered]@{{ registered = $true; generation = 'generation' }}) -Depth 4
"""
            result = self.run_powershell(command)
            self.assertEqual(result.returncode, 0, result.stderr)
            data = receipt.read_bytes()
            self.assertNotEqual(data[:3], bytes((239, 187, 191)))
            node = subprocess.run(
                ["node", "-e", "const fs=require('node:fs'); JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))", str(receipt)],
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(node.returncode, 0, node.stderr)

    def test_failed_sole_owner_receipt_handoff_rolls_back_exact_owned_processes(self) -> None:
        self._assert_failed_receipt_handoff_rolls_back(owner_list=["owner-b"], expected_owners=None, expected_stopped="200,201")

    def test_failed_shared_owner_receipt_handoff_removes_only_invocation_owner(self) -> None:
        self._assert_failed_receipt_handoff_rolls_back(owner_list=["owner-a"], expected_owners=["owner-a"], expected_stopped="")

    def _assert_failed_receipt_handoff_rolls_back(self, owner_list: list[str], expected_owners: list[str] | None, expected_stopped: str) -> None:
        start_script = OPERATIONS_ROOT / "start-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            manifest_path = state / "run" / "process-manifest.json"
            manifest_path.write_text(json.dumps({
                "schemaVersion": 2,
                "repositoryRoot": str(RUNTIME_ROOT),
                "processes": [
                    {"service": "prisma-voice", "port": 5056, "pid": 200, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service", "creationTimeUtc": "voice-created"},
                    {"service": "prisma-local-presentation", "port": 5057, "pid": 201, "executable": "C:\\Python.exe", "module": "prisma_runtime.local_presentation", "commandLine": "python.exe -m prisma_runtime.local_presentation", "creationTimeUtc": "presentation-created"},
                ],
                "developmentOwnership": {"generation": "generation", "owners": owner_list},
            }), encoding="utf-8")
            missing_parent_receipt = state / "missing" / "receipt.json"
            command = fr"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ OwningProcess = $(if ($LocalPort -eq 5056) {{ 200 }} else {{ 201 }}) }} }}
function global:Get-CimInstance {{
    param([string]$ClassName, [string]$Filter)
    $voice = $Filter -match '200'
    [pscustomobject]@{{ ProcessId = $(if ($voice) {{ 200 }} else {{ 201 }}); ExecutablePath = 'C:\Python.exe'; CommandLine = $(if ($voice) {{ 'python.exe -m prisma_runtime.voice_service' }} else {{ 'python.exe -m prisma_runtime.local_presentation' }}); CreationDate = $(if ($voice) {{ 'voice-created' }} else {{ 'presentation-created' }}) }}
}}
$global:stopped = @()
function global:Stop-Process {{ [CmdletBinding()] param([int]$Id, [switch]$Force) $global:stopped += $Id }}
try {{ & '{start_script}' -DevelopmentOwnerToken 'owner-b' -DevelopmentReceiptPath '{missing_parent_receipt}'; exit 9 }}
catch {{ Write-Output "failed=True;stopped=$($global:stopped -join ',')" }}
"""
            result = self.run_powershell(command)
            final_manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig")) if manifest_path.exists() else None
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"failed=True;stopped={expected_stopped}", result.stdout)
        if expected_owners is None:
            self.assertIsNone(final_manifest)
        else:
            self.assertEqual(final_manifest["developmentOwnership"]["owners"], expected_owners)

    def test_generation_mismatch_and_repeated_release_cannot_claim_replacement(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        command = fr"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$manifest = [pscustomobject]@{{
    schemaVersion = 2
    repositoryRoot = 'C:\repo'
    processes = @()
    developmentOwnership = [pscustomobject]@{{ generation = 'replacement'; owners = @('owner') }}
}}
$mismatch = Remove-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken 'owner' -ExpectedGeneration 'old'
$first = Remove-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken 'owner' -ExpectedGeneration 'replacement'
$repeat = Remove-PrismaDevelopmentOwner -Manifest $manifest -OwnerToken 'owner' -ExpectedGeneration 'replacement'
Write-Output "mismatch=$mismatch;first=$first;repeat=$repeat"
"""
        result = self.run_powershell(command)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("mismatch=False;first=True;repeat=False", result.stdout)

    def test_new_identity_requires_creation_time_but_legacy_identity_remains_readable(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        command = fr"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$listener = [pscustomobject]@{{ pid = 9; executable = 'C:\Python.exe'; module = 'prisma_runtime.voice_service'; commandLine = 'python.exe -m prisma_runtime.voice_service'; creationTimeUtc = '2026-09-17T10:00:00Z' }}
$legacy = [pscustomobject]@{{ pid = 9; executable = 'C:\Python.exe'; module = 'prisma_runtime.voice_service'; commandLine = 'python.exe -m prisma_runtime.voice_service' }}
$owned = [pscustomobject]@{{ pid = 9; executable = 'C:\Python.exe'; module = 'prisma_runtime.voice_service'; commandLine = 'python.exe -m prisma_runtime.voice_service'; creationTimeUtc = '2026-09-17T10:00:01Z' }}
Write-Output "legacy=$(Test-PrismaManifestIdentity -Listener $listener -Record $legacy);owned=$(Test-PrismaManifestIdentity -Listener $listener -Record $owned -RequireCreationTime)"
"""
        result = self.run_powershell(command)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("legacy=True;owned=False", result.stdout)

    def test_corrupt_or_foreign_manifest_is_not_canonical_reuse_proof(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "process-manifest.json"
            manifest.write_text("{broken", encoding="utf-8")
            corrupt = self.run_powershell(fr". '{helper}'; Write-Output ([bool](Get-PrismaCanonicalManifest -ManifestPath '{manifest}' -RepositoryRoot 'C:\repo'))")
            manifest.write_text(json.dumps({"schemaVersion": 1, "repositoryRoot": "C:\\other", "processes": []}), encoding="utf-8")
            foreign = self.run_powershell(fr". '{helper}'; Write-Output ([bool](Get-PrismaCanonicalManifest -ManifestPath '{manifest}' -RepositoryRoot 'C:\repo'))")
        self.assertEqual(corrupt.returncode, 0, corrupt.stderr)
        self.assertEqual(foreign.returncode, 0, foreign.stderr)
        self.assertIn("False", corrupt.stdout)
        self.assertIn("False", foreign.stdout)

    def test_manual_canonical_runtime_is_reused_without_start_or_stop_ownership(self) -> None:
        start_script = OPERATIONS_ROOT / "start-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            manifest = {
                "schemaVersion": 1,
                "repositoryRoot": str(RUNTIME_ROOT),
                "processes": [
                    {"service": "prisma-voice", "port": 5056, "pid": 200, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service"},
                    {"service": "prisma-local-presentation", "port": 5057, "pid": 201, "executable": "C:\\Python.exe", "module": "prisma_runtime.local_presentation", "commandLine": "python.exe -m prisma_runtime.local_presentation"},
                ],
            }
            (state / "run" / "process-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            receipt = state / "receipt.json"
            command = fr"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ OwningProcess = $(if ($LocalPort -eq 5056) {{ 200 }} else {{ 201 }}) }} }}
function global:Get-CimInstance {{
    param([string]$ClassName, [string]$Filter)
    $pidValue = if ($Filter -match '200') {{ 200 }} else {{ 201 }}
    $module = if ($pidValue -eq 200) {{ 'prisma_runtime.voice_service' }} else {{ 'prisma_runtime.local_presentation' }}
    [pscustomobject]@{{ ProcessId = $pidValue; ExecutablePath = 'C:\Python.exe'; CommandLine = "python.exe -m $module" }}
}}
$global:started = 0
$global:stopped = 0
function global:Start-Process {{ $global:started++ }}
function global:Stop-Process {{ $global:stopped++ }}
& '{start_script}' -DevelopmentOwnerToken 'owner' -DevelopmentReceiptPath '{receipt}'
$receiptValue = Get-Content -LiteralPath '{receipt}' -Raw | ConvertFrom-Json
Write-Output "registered=$($receiptValue.registered);started=$global:started;stopped=$global:stopped"
"""
            result = self.run_powershell(command)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("registered=False;started=0;stopped=0", result.stdout)

    def test_concurrent_acquisitions_join_one_owned_generation_without_manifest_corruption(self) -> None:
        start_script = OPERATIONS_ROOT / "start-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            generation = "generation-a"
            manifest = {
                "schemaVersion": 2,
                "repositoryRoot": str(RUNTIME_ROOT),
                "processes": [
                    {"service": "prisma-voice", "port": 5056, "pid": 200, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service", "creationTimeUtc": "voice-created"},
                    {"service": "prisma-local-presentation", "port": 5057, "pid": 201, "executable": "C:\\Python.exe", "module": "prisma_runtime.local_presentation", "commandLine": "python.exe -m prisma_runtime.local_presentation", "creationTimeUtc": "presentation-created"},
                ],
                "developmentOwnership": {"generation": generation, "owners": ["owner-a"]},
            }
            (state / "run" / "process-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

            def command(owner: str) -> str:
                receipt = state / f"{owner}.json"
                return fr"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ OwningProcess = $(if ($LocalPort -eq 5056) {{ 200 }} else {{ 201 }}) }} }}
function global:Get-CimInstance {{
    param([string]$ClassName, [string]$Filter)
    $voice = $Filter -match '200'
    [pscustomobject]@{{ ProcessId = $(if ($voice) {{ 200 }} else {{ 201 }}); ExecutablePath = 'C:\Python.exe'; CommandLine = $(if ($voice) {{ 'python.exe -m prisma_runtime.voice_service' }} else {{ 'python.exe -m prisma_runtime.local_presentation' }}); CreationDate = $(if ($voice) {{ 'voice-created' }} else {{ 'presentation-created' }}) }}
}}
& '{start_script}' -DevelopmentOwnerToken '{owner}' -DevelopmentReceiptPath '{receipt}'
"""

            powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            first = subprocess.Popen([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command("owner-b")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            second = subprocess.Popen([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command("owner-c")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            first_stdout, first_stderr = first.communicate(timeout=10)
            second_stdout, second_stderr = second.communicate(timeout=10)
            final_manifest = json.loads((state / "run" / "process-manifest.json").read_text(encoding="utf-8-sig"))
        self.assertEqual(first.returncode, 0, first_stderr or first_stdout)
        self.assertEqual(second.returncode, 0, second_stderr or second_stdout)
        self.assertEqual(final_manifest["developmentOwnership"]["generation"], generation)
        self.assertCountEqual(final_manifest["developmentOwnership"]["owners"], ["owner-a", "owner-b", "owner-c"])

    def test_release_keeps_nonfinal_generation_and_never_kills_replaced_identity(self) -> None:
        release_script = OPERATIONS_ROOT / "release-dev-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            manifest = {
                "schemaVersion": 2,
                "repositoryRoot": str(RUNTIME_ROOT),
                "processes": [
                    {"service": "prisma-voice", "port": 5056, "pid": 200, "executable": "C:\\Python.exe", "module": "prisma_runtime.voice_service", "commandLine": "python.exe -m prisma_runtime.voice_service", "creationTimeUtc": "voice-created"},
                    {"service": "prisma-local-presentation", "port": 5057, "pid": 201, "executable": "C:\\Python.exe", "module": "prisma_runtime.local_presentation", "commandLine": "python.exe -m prisma_runtime.local_presentation", "creationTimeUtc": "presentation-created"},
                ],
                "developmentOwnership": {"generation": "generation", "owners": ["owner-a", "owner-b"]},
            }
            manifest_path = state / "run" / "process-manifest.json"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            command = fr"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ OwningProcess = $(if ($LocalPort -eq 5056) {{ 200 }} else {{ 201 }}) }} }}
function global:Get-CimInstance {{
    param([string]$ClassName, [string]$Filter)
    $voice = $Filter -match '200'
    [pscustomobject]@{{ ProcessId = $(if ($voice) {{ 200 }} else {{ 201 }}); ExecutablePath = 'C:\Python.exe'; CommandLine = $(if ($voice) {{ 'python.exe -m prisma_runtime.voice_service' }} else {{ 'python.exe -m prisma_runtime.local_presentation' }}); CreationDate = $(if ($voice) {{ 'voice-replaced' }} else {{ 'presentation-created' }}) }}
}}
$global:stopped = @()
function global:Stop-Process {{ param([int]$Id) $global:stopped += $Id }}
& '{release_script}' -DevelopmentOwnerToken 'owner-a' -ExpectedGeneration 'generation'
Write-Output "stopped=$($global:stopped -join ',')"
"""
            result = self.run_powershell(command)
            final_manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("stopped=", result.stdout)
        self.assertCountEqual(final_manifest["developmentOwnership"]["owners"], ["owner-a", "owner-b"])

    def test_cancellation_during_voice_startup_rolls_back_only_the_launched_child(self) -> None:
        start_script = OPERATIONS_ROOT / "start-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            cancellation = state / "cancel"
            receipt = state / "receipt.json"
            command = fr"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) return @() }}
function global:Start-Process {{ [System.Diagnostics.Process]::GetCurrentProcess() }}
$global:stopped = @()
function global:Stop-Process {{ param([int]$Id) $global:stopped += $Id }}
function global:Invoke-RestMethod {{ New-Item -ItemType File -Path '{cancellation}' -Force | Out-Null; throw 'not ready' }}
try {{
    & '{start_script}' -DevelopmentOwnerToken 'owner' -DevelopmentReceiptPath '{receipt}' -DevelopmentCancellationPath '{cancellation}'
    exit 9
}} catch {{
    Write-Output "message=$($_.Exception.Message);stopped=$($global:stopped -join ',');receipt=$(Test-Path -LiteralPath '{receipt}')"
    exit 0
}}
"""
            result = self.run_powershell(command)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("cancelled", result.stdout.lower())
        self.assertRegex(result.stdout, r"stopped=\d+")
        self.assertIn("receipt=False", result.stdout)


class ConcurrentFreshStateSeedingTests(unittest.TestCase):
    """PW-002: seeding the effective configuration happens before the manifest
    lock, so two concurrent launchers on a fresh state root can both observe a
    missing file. The seeding must be atomic: exactly one launcher creates the
    configuration, the loser survives without overwriting, and the published
    file always equals the template byte for byte."""

    TEMPLATE_SIZE_BYTES = 64 * 1024 * 1024
    TEMPLATE_BLOCK = b"prisma-seed-race-0123456789abcdef\n"  # exactly 32 bytes
    ENVIRONMENT_LIBRARY = OPERATIONS_ROOT / "runtime-environment.ps1"

    def _seeding_child_command(self, state: Path, template: Path, ready: Path, gate_name: str) -> str:
        """Child body: signal readiness, wait on the shared named event (with the
        child-side handle disposed after waiting), then run the real, unmodified
        product function against the shared state root."""
        return (
            "$ErrorActionPreference = 'Stop'\n"
            f". '{self.ENVIRONMENT_LIBRARY}'\n"
            f"New-Item -ItemType File -Path '{ready}' -Force | Out-Null\n"
            "$gate = [System.Threading.EventWaitHandle]::OpenExisting('" + gate_name + "')\n"
            "try { $gate.WaitOne() | Out-Null } finally { $gate.Dispose() }\n"
            f"$result = Initialize-PrismaRuntimeState -StateRoot '{state}' -Template '{template}'\n"
            "[Console]::Out.WriteLine(('seeded=' + $result.Seeded))\n"
        )

    def _start_powershell(self, command: str) -> subprocess.Popen[str]:
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        return subprocess.Popen(
            [str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def test_concurrent_fresh_state_start_pairs_both_survive_seeding(self) -> None:
        with tempfile.TemporaryDirectory(prefix="pw002-seed-race-") as temporary:
            # Resolve the long path: %TEMP% can carry an 8.3 short name, and
            # .NET Framework short-name expansion under concurrent directory
            # creation can otherwise hand the two children different state
            # roots (the same gotcha ``canonical`` documents in
            # test_python_environment.py).
            base = Path(temporary).resolve()
            block = self.TEMPLATE_BLOCK * (self.TEMPLATE_SIZE_BYTES // len(self.TEMPLATE_BLOCK))
            template = base / "prisma_voice_config.example.json"
            template.write_bytes(block)
            state = base / "state"
            ready_a, ready_b = base / "ready-a", base / "ready-b"
            gate_name = "pw002-seed-gate-" + os.urandom(6).hex()
            # Explicit native signatures: the bare windll export table returns
            # c_int for every call, which truncates HANDLE values and leaves
            # CloseHandle/SetEvent results unchecked.
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel32.CreateEventW.argtypes = (ctypes.wintypes.LPVOID, ctypes.wintypes.BOOL, ctypes.wintypes.BOOL, ctypes.wintypes.LPCWSTR)
            kernel32.CreateEventW.restype = ctypes.wintypes.HANDLE
            kernel32.SetEvent.argtypes = (ctypes.wintypes.HANDLE,)
            kernel32.SetEvent.restype = ctypes.wintypes.BOOL
            kernel32.CloseHandle.argtypes = (ctypes.wintypes.HANDLE,)
            kernel32.CloseHandle.restype = ctypes.wintypes.BOOL
            gate_handle = kernel32.CreateEventW(None, True, False, gate_name)
            self.assertTrue(gate_handle, "the test barrier event must be creatable")

            def _close_gate() -> None:
                if not kernel32.CloseHandle(gate_handle):
                    raise ctypes.WinError(ctypes.get_last_error())

            def _terminate_child(child: subprocess.Popen[str]) -> None:
                # Individually protected: a failure while terminating one child
                # must never prevent the other child's cleanup from running.
                try:
                    if child.poll() is None:
                        child.kill()
                        child.communicate(timeout=10)
                except Exception:
                    pass

            self.addCleanup(_close_gate)
            # Each started child is registered immediately after start, so the
            # registered cleanups terminate every started child on every path,
            # including a partially completed launch sequence and a test-body
            # error before any try block is entered.
            first = self._start_powershell(self._seeding_child_command(state, template, ready_a, gate_name))
            self.addCleanup(_terminate_child, first)
            second = self._start_powershell(self._seeding_child_command(state, template, ready_b, gate_name))
            self.addCleanup(_terminate_child, second)

            deadline = time.time() + 30
            while not (ready_a.exists() and ready_b.exists()) and time.time() < deadline:
                time.sleep(0.01)
            self.assertTrue(
                ready_a.exists() and ready_b.exists(),
                "both launchers must signal readiness before the barrier is released",
            )
            self.assertTrue(kernel32.SetEvent(gate_handle), "the barrier SetEvent call must succeed")
            first_out, first_err = first.communicate(timeout=60)
            second_out, second_err = second.communicate(timeout=60)

            config = state / "prisma_voice_config.json"
            self.assertEqual(first.returncode, 0, f"first launcher failed: {first_err or first_out}")
            self.assertEqual(second.returncode, 0, f"second launcher failed: {second_err or second_out}")
            seeded_lines = sorted(line for line in (first_out + second_out).splitlines() if line.startswith("seeded="))
            self.assertEqual(
                seeded_lines,
                ["seeded=False", "seeded=True"],
                f"exactly one launcher must create the configuration; "
                f"first(stderr)={first_err!r}; second(stderr)={second_err!r}",
            )
            self.assertTrue(config.is_file())
            self.assertEqual(config.read_bytes(), block, "published configuration must equal the template byte for byte")
            leftovers = sorted(str(path) for path in list(state.glob("*.tmp")) + list(base.glob("*.tmp")))
            self.assertEqual(leftovers, [], "no temporary seeding file may remain in the state root or its parent")


if __name__ == "__main__":
    unittest.main()
