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

Run `bootstrap-local.ps1` explicitly after a fresh checkout or dependency-lock
change. Normal `start-local.ps1` startup never creates an environment, runs
pip, or reconciles dependencies. It initializes only the secret-free mutable
state, validates the owned interpreter and required imports, and then launches
the services. If the environment is absent or incomplete, startup stops before
launching a service and directs the operator to `operations\bootstrap-local.ps1`.

Provider credentials are not startup requirements. Both services remain live
without Gemini or Telegram configuration so local diagnostics can report what
is missing. An operation that actually needs Gemini returns an actionable
`GEMINI_CREDENTIAL_UNAVAILABLE` response until an available source is configured.

## Offline-safe verification

`operations\verify-local.ps1` runs the backend offline test gate, but a plain
invocation inherits the caller's ambient environment. If your shell carries real
provider keys or local override variables (`GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`,
`PRISMA_CREDENTIAL_MASTER_KEY_FILE`, `PRISMA_VOICE_CONFIG_FILE`, `PRISMA_LOCAL_*`,
`PRISMA_PUBLIC_ORIGIN`, `TELEGRAM_BOT_API_BASE`), those values can leak into the test
run. The accepted PAC-5 verification therefore ran the canonical gate through the
exact child-only Python supervisor reproduced below.

Unlike the launchers in `operations/`, which run from any working directory because
every path is anchored on the script location, this reproduction block must run from
the **monorepo root** in **Bash or Git Bash** — not PowerShell, not the runtime root —
because it invokes the Python interpreter and the verify script by their
repository-relative paths.

This block is a documented reproduction of the accepted PAC-5 run; it was **not**
re-executed for this documentation change:

```bash
./services/prisma-runtime/.venv/Scripts/python.exe -B - <<'PY'
import os
from pathlib import Path
import subprocess
import tempfile

cleared = (
    'PRISMA_VOICE_CONFIG_FILE',
    'PRISMA_CREDENTIAL_MASTER_KEY_FILE',
    'GEMINI_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'PRISMA_LOCAL_TELEGRAM_ENABLED',
    'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN',
    'PRISMA_LOCAL_SNAPSHOT_FILE',
    'PRISMA_LOCAL_STATE_FILE',
    'PRISMA_LOCAL_VOICE_URL',
    'PRISMA_PUBLIC_ORIGIN',
    'TELEGRAM_BOT_API_BASE',
)
command = [
    'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
    '-ExecutionPolicy', 'Bypass', '-File',
    'services/prisma-runtime/operations/verify-local.ps1',
]
with tempfile.TemporaryDirectory(prefix='prisma-pac5-') as temporary:
    root = Path(temporary)
    assert root.is_dir() and not any(root.iterdir()), 'Sandbox must exist and be fresh'
    child_env = os.environ.copy()
    child_env['PRISMA_RUNTIME_STATE_DIR'] = str(root)
    for name in cleared:
        child_env.pop(name, None)
    assert all(name not in child_env for name in cleared), 'Sandbox override removal failed'
    assert Path(child_env['PRISMA_RUNTIME_STATE_DIR']) == root, 'Sandbox root mismatch'
    print('PAC5 sandbox fresh:true; sensitive/config overrides absent:true', flush=True)
    result = subprocess.run(command, env=child_env, check=False)
    print(f'PAC5 canonical backend exit:{result.returncode}', flush=True)
exit(result.returncode)
PY
```

The supervisor copies the parent environment and modifies only the copy handed to
the child: it points `PRISMA_RUNTIME_STATE_DIR` at a fresh temporary directory and
removes the eleven known sensitive or configuration overrides from the child copy.
The parent shell environment is never mutated and needs no restoration. This
prevents the specific identified ambient state and provider dependencies from
entering the test run; it is **not** a security sandbox, and fixture inspection
before trusting the run is still required. Normal runtime setup (`start-local.ps1`
and friends) is **not** automatically isolated this way.

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
| `GEMINI_API_KEY` | Legacy Gemini source used only when protected mode is not selected. Optional at startup; whitespace-only values are missing. |
| `PRISMA_LOCAL_TELEGRAM_ENABLED` | Set to `1` to opt in to Telegram. |
| `PRISMA_LOCAL_TELEGRAM_BOT_TOKEN` | Legacy Telegram source used only when protected mode is not selected. Telegram still requires explicit opt-in. |
| `PRISMA_RUNTIME_STATE_DIR` | Overrides the mutable state root. |
| `PRISMA_CREDENTIAL_MASTER_KEY_FILE` | Absolute path to the separately protected raw 32-byte credential master-key file. It must be outside the runtime state root. |
| `PRISMA_BOOTSTRAP_PYTHON` | Bootstrap only. Explicit path to the base interpreter used **once**, to create the environment. Validated and logged; never consulted by a launcher. |

