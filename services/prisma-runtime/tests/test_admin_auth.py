import hashlib
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

RUNTIME_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNTIME_ROOT / "src"))

from prisma_runtime.admin_auth import (
    AdminAuthRepository,
    AdminAuthService,
    AuthUnavailable,
    LoginRateLimited,
    PasswordPolicyError,
    ScryptPasswordHasher,
)
from prisma_runtime.admin_cli import run_cli
from prisma_runtime.storage_permissions import (
    PermissionMetadata,
    SecureStoragePermissions,
    StoragePermissionError,
    validate_posix_permissions,
)


VALID_PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "a different durable passphrase"


class FastPasswordHasher:
    def hash_password(self, password: str) -> dict:
        return {"algorithm": "test", "digest": hashlib.sha256(password.encode()).hexdigest()}

    def verify_password(self, password: str, record: dict) -> bool:
        return record == self.hash_password(password)


class PasswordHasherTests(unittest.TestCase):
    def test_real_scrypt_profile_hashes_fake_password_within_one_second(self) -> None:
        hasher = ScryptPasswordHasher()
        started = time.perf_counter()
        record = hasher.hash_password(VALID_PASSWORD)
        elapsed = time.perf_counter() - started

        print(f"PAC-1 scrypt fake-credential measurement: {elapsed:.3f}s")
        self.assertLess(elapsed, 1.0)
        self.assertTrue(hasher.verify_password(VALID_PASSWORD, record))
        self.assertFalse(hasher.verify_password("wrong but sufficiently long password", record))
        self.assertEqual(record["algorithm"], "scrypt")
        self.assertEqual((record["n"], record["r"], record["p"]), (2**15, 8, 3))

    def test_password_policy_rejects_short_and_oversized_input_without_hashing(self) -> None:
        scrypt = Mock(return_value=b"x" * 32)
        hasher = ScryptPasswordHasher(scrypt_fn=scrypt)

        for password in ("too short", "x" * 1025):
            with self.subTest(length=len(password)), self.assertRaises(PasswordPolicyError):
                hasher.hash_password(password)
        scrypt.assert_not_called()

    def test_unavailable_scrypt_and_untrusted_parameters_fail_closed(self) -> None:
        with self.assertRaises(AuthUnavailable):
            ScryptPasswordHasher(scrypt_fn=None).hash_password(VALID_PASSWORD)

        hasher = ScryptPasswordHasher(scrypt_fn=Mock(return_value=b"x" * 32))
        unsafe = {
            "algorithm": "scrypt",
            "version": 1,
            "n": 2**20,
            "r": 8,
            "p": 3,
            "maxmem": 64 * 1024 * 1024,
            "dklen": 32,
            "salt": "00" * 16,
            "digest": "00" * 32,
        }
        with self.assertRaises(AuthUnavailable):
            hasher.verify_password(VALID_PASSWORD, unsafe)


