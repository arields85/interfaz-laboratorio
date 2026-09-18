import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.storage_permissions import SecureStoragePermissions, StoragePermissionError


def _sanitize_windows_output(text: str, *redactions: str) -> str:
    """Redact profile/temp paths (including 8.3 short forms) before surfacing stderr."""
    sanitized = text or ""
    for value in redactions:
        if value:
            sanitized = sanitized.replace(value, "<redacted>")
    sanitized = re.sub(r"[A-Za-z]:\\Users\\[^\\\s:]+", "<redacted-user>", sanitized)
    return sanitized.strip()[:2000]


def _decoded_output(value: object) -> str:
    """Decode captured subprocess output, tolerating bytes and None."""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value if isinstance(value, str) else ""


def _run_native_process(
    command: list[str],
    *,
    timeout: int,
    redactions: tuple[str, ...] = (),
    description: str,
    runner=subprocess.run,
):
    """Run the native helper, converting failures into sanitized controlled assertions.

    Raw command lines and captured output may contain temporary or user-profile
    paths; only sanitized output may ever reach a raised assertion message.
    """
    try:
        return runner(command, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raw = _decoded_output(error.stderr if error.stderr is not None else error.output)
        raise AssertionError(
            f"{description} timed out after {timeout}s; "
            f"stderr: {_sanitize_windows_output(raw, *redactions)}"
        ) from None


def _seed_protected_incident_descriptor(
    directory: Path,
    *,
    runner=subprocess.run,
    redactions: tuple[str, ...] = (),
) -> None:
    """Seed the observed incident descriptor on a test-local directory."""
    literal = str(directory).replace("'", "''")
    seed_script = f"""
$ErrorActionPreference = 'Stop'
$d = '{literal}'
$acl = Get-Acl -LiteralPath $d
$acl.SetAccessRuleProtection($true, $false)
$ownerRights = New-Object Security.Principal.SecurityIdentifier('S-1-3-4')
$system = New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
$administrators = New-Object Security.Principal.SecurityIdentifier([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)
foreach ($rule in @($acl.Access)) {{ [void]$acl.RemoveAccessRuleSpecific($rule) }}
foreach ($identity in @($ownerRights, $system, $administrators)) {{
  $newRule = New-Object Security.AccessControl.FileSystemAccessRule(
    $identity,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($newRule)
}}
Set-Acl -LiteralPath $d -AclObject $acl
"""
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    powershell = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
    seed = _run_native_process(
        [str(powershell), "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", seed_script],
        timeout=60,
        redactions=redactions,
        description="incident descriptor seeding",
        runner=runner,
    )
    if seed.returncode != 0:
        raise AssertionError(
            "failed to seed the incident descriptor; "
            f"stderr: {_sanitize_windows_output(seed.stderr, *redactions)}"
        )


@unittest.skipUnless(os.name == "nt", "requires native Windows PowerShell 5.1 runner")
class NativeWindowsAclRegressionTests(unittest.TestCase):
    """The real helper must persist directory DACLs under the ordinary user token.

    Regression for the live incident: the auth directory carried a protected
    security descriptor (as observed on the live auth directory, including an
    Owner Rights S-1-3-4 FullControl ACE). On such descriptors, Windows
    PowerShell 5.1's full-descriptor Set-Acl persistence fails with
    PrivilegeNotHeldException SeSecurityPrivilege for a non-elevated user,
    leaving provisioning policy-invalid. The seed mirrors that observed state;
    the helper must repair it without ever requesting audit (SACL) sections.
    """

    def test_directory_only_provision_exits_zero_and_reverifies_under_ordinary_token(self) -> None:
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        powershell = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        script = RUNTIME_ROOT / "operations" / "protect-auth-state.ps1"
        self.assertTrue(powershell.is_file(), f"missing native runner: {powershell}")

        with tempfile.TemporaryDirectory(prefix="auth-acl-native-") as temporary:
            directory = Path(temporary) / "auth"
            directory.mkdir()
            redactions = (temporary, os.environ.get("USERPROFILE", ""), os.environ.get("TEMP", ""))
            _seed_protected_incident_descriptor(directory, redactions=redactions)
            database = directory / "admin.sqlite3"
            base_command = [
                str(powershell),
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(script),
                "-DirectoryPath",
                str(directory),
                "-DatabasePath",
                str(database),
            ]

            provision = _run_native_process(
                [*base_command, "-DirectoryOnly"],
                timeout=60,
                redactions=redactions,
                description="directory-only provision",
            )
            incident_markers = ("SeSecurityPrivilege", "PrivilegeNotHeld")
            observed_markers = {marker: marker in (provision.stderr or "") for marker in incident_markers}
            self.assertEqual(
                provision.returncode,
                0,
                msg=(
                    "directory-only provision must exit 0 under the ordinary token; "
                    f"incident markers observed: {observed_markers}; "
                    f"stderr: {_sanitize_windows_output(provision.stderr, *redactions)}"
                ),
            )
            self.assertFalse(database.exists(), "DirectoryOnly invocation must not create the database")

            verify = _run_native_process(
                [*base_command, "-VerifyOnly", "-DirectoryOnly"],
                timeout=60,
                redactions=redactions,
                description="directory-only VerifyOnly",
            )
            self.assertEqual(
                verify.returncode,
                0,
                msg=(
                    "VerifyOnly re-verification must pass after provisioning; "
                    f"stderr: {_sanitize_windows_output(verify.stderr, *redactions)}"
                ),
            )

    def test_full_verify_only_passes_on_test_local_database_and_sidecars(self) -> None:
        """Full VerifyOnly must validate database and sidecars on test-local state."""
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        powershell = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        script = RUNTIME_ROOT / "operations" / "protect-auth-state.ps1"
        self.assertTrue(powershell.is_file(), f"missing native runner: {powershell}")

        with tempfile.TemporaryDirectory(prefix="auth-acl-native-") as temporary:
            directory = Path(temporary) / "auth"
            directory.mkdir()
            redactions = (temporary, os.environ.get("USERPROFILE", ""), os.environ.get("TEMP", ""))
            _seed_protected_incident_descriptor(directory, redactions=redactions)
            database = directory / "admin.sqlite3"
            base_command = [
                str(powershell),
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-File",
                str(script),
                "-DirectoryPath",
                str(directory),
                "-DatabasePath",
                str(database),
            ]

            provision = _run_native_process(
                [*base_command, "-DirectoryOnly"],
                timeout=60,
                redactions=redactions,
                description="directory-only provision",
            )
            self.assertEqual(
                provision.returncode,
                0,
                msg=(
                    "directory-only provision must exit 0 under the ordinary token; "
                    f"stderr: {_sanitize_windows_output(provision.stderr, *redactions)}"
                ),
            )
            self.assertFalse(database.exists(), "DirectoryOnly invocation must not create the database")

            # Mirror SQLite runtime creation: the database and its transient sidecars
            # appear inside the already-protected directory after provisioning.
            sidecar_names = (
                database.name,
                f"{database.name}-journal",
                f"{database.name}-wal",
                f"{database.name}-shm",
            )
            for name in sidecar_names:
                with (directory / name).open("xb"):
                    pass
            self.assertTrue(database.is_file(), "test-local database must exist before full VerifyOnly")
            self.assertTrue(
                all((directory / name).is_file() for name in sidecar_names),
                "test-local sidecars must exist before full VerifyOnly",
            )

            verify = _run_native_process(
                [*base_command, "-VerifyOnly"],
                timeout=60,
                redactions=redactions,
                description="full VerifyOnly verification",
            )
            self.assertEqual(
                verify.returncode,
                0,
                msg=(
                    "full VerifyOnly must pass for the database and sidecars; "
                    f"stderr: {_sanitize_windows_output(verify.stderr, *redactions)}"
                ),
            )


class NativeProcessSanitizationTests(unittest.TestCase):
    """Native helper invocations must fail through sanitized controlled assertions.

    Raw command lines and captured output may contain temporary or user-profile
    paths; only sanitized output may ever reach a raised assertion message.
    """

    def test_seed_failure_raises_sanitized_controlled_assertion(self) -> None:
        with tempfile.TemporaryDirectory(prefix="auth-acl-native-") as temporary:
            directory = Path(temporary) / "auth"
            directory.mkdir()
            raw_stderr = f"fatal in {temporary}\\seed.ps1 for C:\\Users\\dev\\profile"

            def failing_runner(_command, **_kwargs):
                return SimpleNamespace(returncode=1, stdout="", stderr=raw_stderr)

            with self.assertRaises(AssertionError) as caught:
                _seed_protected_incident_descriptor(directory, runner=failing_runner, redactions=(temporary,))

            message = str(caught.exception)
            self.assertIn("failed to seed the incident descriptor", message)
            self.assertIn("<redacted-user>", message)
            self.assertNotIn(temporary, message)
            self.assertNotIn("C:\\Users\\dev", message)

    def test_timeout_expired_raises_sanitized_controlled_assertion(self) -> None:
        with tempfile.TemporaryDirectory(prefix="auth-acl-native-") as temporary:
            profile = os.environ.get("USERPROFILE", "")
            command = [
                str(RUNTIME_ROOT / "operations" / "protect-auth-state.ps1"),
                "-DirectoryPath",
                str(temporary),
            ]
            raw_output = f"invoked {temporary}\\auth under {profile}".encode()

            def timing_out_runner(_command, **_kwargs):
                raise subprocess.TimeoutExpired(cmd=_command, timeout=5, output=raw_output, stderr=raw_output)

            with self.assertRaises(AssertionError) as caught:
                _run_native_process(
                    command,
                    timeout=5,
                    redactions=(temporary, profile),
                    description="native provision",
                    runner=timing_out_runner,
                )

            message = str(caught.exception)
            self.assertIn("timed out after 5s", message)
            self.assertNotIn(temporary, message)
            if profile:
                self.assertNotIn(profile, message)


def file_metadata(*, mode: int = 0o600, owner: int = 1000, attributes: int = 0):
    return SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=owner, st_file_attributes=attributes)


