# Prisma Local Runtime

This directory contains the repository-owned, Local-only Prisma voice system.
It binds the voice service to `127.0.0.1:5056` and the presentation bridge to
`127.0.0.1:5057`. Gemini and Telegram remain valid outbound integrations. The
runtime never writes to industrial systems.

## Bootstrap, start, stop, verify

Run the scripts from any working directory:

```powershell
.\operations\bootstrap-local.ps1
.\operations\start-local.ps1
.\operations\stop-local.ps1
.\operations\verify-local.ps1
```

The bootstrap creates the mutable state directory and copies the secret-free
configuration template only when no configuration exists. It does not install
dependencies. Install the pinned declarations in `requirements.txt` through
the environment management process used for this machine.

Required process environment variables:

- `GEMINI_API_KEY`

Telegram is disabled unless both of these variables are present:

- `PRISMA_LOCAL_TELEGRAM_ENABLED=1`
- `PRISMA_LOCAL_TELEGRAM_BOT_TOKEN`

A token without the explicit opt-in does not construct the Telegram bot or make
Telegram requests. Enabling Telegram without a token fails before either
runtime service starts.

Optional variables include `PRISMA_PYTHON` and `PRISMA_RUNTIME_STATE_DIR`.
Secrets are never stored by these launchers.

## State and exclusions

Mutable configuration, snapshots, pairing state, logs, and owned-process state live under
`%LOCALAPPDATA%\CoreAnalytics\Prisma` (or `PRISMA_RUNTIME_STATE_DIR`). The
repository contains only source, tests, dependency declarations, launchers,
and a secret-free configuration template. Virtual environments, caches,
generated audio, snapshots, pairing state, credentials, backups, benchmark
artifacts, VPN scripts, and Server launchers are intentionally excluded.

The previous `C:\hmi_tts` directory is untouched and remains the rollback
reference. No cutover or live-service verification is performed by this
migration.
