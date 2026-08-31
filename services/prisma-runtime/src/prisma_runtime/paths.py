"""Runtime-owned paths for mutable Prisma Local state."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _local_app_data() -> Path:
    configured = os.environ.get("LOCALAPPDATA", "").strip()
    if configured:
        return Path(configured)
    return Path.home() / "AppData" / "Local"


@dataclass(frozen=True)
class RuntimePaths:
    root: Path
    voice_config: Path
    snapshot: Path
    chat_state: Path
    logs: Path

    @property
    def mutable_files(self) -> tuple[Path, ...]:
        return self.voice_config, self.snapshot, self.chat_state


def runtime_paths() -> RuntimePaths:
    configured_root = os.environ.get("PRISMA_RUNTIME_STATE_DIR", "").strip()
    root = Path(configured_root).expanduser() if configured_root else _local_app_data() / "CoreAnalytics" / "Prisma"
    return RuntimePaths(
        root=root,
        voice_config=Path(os.environ.get("PRISMA_VOICE_CONFIG_FILE", root / "prisma_voice_config.json")),
        snapshot=Path(os.environ.get("PRISMA_LOCAL_SNAPSHOT_FILE", root / "prisma_local_snapshot.json")),
        chat_state=Path(os.environ.get("PRISMA_LOCAL_STATE_FILE", root / "prisma_local_state.json")),
        logs=root / "logs",
    )


def ensure_runtime_state(paths: RuntimePaths | None = None) -> RuntimePaths:
    resolved = paths or runtime_paths()
    resolved.root.mkdir(parents=True, exist_ok=True)
    resolved.logs.mkdir(parents=True, exist_ok=True)
    return resolved
