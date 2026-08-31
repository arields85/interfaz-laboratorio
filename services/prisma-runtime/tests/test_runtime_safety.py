import json
import os
import subprocess
import tempfile
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

    def test_enabled_telegram_requires_a_token_before_startup(self) -> None:
        with patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN"):
                read_telegram_config()

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
        self.assertIsNone(health["telegramLastError"])
        self.assertTrue(health["ready"])

    def test_enabled_health_exposes_connection_observability(self) -> None:
        bot = Mock(token="secret-token", bot_username="prisma_bot", last_error="temporary")
        fake_http = Mock()
        fake_http.get.return_value.json.return_value = {"ok": True}
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"PRISMA_LOCAL_TELEGRAM_ENABLED": "1", "PRISMA_RUNTIME_STATE_DIR": temporary}, clear=True), patch.object(local_presentation.requests, "Session", return_value=fake_http):
            health = local_presentation.create_app(telegram_bot=bot).test_client().get("/health").get_json()
        self.assertTrue(health["telegramEnabled"])
        self.assertTrue(health["telegramConfigured"])
        self.assertTrue(health["telegramConnected"])
        self.assertEqual(health["telegramLastError"], "temporary")
        self.assertTrue(health["ready"])


class RuntimeOwnershipTests(unittest.TestCase):
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

    def test_start_keeps_preflight_before_start_and_manifest_uses_simple_identity(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertLess(source.index("Assert-PrismaLocalPortsAvailable"), source.index("Start-Process"))
        self.assertIn("pid = [int]$Listener.pid", source)
        self.assertIn("module = [string]$Listener.module", source)
        self.assertIn("commandLine = [string]$Listener.commandLine", source)
        self.assertNotIn("creationIdentity", source)
        self.assertNotIn("Stop-PrismaWrapperIfSeparate", source)
        ownership = (OPERATIONS_ROOT / "process-ownership.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn("ParentProcessId", ownership)
        self.assertNotIn("CreationDate", ownership)
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
        launcher_cleanup = source[source.index("function Stop-PrismaLaunchedProcess"):source.index("New-Item -ItemType Directory")]
        self.assertIn("Stop-Process -Id $Process.Id", launcher_cleanup)
        self.assertIn("$Process.HasExited", launcher_cleanup)
        self.assertIn("-ErrorAction SilentlyContinue", launcher_cleanup)
        self.assertNotIn("Get-Process", launcher_cleanup)

        stop_local = (OPERATIONS_ROOT / "stop-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("Stop-Process -Id $recordedPid", stop_local)


if __name__ == "__main__":
    unittest.main()
