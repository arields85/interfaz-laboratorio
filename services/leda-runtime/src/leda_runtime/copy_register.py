"""Copy register: how the HMI and Leda address people (usted, rioplatense or neutro).

The setting lives in the shared HMI configuration under ``hmi:copy-register`` as the JSON
document ``{"version": 1, "register": "<register>"}``. Anything missing, malformed or unknown
reads as ``usted``. This module only parses, validates and reads the setting; it never writes.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from .hmi_config_store import HmiConfigUnavailable

if TYPE_CHECKING:
    from .hmi_config_store import HmiConfigStore

COPY_REGISTER_KEY = "hmi:copy-register"
COPY_REGISTERS: tuple[str, ...] = ("usted", "rioplatense", "neutro")
DEFAULT_COPY_REGISTER = "usted"
COPY_REGISTER_VERSION = 1
HMI_CONFIG_INVALID_COPY_REGISTER = "HMI_CONFIG_INVALID_COPY_REGISTER"


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
