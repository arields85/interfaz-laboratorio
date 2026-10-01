# Rename Prisma to Leda — ODD feature document

> ODD feature task (not SDD). Branch `feat/rename-prisma-to-leda`, stacked on `feat/shared-config-hidden-access`.
> Engram: decision `decision/rename-prisma-to-leda`; mirror `odd/rename-prisma-to-leda/tasks`.
> This document keeps the old name on purpose: it describes the rename itself.

## Objective

The assistant "Prisma" is now called **Leda**. Rename everything, visible and technical, before the code is handed to IT for the Docker deployment, so the IT configuration never sees the old names.

## User decisions (2026-10-01)

- Full rename, both the visible layer and the technical layer (user: "todo").
- It happens before the IT handoff.
- Out of scope:
  - git history;
  - the Telegram bot names, which the user changes in BotFather;
  - `Directrices/`, which has no occurrences and must not be modified anyway.
- Gemini is only the voice provider (TTS and STT). There is no persona prompt; the assistant name lives only in runtime reply texts and UI copy.

## Defaults taken (the user can override)

- Casing:
  - "Leda" in UI, docs and prose;
  - `leda` in code identifiers, file and folder names, routes and storage keys;
  - `LEDA` in env vars and constants;
  - `Leda*` for PascalCase identifiers.
- Hard cut: no fallback reads of the old `PRISMA_*` env vars or `/api/prisma/*` routes.
- A one-time migration of the developer's local state so the stored credentials survive:
  - state dir `%LOCALAPPDATA%\CoreAnalytics\Prisma` → `...\Leda`;
  - credential key dir `PrismaCredentialKey` → `LedaCredentialKey` (master key; critical);
  - state file names;
  - the server-shared keys `hmi:prisma-hmi-name` and `hmi:prisma-orb-visual-config`;
  - the browser keys `hmi:prisma-*`.
- Every document is rewritten, including the `odd/tasks` history and the curated history document. Git keeps the original wording.
- The Lucide `Pyramid` icon stays: it is a generic icon name.

## Inventory (2026-10-01)

- About 7,100 occurrences in about 252 files, plus about 100 file paths and 3 folders. There is no third-party "Prisma" (no ORM).
- About 20 real env vars, including `PRISMA_RUNTIME_STATE_DIR`, `PRISMA_CREDENTIAL_MASTER_KEY_FILE` and `PRISMA_DEV_*`.
- The cookie `prisma_admin_session` and the header `X-Prisma-Session-Capability` change. Existing admin sessions are invalidated.
- The audio schema hash: regenerate the bindings after the rename.
- Stop the runtime processes before moving state (process manifest and module names). Recreate the `.venv`, whose path changes with the folder.

## Tasks

- [x] L1 — Scripted rename: `git mv` the folders and every path containing prisma, then case-ordered content substitution over the tracked files (exclusions: `Directrices/`, binaries such as `.ico`, lockfiles). Regenerate the audio schema bindings. Get all gates green.
- [x] L2 — Migration of the local state and browser and shared keys: a one-time launcher step for the state dir, the master key and the state files, plus migration of the client and server storage keys. Tests.
- [x] L3 — Manual pass over the visible copy (UI, runtime reply texts, health JSON), the launcher, the READMEs and the docs. A final search for the old name returns only intentional hits, each documented below.
- [x] L4 — Live check (parent): restart the runtime from the new path, then confirm credentials are intact, the HMI loads, login works and Leda answers. Also verify the dev launcher and the control Chrome.

## TDD

- Mode: strict, ON (source: global orchestrator config).
- Runners:
  - hmi-app: `npm test`.
  - Runtime: Python `unittest`, and the offline gate per the runtime README.
- A mechanical rename keeps the existing tests as the regression net. The migration (L2) got RED/GREEN tests.

## The rename script (L1, kept outside the repository)

Three steps, run from the repository root over `git ls-files` minus `Directrices/`:

1. Paths: every tracked path containing `prisma`, `Prisma` or `PRISMA` was moved with `git mv`, case-preserving (197 paths: `services/prisma-runtime` to `services/leda-runtime`, `src/prisma_runtime` to `src/leda_runtime`, `docs/prisma` to `docs/leda`, `tools/dev-launcher/prisma-pyramid.*`, `vite.prismaProxy.config.*`, and so on). The untracked `services/prisma-runtime/.venv` and `__pycache__` folders were left behind by the move and deleted; the venv was recreated at `services/leda-runtime/.venv` (same steps as `bootstrap-local.ps1`: `python -m venv` plus the hash-locked requirements). `.gitignore` already ignores it by the new path.
2. Contents: a byte-level replace, in this order, so line endings and encodings are preserved: `PRISMA` to `LEDA`, `Prisma` to `Leda`, `prisma` to `leda`. Skipped: `Directrices/`, any file with a NUL byte, `.gz`, fonts, `.wav`, `.ico`, lockfiles. Before running, no third-party use of the word was found and no mixed-case variants existed.
3. Audio bindings: `schemas/generate_leda_audio_bindings.py` regenerated the Python and TypeScript projections and `schemas/check_leda_audio_bindings.py` passed (the pinned source hash is regenerated, not hand-edited).