class StoragePermissionTests(unittest.TestCase):
    def test_posix_policy_rejects_wrong_owner_modes_and_links(self) -> None:
        valid_directory = PermissionMetadata(owner_id=1000, mode=0o700, is_link=False)
        valid_file = PermissionMetadata(owner_id=1000, mode=0o600, is_link=False)
        validate_posix_permissions(valid_directory, valid_file, current_owner_id=1000)

        invalid_cases = (
            (PermissionMetadata(1000, 0o770, False), valid_file),
            (valid_directory, PermissionMetadata(1001, 0o600, False)),
            (valid_directory, PermissionMetadata(1000, 0o600, True)),
        )
        for directory, database in invalid_cases:
            with self.subTest(directory=directory, database=database), self.assertRaises(StoragePermissionError):
                validate_posix_permissions(directory, database, current_owner_id=1000)

    def test_windows_paths_are_safe_arguments_and_native_failures_are_sanitized(self) -> None:
        runner = Mock(return_value=SimpleNamespace(returncode=0, stdout="", stderr=""))
        permissions = SecureStoragePermissions(
            platform_name="nt",
            windows_script=Path("C:/repo/operations/protect-auth-state.ps1"),
            runner=runner,
        )
        directory = Path("C:/state with spaces/auth;literal")
        database = directory / "admin.sqlite3"

        permissions.verify(directory, database)

        command = runner.call_args.args[0]
        self.assertIn(str(directory), command)
        self.assertIn(str(database), command)
        self.assertNotIn("shell", runner.call_args.kwargs)
        self.assertEqual(runner.call_args.kwargs["timeout"], 10)
        self.assertEqual(command[command.index("-DirectoryPath") + 1], str(directory))
        self.assertEqual(command[command.index("-DatabasePath") + 1], str(database))

        runner.side_effect = TimeoutError("C:/secret/runtime/path")
        with self.assertRaisesRegex(StoragePermissionError, "AUTH_STORAGE_PERMISSIONS_INVALID") as error:
            permissions.verify(directory, database)
        self.assertNotIn("secret", str(error.exception))

    def test_broken_storage_links_are_rejected_without_following_them(self) -> None:
        directory = Mock()
        database = Mock()
        directory.is_symlink.return_value = True
        database.is_symlink.return_value = False

        with self.assertRaisesRegex(StoragePermissionError, "AUTH_STORAGE_PERMISSIONS_INVALID"):
            SecureStoragePermissions._reject_existing_links(directory, database)

        directory.is_symlink.assert_called_once_with()
        directory.exists.assert_not_called()


class AdminAuthRepositoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / "auth" / "admin.sqlite3"
        self.permissions = Mock()
        self.repository = AdminAuthRepository(self.database, permission_checker=self.permissions.verify)
        self.hasher = FastPasswordHasher()

    def provision(self) -> None:
        self.repository.initialize_for_provisioning()
        self.repository.provision_admin("admin", self.hasher.hash_password(VALID_PASSWORD), now=1000.0)

    def test_unconfigured_status_does_not_create_or_access_storage(self) -> None:
        self.assertFalse(self.repository.is_configured())
        self.assertFalse(self.database.exists())
        self.permissions.verify.assert_not_called()

    def test_provision_is_single_admin_and_reset_revokes_sessions_atomically(self) -> None:
        self.provision()
        with self.assertRaises(AuthUnavailable):
            self.repository.provision_admin("other", self.hasher.hash_password(VALID_PASSWORD), now=1001.0)

        service = AdminAuthService(self.repository, self.hasher, now=lambda: 1010.0)
        login = service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.assertIsNotNone(login)

        self.repository.reset_admin_password(self.hasher.hash_password(NEW_PASSWORD), now=1020.0)

        self.assertIsNone(service.read_session(login.session_id))
        self.assertIsNone(service.login("admin", VALID_PASSWORD, "127.0.0.1"))
        self.assertIsNotNone(service.login("admin", NEW_PASSWORD, "127.0.0.1"))

    def test_session_id_is_hashed_and_csrf_stays_stable_across_reads(self) -> None:
        self.provision()
        service = AdminAuthService(self.repository, self.hasher, now=lambda: 1010.0)
        login = service.login("admin", VALID_PASSWORD, "127.0.0.1")

        first = service.read_session(login.session_id)
        second = service.read_session(login.session_id)
        with closing(sqlite3.connect(self.database)) as connection:
            stored_id, stored_csrf = connection.execute("SELECT session_id_hash, csrf_token FROM admin_sessions").fetchone()

        self.assertNotEqual(stored_id, login.session_id)
        self.assertNotIn(login.session_id, self.database.read_bytes().decode("latin1"))
        self.assertEqual(first.csrf_token, login.csrf_token)
        self.assertEqual(second.csrf_token, login.csrf_token)
        self.assertEqual(stored_csrf, login.csrf_token)
        self.assertTrue(service.revoke_session(login.session_id, login.csrf_token))
        self.assertIsNone(service.read_session(login.session_id))

    def test_idle_and_absolute_expiration_are_server_side(self) -> None:
        self.provision()
        clock = [1000.0]
        service = AdminAuthService(self.repository, self.hasher, now=lambda: clock[0], idle_seconds=10, absolute_seconds=30)
        idle_login = service.login("admin", VALID_PASSWORD, "127.0.0.1")
        clock[0] = 1011.0
        self.assertIsNone(service.read_session(idle_login.session_id))

        clock[0] = 1020.0
        absolute_login = service.login("admin", VALID_PASSWORD, "127.0.0.1")
        clock[0] = 1029.0
        self.assertIsNotNone(service.read_session(absolute_login.session_id))
        clock[0] = 1038.0
        self.assertIsNotNone(service.read_session(absolute_login.session_id))
        clock[0] = 1047.0
        self.assertIsNotNone(service.read_session(absolute_login.session_id))
        clock[0] = 1051.0
        self.assertIsNone(service.read_session(absolute_login.session_id))

    def test_persisted_throttles_bound_account_source_pairs_and_each_source(self) -> None:
        self.provision()
        barrier = threading.Barrier(6)
        accepted: list[bool] = []

        def reserve() -> None:
            barrier.wait()
            accepted.append(self.repository.reserve_login_attempt("admin", "192.0.2.1", now=1100.0))

        threads = [threading.Thread(target=reserve) for _ in range(6)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(accepted.count(True), 5)
        self.assertEqual(accepted.count(False), 1)

        for account_index in range(1, 4):
            for _ in range(5):
                self.assertTrue(
                    self.repository.reserve_login_attempt(f"other-{account_index}", "192.0.2.1", now=1100.0)
                )
        self.assertFalse(self.repository.reserve_login_attempt("last", "192.0.2.1", now=1100.0))
        self.assertTrue(self.repository.reserve_login_attempt("admin", "192.0.2.2", now=1100.0))
        self.assertLessEqual(self.repository.count_failure_rows(), 100)

    def test_live_failure_capacity_fails_closed_without_evicting_blocks_and_recovers_after_expiry(self) -> None:
        self.provision()
        clock = [1120.0]

        for _ in range(5):
            self.assertTrue(self.repository.reserve_login_attempt("blocked", "192.0.2.10", now=clock[0]))
        self.assertFalse(self.repository.reserve_login_attempt("blocked", "192.0.2.10", now=clock[0]))

        for index in range(94):
            self.assertTrue(
                self.repository.reserve_login_attempt(f"flood-{index}", f"198.51.100.{index}", now=clock[0] + 1)
            )
        self.assertEqual(self.repository.count_failure_rows(), 99)

        barrier = threading.Barrier(2)
        concurrent: list[bool] = []

        def reserve_at_last_capacity(index: int) -> None:
            barrier.wait()
            concurrent.append(
                self.repository.reserve_login_attempt(f"capacity-{index}", f"203.0.113.{index}", now=clock[0] + 2)
            )

        workers = [threading.Thread(target=reserve_at_last_capacity, args=(index,)) for index in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

        self.assertEqual(concurrent.count(True), 1)
        self.assertEqual(concurrent.count(False), 1)
        self.assertEqual(self.repository.count_failure_rows(), 100)
        self.assertFalse(self.repository.reserve_login_attempt("overflow", "203.0.113.10", now=clock[0] + 2))
        self.assertFalse(self.repository.reserve_login_attempt("blocked", "192.0.2.10", now=clock[0] + 2))

        clock[0] += 15 * 60 + 3
        self.assertTrue(self.repository.reserve_login_attempt("recovered", "203.0.113.20", now=clock[0]))
        self.assertEqual(self.repository.count_failure_rows(), 1)

    def test_hashing_semaphore_is_shared_by_all_service_instances(self) -> None:
        self.provision()
        verification_started = threading.Event()
        continue_verification = threading.Event()

        class BlockingHasher(FastPasswordHasher):
            def verify_password(inner_self, password: str, record: dict) -> bool:
                if threading.current_thread().name == "blocking-login":
                    verification_started.set()
                    continue_verification.wait(timeout=2)
                return super().verify_password(password, record)

        hasher = BlockingHasher()
        first_service = AdminAuthService(self.repository, hasher, now=lambda: 1150.0)
        second_service = AdminAuthService(self.repository, hasher, now=lambda: 1150.0)
        result: list[object] = []
        worker = threading.Thread(
            name="blocking-login",
            target=lambda: result.append(first_service.login("admin", VALID_PASSWORD, "192.0.2.1")),
        )
        worker.start()
        self.assertTrue(verification_started.wait(timeout=2))
        try:
            with self.assertRaises(LoginRateLimited):
                second_service.login("admin", VALID_PASSWORD, "192.0.2.2")
        finally:
            continue_verification.set()
            worker.join(timeout=2)
        self.assertEqual(len(result), 1)

    def test_successful_login_clears_only_its_account_source_failures(self) -> None:
        self.provision()
        self.assertTrue(self.repository.reserve_login_attempt("missing", "192.0.2.1", now=1170.0))

        service = AdminAuthService(self.repository, self.hasher, now=lambda: 1170.0)
        self.assertIsNotNone(service.login("admin", VALID_PASSWORD, "192.0.2.1"))

        self.assertEqual(self.repository.count_failure_rows(), 1)

    def test_reset_wins_against_concurrent_old_password_login(self) -> None:
        self.provision()
        verification_started = threading.Event()
        continue_verification = threading.Event()

        class BlockingHasher(FastPasswordHasher):
            def verify_password(inner_self, password: str, record: dict) -> bool:
                verification_started.set()
                continue_verification.wait(timeout=2)
                return super().verify_password(password, record)

        service = AdminAuthService(self.repository, BlockingHasher(), now=lambda: 1200.0)
        result: list[object] = []
        worker = threading.Thread(target=lambda: result.append(service.login("admin", VALID_PASSWORD, "127.0.0.1")))
        worker.start()
        self.assertTrue(verification_started.wait(timeout=2))
        self.repository.reset_admin_password(self.hasher.hash_password(NEW_PASSWORD), now=1201.0)
        continue_verification.set()
        worker.join(timeout=2)

        self.assertEqual(result, [None])
        self.assertEqual(self.repository.count_sessions(), 0)

    def test_malformed_schema_and_insecure_existing_storage_fail_before_data_access(self) -> None:
        self.database.parent.mkdir()
        self.database.write_text("not sqlite", encoding="utf-8")
        self.permissions.verify.side_effect = StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")

        with self.assertRaisesRegex(AuthUnavailable, "AUTH_STORAGE_UNAVAILABLE") as error:
            self.repository.is_configured()

        self.assertNotIn(str(self.database), str(error.exception))


class AdminCliTests(unittest.TestCase):
    def test_provision_and_reset_use_non_echoing_reader_and_revoke_sessions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "auth" / "admin.sqlite3"
            permissions = Mock()
            passwords = iter((VALID_PASSWORD, VALID_PASSWORD, NEW_PASSWORD, NEW_PASSWORD))
            reader = Mock(side_effect=lambda _prompt: next(passwords))
            hasher = FastPasswordHasher()

            self.assertEqual(run_cli(["provision-admin"], database, reader, hasher, permissions), 0)
            repository = AdminAuthRepository(database, permission_checker=permissions.verify)
            session = AdminAuthService(repository, hasher, now=lambda: 1300.0).login("admin", VALID_PASSWORD, "127.0.0.1")
            self.assertEqual(run_cli(["reset-admin-password"], database, reader, hasher, permissions), 0)
            self.assertIsNone(AdminAuthService(repository, hasher, now=lambda: 1301.0).read_session(session.session_id))
            self.assertEqual(reader.call_count, 4)

    def test_cli_refuses_noninteractive_getpass_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch("prisma_runtime.admin_cli.sys.stdin.isatty", return_value=False):
            with self.assertRaisesRegex(AuthUnavailable, "INTERACTIVE_TERMINAL_REQUIRED"):
                run_cli(["provision-admin"], Path(temporary) / "auth.sqlite3")


if __name__ == "__main__":
    unittest.main()
