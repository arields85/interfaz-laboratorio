"""One-time Prisma -> Leda migration of the developer's local state and master key.

Every test is offline and runs against a temporary LOCALAPPDATA; the real user
profile is never read or written. PowerShell is exercised through the same
harness style as ``test_python_environment.py``.
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path


RUNTIME_ROOT = Path(__file__).resolve().parents[1]
OPERATIONS_ROOT = RUNTIME_ROOT / "operations"
ENVIRONMENT_LIBRARY = OPERATIONS_ROOT / "runtime-environment.ps1"
POWERSHELL = Path(os.environ["SystemRoot"]) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"

PREAMBLE = (
    "Set-StrictMode -Version Latest\n"
    "$ErrorActionPreference = 'Stop'\n"
)


def run_powershell(body: str, env_overrides: dict[str, str | None] | None = None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    for name, value in (env_overrides or {}).items():
        if value is None:
            env.pop(name, None)
        else:
            env[name] = value
    return subprocess.run(
        [str(POWERSHELL), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", PREAMBLE + body],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


class LegacyMigrationTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.local_app_data = Path(self.temporary.name).resolve()
        self.core = self.local_app_data / "CoreAnalytics"
        self.legacy_state = self.core / "Prisma"
        self.new_state = self.core / "Leda"
        self.legacy_key_dir = self.core / "PrismaCredentialKey"
        self.new_key_dir = self.core / "LedaCredentialKey"

    def write(self, path: Path, content: bytes) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    def seed_legacy_state(self) -> None:
        self.write(self.legacy_state / "prisma_voice_config.json", b'{"effectEnabled": true}')
        self.write(self.legacy_state / "prisma_local_snapshot.json", b"snapshot")
        self.write(self.legacy_state / "prisma_local_state.json", b"state")
        self.write(self.legacy_state / "prisma_channel_a_config.json", b"channel-a")
        self.write(self.legacy_state / "auth" / "admin.sqlite3", b"auth-db")
        self.write(self.legacy_state / "credentials" / "provider-credentials.sqlite3", b"cipher-text")
        self.write(self.legacy_state / "hmi-config" / "hmi-config.sqlite3", b"hmi-config")
        self.write(self.legacy_state / "logs" / "prisma-voice.log", b"log")
        self.write(self.legacy_state / "run" / "process-manifest.json", b"stale-manifest")

    def migrate(self, function: str = "Invoke-LedaLegacyLocalMigration", env: dict[str, str | None] | None = None) -> subprocess.CompletedProcess:
        body = f". '{ENVIRONMENT_LIBRARY}'\n{function} -LocalAppData '{self.local_app_data}' | Out-Null\n"
        result = run_powershell(body, {"LEDA_RUNTIME_STATE_DIR": None, **(env or {})})
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result


class LegacyStateMigrationTests(LegacyMigrationTestCase):
    def test_copies_the_old_state_dir_and_renames_prisma_named_files_in_the_copy(self) -> None:
        self.seed_legacy_state()

        result = self.migrate()

        self.assertEqual((self.new_state / "leda_voice_config.json").read_bytes(), b'{"effectEnabled": true}')
        self.assertEqual((self.new_state / "leda_local_snapshot.json").read_bytes(), b"snapshot")
        self.assertEqual((self.new_state / "leda_local_state.json").read_bytes(), b"state")
        self.assertEqual((self.new_state / "leda_channel_a_config.json").read_bytes(), b"channel-a")
        self.assertEqual((self.new_state / "logs" / "leda-voice.log").read_bytes(), b"log")
        self.assertEqual((self.new_state / "auth" / "admin.sqlite3").read_bytes(), b"auth-db")
        self.assertEqual((self.new_state / "credentials" / "provider-credentials.sqlite3").read_bytes(), b"cipher-text")
        self.assertEqual((self.new_state / "hmi-config" / "hmi-config.sqlite3").read_bytes(), b"hmi-config")
        self.assertFalse(any("prisma" in path.name.lower() for path in self.new_state.rglob("*")))
        self.assertIn("Migrated the legacy local state", result.stdout)

    def test_never_copies_the_ephemeral_run_directory(self) -> None:
        self.seed_legacy_state()

        self.migrate()

        self.assertFalse((self.new_state / "run" / "process-manifest.json").exists())

    def test_leaves_the_old_state_dir_untouched(self) -> None:
        self.seed_legacy_state()

        self.migrate()

        self.assertEqual((self.legacy_state / "prisma_voice_config.json").read_bytes(), b'{"effectEnabled": true}')
        self.assertEqual((self.legacy_state / "run" / "process-manifest.json").read_bytes(), b"stale-manifest")
        self.assertEqual((self.legacy_state / "credentials" / "provider-credentials.sqlite3").read_bytes(), b"cipher-text")

    def test_never_overwrites_an_existing_new_state_dir(self) -> None:
        self.seed_legacy_state()
        self.write(self.new_state / "leda_voice_config.json", b"already-here")

        result = self.migrate()

        self.assertEqual((self.new_state / "leda_voice_config.json").read_bytes(), b"already-here")
        self.assertFalse((self.new_state / "auth").exists())
        self.assertNotIn("Migrated the legacy local state", result.stdout)

    def test_is_idempotent(self) -> None:
        self.seed_legacy_state()
        self.migrate()
        (self.new_state / "leda_local_state.json").write_bytes(b"edited-after-migration")

        self.migrate()

        self.assertEqual((self.new_state / "leda_local_state.json").read_bytes(), b"edited-after-migration")

    def test_does_nothing_without_a_legacy_state_dir(self) -> None:
        self.migrate()

        self.assertFalse(self.new_state.exists())

    def test_replaces_a_stale_staging_directory_from_an_interrupted_run(self) -> None:
        self.seed_legacy_state()
        self.write(self.core / "Leda.migrating" / "half-copied.json", b"partial")

        self.migrate()

        self.assertFalse((self.core / "Leda.migrating").exists())
        self.assertFalse((self.new_state / "half-copied.json").exists())
        self.assertTrue((self.new_state / "leda_voice_config.json").exists())

    def test_skips_the_state_copy_when_the_state_dir_is_overridden(self) -> None:
        self.seed_legacy_state()

        self.migrate(env={"LEDA_RUNTIME_STATE_DIR": str(self.local_app_data / "custom-state")})

        self.assertFalse(self.new_state.exists())


class LegacyCredentialKeyMigrationTests(LegacyMigrationTestCase):
    KEY_BYTES = bytes(range(32))

    def test_copies_the_master_key_byte_for_byte_and_keeps_the_old_one(self) -> None:
        self.write(self.legacy_key_dir / "master.key", self.KEY_BYTES)

        result = self.migrate()

        self.assertEqual((self.new_key_dir / "master.key").read_bytes(), self.KEY_BYTES)
        self.assertEqual((self.legacy_key_dir / "master.key").read_bytes(), self.KEY_BYTES)
        self.assertIn("Migrated the legacy credential master key", result.stdout)

    def test_never_overwrites_an_existing_new_master_key(self) -> None:
        self.write(self.legacy_key_dir / "master.key", self.KEY_BYTES)
        self.write(self.new_key_dir / "master.key", b"the-new-key")

        self.migrate()

        self.assertEqual((self.new_key_dir / "master.key").read_bytes(), b"the-new-key")

    def test_is_idempotent_and_does_nothing_without_a_legacy_key(self) -> None:
        self.migrate()
        self.assertFalse(self.new_key_dir.exists())

        self.write(self.legacy_key_dir / "master.key", self.KEY_BYTES)
        self.migrate()
        (self.new_key_dir / "master.key").write_bytes(b"rotated")
        self.migrate()

        self.assertEqual((self.new_key_dir / "master.key").read_bytes(), b"rotated")

    def test_migrates_the_key_even_when_the_state_dir_is_overridden(self) -> None:
        self.write(self.legacy_key_dir / "master.key", self.KEY_BYTES)

        self.migrate(env={"LEDA_RUNTIME_STATE_DIR": str(self.local_app_data / "custom-state")})

        self.assertEqual((self.new_key_dir / "master.key").read_bytes(), self.KEY_BYTES)


class LegacyMigrationWiringTests(unittest.TestCase):
    def test_start_and_bootstrap_migrate_before_any_state_or_key_use(self) -> None:
        for name in ("start-local.ps1", "bootstrap-local.ps1"):
            source = (OPERATIONS_ROOT / name).read_text(encoding="utf-8-sig")
            self.assertIn("Invoke-LedaLegacyLocalMigration", source, name)
            self.assertLess(
                source.index("Invoke-LedaLegacyLocalMigration"),
                source.index("Initialize-LedaRuntimeState -StateRoot"),
                name,
            )


if __name__ == "__main__":
    unittest.main()
