"""Offline provisioning for the Prisma credential master key and ciphertext store."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .credential_store import CredentialUnavailable, initialize_credential_database, validate_key_path
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions


def provision_credentials(
    key_file: Path,
    database: Path,
    runtime_root: Path,
    permissions,
    *,
    random_bytes=os.urandom,
) -> None:
    try:
        key_file, _ = validate_key_path(key_file, runtime_root)
        database = Path(database)
        if key_file.exists() or key_file.is_symlink() or database.exists() or database.is_symlink():
            raise CredentialUnavailable("CREDENTIAL_PROVISIONING_FAILED")
        key = random_bytes(32)
        if not isinstance(key, bytes) or len(key) != 32:
            raise CredentialUnavailable("CREDENTIAL_PROVISIONING_FAILED")
        permissions.provision(key_file.parent, key_file)
        permissions.provision(database.parent, database)
        if key_file.stat().st_size != 0 or database.stat().st_size != 0:
            raise CredentialUnavailable("CREDENTIAL_PROVISIONING_FAILED")
        initialize_credential_database(database, key, permissions.verify)
        with key_file.open("r+b", buffering=0) as descriptor:
            if descriptor.read(1):
                raise CredentialUnavailable("CREDENTIAL_PROVISIONING_FAILED")
            descriptor.write(key)
            descriptor.flush()
            os.fsync(descriptor.fileno())
    except Exception:
        raise CredentialUnavailable("CREDENTIAL_PROVISIONING_FAILED") from None


def run_cli(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Provision Prisma credential storage locally.")
    parser.add_argument("command", choices=("provision-key",))
    arguments = parser.parse_args(argv)
    if arguments.command == "provision-key":
        paths = runtime_paths()
        configured = os.environ.get("PRISMA_CREDENTIAL_MASTER_KEY_FILE", "")
        provision_credentials(
            Path(configured),
            paths.credential_database,
            paths.root,
            SecureStoragePermissions(),
        )
    return 0


def main() -> int:
    try:
        return run_cli()
    except CredentialUnavailable:
        print("CREDENTIAL_PROVISIONING_FAILED", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