`PRISMA_PYTHON` has been **removed**. It was a silent interpreter override on
the startup path and was the mechanism that kept the legacy `C:\hmi_tts`
environment alive through the migration. Selecting an interpreter is now a
bootstrap-time concern only, and it is loud.

Startup settings are read once, when the backend process is constructed. They
must therefore be present in the environment **before** startup; the runtime
does not re-read a changed environment. When a setting changes — for example
after setting `PRISMA_CREDENTIAL_MASTER_KEY_FILE` for the first time — a dev
runtime still running under the old environment keeps serving until it is
restarted gracefully: stop it through the terminal that owns it (`Ctrl+C`) or
with `operations\stop-local.ps1`, confirm ports `5056` and `5057` are free, and
start again. No `setx` or machine-level persistence is required; per-process
environment is the supported mechanism.

A token without the explicit opt-in does not construct the Telegram bot or make
Telegram requests. Enabling Telegram without a token in the selected source leaves the
integration enabled but unconfigured: no bot is constructed, no Telegram request is made,
and runtime health remains available. A nonblank master-key-file setting selects protected
Telegram storage authoritatively; missing or corrupt protected state never falls back to the
legacy environment token. Secrets are never stored by these launchers.

## Credential administration

Credential administration is available in **Configuración general → Voz** through the same
backend-validated administrator session used by the rest of the HMI. There is no second Voice login.

### Three distinct credential concepts

| Concept | What it is | How it is created |
|---|---|---|
| Administrator account | The single backend login that authorizes the HMI administrator session. | `admin_cli provision-admin`, run once by the installation owner with an interactive password. |
| Master key and ciphertext store | The separately protected raw 32-byte key file plus `<runtime-state>\credentials\provider-credentials.sqlite3` that hold encrypted provider secrets. | `credential_cli provision-key`, which refuses to regenerate an existing key or database; an existing key must never be deleted or regenerated to re-provision. |
| Provider secrets | The Gemini and Telegram values stored inside that store. | Saved by an authenticated administrator from **Configuración general → Voz**; provisioning never writes them. |

Login, provider-store preparation, and provider-credential saving are three separate
actions at three separate times. Provisioning prepares the key and store but stores no
provider secret; saving a credential requires a validated administrator session and
writes only into the already-provisioned store.

The browser receives metadata only; secret input remains transient and is cleared when Settings
closes without ending the administrator session. Global **Guardar** still saves only effects/orb
settings. Saving a credential does not verify it, apply it to a provider, or report that a provider
is running. Gemini adoption is complete offline: a nonblank
`PRISMA_CREDENTIAL_MASTER_KEY_FILE` selects authoritative protected mode, and actual Gemini work
reads the stored credential at dequeue immediately before client creation. Missing, deleted,
unavailable, mismatched, or corrupt protected storage never falls back to `GEMINI_API_KEY`.
The environment key remains a legacy source only when protected mode is not selected. Telegram
uses the same authoritative source rule. Saving a Telegram replacement advances desired state
without contacting Telegram or restarting the current poller. Startup may apply an enabled,
configured source unattended; explicit runtime replacement uses the authenticated apply route.

Provision the administrator and credential storage offline from the repository root, under
the same OS identity that will run Prisma. Replace the placeholder with an absolute path in a
separately protected directory outside `PRISMA_RUNTIME_STATE_DIR`; do not place a real key or
secret in source control or command arguments.

```powershell
$runtimeRoot = (Resolve-Path '.\services\prisma-runtime').Path
$env:PYTHONPATH = "$runtimeRoot\src"
$env:PRISMA_CREDENTIAL_MASTER_KEY_FILE = '<absolute-protected-key-path-outside-runtime-state>'

& "$runtimeRoot\.venv\Scripts\python.exe" -B -m prisma_runtime.admin_cli provision-admin
& "$runtimeRoot\.venv\Scripts\python.exe" -B -m prisma_runtime.credential_cli provision-key
```

`provision-admin` reads and confirms the password interactively; it accepts no password
argument. `provision-key` accepts no path flag: it reads
`PRISMA_CREDENTIAL_MASTER_KEY_FILE`, creates a raw 32-byte key, and initializes
`<runtime-state>\credentials\provider-credentials.sqlite3`. It fails when the key or database
already exists. Neither command runs during normal startup, so there is no per-launch password
prompt or automatic key generation.

Authenticated administrators use these backend routes:

| Route | Result |
|---|---|
| `GET /api/prisma/admin/credentials` | Configured booleans for `gemini` and `telegram`; never secret values. |
| `PUT /api/prisma/admin/credentials/<provider>` | Stores one encrypted secret after Origin and CSRF validation. |
| `DELETE /api/prisma/admin/credentials/<provider>` | Idempotently removes one stored credential. |
| `POST /api/prisma/admin/credentials/telegram/apply` | Applies the current desired Telegram token from exact JSON `{}` after Origin, session, and CSRF validation. |