Side effect handled by hand: the substitution renamed this very document, so it was moved back to its original name and rewritten.

## Migration design (L2)

- Local state and master key: `Invoke-LedaLegacyLocalMigration` in `services/leda-runtime/operations/runtime-environment.ps1`, called by `start-local.ps1` and `bootstrap-local.ps1` before `Initialize-LedaRuntimeState`. Both run before any read of the key or the state. It COPIES (never moves, never deletes, never overwrites):
  - `%LOCALAPPDATA%\CoreAnalytics\Prisma` to `...\Leda` when the new one does not exist, staged in `Leda.migrating` and renamed into place; the `run\` folder is not copied; files whose names contain `prisma` are renamed inside the copy; DACLs are preserved. Skipped only when `LEDA_RUNTIME_STATE_DIR` points somewhere other than the default dir (the launcher exports the default path itself before migrating, which still migrates).
  - `...\PrismaCredentialKey\master.key` to `...\LedaCredentialKey\master.key` when the new key is missing: staged in `LedaCredentialKey.migrating`, which first receives the protected DACL of the old key directory, then the key byte for byte with its DACL (copy verified), then renamed into place.
  - Both fail closed: if any access rule cannot be copied, the staging directory is removed and the launcher stops with an error naming the path, rather than leaving unprotected credentials. A stale staging directory is replaced on the next run.
  - It is idempotent and logs what it did. Python keeps resolving only the new default paths, so the two views agree.
- Shared HMI configuration keys: `HmiConfigStore._migrate_legacy_keys` runs once when the store opens its database, copies the old value when the new key is absent, deletes the old key and bumps the revision once, and only when a legacy row actually moved (the check runs inside the immediate transaction, so a second opener that lost the race does not bump again).
- Browser keys: `hmi-app/src/utils/legacyPrismaStorageMigration.ts`, called at the top of `bootstrap()` in `main.tsx`, before the shared configuration loads (its local fallback reads the new keys). It covers `hmi:prisma-hmi-name`, `hmi:prisma-orb-visual-config` and `hmi-prisma-voice-prebuffer-history`. The five content keys the bootstrap fallback reads never contained the old name, so they need no migration. The cached copy of the server document (`hmi:shared-config-cache`) is not rewritten; the next load replaces it.

RED/GREEN evidence:

- Browser: `npx vitest run src/utils/legacyPrismaStorageMigration.test.ts` failed on the missing module (RED), then 6 passed (GREEN).
- Server keys: `unittest tests.test_hmi_config_legacy_keys` failed on the missing import `LEGACY_PRISMA_KEY_RENAMES` (RED), then passed together with `tests.test_hmi_config` (28 tests, GREEN).
- Local state and key: `unittest tests.test_legacy_state_migration` failed 13 of 13 on the missing PowerShell functions and wiring (RED), then passed 13 of 13 (GREEN).

## Intentional leftover hits for the old name

- `services/leda-runtime/operations/runtime-environment.ps1`, `start-local.ps1`, `bootstrap-local.ps1`: the migration names the old directories and file names.
- `services/leda-runtime/src/leda_runtime/hmi_config_store.py`: the old shared keys.
- `hmi-app/src/utils/legacyPrismaStorageMigration.ts`: the old browser keys.
- `hmi-app/src/main.tsx`: imports and calls `migrateLegacyPrismaStorageKeys`.
- `services/leda-runtime/tests/test_legacy_state_migration.py`, `test_hmi_config_legacy_keys.py`, `hmi-app/src/utils/legacyPrismaStorageMigration.test.ts`: fixtures for those migrations.
- `services/leda-runtime/README.md` ("One-time migration" section) and `tools/dev-launcher/README.md` (key row): document the migration.
- This feature document.
- `.engram/chunks/*.jsonl.gz`: compressed Engram export, history, not rewritten.

## Follow-ups for the parent

- The rewritten docs cite Engram topic keys such as `backlog/leda-dual-channel-assistant` and `odd/leda-*/tasks`. The real Engram observations are still stored under the `prisma` spelling; re-key them (or accept the mismatch) so the documented lookups work.
- The cookie and header renames invalidate existing admin sessions: log in again.

## Progress

- 2026-10-01: inventory done (read-only mapper). Feature document created.
- 2026-10-01: L1 done in `862c706`: scripted rename of paths, identifiers, copy and docs; bindings regenerated. Gates: `tsc -b`, lint, build clean; vitest 3772 passed and 1 flaky Topbar test that passes in isolation; Python unittest 1836 passed.
- 2026-10-01: L2 done in `af14112`: migrations for local state, master key, shared keys and browser keys, with tests.
- 2026-10-01: L3 done: copy reviewed (Spanish "usted", feminine agreement in "Leda quedó vinculada" and "Leda está lista", health JSON `"assistant": "Leda"`, tab label "Leda"); READMEs updated; leftover hits listed above.
- Next: L4 live check by the parent.
- 2026-10-01 L4 live check (parent):
  - Bug 1:
    - First start: the presentation service crashed with `LEDA_CHANNEL_A_CREDENTIAL_UNAVAILABLE`.
    - Cause: `start-local.ps1` exports `LEDA_RUNTIME_STATE_DIR` (the default path) before it calls the migration, and the migration read any set variable as an override, so it skipped the state copy. The startup then created an empty `Leda` dir.
    - Fix: `e45608c`. The copy is skipped only when the variable points somewhere other than the default. Test RED, then GREEN 14/14.
    - The incomplete dir was set aside as `%LOCALAPPDATA%\CoreAnalytics\Leda.incomplete-20261001-1150`, not deleted.
  - Bug 2 (security relevant):
    - The copies lost their PROTECTED DACLs. On Windows PowerShell 5.1, `SetAccessControl` with a security object that was only read persists nothing and raises nothing.
    - `LedaCredentialKey\master.key` and `Leda\credentials` inherited the parent's rules, including read for `CodexSandboxUsers`. The runtime's permission checker rejected them (`AUTH_STORAGE_PERMISSIONS_INVALID`), failing closed.
    - Fix: `ff348ac`. A new `Copy-LedaAccessRules` copies through the SDDL form, and the key migration now copies the key DIRECTORY rules too. Tests RED (2 failed), then GREEN 16/16.
    - The existing copies were hardened in place with the same helper. icacls now matches the originals: SYSTEM, Administradores and the user only.
  - Result:
    - Leda started from `services/leda-runtime`. Health reports `"assistant":"Leda"` and the voice provider `configured: true, source: protected`, so the credentials decrypted from the migrated store.
    - The dev launcher `tools/dev-launcher/CoreAnalytics.cmd` brought up Vite, and `/api/leda/*` proxies through it with 200.
    - In the control Chrome:
      - the topbar shows the "Leda" button when access is revealed;
      - the dashboards load;
      - the browser keys were migrated to `hmi:leda-*`;
      - the Leda panel generates the Channel A QR (Channel A credential readable).
    - Inert legacy browser keys `hmi:prisma-runtime-mode` and `hmi:prisma-voice-tts-service-url` remain. Nothing reads them; this is harmless.
- 2026-10-01: native-review fixups M1-M7:
  - M5 `bd7618d` (helper renamed to `ConvertTo-LedaName`) and M6 `13dd185` (module renamed to `legacyPrismaStorageMigration.ts`, `migrateLegacyPrismaStorageKeys`): refactors, tests stayed green (6 and 16 passed).
  - M3 `f179eb4`: `test_legacy_state_migration` and the PowerShell classes of `test_python_environment` skip on non-Windows and no longer read `SystemRoot` at import. RED: with `SystemRoot` unset the import raised `KeyError: 'SystemRoot'`; GREEN: with `SystemRoot` unset and `sys.platform` patched to linux, 47 tests ran, 38 skipped, none errored. The other import-time `SystemRoot` reads in `test_operations.py` and `test_runtime_safety.py` sit inside test methods, not at import, so discovery does not error there; they were left alone.
  - M1 and M2 `7756b52`: both migrations fail closed and the key is staged (`LedaCredentialKey.migrating`, directory DACL first, byte verification, rename). RED: 7 new tests failed; GREEN: 24 of 24.
  - M7 `5c2febd`: the legacy-key check and the revision bump moved inside `BEGIN IMMEDIATE`, bumping only when a row moved. RED: the second-opener test saw revision 3 instead of 2; GREEN: 29 passed with `test_hmi_config`.
  - M4: README and the Migration design above state the current override rule and the fail-closed behavior.
  - Gates: `tsc -b` clean, lint clean, vitest 3779 passed, build ok, offline backend gate 1867 tests OK (PAC5 exit 0).
