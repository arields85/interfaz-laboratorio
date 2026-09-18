import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.storage_permissions import SecureStoragePermissions, StoragePermissionError


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