Credential responses are non-cacheable. Stable failures include authentication `401`,
transport or CSRF `403`, unsupported provider `404`, invalid JSON/value `400`, wrong content
type `415`, oversized wire body `413`, and sanitized `CREDENTIAL_STORAGE_UNAVAILABLE` `503`
for missing, inaccessible, mismatched, or corrupt key/database state. There is no API secret
readback or automatic key rotation. The installation owner must back up the key separately
from the ciphertext database and keep matching copies; losing the key makes encrypted
credentials unrecoverable.

Telegram PUT is desired-only. Telegram DELETE commits absence before requesting cooperative
poller stop and returns `409 TELEGRAM_STOP_TIMEOUT` if the old poller remains alive; the deletion
is retained and no replacement starts. Apply stops and physically joins the old poller before
starting one replacement. Apply responses expose only source, enabled/configured,
desired/applied generations, running, verified, restart-required, and sanitized error metadata.
Provider success is not continuous connectivity or production verification.

In the HMI, **Guardar credencial** stores a Gemini or Telegram secret and **Eliminar credencial**
removes it. New Gemini work uses the selected stored credential, but saving does not perform live
verification. Telegram save changes desired state only; **Aplicar cambio** explicitly reconciles the
running bot. If Telegram deletion returns `409 TELEGRAM_STOP_TIMEOUT`, the token is already absent
while stop remains uncertain, and only an explicit user retry issues another DELETE. Loading,
unavailable, retained last-known, configured, desired/applied, running, and verified states remain
distinct. These behaviors are independently accepted offline, not validated against live providers
or a production proxy/deployment.

## Health and integration status

Runtime liveness and external-integration readiness are separate:

- `ok`, `ready`, `service`, and `mode` keep their existing runtime-liveness
  meaning;
- Gemini status reports the selected protected or environment source and whether its credential
  is configured and available;
- Telegram enabled, configured, connected, verified, desired/applied generation, and
  restart-required states are reported separately;
- configured never means provider-verified. Passive health requests do not
  contact Gemini or Telegram and do not expose credential values.

Telegram `verified` means only that `getMe` succeeded during the current applied startup or
explicit operation. Gemini verification remains a later operation. The HMI displays these statuses;
browser-loader or mandatory readiness changes are not part of this runtime increment.

## HMI document sessions and event-bound voice

Each browser document automatically bootstraps one anonymous server-issued capability. The
capability is returned only through `X-Prisma-Session-Capability`, retained only in browser
memory, and stored server-side only as a SHA-256 digest associated with an internal owner UUID.
It is bearer authority for that document's owned context, not user-account authentication,
device identity, or theft-proof authorization. Viewer/admin UI roles cannot mint authority for
another document, and playback does not require administrator login.

The capability isolates current-view snapshots, questions, responses, voice events, TTS replay,
cancellation, and presentation navigation. Shared backend processes, Gemini credentials,
installation telemetry, and bounded worker pools do not create a shared conversation. HMI asks
have no fallback to the installation legacy snapshot. No chat UI or stored browser history was
added.

| Browser route | Runtime route | Contract |
|---|---|---|
| `POST /api/prisma/session` | `POST /hmi/session` | Exact `{}`, 128-byte wire cap; returns `201`, expiry metadata, and capability header. |
| `DELETE /api/prisma/session` | `DELETE /hmi/session` | No body; revokes the capability and returns bodyless `204`. |
| `POST /api/prisma/snapshot` | `POST /hmi/current-snapshot` | Replaces only that session's latest view; maximum 1 MiB. |
| `GET /api/prisma/events/latest` | `GET /hmi/voice/latest` | Returns only that session's latest event, or `204`. |
| `POST /api/prisma/ask` | `POST /local/ask` | Exact question object, 1–4096 UTF-8 bytes and 32 KiB wire cap. |
| `POST /api/prisma/tts/live` | `POST /prisma/speak-live` | Exact event ID plus capability; foreign events return nondisclosing `404`. |

Every exact session/TTS response is `Cache-Control: no-store`. Missing, malformed, expired, or
revoked capabilities fail before credential, coordinator, cache, or provider work. The capability
header is forwarded only on the fixed session paths. Raw text TTS `/prisma/speak` is retired and
returns `410 RAW_TTS_DISABLED`; browser playback uses event IDs and progressive PCM only.

A fresh document or reload receives a new capability. Explicit close revokes it, while browser
`pagehide` close is best effort; abandoned sessions remain bounded by 30-minute idle and 8-hour
absolute expiry. State is process-local and non-durable, so restart invalidates every capability.
The supported topology is one voice-service process, one coordinator, and one provider worker;
multiple workers or replicas are not supported.

