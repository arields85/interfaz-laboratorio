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
    def test_listener_resolution_admits_child_and_reaps_only_wrapper(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        command = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$global:stopped = @()
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ LocalPort = $LocalPort; OwningProcess = 200 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) if ($Filter -match '200') {{ [pscustomobject]@{{ ProcessId = 200; ExecutablePath = 'C:\\Python\\python.exe'; CommandLine = 'C:\\Python\\python.exe -m prisma_runtime.voice_service --prisma-runtime-root=C:\\repo' }} }} elseif ($Filter -match '100') {{ [pscustomobject]@{{ ProcessId = 100; ExecutablePath = 'C:\\venv\\python.exe'; CommandLine = 'C:\\venv\\python.exe -m prisma_runtime.voice_service --prisma-runtime-root=C:\\repo' }} }} }}
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
$listener = Resolve-PrismaVerifiedListener -Port 5056 -ExpectedModule 'prisma_runtime.voice_service' -RepositoryRoot 'C:\\repo'
Stop-PrismaWrapperIfSeparate -WrapperProcessId 100 -ListenerProcessId $listener.pid -ExpectedModule 'prisma_runtime.voice_service' -RepositoryRoot 'C:\\repo'
Write-Output ('listener=' + $listener.pid + ';stopped=' + ($global:stopped -join ','))
"""
        result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("listener=200", result.stdout)
        self.assertIn("stopped=100", result.stdout)
        self.assertNotIn("stopped=200", result.stdout)

    def test_unknown_listener_mismatch_is_not_admitted_or_stopped(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        command = f"""
$ErrorActionPreference = 'Stop'
. '{helper}'
$global:stopped = @()
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) [pscustomobject]@{{ LocalPort = $LocalPort; OwningProcess = 999 }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) [pscustomobject]@{{ ProcessId = 999; ExecutablePath = 'C:\\Other\\python.exe'; CommandLine = 'C:\\Other\\python.exe -m other_service --root=C:\\other' }} }}
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
$listener = Resolve-PrismaVerifiedListener -Port 5056 -ExpectedModule 'prisma_runtime.voice_service' -RepositoryRoot 'C:\\repo'
Write-Output ('listener=' + [bool]$listener + ';stopped=' + ($global:stopped -join ','))
"""
        result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("listener=False", result.stdout)
        self.assertIn("stopped=", result.stdout)

    def test_start_owns_presentation_as_background_process_with_retained_logs_after_voice(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        voice_start = source.index("prisma-voice-stdout.log")
        presentation_start = source.index("prisma-presentation-stdout.log")
        self.assertLess(voice_start, presentation_start)
        self.assertGreater(source.find("Start-Process", presentation_start), presentation_start)
        self.assertIn("RedirectStandardOutput", source)
        self.assertIn("RedirectStandardError", source)
        self.assertIn("run", source)

    def test_failed_startup_removes_manifest_records_after_rollback(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        cleanup = source.index("if (-not $startupComplete)")
        self.assertIn("Remove-Item -LiteralPath $manifestPath", source[cleanup:])
        self.assertIn("Prune-PrismaProcessManifest", source)

    def test_stale_manifest_record_is_pruned_without_stopping_unknown_processes(self) -> None:
        helper = OPERATIONS_ROOT / "process-ownership.ps1"
        powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        with tempfile.TemporaryDirectory() as temporary:
            manifest = Path(temporary) / "process-manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "repositoryRoot": str(RUNTIME_ROOT), "processes": [{"service": "prisma-voice", "port": 5056, "pid": 111, "executable": "C:\\Python.exe"}]}), encoding="utf-8")
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

    def test_start_rejects_missing_opted_in_token_before_any_process_start(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        validation = source.index("PRISMA_LOCAL_TELEGRAM_ENABLED")
        self.assertLess(validation, source.index("Start-Process"))
        self.assertIn("PRISMA_LOCAL_TELEGRAM_BOT_TOKEN must be provided", source)

    def test_manifest_contains_only_owned_service_identity_for_5056_and_5057(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("process-manifest.json", source)
        self.assertIn("prisma-voice", source)
        self.assertIn("prisma-local-presentation", source)
        self.assertIn("5056", source)
        self.assertIn("5057", source)
        self.assertIn("pid = [int]$Listener.pid", source)
        self.assertNotIn("pid = [int]$Process.Id", source)
        self.assertNotIn("GEMINI_API_KEY", source[source.index("ConvertTo-Json") :])

    def test_start_health_gates_presentation_after_voice_with_exact_identity(self) -> None:
        source = (OPERATIONS_ROOT / "start-local.ps1").read_text(encoding="utf-8-sig")
        voice_health = source.index("127.0.0.1:5056/health")
        presentation_health = source.index("127.0.0.1:5057/health")
        self.assertLess(voice_health, presentation_health)
        self.assertIn("prisma-local-presentation", source[presentation_health:])
        self.assertIn("$health.ready -eq $true", source[presentation_health:])
        self.assertIn("prismaVoiceReady", source[presentation_health:])

    def test_stop_preserves_unknown_listener_and_stops_only_matching_manifest_process(self) -> None:
        stop_script = OPERATIONS_ROOT / "stop-local.ps1"
        with tempfile.TemporaryDirectory() as temporary:
            state = Path(temporary)
            (state / "run").mkdir()
            (state / "run" / "process-manifest.json").write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "repositoryRoot": str(RUNTIME_ROOT),
                        "processes": [
                            {"service": "prisma-voice", "port": 5056, "pid": 111, "executable": "C:\\Python.exe", "arguments": "-m prisma_runtime.voice_service"},
                            {"service": "prisma-local-presentation", "port": 5057, "pid": 222, "executable": "C:\\Python.exe", "arguments": "-m prisma_runtime.local_presentation"},
                        ],
                    }
                ),
                encoding="utf-8",
            )
            powershell = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
            command = f"""
