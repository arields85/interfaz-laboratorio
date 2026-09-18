"""Fail-closed cross-platform permission checks for Prisma authentication state."""

from __future__ import annotations

import os
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


SQLITE_SIDECAR_SUFFIXES = ("-journal", "-wal", "-shm")
WINDOWS_REPARSE_POINT = 0x400


class StoragePermissionError(RuntimeError):
    pass


@dataclass(frozen=True)
class PermissionMetadata:
    owner_id: int
    mode: int
    is_link: bool


def validate_posix_permissions(
    directory: PermissionMetadata,
    database: PermissionMetadata,
    *,
    current_owner_id: int,
) -> None:
    if directory.is_link or database.is_link:
        raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
    if directory.owner_id != current_owner_id or database.owner_id != current_owner_id:
        raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
    if directory.mode != 0o700 or database.mode != 0o600:
        raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")


class SecureStoragePermissions:
    def __init__(
        self,
        *,
        platform_name: str = os.name,
        windows_script: Path | None = None,
        runner: Callable = subprocess.run,
        lstat_fn: Callable = os.lstat,
        owner_id_fn: Callable = getattr(os, "geteuid", lambda: -1),
    ):
        runtime_root = Path(__file__).resolve().parents[2]
        self.platform_name = platform_name
        self.windows_script = windows_script or runtime_root / "operations" / "protect-auth-state.ps1"
        self.runner = runner
        self.lstat = lstat_fn
        self.owner_id = owner_id_fn

    def provision(self, directory: Path, database: Path) -> None:
        self._reject_linked_paths(directory, database)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self._reject_linked_paths(directory, database)
        if self.platform_name == "nt":
            self._run_windows(directory, database, verify_only=False, directory_only=True)
        else:
            directory.chmod(0o700)
            self._verify_posix_directory(directory)
        if not database.exists():
            with database.open("xb"):
                pass
        if self.platform_name == "nt":
            self._run_windows(directory, database, verify_only=True)
        else:
            directory.chmod(0o700)
            database.chmod(0o600)
            self.verify(directory, database)

    def verify(self, directory: Path, database: Path) -> None:
        self._reject_linked_paths(directory, database)
        if self.platform_name == "nt":
            self._run_windows(directory, database, verify_only=True)
            return
        try:
            directory_stat = self.lstat(directory)
            database_stat = self.lstat(database)
            validate_posix_permissions(
                self._metadata(directory_stat),
                self._metadata(database_stat),
                current_owner_id=self.owner_id(),
            )
            for sidecar in self._sidecars(database):
                try:
                    sidecar_stat = self.lstat(sidecar)
                except FileNotFoundError:
                    continue
                metadata = self._metadata(sidecar_stat)
                if metadata.is_link or metadata.owner_id != self.owner_id() or metadata.mode != 0o600:
                    raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
        except (OSError, AttributeError, StoragePermissionError):
            raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID") from None

    def _verify_posix_directory(self, directory: Path) -> None:
        try:
            metadata = self._metadata(self.lstat(directory))
            if metadata.is_link or metadata.owner_id != self.owner_id() or metadata.mode != 0o700:
                raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
        except (OSError, AttributeError, StoragePermissionError):
            raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID") from None

    @staticmethod
    def _metadata(value) -> PermissionMetadata:
        attributes = getattr(value, "st_file_attributes", 0)
        is_link = stat.S_ISLNK(value.st_mode) or bool(attributes & WINDOWS_REPARSE_POINT)
        return PermissionMetadata(value.st_uid, stat.S_IMODE(value.st_mode), is_link)

    @staticmethod
    def _sidecars(database: Path) -> tuple[Path, ...]:
        return tuple(Path(f"{database}{suffix}") for suffix in SQLITE_SIDECAR_SUFFIXES)

    @staticmethod
    def _path_chain(path: Path):
        current = Path(path)
        while True:
            yield current
            parent = current.parent
            if parent == current:
                return
            current = parent

    def _reject_linked_paths(self, directory: Path, database: Path) -> None:
        checked: set[Path] = set()
        try:
            for target in (directory, database, *self._sidecars(database)):
                for candidate in self._path_chain(target):
                    if candidate in checked:
                        continue
                    checked.add(candidate)
                    try:
                        metadata = self.lstat(candidate)
                    except FileNotFoundError:
                        continue
                    if self._metadata(metadata).is_link:
                        raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
        except (OSError, AttributeError, StoragePermissionError):
            raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID") from None

    @staticmethod
    def _reject_existing_links(directory: Path, database: Path) -> None:
        try:
            if directory.is_symlink() or database.is_symlink():
                raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
        except OSError:
            raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID") from None

    def _run_windows(
        self,
        directory: Path,
        database: Path,
        *,
        verify_only: bool,
        directory_only: bool = False,
    ) -> None:
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        powershell = Path(system_root) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        command = [
            str(powershell),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(self.windows_script),
            "-DirectoryPath",
            str(directory),
            "-DatabasePath",
            str(database),
        ]
        if verify_only:
            command.append("-VerifyOnly")
        if directory_only:
            command.append("-DirectoryOnly")
        try:
            result = self.runner(command, capture_output=True, text=True, timeout=10, check=False)
        except Exception:
            raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID") from None
        if result.returncode != 0:
            raise StoragePermissionError("AUTH_STORAGE_PERMISSIONS_INVALID")
