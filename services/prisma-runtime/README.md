# Prisma Local Runtime

This directory contains the repository-owned, Local-only Prisma voice system.
It binds the voice service to `127.0.0.1:5056` and the presentation bridge to
`127.0.0.1:5057`. Gemini and Telegram remain valid outbound integrations. The
runtime never writes to industrial systems.

The canonical product status, approved target, and unified delivery roadmap are in
[`docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md`](../../docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md).

## Bootstrap, start, stop, verify

Run the scripts from any working directory. Every path is anchored on the
script location, never on the caller's current directory.

```powershell
.\operations\bootstrap-local.ps1
.\operations\start-local.ps1
.\operations\stop-local.ps1
.\operations\verify-local.ps1
```

`bootstrap-local.ps1` is idempotent and safe to re-run. It:

1. creates the mutable state directories and copies the secret-free
   configuration template only when no effective configuration exists;
2. creates the virtual environment when it is absent, and reuses it otherwise;
3. installs the pinned, hash-verified dependency graph into it.

`start-local.ps1` runs the bootstrap before launching anything, so a fresh
checkout needs no separate preparation step.

## The Python environment

The virtual environment lives at `services/prisma-runtime/.venv` and is
gitignored. It is created and consumed exclusively by the scripts in
`operations/`.

### Why the environment is co-located with the checkout

Mutable *machine* state — configuration, snapshots, logs, owned-process state —
correctly lives in `%LOCALAPPDATA%\CoreAnalytics\Prisma` and is shared across
checkouts, because it describes the machine rather than the code.

A virtual environment is *checkout* state. It is derived from the
`requirements` files of one specific checkout. Sharing a single environment
across two checkouts silently serves the wrong dependency set to one of them,
and the failure appears far away from its cause. Co-locating the environment
with the checkout that declares it makes ownership unambiguous.

### One interpreter, no fallbacks

Every launcher resolves exactly one interpreter:

```
<runtime root>\.venv\Scripts\python.exe
```

Resolution lives in a single shared helper, `operations/runtime-environment.ps1`.
When that interpreter is missing, the launchers fail with an actionable error
instead of guessing. There is deliberately **no** fallback to an interpreter
found on `PATH`, because a fallback converts a broken environment into a
silently wrong one.

`operations/startup-preflight.ps1` additionally asserts, immediately before any
service is launched, that the interpreter is the repository-owned one and that
its `sys.prefix` resolves inside `<runtime root>\.venv`. The identity check is a
pure path comparison performed *before* the interpreter is executed, so an
unexpected binary is rejected without ever being run.

### Environment variables

| Variable | Role |
|----------|------|
| `GEMINI_API_KEY` | Required by `start-local.ps1`. |
| `PRISMA_LOCAL_TELEGRAM_ENABLED` | Set to `1` to opt in to Telegram. |
| `PRISMA_LOCAL_TELEGRAM_BOT_TOKEN` | Required when Telegram is enabled. |
| `PRISMA_RUNTIME_STATE_DIR` | Overrides the mutable state root. |
| `PRISMA_BOOTSTRAP_PYTHON` | Bootstrap only. Explicit path to the base interpreter used **once**, to create the environment. Validated and logged; never consulted by a launcher. |

`PRISMA_PYTHON` has been **removed**. It was a silent interpreter override on
the startup path and was the mechanism that kept the legacy `C:\hmi_tts`
environment alive through the migration. Selecting an interpreter is now a
bootstrap-time concern only, and it is loud.

A token without the explicit opt-in does not construct the Telegram bot or make
Telegram requests. Enabling Telegram without a token fails before either
runtime service starts. Secrets are never stored by these launchers.

## Python version

The required interpreter series is declared in `.python-version`:

```
3.14
```

`.python-version` is the mechanism used here because it is the de-facto
cross-tool standard (pyenv, pyenv-win, asdf, uv all read it), it is a plain
single-line file that the PowerShell bootstrap can read without a TOML parser,
and this runtime is an application executed via `python -m`, not a packaged
distribution — so there is no `pyproject.toml` whose `requires-python` field
would be the natural home.

The pin is `major.minor`. Patch releases are accepted, so a security update does
not break the bootstrap. `bootstrap-local.ps1` asserts the version **before**
creating the environment and names both the required and the found version when
they disagree.

## Dependencies

| File | Role |
|------|------|
| `requirements.in` | Direct dependencies. Human-editable. |
| `requirements.lock.txt` | Generated. Full transitive graph, pinned with hashes. |

The bootstrap consumes the lock with nothing but the stock `pip` that ships
inside the virtual environment:

```powershell
python -m pip install --require-hashes --requirement requirements.lock.txt
```

No resolver, lock tool, or extra dependency sits on the startup critical path.

### Regenerating the lock

Locking is a maintenance task, so it may use a tool that the runtime itself
never needs. Edit `requirements.in`, then regenerate from a throwaway
environment created **outside** this checkout:

```powershell
python -m venv $env:TEMP\prisma-lockgen
& $env:TEMP\prisma-lockgen\Scripts\python.exe -m pip install pip-tools
& $env:TEMP\prisma-lockgen\Scripts\python.exe -m piptools compile `
    --generate-hashes --no-header `
    --output-file requirements.lock.txt requirements.in
```

Run it from this directory, with an interpreter matching `.python-version`.
Re-add the explanatory header at the top of the generated file, then re-run
`bootstrap-local.ps1` and `verify-local.ps1`.

Keep the throwaway environment outside the checkout so the locking tool never
becomes an implicit runtime dependency.

## FFmpeg resolution

Telegram voice encoding needs FFmpeg. `voice_service.py` resolves it portably,
in this order:

1. `shutil.which("ffmpeg")` — a system installation on `PATH` wins, which lets
   an operator supply a build with the codecs they need;
2. `imageio_ffmpeg.get_ffmpeg_exe()` — the pinned wheel-provided binary, so a
   machine without a system FFmpeg still works out of the box.

When neither resolves, the encode fails with `FFMPEG_NOT_FOUND` rather than
raising. No FFmpeg path is ever hardcoded.

## State and exclusions

Mutable configuration, snapshots, pairing state, logs, and owned-process state
live under `%LOCALAPPDATA%\CoreAnalytics\Prisma` (or `PRISMA_RUNTIME_STATE_DIR`).
The repository contains only source, tests, dependency declarations, launchers,
and a secret-free configuration template. The virtual environment, caches,
generated audio, snapshots, pairing state, credentials, backups, benchmark
artifacts, VPN scripts, and Server launchers are intentionally excluded.

## Rollback to `C:\hmi_tts`

`C:\hmi_tts` is the frozen rollback reference and is never read, written, or
modified by this runtime. To fall back to it:

1. Stop the repository-owned services with `.\operations\stop-local.ps1`. It
   only stops processes recorded in the manifest it owns, and it refuses a
   manifest belonging to another checkout.
2. Confirm ports `5056` and `5057` have no listener left.
3. Start the legacy system from `C:\hmi_tts` using its own launchers and its own
   `C:\hmi_tts\.venv`.

Rolling back needs no change to this repository. Rolling forward again is
`.\operations\bootstrap-local.ps1` followed by `.\operations\start-local.ps1`.