The whole-job deadline is logical. Cooperative cancellation, subscriber release, and late-output
suppression happen at timeout, but Python cannot safely kill a blocked provider iterator. Its
producer slot remains quarantined until physical return; the 45-second Gemini SDK I/O timeout is
the bounded provider-unblock mechanism. This offline acceptance does not prove live Gemini,
FFmpeg, native Windows/Linux permissions, TLS, proxying, supervisor behavior, or production use.

Telegram remains a private-text installation-snapshot integration. It does not publish HMI voice
events, bind a Telegram user to an HMI document, or receive automatic paid audio. Pairing and the
acknowledged update offset are stored per numeric bot identity. Token rotation for the same bot
retains that bot's state; a different bot requires pairing, and switching back restores only the
known bot's own state. Legacy root allowlists and `PRISMA_LOCAL_ALLOWED_CHAT_IDS` are not imported.
Migration drains the complete queued backlog in nonblocking batches before fresh `/start` pairing
is allowed, without negative offsets or `drop_pending_updates`. Updates are acknowledged only
after handling and state persistence. Delivery is at least once, so a crash after a successful
send but before persistence can duplicate a response.

## Local development boundary

After one explicit bootstrap, the normal local development command is:

```powershell
cd hmi-app
npm run dev
```

The command attempts a bounded Prisma Local acquisition first, then starts the
installed Vite CLI with the exact supplied arguments. Missing credentials,
an incomplete Python environment, occupied foreign ports, or another Prisma
startup failure is reported in the terminal but does not prevent Vite from
running. The wrapper never installs dependencies or invokes bootstrap.

On Windows, helper and service windows are hidden while the existing npm/Vite
terminal remains attached. Concurrent development commands share one verified
development-owned runtime generation. Closing one command removes only its
owner; the final owner stops only the exact process identities started by that
generation. A complete canonical runtime started manually may be reused, but
the development wrapper never stops it. Foreign, replaced, corrupt, or
insufficiently proven process state is left untouched with a warning.

Ownership registration and receipt delivery are one locked transaction. The
PowerShell helper writes the receipt as BOM-less UTF-8 for Node interoperability;
if delivery fails, it rolls back only that invocation's owner and stops a cold
runtime only when the canonical generation and every live creation identity
still match. If Node cannot read or parse a receipt, it requests recovery using
only its unique invocation token. Recovery derives the generation from the
canonical manifest under the same lock and applies the same identity checks;
ordinary successful release still requires the generation from the receipt.
If those proofs are unavailable, state is retained with a warning rather than
claiming cleanup or stopping another process. Temporary handoff-file cleanup
errors are reported but do not replace the established ownership outcome.

`SIGINT`, `SIGTERM`, normal Vite exit, and Vite spawn failure converge on the
same idempotent release path. Browser or tab closure has no backend lifecycle
authority. This is bounded normal-development cleanup, not a claim of recovery
after forced terminal termination, power loss, or an operating-system crash.
Automatic Prisma orchestration is currently Windows-only; unsupported systems
run Vite with an explicit warning rather than pretending the backend is owned.

The browser consumes Prisma through the fixed same-origin routes documented
in [`docs/prisma/PRISMA_BROWSER_ROUTING.md`](../../docs/prisma/PRISMA_BROWSER_ROUTING.md).
Vite forwards those exact routes to this runtime during development; there is no
browser runtime selector or editable Prisma endpoint prerequisite. With no Gemini
key, provider-dependent speech still returns the documented technical unavailable
response and is never presented as spoken output.

The unified browser-routing increment, backend protected credential storage, Gemini adoption,
per-document HMI session isolation, and protected Telegram lifecycle are implemented and
independently verified offline. Telegram retains ownership when stop raises, reports only the
stable stop failure, prevents replacement until a confirmed stop, and then permits one replacement.
Credential administration is exposed through the HMI and independently accepted offline. This does
not prove a live provider or production proxy deployment. Production static hosting still requires
IT-managed forwarding for all exact routes, including progressive TTS streaming.

Production host and supervisor selection remain deferred. This development
wrapper is not a production deployment or operating-system service manager.

## Verified boundary

The offline acceptance covers this Windows checkout: the full HMI suite, the canonical
backend gate under the temporary-state wrapper above, build, lint, and dependency
checks, plus a locally provisioned protected master key with a user-confirmed native
Chrome administrator login. It does **not** cover native Linux permission behavior,
deployment or supervised operation, SACL-auditing preservation, reparse points,
backup/restore, TLS/proxying, or live providers. Those remain open residuals tracked in
[`docs/PENDING_WORK.md`](../../docs/PENDING_WORK.md) under PW-002/PW-003.

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
