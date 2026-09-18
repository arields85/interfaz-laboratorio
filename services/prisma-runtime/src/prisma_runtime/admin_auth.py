"""Application-owned Prisma administrator authentication primitives."""

from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


SCHEMA_VERSION = 1
SCRYPT_PARAMETERS = {"n": 2**15, "r": 8, "p": 3, "maxmem": 64 * 1024 * 1024, "dklen": 32}
FAILURE_WINDOW_SECONDS = 15 * 60
ACCOUNT_FAILURE_LIMIT = 5
SOURCE_FAILURE_LIMIT = 20
MAX_FAILURE_ROWS = 100
_HASH_SLOT = threading.BoundedSemaphore(1)


class AuthUnavailable(RuntimeError):
    pass


class AuthNotConfigured(AuthUnavailable):
    pass


class LoginRateLimited(RuntimeError):
    pass


class PasswordPolicyError(ValueError):
    pass


@dataclass(frozen=True)
class AuthSession:
    session_id: str
    csrf_token: str
    username: str
    created_at: float
    last_seen_at: float
    absolute_expires_at: float


class ScryptPasswordHasher:
    def __init__(self, scrypt_fn: Callable | None = hashlib.scrypt):
        self._scrypt = scrypt_fn

    @staticmethod
    def _password_bytes(password: str, *, provisioning: bool) -> bytes:
        if not isinstance(password, str):
            raise PasswordPolicyError("PASSWORD_INVALID")
        encoded = password.encode("utf-8")
        if len(encoded) > 1024 or (provisioning and len(password) < 15):
            raise PasswordPolicyError("PASSWORD_POLICY_REJECTED")
        return encoded

    def _derive(self, password: bytes, salt: bytes) -> bytes:
        if self._scrypt is None:
            raise AuthUnavailable("AUTH_HASHING_UNAVAILABLE")
        try:
            return self._scrypt(password, salt=salt, **SCRYPT_PARAMETERS)
        except (TypeError, ValueError, MemoryError):
            raise AuthUnavailable("AUTH_HASHING_UNAVAILABLE") from None

    def hash_password(self, password: str) -> dict:
        encoded = self._password_bytes(password, provisioning=True)
        salt = secrets.token_bytes(16)
        digest = self._derive(encoded, salt)
        return {
            "algorithm": "scrypt",
            "version": 1,
            **SCRYPT_PARAMETERS,
            "salt": salt.hex(),
            "digest": digest.hex(),
        }

    def verify_password(self, password: str, record: dict) -> bool:
        encoded = self._password_bytes(password, provisioning=False)
        expected_keys = {"algorithm", "version", *SCRYPT_PARAMETERS, "salt", "digest"}
        if set(record) != expected_keys or record.get("algorithm") != "scrypt" or record.get("version") != 1:
            raise AuthUnavailable("AUTH_PASSWORD_RECORD_INVALID")
        if any(record.get(key) != value for key, value in SCRYPT_PARAMETERS.items()):
            raise AuthUnavailable("AUTH_PASSWORD_RECORD_INVALID")
        try:
            salt = bytes.fromhex(record["salt"])
            expected = bytes.fromhex(record["digest"])
        except (TypeError, ValueError):
            raise AuthUnavailable("AUTH_PASSWORD_RECORD_INVALID") from None
        if len(salt) != 16 or len(expected) != SCRYPT_PARAMETERS["dklen"]:
            raise AuthUnavailable("AUTH_PASSWORD_RECORD_INVALID")
        return hmac.compare_digest(self._derive(encoded, salt), expected)


