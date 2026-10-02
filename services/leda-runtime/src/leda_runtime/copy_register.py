"""Copy register: how the HMI and Leda address people (usted, rioplatense or neutro).

The setting lives in the shared HMI configuration under ``hmi:copy-register`` as the JSON
document ``{"version": 1, "register": "<register>"}``. Anything missing, malformed or unknown
reads as ``usted``. This module parses, validates and reads the setting (with a short cache for the
bots, which read it on every message); it never writes.
"""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

from .hmi_config_store import HmiConfigUnavailable

if TYPE_CHECKING:
    from .hmi_config_store import HmiConfigStore

COPY_REGISTER_KEY = "hmi:copy-register"
COPY_REGISTERS: tuple[str, ...] = ("usted", "rioplatense", "neutro")
DEFAULT_COPY_REGISTER = "usted"
COPY_REGISTER_VERSION = 1
HMI_CONFIG_INVALID_COPY_REGISTER = "HMI_CONFIG_INVALID_COPY_REGISTER"
# How long a bot trusts the register it last read: an admin change applies to the next message after this.
COPY_REGISTER_TTL_SECONDS = 5.0


def _strict_register(raw: object) -> str | None:
    """The register of a value that is exactly the documented shape, else None."""
    if not isinstance(raw, str):
        return None
    try:
        document = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(document, dict) or set(document) != {"version", "register"}:
        return None
    version = document["version"]
    register = document["register"]
    if type(version) is not int or version != COPY_REGISTER_VERSION:
        return None
    if not isinstance(register, str) or register not in COPY_REGISTERS:
        return None
    return register


def is_valid_copy_register_value(raw: object) -> bool:
    return _strict_register(raw) is not None


def parse_copy_register(raw: object) -> str:
    """Register encoded in a stored value; ``usted`` when missing, malformed or unknown."""
    return _strict_register(raw) or DEFAULT_COPY_REGISTER


def read_copy_register(store: HmiConfigStore) -> str:
    """Active register in the shared HMI configuration; ``usted`` when unset or unreadable."""
    try:
        _, items = store.read_document()
    except HmiConfigUnavailable:
        return DEFAULT_COPY_REGISTER
    return parse_copy_register(items.get(COPY_REGISTER_KEY))


class CopyRegisterResolver:
    """The active register for the bots: read from the shared store, cached for a short TTL.

    Calling it never raises: any failure to read the store reads as ``usted``. The fallback is cached
    for the TTL like any other value, so a broken store is not hit on every message.
    """

    def __init__(
        self,
        store: HmiConfigStore,
        *,
        ttl_seconds: float = COPY_REGISTER_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._store = store
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._lock = threading.Lock()
        self._register = DEFAULT_COPY_REGISTER
        self._read_at: float | None = None

    def __call__(self) -> str:
        with self._lock:
            now = self._clock()
            if self._read_at is None or now - self._read_at >= self._ttl_seconds:
                try:
                    self._register = read_copy_register(self._store)
                except Exception:
                    self._register = DEFAULT_COPY_REGISTER
                self._read_at = now
            return self._register


def active_register(resolver: Callable[[], str] | None) -> str:
    """The register a resolver reports; ``usted`` when there is none, it fails or it answers unknown."""
    if resolver is None:
        return DEFAULT_COPY_REGISTER
    try:
        register = resolver()
    except Exception:
        return DEFAULT_COPY_REGISTER
    return register if register in COPY_REGISTERS else DEFAULT_COPY_REGISTER
