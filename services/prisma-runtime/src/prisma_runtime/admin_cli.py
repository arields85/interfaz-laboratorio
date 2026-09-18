"""Offline service-identity provisioning and recovery for the Prisma administrator."""

from __future__ import annotations

import argparse
import getpass
import sys
import time
from pathlib import Path

from .admin_auth import AdminAuthRepository, AuthUnavailable, ScryptPasswordHasher
from .paths import runtime_paths
from .storage_permissions import SecureStoragePermissions


def _read_confirmed_password(reader) -> str:
    first = reader("Administrator password: ")
    second = reader("Confirm administrator password: ")
    if first != second:
        raise AuthUnavailable("PASSWORD_CONFIRMATION_MISMATCH")
    return first


def run_cli(argv=None, database: Path | None = None, password_reader=None, hasher=None, permissions=None) -> int:
    parser = argparse.ArgumentParser(description="Provision or recover the Prisma administrator locally.")
    parser.add_argument("command", choices=("provision-admin", "reset-admin-password"))
    arguments = parser.parse_args(argv)
    if password_reader is None:
        if not sys.stdin.isatty():
            raise AuthUnavailable("INTERACTIVE_TERMINAL_REQUIRED")
        password_reader = getpass.getpass

    paths = runtime_paths()
    database = Path(database or paths.auth_database)
    permissions = permissions or SecureStoragePermissions()
    hasher = hasher or ScryptPasswordHasher()
    password = _read_confirmed_password(password_reader)
    record = hasher.hash_password(password)

    if arguments.command == "provision-admin":
        permissions.provision(database.parent, database)
    repository = AdminAuthRepository(database, permission_checker=permissions.verify)
    if arguments.command == "provision-admin":
        repository.initialize_for_provisioning()
        repository.provision_admin("admin", record, now=time.time())
    else:
        repository.reset_admin_password(record, now=time.time())
    return 0


def main() -> int:
    try:
        return run_cli()
    except (AuthUnavailable, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