def directory_metadata(*, mode: int = 0o700, owner: int = 1000, attributes: int = 0):
    return SimpleNamespace(st_mode=stat.S_IFDIR | mode, st_uid=owner, st_file_attributes=attributes)


class StoragePermissionBoundaryTests(unittest.TestCase):
    def test_rejects_linked_or_reparse_ancestor_before_native_verification(self) -> None:
        directory = Path("/state/linked/auth")
        database = directory / "admin.sqlite3"
        linked_ancestor = Path("/state/linked")
        unsafe_metadata = (
            SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=1000, st_file_attributes=0),
            directory_metadata(attributes=0x400),
        )

        for metadata in unsafe_metadata:
            with self.subTest(metadata=metadata):
                def lstat(path):
                    if Path(path) == linked_ancestor:
                        return metadata
                    raise FileNotFoundError

                runner = Mock()
                permissions = SecureStoragePermissions(platform_name="nt", runner=runner, lstat_fn=lstat)

                with self.assertRaisesRegex(StoragePermissionError, "AUTH_STORAGE_PERMISSIONS_INVALID"):
                    permissions.verify(directory, database)

                runner.assert_not_called()

    def test_posix_verification_rejects_insecure_existing_sqlite_sidecar(self) -> None:
        directory = Path("/state/auth")
        database = directory / "admin.sqlite3"
        wal = Path(f"{database}-wal")
        metadata = {
            directory: directory_metadata(),
            database: file_metadata(),
            wal: file_metadata(mode=0o644),
        }

        def lstat(path):
            target = Path(path)
            if target in metadata:
                return metadata[target]
            raise FileNotFoundError

        permissions = SecureStoragePermissions(
            platform_name="posix",
            lstat_fn=lstat,
            owner_id_fn=lambda: 1000,
        )

        with self.assertRaisesRegex(StoragePermissionError, "AUTH_STORAGE_PERMISSIONS_INVALID"):
            permissions.verify(directory, database)

    def test_posix_verification_allows_absent_transient_sidecars(self) -> None:
        directory = Path("/state/auth")
        database = directory / "admin.sqlite3"
        metadata = {directory: directory_metadata(), database: file_metadata()}

        def lstat(path):
            target = Path(path)
            if target in metadata:
                return metadata[target]
            raise FileNotFoundError

        SecureStoragePermissions(
            platform_name="posix",
            lstat_fn=lstat,
            owner_id_fn=lambda: 1000,
        ).verify(directory, database)

    def test_windows_provision_protects_empty_directory_before_database_creation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "auth"
            database = directory / "admin.sqlite3"
            calls: list[list[str]] = []

            def runner(command, **_kwargs):
                calls.append(command)
                if len(calls) == 1:
                    self.assertIn("-DirectoryOnly", command)
                    self.assertTrue(directory.is_dir())
                    self.assertFalse(database.exists())
                else:
                    self.assertNotIn("-DirectoryOnly", command)
                    self.assertIn("-VerifyOnly", command)
                    self.assertTrue(database.is_file())
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            SecureStoragePermissions(platform_name="nt", runner=runner).provision(directory, database)

            self.assertEqual(len(calls), 2)

    def test_windows_helper_statically_covers_ancestors_directory_rules_and_sidecars(self) -> None:
        script = (RUNTIME_ROOT / "operations" / "protect-auth-state.ps1").read_text(encoding="utf-8-sig")

        for required in (
            "Assert-PlainPathChain",
            "DirectoryOnly",
            "-journal",
            "-wal",
            "-shm",
            "InheritanceFlags",
            "PropagationFlags",
            "WellKnownSidType",
        ):
            with self.subTest(required=required):
                self.assertIn(required, script)


if __name__ == "__main__":
    unittest.main()