class AdminAuthRepository:
    def __init__(self, database: Path, *, permission_checker: Callable[[Path, Path], None]):
        self.database = Path(database)
        self.permission_checker = permission_checker

    def _assert_storage(self) -> None:
        try:
            self.permission_checker(self.database.parent, self.database)
        except Exception:
            raise AuthUnavailable("AUTH_STORAGE_UNAVAILABLE") from None

    def _connect(self) -> sqlite3.Connection:
        self._assert_storage()
        connection = None
        try:
            connection = sqlite3.connect(self.database, timeout=5)
            connection.row_factory = sqlite3.Row
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version != SCHEMA_VERSION:
                raise AuthUnavailable("AUTH_STORAGE_UNAVAILABLE")
            return connection
        except (OSError, sqlite3.Error, AuthUnavailable):
            if connection is not None:
                connection.close()
            raise AuthUnavailable("AUTH_STORAGE_UNAVAILABLE") from None

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def _translate_database_error(operation: Callable):
        try:
            return operation()
        except AuthUnavailable:
            raise
        except (OSError, sqlite3.Error, json.JSONDecodeError, TypeError, ValueError):
            raise AuthUnavailable("AUTH_STORAGE_UNAVAILABLE") from None

    def initialize_for_provisioning(self) -> None:
        if not self.database.exists():
            self.database.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            descriptor = self.database.open("xb")
            descriptor.close()
            if os_name() != "nt":
                self.database.parent.chmod(0o700)
                self.database.chmod(0o600)
        self._assert_storage()

        def initialize() -> None:
            connection = sqlite3.connect(self.database, timeout=5)
            try:
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                if version not in (0, SCHEMA_VERSION) or (version == 0 and tables):
                    raise AuthUnavailable("AUTH_STORAGE_UNAVAILABLE")
                connection.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS administrator (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        username TEXT NOT NULL,
                        password_record TEXT NOT NULL,
                        credential_version INTEGER NOT NULL,
                        updated_at REAL NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS admin_sessions (
                        session_id_hash TEXT PRIMARY KEY,
                        csrf_token TEXT NOT NULL,
                        username TEXT NOT NULL,
                        created_at REAL NOT NULL,
                        last_seen_at REAL NOT NULL,
                        absolute_expires_at REAL NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS login_failures (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        account_key TEXT NOT NULL,
                        source TEXT NOT NULL,
                        failed_at REAL NOT NULL
                    );
                    PRAGMA user_version = 1;
                    """
                )
                connection.commit()
            finally:
                connection.close()

        self._translate_database_error(initialize)

    def is_configured(self) -> bool:
        if not self.database.exists():
            return False

        def query() -> bool:
            with self._connection() as connection:
                return connection.execute("SELECT 1 FROM administrator WHERE singleton = 1").fetchone() is not None

        return self._translate_database_error(query)

    def provision_admin(self, username: str, password_record: dict, *, now: float) -> None:
        def write() -> None:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                if connection.execute("SELECT 1 FROM administrator").fetchone() is not None:
                    raise AuthUnavailable("AUTH_ALREADY_CONFIGURED")
                connection.execute(
                    "INSERT INTO administrator VALUES (1, ?, ?, 1, ?)",
                    (username, json.dumps(password_record, sort_keys=True, separators=(",", ":")), now),
                )

        self._translate_database_error(write)

    def reset_admin_password(self, password_record: dict, *, now: float) -> None:
        def write() -> None:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                result = connection.execute(
                    "UPDATE administrator SET password_record = ?, credential_version = credential_version + 1, updated_at = ? WHERE singleton = 1",
                    (json.dumps(password_record, sort_keys=True, separators=(",", ":")), now),
                )
                if result.rowcount != 1:
                    raise AuthNotConfigured("AUTH_NOT_CONFIGURED")
                connection.execute("DELETE FROM admin_sessions")
                connection.execute("DELETE FROM login_failures")

        self._translate_database_error(write)

    def reserve_login_attempt(self, username: str, source: str, *, now: float) -> bool:
        def reserve() -> bool:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                cutoff = now - FAILURE_WINDOW_SECONDS
                account_key = digest_token(username.strip().casefold())
                connection.execute("DELETE FROM login_failures WHERE failed_at <= ?", (cutoff,))
                account_count = connection.execute(
                    "SELECT COUNT(*) FROM login_failures WHERE account_key = ? AND source = ?",
                    (account_key, source),
                ).fetchone()[0]
                source_count = connection.execute("SELECT COUNT(*) FROM login_failures WHERE source = ?", (source,)).fetchone()[0]
                if account_count >= ACCOUNT_FAILURE_LIMIT or source_count >= SOURCE_FAILURE_LIMIT:
                    return False
                live_count = connection.execute("SELECT COUNT(*) FROM login_failures").fetchone()[0]
                if live_count >= MAX_FAILURE_ROWS:
                    return False
                connection.execute(
                    "INSERT INTO login_failures(account_key, source, failed_at) VALUES (?, ?, ?)",
                    (account_key, source, now),
                )
                return True

        return self._translate_database_error(reserve)

    def login_snapshot(self) -> tuple[str, dict, int]:
        def query() -> tuple[str, dict, int]:
            with self._connection() as connection:
                row = connection.execute(
                    "SELECT username, password_record, credential_version FROM administrator WHERE singleton = 1"
                ).fetchone()
                if row is None:
                    raise AuthNotConfigured("AUTH_NOT_CONFIGURED")
                return row["username"], json.loads(row["password_record"]), row["credential_version"]

        return self._translate_database_error(query)

    def create_session_if_version(
        self,
        credential_version: int,
        session: AuthSession,
        source: str,
    ) -> bool:
        def write() -> bool:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute("SELECT credential_version FROM administrator WHERE singleton = 1").fetchone()
                if row is None or row[0] != credential_version:
                    return False
                connection.execute(
                    "DELETE FROM login_failures WHERE account_key = ? AND source = ?",
                    (digest_token(session.username.strip().casefold()), source),
                )
                connection.execute(
                    "INSERT INTO admin_sessions VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        digest_token(session.session_id),
                        session.csrf_token,
                        session.username,
                        session.created_at,
                        session.last_seen_at,
                        session.absolute_expires_at,
                    ),
                )
                return True

        return self._translate_database_error(write)

    def read_session(self, session_id: str, *, now: float, idle_seconds: int) -> AuthSession | None:
        def read() -> AuthSession | None:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                token_hash = digest_token(session_id)
                row = connection.execute("SELECT * FROM admin_sessions WHERE session_id_hash = ?", (token_hash,)).fetchone()
                if row is None:
                    return None
                if now >= row["absolute_expires_at"] or now - row["last_seen_at"] >= idle_seconds:
                    connection.execute("DELETE FROM admin_sessions WHERE session_id_hash = ?", (token_hash,))
                    return None
                connection.execute("UPDATE admin_sessions SET last_seen_at = ? WHERE session_id_hash = ?", (now, token_hash))
                return AuthSession(
                    session_id=session_id,
                    csrf_token=row["csrf_token"],
                    username=row["username"],
                    created_at=row["created_at"],
                    last_seen_at=now,
                    absolute_expires_at=row["absolute_expires_at"],
                )

        return self._translate_database_error(read)

    def revoke_session(self, session_id: str, csrf_token: str) -> bool:
        def revoke() -> bool:
            with self._connection() as connection:
                connection.execute("BEGIN IMMEDIATE")
                token_hash = digest_token(session_id)
                row = connection.execute("SELECT csrf_token FROM admin_sessions WHERE session_id_hash = ?", (token_hash,)).fetchone()
                if row is None or not hmac.compare_digest(row[0], csrf_token):
                    return False
                connection.execute("DELETE FROM admin_sessions WHERE session_id_hash = ?", (token_hash,))
                return True

        return self._translate_database_error(revoke)

    def count_failure_rows(self) -> int:
        with self._connection() as connection:
            return connection.execute("SELECT COUNT(*) FROM login_failures").fetchone()[0]

    def count_sessions(self) -> int:
        with self._connection() as connection:
            return connection.execute("SELECT COUNT(*) FROM admin_sessions").fetchone()[0]


class AdminAuthService:
    def __init__(
        self,
        repository: AdminAuthRepository,
        hasher,
        *,
        now: Callable[[], float] = time.time,
        idle_seconds: int = 15 * 60,
        absolute_seconds: int = 8 * 60 * 60,
    ):
        self.repository = repository
        self.hasher = hasher
        self.now = now
        self.idle_seconds = idle_seconds
        self.absolute_seconds = absolute_seconds
        self._hash_slot = _HASH_SLOT

    def is_configured(self) -> bool:
        return self.repository.is_configured()

    def login(self, username: str, password: str, source: str) -> AuthSession | None:
        if not self._hash_slot.acquire(blocking=False):
            raise LoginRateLimited("LOGIN_RATE_LIMITED")
        try:
            now = self.now()
            if not self.repository.reserve_login_attempt(username, source, now=now):
                raise LoginRateLimited("LOGIN_RATE_LIMITED")
            stored_username, password_record, credential_version = self.repository.login_snapshot()
            password_ok = self.hasher.verify_password(password, password_record)
            if not password_ok or not hmac.compare_digest(str(username), stored_username):
                return None
            session = AuthSession(
                session_id=secrets.token_urlsafe(32),
                csrf_token=secrets.token_urlsafe(32),
                username=stored_username,
                created_at=now,
                last_seen_at=now,
                absolute_expires_at=now + self.absolute_seconds,
            )
            return session if self.repository.create_session_if_version(credential_version, session, source) else None
        finally:
            self._hash_slot.release()

    def read_session(self, session_id: str) -> AuthSession | None:
        if not session_id:
            return None
        return self.repository.read_session(session_id, now=self.now(), idle_seconds=self.idle_seconds)

    def revoke_session(self, session_id: str, csrf_token: str) -> bool:
        if not session_id or not csrf_token:
            return False
        return self.repository.revoke_session(session_id, csrf_token)


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def os_name() -> str:
    import os

    return os.name
