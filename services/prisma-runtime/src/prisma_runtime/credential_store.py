"""Encrypted provider credential storage owned by the Prisma admin boundary."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import stat
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, NamedTuple


FORMAT_VERSION = 1
ALLOWED_PROVIDERS = ("gemini", "telegram", "telegram_channel_a")
MAX_SECRET_BYTES = 4096
NONCE_BYTES = 12
TAG_BYTES = 16
SCHEMA_VERSION = 1


class CredentialUnavailable(RuntimeError):
    pass


class InvalidCredential(ValueError):
    pass


class EncryptedCredential(NamedTuple):
    provider: str
    format_version: int
    key_id: str
    nonce: bytes
    ciphertext: bytes


def _unavailable() -> CredentialUnavailable:
    return CredentialUnavailable("CREDENTIAL_STORAGE_UNAVAILABLE")


def _key_id(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()


def _aad(provider: str, key_id: str, format_version: int = FORMAT_VERSION) -> bytes:
    return json.dumps(
        {"formatVersion": format_version, "keyId": key_id, "provider": provider},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def validate_secret(provider: str, secret: str) -> bytes:
    if provider not in ALLOWED_PROVIDERS or not isinstance(secret, str) or not secret.strip():
        raise InvalidCredential("INVALID_CREDENTIAL_REQUEST")
    try:
        encoded = secret.encode("utf-8")
    except UnicodeEncodeError:
        raise InvalidCredential("INVALID_CREDENTIAL_REQUEST") from None
    if not encoded or len(encoded) > MAX_SECRET_BYTES:
        raise InvalidCredential("INVALID_CREDENTIAL_REQUEST")
    return encoded


def validate_key_path(key_file: Path, runtime_root: Path) -> tuple[Path, Path]:
    key_file = Path(key_file)
    runtime_root = Path(runtime_root)
    if not key_file.is_absolute() or not runtime_root.is_absolute():
        raise _unavailable()
    lexical_key = Path(os.path.abspath(key_file))
    lexical_runtime = Path(os.path.abspath(runtime_root))
    try:
        common = os.path.commonpath((lexical_key, lexical_runtime))
        if os.path.normcase(common) == os.path.normcase(str(lexical_runtime)):
            raise _unavailable()
        for target in (lexical_key.parent, lexical_key):
            current = target
            while True:
                try:
                    metadata = os.lstat(current)
                except FileNotFoundError:
                    pass
                else:
                    attributes = getattr(metadata, "st_file_attributes", 0)
                    if stat.S_ISLNK(metadata.st_mode) or bool(attributes & 0x400):
                        raise _unavailable()
                parent = current.parent
                if parent == current:
                    break
                current = parent
    except (OSError, ValueError, CredentialUnavailable):
        raise _unavailable() from None
    return lexical_key, lexical_runtime


def _aesgcm(key: bytes):
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        return AESGCM(key)
    except (ImportError, TypeError, ValueError):
        raise _unavailable() from None


class CredentialCipher:
    def __init__(self, key: bytes, *, nonce_source: Callable[[int], bytes] = os.urandom):
        if not isinstance(key, bytes) or len(key) != 32:
            raise _unavailable()
        self.key = key
        self.key_id = _key_id(key)
        self.nonce_source = nonce_source or os.urandom
        self.aesgcm = _aesgcm(key)

    def encrypt(self, provider: str, secret: str) -> EncryptedCredential:
        plaintext = validate_secret(provider, secret)
        try:
            nonce = self.nonce_source(NONCE_BYTES)
            if not isinstance(nonce, bytes) or len(nonce) != NONCE_BYTES:
                raise _unavailable()
            ciphertext = self.aesgcm.encrypt(nonce, plaintext, _aad(provider, self.key_id))
            return EncryptedCredential(provider, FORMAT_VERSION, self.key_id, nonce, ciphertext)
        except CredentialUnavailable:
            raise
        except Exception:
            raise _unavailable() from None

    def decrypt(self, record: EncryptedCredential) -> str:
        if (
            record.provider not in ALLOWED_PROVIDERS
            or record.format_version != FORMAT_VERSION
            or not hmac.compare_digest(record.key_id, self.key_id)
            or not isinstance(record.nonce, bytes)
            or len(record.nonce) != NONCE_BYTES
            or not isinstance(record.ciphertext, bytes)
            or not TAG_BYTES < len(record.ciphertext) <= MAX_SECRET_BYTES + TAG_BYTES
        ):
            raise _unavailable()
        try:
            plaintext = self.aesgcm.decrypt(
                record.nonce,
                record.ciphertext,
                _aad(record.provider, record.key_id, record.format_version),
            )
            value = plaintext.decode("utf-8")
            validate_secret(record.provider, value)
            return value
        except Exception:
            raise _unavailable() from None


def initialize_credential_database(database: Path, key: bytes, permission_checker: Callable[[Path, Path], None]) -> None:
    database = Path(database)
    try:
        if not isinstance(key, bytes) or len(key) != 32:
            raise _unavailable()
        permission_checker(database.parent, database)
        connection = sqlite3.connect(database, timeout=5)
        try:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                connection.execute(
                    "CREATE TABLE store_binding (singleton INTEGER PRIMARY KEY CHECK(singleton=1), format_version INTEGER NOT NULL, key_id TEXT NOT NULL)"
                )
                connection.execute(
                    "CREATE TABLE credentials (provider TEXT PRIMARY KEY, format_version INTEGER NOT NULL, key_id TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL)"
                )
                connection.execute("INSERT INTO store_binding VALUES (1, ?, ?)", (FORMAT_VERSION, _key_id(key)))
                connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        finally:
            connection.close()
    except Exception:
        raise _unavailable() from None


class CredentialService:
    def __init__(
        self,
        database: Path,
        key_file: Path,
        runtime_root: Path,
        permission_checker: Callable[[Path, Path], None],
        *,
        nonce_source: Callable[[int], bytes] = os.urandom,
    ):
        self.database = Path(database)
        self.key_file = Path(key_file)
        self.runtime_root = Path(runtime_root)
        self.permission_checker = permission_checker
        self.nonce_source = nonce_source

    def _cipher(self) -> CredentialCipher:
        key_file, _ = validate_key_path(self.key_file, self.runtime_root)
        try:
            self.permission_checker(key_file.parent, key_file)
            with key_file.open("rb") as descriptor:
                key = descriptor.read(33)
            if len(key) != 32:
                raise _unavailable()
            return CredentialCipher(key, nonce_source=self.nonce_source)
        except CredentialUnavailable:
            raise
        except Exception:
            raise _unavailable() from None

    @contextmanager
    def _connection(self):
        connection = None
        try:
            self.permission_checker(self.database.parent, self.database)
            connection = sqlite3.connect(self.database, timeout=5)
            connection.row_factory = sqlite3.Row
            if connection.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
                raise _unavailable()
            yield connection
        except CredentialUnavailable:
            raise
        except Exception:
            raise _unavailable() from None
        finally:
            if connection is not None:
                connection.close()

    @staticmethod
    def _validated_values(connection: sqlite3.Connection, cipher: CredentialCipher) -> dict[str, str]:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if tables != {"store_binding", "credentials"}:
            raise _unavailable()
        bindings = connection.execute(
            "SELECT singleton, format_version, key_id, typeof(format_version), typeof(key_id) FROM store_binding"
        ).fetchall()
        if (
            len(bindings) != 1
            or tuple(bindings[0][0:2]) != (1, FORMAT_VERSION)
            or bindings[0][3] != "integer"
            or bindings[0][4] != "text"
            or not isinstance(bindings[0][2], str)
            or len(bindings[0][2]) != 64
            or not hmac.compare_digest(bindings[0][2], cipher.key_id)
        ):
            raise _unavailable()
        metadata = connection.execute(
            "SELECT provider, format_version, key_id, typeof(provider), typeof(format_version), typeof(key_id), typeof(nonce), typeof(ciphertext), length(nonce), length(ciphertext) FROM credentials"
        ).fetchall()
        if len(metadata) > len(ALLOWED_PROVIDERS):
            raise _unavailable()
        values: dict[str, str] = {}
        for row in metadata:
            provider, version, key_id = row[0:3]
            if (
                provider not in ALLOWED_PROVIDERS
                or provider in values
                or version != FORMAT_VERSION
                or not isinstance(key_id, str)
                or len(key_id) != 64
                or tuple(row[3:8]) != ("text", "integer", "text", "blob", "blob")
                or row[8] != NONCE_BYTES
                or not TAG_BYTES < row[9] <= MAX_SECRET_BYTES + TAG_BYTES
            ):
                raise _unavailable()
            payload = connection.execute(
                "SELECT substr(nonce, 1, ?), substr(ciphertext, 1, ?) FROM credentials WHERE provider = ?",
                (NONCE_BYTES + 1, MAX_SECRET_BYTES + TAG_BYTES + 1, provider),
            ).fetchone()
            record = EncryptedCredential(provider, version, key_id, payload[0], payload[1])
            values[provider] = cipher.decrypt(record)
        return values

    def status(self) -> dict[str, bool]:
        cipher = self._cipher()
        with self._connection() as connection:
            connection.execute("BEGIN")
            values = self._validated_values(connection, cipher)
            return {provider: provider in values for provider in ALLOWED_PROVIDERS}

    def set_secret(self, provider: str, secret: str) -> None:
        validate_secret(provider, secret)
        cipher = self._cipher()
        record = cipher.encrypt(provider, secret)
        with self._connection() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                self._validated_values(connection, cipher)
                connection.execute(
                    "INSERT INTO credentials VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET format_version=excluded.format_version, key_id=excluded.key_id, nonce=excluded.nonce, ciphertext=excluded.ciphertext",
                    record,
                )

    def delete_secret(self, provider: str) -> None:
        if provider not in ALLOWED_PROVIDERS:
            raise InvalidCredential("INVALID_CREDENTIAL_REQUEST")
        cipher = self._cipher()
        with self._connection() as connection:
            with connection:
                connection.execute("BEGIN IMMEDIATE")
                self._validated_values(connection, cipher)
                connection.execute("DELETE FROM credentials WHERE provider = ?", (provider,))

    def get_secret(self, provider: str) -> str | None:
        if provider not in ALLOWED_PROVIDERS:
            raise InvalidCredential("INVALID_CREDENTIAL_REQUEST")
        cipher = self._cipher()
        with self._connection() as connection:
            connection.execute("BEGIN")
            return self._validated_values(connection, cipher).get(provider)
