"""Explicit-path, secret-free desired configuration for Channel A.

The caller owns the parent directory. Construction and absent reads never
create it or backfill a file. One store serializes its own read/modify/replace
operations; coordinating external writers is deliberately not its contract.
"""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

PRISMA_CHANNEL_A_CONFIGURATION_INVALID = "PRISMA_CHANNEL_A_CONFIGURATION_INVALID"
PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE = "PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE"
MAX_DESIRED_GENERATION = 2**53 - 1
DEFAULT_WARNING_LEAD_SECONDS = 60
MIN_WARNING_LEAD_SECONDS = 15
MAX_WARNING_LEAD_SECONDS = 300
_DOCUMENT_KEYS = frozenset({"version", "warningLeadSeconds", "desiredGeneration"})


class ChannelAConfigurationError(RuntimeError):
    """A fixed configuration error, without storage details."""


def _validate_warning(value) -> None:
    if type(value) is not int or not MIN_WARNING_LEAD_SECONDS <= value <= MAX_WARNING_LEAD_SECONDS:
        raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_INVALID)


@dataclass(frozen=True, slots=True)
class ChannelAConfiguration:
    warning_lead_seconds: int = DEFAULT_WARNING_LEAD_SECONDS
    desired_generation: int = 0

    def __post_init__(self) -> None:
        _validate_warning(self.warning_lead_seconds)
        if type(self.desired_generation) is not int or not 0 <= self.desired_generation <= MAX_DESIRED_GENERATION:
            raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_INVALID)


def _unique_document(pairs):
    document = {}
    for key, value in pairs:
        if key in document:
            raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_INVALID)
        document[key] = value
    return document


class ChannelAConfigurationStore:
    def __init__(self, path) -> None:
        self._path = Path(path)
        self._lock = RLock()

    def read(self) -> ChannelAConfiguration:
        with self._lock:
            return self._read()

    def _read(self) -> ChannelAConfiguration:
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return ChannelAConfiguration()
        except UnicodeError:
            raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_INVALID) from None
        except Exception:
            raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE) from None
        try:
            document = json.loads(raw, object_pairs_hook=_unique_document)
            if (
                type(document) is not dict
                or document.keys() != _DOCUMENT_KEYS
                or type(document["version"]) is not int
                or document["version"] != 1
            ):
                raise ValueError
            return ChannelAConfiguration(document["warningLeadSeconds"], document["desiredGeneration"])
        except Exception:
            raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_INVALID) from None

    def set_warning_lead(self, value) -> ChannelAConfiguration:
        _validate_warning(value)
        with self._lock:
            current = self._read()
            if value == current.warning_lead_seconds:
                return current
            return self._write(ChannelAConfiguration(value, current.desired_generation + 1))

    def advance_generation(self) -> ChannelAConfiguration:
        with self._lock:
            current = self._read()
            return self._write(ChannelAConfiguration(
                current.warning_lead_seconds, current.desired_generation + 1,
            ))

    def _write(self, snapshot: ChannelAConfiguration) -> ChannelAConfiguration:
        owned_path = None
        descriptor = None
        try:
            payload = json.dumps({
                "version": 1,
                "warningLeadSeconds": snapshot.warning_lead_seconds,
                "desiredGeneration": snapshot.desired_generation,
            }, separators=(",", ":")) + "\n"
            descriptor, name = tempfile.mkstemp(prefix=".channel-a-", suffix=".tmp", dir=self._path.parent)
            owned_path = Path(name)
            stream = os.fdopen(descriptor, "w", encoding="utf-8")
            descriptor = None  # The stream now owns the descriptor, including failures.
            with stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(owned_path, self._path)
            owned_path = None
        except Exception:
            raise ChannelAConfigurationError(PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE) from None
        finally:
            # Never enumerate siblings or clean a path this operation did not create.
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    pass
            if owned_path is not None:
                try:
                    owned_path.unlink(missing_ok=True)
                except OSError:
                    pass
        return snapshot
