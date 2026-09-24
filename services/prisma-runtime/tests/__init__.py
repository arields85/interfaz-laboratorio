"""Focused tests for the repository-owned Prisma runtime."""

import os
import sys
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[1] / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))


# B1b: the runtime reads these directly from os.environ -- PRISMA_LOCAL_
# TELEGRAM_BOT_TOKEN (telegram_config.py, telegram_credentials.py),
# GEMINI_API_KEY (gemini_credentials.py), and PRISMA_CREDENTIAL_MASTER_
# KEY_FILE (telegram_config.py/gemini_credentials.py -- gates whether the
# direct token/key is even consulted). A real value left in this machine's
# own User-scope Windows environment -- exactly what happened during B1
# development, where a token fragment briefly reached tool output -- would
# otherwise be visible to any test that reads os.environ without its own
# explicit patch.dict(..., clear=True). Every test in this suite runs in
# the same process, so scrubbing these keys once here, at test package
# import time (before any test module or fixture runs), makes the whole
# suite hermetic: a test's own patch.dict(os.environ, ..., clear=True)
# snapshots and restores this already-scrubbed baseline, never a real
# ambient value. This never reads, logs or echoes the value being removed.
HERMETIC_TOKEN_ENV_VARS = (
    "PRISMA_LOCAL_TELEGRAM_BOT_TOKEN",
    "GEMINI_API_KEY",
    "PRISMA_CREDENTIAL_MASTER_KEY_FILE",
)


def scrub_ambient_token_env_vars() -> None:
    """Remove every hermetic Telegram/Gemini token env var from the live
    process environment. Idempotent; a test may call it again to re-assert
    the guarantee. Never reads or returns the removed value."""
    for name in HERMETIC_TOKEN_ENV_VARS:
        os.environ.pop(name, None)


scrub_ambient_token_env_vars()
