# Rename Leda to Leda — ODD feature document

> ODD feature task (not SDD). Branch `feat/rename-leda-to-leda`, stacked on `feat/shared-config-hidden-access`.
> Engram: decision `decision/rename-leda-to-leda`; mirror `odd/rename-leda-to-leda/tasks`.

## Objective

The assistant "Leda" is now called **Leda**. Rename everything, visible and technical, before the code is handed to IT for the Docker deployment, so the IT configuration never sees the old names.

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
- Hard cut: no fallback reads of the old `LEDA_*` env vars or `/api/leda/*` routes.
- A one-time migration of the developer's local state so the stored credentials survive:
  - state dir `%LOCALAPPDATA%\CoreAnalytics\Leda` → `...\Leda`;
  - credential key dir `LedaCredentialKey` → `LedaCredentialKey` (master key; critical);
  - state file names;
  - the server-shared keys `hmi:leda-hmi-name` and `hmi:leda-orb-visual-config`;
  - the browser keys `hmi:leda-*`.
- Every document is rewritten, including the `odd/tasks` history and `LEDA_HISTORIAL_CURADO.md`. Git keeps the original wording.
- The Lucide `Pyramid` icon stays: it is a generic icon name.

## Inventory (2026-10-01)

- About 7,100 occurrences in about 252 files, plus about 100 file paths and 3 folders. There is no third-party "Leda" (no ORM).
- About 20 real env vars, including `LEDA_RUNTIME_STATE_DIR`, `LEDA_CREDENTIAL_MASTER_KEY_FILE` and `LEDA_DEV_*`.
- The cookie `leda_admin_session` and the header `X-Leda-Session-Capability` change. Existing admin sessions are invalidated.
- The audio schema hash `LEDA_AUDIO_METRIC_SCHEMA_SOURCE_SHA256`: regenerate the bindings after the rename.
- Stop the runtime processes before moving state (process manifest and module names). Recreate the `.venv`, whose path changes with the folder.

## Tasks

- [ ] L1 — Scripted rename: `git mv` the folders and every path containing leda, then case-ordered content substitution over the tracked files (exclusions: `Directrices/`, binaries such as `.ico`, lockfiles). Regenerate the audio schema bindings. Get all gates green.
- [ ] L2 — Migration of the local state and browser and shared keys: a one-time runtime or launcher step for the state dir, the master key and the state files, plus migration of the client and server storage keys. Tests.
- [ ] L3 — Manual pass over the visible copy (UI, runtime reply texts, health JSON), the launcher, the READMEs and the docs. A final `rg -i leda` must return only intentional hits, each documented.
- [ ] L4 — Live check: restart the runtime from the new path, then confirm credentials are intact, the HMI loads, login works and Leda answers. Also verify the dev launcher and the control Chrome.

## TDD

- Mode: strict, ON.
- Runners:
  - hmi-app: `npm test`.
  - Runtime: the offline gate per the runtime README.
- A mechanical rename keeps the existing tests as the regression net. The migration (L2) gets RED/GREEN tests.

## Progress

- 2026-10-01: inventory done (read-only mapper). Feature document created.
