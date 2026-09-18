import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.credential_store import (
    CredentialCipher,
    CredentialService,
    CredentialUnavailable,
    InvalidCredential,
    initialize_credential_database,
)


KEY = bytes(range(32))
OTHER_KEY = bytes(reversed(range(32)))
SECRET = "  synthetic-秘密-token  "


class CredentialStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.runtime_root = self.root / "runtime"
        self.database = self.runtime_root / "credentials" / "provider-credentials.sqlite3"
        self.key_file = self.root / "keys" / "master.key"
        self.key_file.parent.mkdir()
        self.key_file.write_bytes(KEY)
        self.database.parent.mkdir(parents=True)
        self.database.touch()
        self.permissions = Mock()
        initialize_credential_database(self.database, KEY, self.permissions.verify)

    def service(self, key_file: Path | None = None, nonce_source=None) -> CredentialService:
        return CredentialService(
            self.database,
            key_file or self.key_file,
            self.runtime_root,
            self.permissions.verify,
            nonce_source=nonce_source,
        )

    def test_real_aesgcm_round_trip_fresh_nonce_and_authenticated_context(self) -> None:
        nonces = iter((b"a" * 12, b"b" * 12))
        cipher = CredentialCipher(KEY, nonce_source=lambda size: next(nonces))
        first = cipher.encrypt("gemini", SECRET)
        second = cipher.encrypt("gemini", SECRET)

        self.assertEqual(cipher.decrypt(first), SECRET)
        self.assertNotEqual(first.nonce, second.nonce)
        self.assertNotEqual(first.ciphertext, second.ciphertext)
        for mutation in (
            first._replace(ciphertext=first.ciphertext[:-1] + bytes([first.ciphertext[-1] ^ 1])),
            first._replace(provider="telegram"),
            first._replace(format_version=2),
        ):
            with self.subTest(mutation=mutation), self.assertRaises(CredentialUnavailable):
                cipher.decrypt(mutation)
        with self.assertRaises(CredentialUnavailable):
            CredentialCipher(OTHER_KEY).decrypt(first)

    def test_empty_store_is_bound_to_master_key_and_metadata_is_boolean_only(self) -> None:
        self.assertEqual(self.service().status(), {"gemini": False, "telegram": False})
        wrong_key = self.root / "keys" / "wrong.key"
        wrong_key.write_bytes(OTHER_KEY)
        with self.assertRaises(CredentialUnavailable):
            self.service(wrong_key).status()

    def test_set_replace_internal_read_delete_and_unicode_bounds_preserve_bytes(self) -> None:
        service = self.service()
        service.set_secret("gemini", SECRET)
        self.assertEqual(service.get_secret("gemini"), SECRET)
        self.assertEqual(service.status(), {"gemini": True, "telegram": False})
        service.set_secret("gemini", "replacement")
        self.assertEqual(service.get_secret("gemini"), "replacement")
        service.delete_secret("gemini")
        service.delete_secret("gemini")
        self.assertEqual(service.status(), {"gemini": False, "telegram": False})

        for invalid in ("", " \t\n", "x" * 4097, "\ud800"):
            with self.subTest(value=repr(invalid)), self.assertRaises(InvalidCredential):
                service.set_secret("gemini", invalid)
        with self.assertRaises(InvalidCredential):
            service.set_secret("other", "secret")

    def test_tamper_wrong_types_sizes_and_unexpected_rows_fail_without_modification(self) -> None:
        service = self.service(nonce_source=lambda size: b"n" * size)
        service.set_secret("gemini", SECRET)
        connection = sqlite3.connect(self.database)
        try:
            original = connection.execute("SELECT ciphertext FROM credentials WHERE provider='gemini'").fetchone()[0]
            connection.execute("UPDATE credentials SET ciphertext = ? WHERE provider='gemini'", (original[:-1] + b"x",))
            connection.commit()
        finally:
            connection.close()

        for operation in (lambda: service.status(), lambda: service.set_secret("telegram", "new"), lambda: service.delete_secret("gemini")):
            with self.subTest(operation=operation), self.assertRaises(CredentialUnavailable):
                operation()
        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(connection.execute("SELECT ciphertext FROM credentials WHERE provider='gemini'").fetchone()[0], original[:-1] + b"x")
            self.assertIsNone(connection.execute("SELECT 1 FROM credentials WHERE provider='telegram'").fetchone())
        finally:
            connection.close()

    def test_concurrent_connections_commit_ciphertext_and_reopen_durably_without_plaintext(self) -> None:
        errors = []

        def write(provider: str, secret: str) -> None:
            try:
                self.service().set_secret(provider, secret)
            except Exception as error:
                errors.append(error)

        threads = [
            threading.Thread(target=write, args=("gemini", SECRET)),
            threading.Thread(target=write, args=("telegram", "synthetic-telegram-token")),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])
        reopened = self.service()
        self.assertEqual(reopened.status(), {"gemini": True, "telegram": True})
        self.assertEqual(reopened.get_secret("gemini"), SECRET)
        for path in self.database.parent.glob("provider-credentials.sqlite3*"):
            self.assertNotIn(SECRET.encode("utf-8"), path.read_bytes())
            self.assertNotIn(b"synthetic-telegram-token", path.read_bytes())

    def test_failed_transaction_rolls_back_without_replacing_valid_ciphertext(self) -> None:
        service = self.service()
        service.set_secret("gemini", SECRET)
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "CREATE TRIGGER reject_update BEFORE UPDATE ON credentials BEGIN SELECT RAISE(ABORT, 'synthetic'); END"
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaises(CredentialUnavailable):
            service.set_secret("gemini", "replacement")
        connection = sqlite3.connect(self.database)
        try:
            connection.execute("DROP TRIGGER reject_update")
            connection.commit()
        finally:
            connection.close()
        self.assertEqual(service.get_secret("gemini"), SECRET)

    def test_invalid_key_paths_permissions_database_and_crypto_are_sanitized(self) -> None:
        inside = self.runtime_root / "master.key"
        inside.parent.mkdir(parents=True, exist_ok=True)
        inside.write_bytes(KEY)
        for key_path in (Path("relative.key"), inside, self.root / "missing.key"):
            with self.subTest(path=key_path), self.assertRaises(CredentialUnavailable):
                self.service(key_path).status()

        self.permissions.verify.side_effect = RuntimeError("sensitive path detail")
        with self.assertRaisesRegex(CredentialUnavailable, "CREDENTIAL_STORAGE_UNAVAILABLE") as captured:
            self.service().status()
        self.assertNotIn(str(self.key_file), str(captured.exception))


if __name__ == "__main__":
    unittest.main()
