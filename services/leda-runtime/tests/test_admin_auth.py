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

from leda_runtime.admin_auth import (
    MAX_REPLACED_ROWS,
    AdminAuthRepository,
    AdminAuthService,
    AdminSessionActiveElsewhere,
    AuthUnavailable,
    LoginRateLimited,
    PasswordChange,
    PasswordPolicyError,
    ScryptPasswordHasher,
    digest_token,
    login_account_key,
)
from leda_runtime.admin_cli import run_cli
from leda_runtime.storage_permissions import (
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


class AdminSingleSessionTests(unittest.TestCase):
    """Only one administrator session may exist; a second login needs an explicit takeover."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "auth" / "admin.sqlite3"
        self.repository = AdminAuthRepository(self.database, permission_checker=lambda *_: None)
        self.hasher = FastPasswordHasher()
        self.repository.initialize_for_provisioning()
        self.repository.provision_admin("admin", self.hasher.hash_password(VALID_PASSWORD), now=1000.0)
        self.clock = [1010.0]
        self.service = AdminAuthService(
            self.repository, self.hasher, now=lambda: self.clock[0], idle_seconds=100, absolute_seconds=1000
        )

    def test_second_login_without_takeover_is_refused_and_creates_no_session(self) -> None:
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")

        with self.assertRaises(AdminSessionActiveElsewhere):
            self.service.login("admin", VALID_PASSWORD, "192.0.2.9")

        self.assertEqual(self.repository.count_sessions(), 1)
        self.assertIsNotNone(self.service.read_session(first.session_id))
        self.assertFalse(self.service.was_session_replaced(first.session_id))

    def test_takeover_revokes_the_other_session_and_marks_it_replaced(self) -> None:
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")

        second = self.service.login("admin", VALID_PASSWORD, "192.0.2.9", takeover=True)

        self.assertIsNotNone(second)
        self.assertEqual(self.repository.count_sessions(), 1)
        self.assertIsNone(self.service.read_session(first.session_id))
        self.assertTrue(self.service.was_session_replaced(first.session_id))
        self.assertIsNotNone(self.service.read_session(second.session_id))
        self.assertFalse(self.service.was_session_replaced(second.session_id))

    def test_takeover_without_another_session_is_a_plain_login(self) -> None:
        session = self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)

        self.assertIsNotNone(session)
        self.assertEqual(self.repository.count_sessions(), 1)

    def test_expired_other_sessions_do_not_block_login_and_are_not_reported_as_replaced(self) -> None:
        idle = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.clock[0] = 1010.0 + 100
        replacement = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.assertIsNotNone(replacement)
        self.assertIsNone(self.service.read_session(idle.session_id))
        self.assertFalse(self.service.was_session_replaced(idle.session_id))

        self.clock[0] = 1010.0 + 1000 + 1
        absolute = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.assertIsNotNone(absolute)
        self.assertEqual(self.repository.count_sessions(), 1)

    def test_wrong_password_never_reveals_an_active_session(self) -> None:
        self.service.login("admin", VALID_PASSWORD, "127.0.0.1")

        for takeover in (False, True):
            with self.subTest(takeover=takeover):
                self.assertIsNone(self.service.login("admin", "wrong but sufficiently long", "192.0.2.9", takeover=takeover))
                self.assertIsNone(self.service.login("other", VALID_PASSWORD, "192.0.2.9", takeover=takeover))
        self.assertEqual(self.repository.count_sessions(), 1)

    def test_refused_login_still_clears_the_failure_budget_of_a_verified_password(self) -> None:
        self.service.login("admin", VALID_PASSWORD, "127.0.0.1")

        with self.assertRaises(AdminSessionActiveElsewhere):
            self.service.login("admin", VALID_PASSWORD, "192.0.2.9")

        self.assertEqual(self.repository.count_failure_rows(), 0)

    def test_takeover_is_atomic_when_the_new_session_cannot_be_written(self) -> None:
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript(
                "CREATE TRIGGER refuse_insert BEFORE INSERT ON admin_sessions "
                "BEGIN SELECT RAISE(ABORT, 'refused'); END;"
            )

        with self.assertRaisesRegex(AuthUnavailable, "AUTH_STORAGE_UNAVAILABLE"):
            self.service.login("admin", VALID_PASSWORD, "192.0.2.9", takeover=True)

        self.assertIsNotNone(self.service.read_session(first.session_id))
        self.assertFalse(self.service.was_session_replaced(first.session_id))

    def test_replaced_markers_expire_with_the_replaced_session_and_stay_bounded(self) -> None:
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        second = self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)
        self.assertTrue(self.service.was_session_replaced(first.session_id))

        self.clock[0] = 1010.0 + 1000 + 1
        self.assertFalse(self.service.was_session_replaced(first.session_id))

        self.clock[0] = 1010.0 + 1
        current = second
        for _ in range(MAX_REPLACED_ROWS + 5):
            current = self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)
        with closing(sqlite3.connect(self.database)) as connection:
            count = connection.execute("SELECT COUNT(*) FROM replaced_sessions").fetchone()[0]
        self.assertLessEqual(count, MAX_REPLACED_ROWS)
        self.assertIsNotNone(self.service.read_session(current.session_id))

    def test_a_database_provisioned_before_this_rule_gains_the_marker_table_lazily(self) -> None:
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("DROP TABLE replaced_sessions")
            connection.commit()
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.assertFalse(self.service.was_session_replaced(first.session_id))

        self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)

        self.assertTrue(self.service.was_session_replaced(first.session_id))


    def test_the_replaced_lookup_is_a_pure_read_that_needs_no_write_lock(self) -> None:
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)
        locker = sqlite3.connect(self.database, timeout=0.1)
        self.addCleanup(locker.close)
        locker.execute("BEGIN IMMEDIATE")

        started = time.perf_counter()
        self.assertTrue(self.service.was_session_replaced(first.session_id))
        self.assertFalse(self.service.was_session_replaced("a forged cookie value"))

        self.assertLess(time.perf_counter() - started, 1.0)

    def test_the_replaced_lookup_neither_creates_the_table_nor_purges_markers(self) -> None:
        first = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)
        self.clock[0] = 1010.0 + 1000 + 1

        self.assertFalse(self.service.was_session_replaced(first.session_id))

        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM replaced_sessions").fetchone()[0], 1)
            connection.execute("DROP TABLE replaced_sessions")
            connection.commit()
        self.assertFalse(self.service.was_session_replaced(first.session_id))
        with closing(sqlite3.connect(self.database)) as connection:
            tables = connection.execute("SELECT name FROM sqlite_master WHERE name = 'replaced_sessions'").fetchall()
        self.assertEqual(tables, [])

    def test_schema_init_adds_the_marker_table_to_a_database_that_lacks_it(self) -> None:
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute("DROP TABLE replaced_sessions")
            connection.commit()

        self.repository.initialize_for_provisioning()

        with closing(sqlite3.connect(self.database)) as connection:
            self.assertIsNotNone(
                connection.execute("SELECT 1 FROM sqlite_master WHERE name = 'replaced_sessions'").fetchone()
            )

    def test_an_idle_expired_session_does_not_trigger_the_active_elsewhere_refusal(self) -> None:
        self.service.login("admin", VALID_PASSWORD, "127.0.0.1")
        self.clock[0] = 1010.0 + 100

        self.assertIsNotNone(self.service.login("admin", VALID_PASSWORD, "192.0.2.9"))

class LoginAccountKeyTests(unittest.TestCase):
    def test_the_key_is_the_digest_of_the_trimmed_casefolded_username(self) -> None:
        self.assertEqual(login_account_key("  Admin  "), digest_token("admin"))
        self.assertEqual(login_account_key("ADMIN"), login_account_key("admin"))
        self.assertNotEqual(login_account_key("admin"), login_account_key("other"))


class AdminPasswordChangeTests(unittest.TestCase):
    """The administrator changes their own password while keeping the calling session."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.database = Path(self.temporary.name) / "auth" / "admin.sqlite3"
        self.repository = AdminAuthRepository(self.database, permission_checker=lambda *_: None)
        self.hasher = FastPasswordHasher()
        self.repository.initialize_for_provisioning()
        self.repository.provision_admin("admin", self.hasher.hash_password(VALID_PASSWORD), now=1000.0)
        self.clock = [1010.0]
        self.service = AdminAuthService(
            self.repository, self.hasher, now=lambda: self.clock[0], idle_seconds=100, absolute_seconds=1000
        )
        self.session = self.service.login("admin", VALID_PASSWORD, "127.0.0.1")

    def add_other_session(self, name: str = "other-session") -> str:
        with closing(sqlite3.connect(self.database)) as connection, connection:
            connection.execute(
                "INSERT INTO admin_sessions VALUES (?, ?, 'admin', ?, ?, ?)",
                (digest_token(name), "csrf", 1010.0, 1010.0, 2000.0),
            )
        return name

    def change(self, current: str = VALID_PASSWORD, new: str = NEW_PASSWORD, source: str = "127.0.0.1"):
        return self.service.change_password(self.session.session_id, current, new, source)

    def test_success_stores_the_new_password_and_keeps_only_the_calling_session(self) -> None:
        other = self.add_other_session()

        self.assertIs(self.change(), PasswordChange.CHANGED)

        self.assertIsNotNone(self.service.read_session(self.session.session_id))
        self.assertIsNone(self.service.read_session(other))
        self.assertEqual(self.repository.count_sessions(), 1)
        self.assertIsNone(self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True))
        self.assertIsNotNone(self.service.login("admin", NEW_PASSWORD, "127.0.0.1", takeover=True))

    def test_revoked_sessions_are_not_marked_as_replaced(self) -> None:
        other = self.add_other_session()

        self.change()

        self.assertFalse(self.service.was_session_replaced(other))

    def test_the_credential_version_is_bumped(self) -> None:
        before = self.repository.login_snapshot()[2]

        self.change()

        self.assertEqual(self.repository.login_snapshot()[2], before + 1)

    def test_wrong_current_password_changes_nothing_and_counts_as_a_failed_attempt(self) -> None:
        other = self.add_other_session()

        outcome = self.change(current="wrong but sufficiently long password")

        self.assertIs(outcome, PasswordChange.WRONG_CURRENT_PASSWORD)
        self.assertEqual(self.repository.count_failure_rows(), 1)
        self.assertIsNotNone(self.service.read_session(other))
        self.assertIsNotNone(self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True))

    def test_repeated_wrong_current_passwords_exhaust_the_login_budget(self) -> None:
        for _ in range(5):
            self.assertIs(self.change(current="wrong but sufficiently long password"), PasswordChange.WRONG_CURRENT_PASSWORD)

        with self.assertRaises(LoginRateLimited):
            self.change()
        with self.assertRaises(LoginRateLimited):
            self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True)

    def test_an_oversized_current_password_is_a_wrong_password_not_an_error(self) -> None:
        self.assertIs(self.change(current="x" * 1025), PasswordChange.WRONG_CURRENT_PASSWORD)

    def test_success_clears_the_failure_budget_of_that_source(self) -> None:
        self.change(current="wrong but sufficiently long password")

        self.assertIs(self.change(), PasswordChange.CHANGED)

        self.assertEqual(self.repository.count_failure_rows(), 0)

    def test_policy_violations_are_rejected_before_any_attempt_is_counted(self) -> None:
        for candidate in ("too short", "x" * 1025):
            with self.subTest(length=len(candidate)), self.assertRaisesRegex(PasswordPolicyError, "PASSWORD_POLICY_REJECTED"):
                self.change(new=candidate)

        self.assertEqual(self.repository.count_failure_rows(), 0)
        self.assertIsNotNone(self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True))

    def test_the_policy_is_the_one_the_cli_hasher_enforces(self) -> None:
        for candidate in ("x" * 14, "x" * 15, "é" * 14, "é" * 512, "é" * 513):
            with self.subTest(length=len(candidate)):
                try:
                    ScryptPasswordHasher(scrypt_fn=Mock(return_value=b"x" * 32)).hash_password(candidate)
                    cli_accepts = True
                except PasswordPolicyError:
                    cli_accepts = False
                try:
                    self.change(new=candidate)
                    service_accepts = True
                except PasswordPolicyError:
                    service_accepts = False
                self.assertEqual(service_accepts, cli_accepts)
                if service_accepts:  # the session survives a change, so the next candidate can start from here
                    self.assertIsNotNone(self.service.read_session(self.session.session_id))
                    self.assertIs(self.change(current=candidate, new=VALID_PASSWORD), PasswordChange.CHANGED)

    def test_an_unchanged_password_is_refused_without_counting_an_attempt(self) -> None:
        with self.assertRaisesRegex(PasswordPolicyError, "PASSWORD_UNCHANGED"):
            self.change(new=VALID_PASSWORD)

        self.assertEqual(self.repository.count_failure_rows(), 0)

    def test_a_caller_session_that_ended_gets_no_change(self) -> None:
        self.service.revoke_session(self.session.session_id, self.session.csrf_token)

        self.assertIs(self.change(), PasswordChange.SESSION_ENDED)

        self.assertIsNotNone(self.service.login("admin", VALID_PASSWORD, "127.0.0.1"))

    def test_the_change_is_atomic_when_the_store_refuses_the_write(self) -> None:
        other = self.add_other_session()
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript(
                "CREATE TRIGGER refuse_update BEFORE UPDATE ON administrator "
                "BEGIN SELECT RAISE(ABORT, 'refused'); END;"
            )

        with self.assertRaisesRegex(AuthUnavailable, "AUTH_STORAGE_UNAVAILABLE"):
            self.change()

        self.assertIsNotNone(self.service.read_session(other))
        self.assertIsNotNone(self.service.read_session(self.session.session_id))
        self.assertIsNotNone(self.service.login("admin", VALID_PASSWORD, "127.0.0.1", takeover=True))

    def test_a_reset_that_lands_during_verification_wins(self) -> None:
        verify = self.hasher.verify_password

        def verify_then_reset(password, record):
            result = verify(password, record)
            self.repository.reset_admin_password(self.hasher.hash_password("a reset administrator password"), now=1015.0)
            return result

        with patch.object(self.hasher, "verify_password", verify_then_reset):
            outcome = self.change()

        self.assertIs(outcome, PasswordChange.SESSION_ENDED)
        self.assertIsNotNone(self.service.login("admin", "a reset administrator password", "127.0.0.1"))


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
        with tempfile.TemporaryDirectory() as temporary, patch("leda_runtime.admin_cli.sys.stdin.isatty", return_value=False):
            with self.assertRaisesRegex(AuthUnavailable, "INTERACTIVE_TERMINAL_REQUIRED"):
                run_cli(["provision-admin"], Path(temporary) / "auth.sqlite3")


if __name__ == "__main__":
    unittest.main()