$ErrorActionPreference = 'Stop'
$env:PRISMA_RUNTIME_STATE_DIR = '{state}'
function global:Get-NetTCPConnection {{ param([int]$LocalPort, [string]$State) if ($LocalPort -eq 5056) {{ [pscustomobject]@{{ LocalPort = 5056; OwningProcess = 999 }} }} elseif ($LocalPort -eq 5057) {{ [pscustomobject]@{{ LocalPort = 5057; OwningProcess = 222 }} }} }}
function global:Get-CimInstance {{ param([string]$ClassName, [string]$Filter) if ($Filter -match '111') {{ [pscustomobject]@{{ ProcessId = 111; ExecutablePath = 'C:\\Python.exe'; CommandLine = 'python.exe -m prisma_runtime.voice_service --prisma-runtime-root=C:\\Users\\Ariel\\repo' }} }} elseif ($Filter -match '222') {{ [pscustomobject]@{{ ProcessId = 222; ExecutablePath = 'C:\\Python.exe'; CommandLine = 'python.exe -m prisma_runtime.local_presentation --prisma-runtime-root={str(RUNTIME_ROOT)}' }} }} }}
$global:stopped = @()
function global:Stop-Process {{ param([int]$Id, [switch]$Force) $global:stopped += $Id }}
& '{stop_script}'
Write-Output ('stopped=' + ($global:stopped -join ','))
"""
            result = subprocess.run([str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("stopped=222", result.stdout)
        self.assertNotIn("stopped=111", result.stdout)

    def test_stop_script_never_stops_arbitrary_port_listeners(self) -> None:
        source = (OPERATIONS_ROOT / "stop-local.ps1").read_text(encoding="utf-8-sig")
        self.assertNotIn("foreach ($port in @(5056, 5057))", source)
        self.assertIn("process-manifest.json", source)
        ownership = (OPERATIONS_ROOT / "process-ownership.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("Get-CimInstance", ownership)

    def test_stop_requires_recorded_pid_to_be_the_verified_listener_pid(self) -> None:
        source = (OPERATIONS_ROOT / "stop-local.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$listener.pid -eq $recordedPid", source)
        ownership = (OPERATIONS_ROOT / "process-ownership.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("$ProcessInfo.CommandLine", ownership)


if __name__ == "__main__":
    unittest.main()
