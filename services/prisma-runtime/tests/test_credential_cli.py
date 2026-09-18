import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.credential_cli import provision_credentials
from prisma_runtime.credential_store import CredentialUnavailable


class FakePermissions:
    def __init__(self, fail_at: int | None = None):
        self.calls = []
        self.fail_at = fail_at

    def provision(self, directory: Path, path: Path) -> None:
        self.calls.append((directory, path))
        directory.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=False)
        if self.fail_at == len(self.calls):
            raise RuntimeError("synthetic permission failure")

    def verify(self, directory: Path, path: Path) -> None:
        if not path.exists():
            raise RuntimeError("missing")


class CredentialCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.runtime_root = self.root / "runtime"
        self.database = self.runtime_root / "credentials" / "provider-credentials.sqlite3"
        self.key_file = self.root / "private-key" / "master.key"

    def test_provision_protects_empty_files_before_key_bytes_and_never_overwrites(self) -> None:
        permissions = FakePermissions()
        provision_credentials(
            self.key_file,
            self.database,
            self.runtime_root,
            permissions,
            random_bytes=lambda size: b"k" * size,
        )

        self.assertEqual(permissions.calls, [(self.key_file.parent, self.key_file), (self.database.parent, self.database)])
        self.assertEqual(self.key_file.read_bytes(), b"k" * 32)
        self.assertGreater(self.database.stat().st_size, 0)
        with self.assertRaises(CredentialUnavailable):
            provision_credentials(self.key_file, self.database, self.runtime_root, permissions)
        self.assertEqual(self.key_file.read_bytes(), b"k" * 32)

    def test_partial_failure_is_visible_and_does_not_write_or_delete_key(self) -> None:
        permissions = FakePermissions(fail_at=2)
        with self.assertRaisesRegex(CredentialUnavailable, "CREDENTIAL_PROVISIONING_FAILED"):
            provision_credentials(
                self.key_file,
                self.database,
                self.runtime_root,
                permissions,
                random_bytes=lambda size: b"s" * size,
            )
        self.assertTrue(self.key_file.exists())
        self.assertEqual(self.key_file.read_bytes(), b"")
        self.assertTrue(self.database.exists())

    def test_rejects_relative_inside_runtime_existing_and_linked_key_paths_before_permissions(self) -> None:
        permissions = Mock()
        existing = self.root / "existing.key"
        existing.write_bytes(b"x" * 32)
        candidates = [Path("relative.key"), self.runtime_root / "inside.key", existing]
        link = self.root / "linked.key"
        try:
            link.symlink_to(existing)
            candidates.append(link)
        except OSError:
            pass

        for candidate in candidates:
            with self.subTest(candidate=candidate), self.assertRaises(CredentialUnavailable):
                provision_credentials(candidate, self.database, self.runtime_root, permissions)
        permissions.provision.assert_not_called()


if __name__ == "__main__":
    unittest.main()
