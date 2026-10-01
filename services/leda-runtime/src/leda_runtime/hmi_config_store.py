"""Shared HMI configuration document: key -> JSON string value plus one global revision.

This persists the HMI's own configuration (what an administrator configures in the
browser) so every browser reads the same document. It never touches the plant.
"""

from __future__ import annotations

import re
import sqlite3
import threading
from contextlib import closing, contextmanager
from pathlib import Path
from typing import Iterable, Iterator, Mapping

MAX_KEY_LENGTH = 128
MAX_VALUE_BYTES = 4 * 1024 * 1024
MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
MAX_BATCH_OPERATIONS = 200
MAX_KEYS = 512
KEY_PATTERN = re.compile(r"^[A-Za-z0-9:._-]+$")
BUSY_TIMEOUT_SECONDS = 5.0
# Prisma -> Leda rename: shared keys that changed name. Migrated once when the store is
# opened (see _migrate_legacy_keys); this is the only place that still names the old keys.
LEGACY_PRISMA_KEY_RENAMES: tuple[tuple[str, str], ...] = (
    ("hmi:prisma-hmi-name", "hmi:leda-hmi-name"),
    ("hmi:prisma-orb-visual-config", "hmi:leda-orb-visual-config"),
)


class HmiConfigInvalid(ValueError):
    pass


class HmiConfigTooLarge(ValueError):
    """Carries the closed wire code of the exceeded bound as ``args[0]``."""


class HmiConfigUnavailable(RuntimeError):
    pass


def _validate_key(key: object) -> str:
    if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH or not KEY_PATTERN.fullmatch(key):
        raise HmiConfigInvalid("HMI_CONFIG_INVALID_REQUEST")
    return key


def _validate_value(value: object) -> str:
    if not isinstance(value, str):
        raise HmiConfigInvalid("HMI_CONFIG_INVALID_REQUEST")
    try:
        size = len(value.encode("utf-8"))
    except UnicodeEncodeError:
        raise HmiConfigInvalid("HMI_CONFIG_INVALID_REQUEST") from None
    if size > MAX_VALUE_BYTES:
        raise HmiConfigTooLarge("HMI_CONFIG_VALUE_TOO_LARGE")
    return value


class HmiConfigStore:
    """SQLite-backed document. The file is created lazily on first use."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._schema_ready = False
        self._schema_lock = threading.Lock()

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        try:
            with closing(self._open()) as connection:
                yield connection
        except (sqlite3.Error, OSError) as error:
            raise HmiConfigUnavailable("HMI_CONFIG_UNAVAILABLE") from error

    def _open(self) -> sqlite3.Connection:
        """Open a connection; the schema is created and seeded once, so reads stay pure reads."""
        if not self._schema_ready:
            with self._schema_lock:
                if not self._schema_ready:
                    self.path.parent.mkdir(parents=True, exist_ok=True)
                    with closing(sqlite3.connect(self.path, timeout=BUSY_TIMEOUT_SECONDS, isolation_level=None)) as setup:
                        setup.executescript(
                            "CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
                            "CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL);"
                            "INSERT OR IGNORE INTO meta (id, revision) VALUES (1, 0);"
                        )
                        self._migrate_legacy_keys(setup)
                    self._schema_ready = True
        return sqlite3.connect(self.path, timeout=BUSY_TIMEOUT_SECONDS, isolation_level=None)

    @staticmethod
    def _migrate_legacy_keys(connection: sqlite3.Connection) -> None:
        """Copy each legacy key to its new name when absent, drop the old key, bump the revision once."""
        placeholders = ", ".join("?" for _ in LEGACY_PRISMA_KEY_RENAMES)
        legacy_keys = [old for old, _ in LEGACY_PRISMA_KEY_RENAMES]
        if connection.execute(f"SELECT 1 FROM config WHERE key IN ({placeholders}) LIMIT 1", legacy_keys).fetchone() is None:
            return
        connection.execute("BEGIN IMMEDIATE")
        try:
            for old, new in LEGACY_PRISMA_KEY_RENAMES:
                row = connection.execute("SELECT value FROM config WHERE key = ?", (old,)).fetchone()
                if row is None:
                    continue
                connection.execute("INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)", (new, row[0]))
                connection.execute("DELETE FROM config WHERE key = ?", (old,))
            connection.execute("UPDATE meta SET revision = revision + 1 WHERE id = 1")
        except BaseException:
            connection.execute("ROLLBACK")
            raise
        connection.execute("COMMIT")

    def read_revision(self) -> int:
        with self._connection() as connection:
            return connection.execute("SELECT revision FROM meta WHERE id = 1").fetchone()[0]

    def read_document(self) -> tuple[int, dict[str, str]]:
        with self._connection() as connection:
            connection.execute("BEGIN")
            try:
                revision = connection.execute("SELECT revision FROM meta WHERE id = 1").fetchone()[0]
                items = dict(connection.execute("SELECT key, value FROM config").fetchall())
            finally:
                connection.execute("COMMIT")
            return revision, items

    def apply_batch(self, sets: Mapping[str, str], deletes: Iterable[str]) -> int:
        """Apply every set and delete in one transaction and bump the revision once."""
        deletes = list(deletes)
        if not isinstance(sets, Mapping) or (not sets and not deletes):
            raise HmiConfigInvalid("HMI_CONFIG_INVALID_REQUEST")
        if len(sets) + len(deletes) > MAX_BATCH_OPERATIONS:
            raise HmiConfigInvalid("HMI_CONFIG_INVALID_REQUEST")
        valid_sets = {_validate_key(key): _validate_value(value) for key, value in sets.items()}
        valid_deletes = [_validate_key(key) for key in deletes]
        if set(valid_sets) & set(valid_deletes):
            raise HmiConfigInvalid("HMI_CONFIG_INVALID_REQUEST")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                connection.executemany("DELETE FROM config WHERE key = ?", [(key,) for key in valid_deletes])
                connection.executemany(
                    "INSERT INTO config (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    list(valid_sets.items()),
                )
                keys, size = connection.execute(
                    "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) FROM config"
                ).fetchone()
                if keys > MAX_KEYS or size > MAX_DOCUMENT_BYTES:
                    raise HmiConfigTooLarge("HMI_CONFIG_DOCUMENT_TOO_LARGE")
                connection.execute("UPDATE meta SET revision = revision + 1 WHERE id = 1")
                revision = connection.execute("SELECT revision FROM meta WHERE id = 1").fetchone()[0]
            except BaseException:
                connection.execute("ROLLBACK")
                raise
            connection.execute("COMMIT")
            return revision
