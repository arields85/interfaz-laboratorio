# Rename Prisma to Leda — ODD feature document

> ODD feature task (not SDD). Branch `feat/rename-prisma-to-leda`, stacked on `feat/shared-config-hidden-access`.
> Engram: decision `decision/rename-prisma-to-leda`; mirror `odd/rename-prisma-to-leda/tasks`.

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
- Every document is rewritten, including the `odd/tasks` history and `PRISMA_HISTORIAL_CURADO.md`. Git keeps the original wording.
- The Lucide `Pyramid` icon stays: it is a generic icon name.

## Inventory (2026-10-01)

- About 7,100 occurrences in about 252 files, plus about 100 file paths and 3 folders. There is no third-party "Prisma" (no ORM).
- About 20 real env vars, including `PRISMA_RUNTIME_STATE_DIR`, `PRISMA_CREDENTIAL_MASTER_KEY_FILE` and `PRISMA_DEV_*`.
- The cookie `prisma_admin_session` and the header `X-Prisma-Session-Capability` change. Existing admin sessions are invalidated.
- The audio schema hash `PRISMA_AUDIO_METRIC_SCHEMA_SOURCE_SHA256`: regenerate the bindings after the rename.
- Stop the runtime processes before moving state (process manifest and module names). Recreate the `.venv`, whose path changes with the folder.

## Tasks

- [ ] L1 — Scripted rename: `git mv` the folders and every path containing prisma, then case-ordered content substitution over the tracked files (exclusions: `Directrices/`, binaries such as `.ico`, lockfiles). Regenerate the audio schema bindings. Get all gates green.
- [ ] L2 — Migration of the local state and browser and shared keys: a one-time runtime or launcher step for the state dir, the master key and the state files, plus migration of the client and server storage keys. Tests.
- [ ] L3 — Manual pass over the visible copy (UI, runtime reply texts, health JSON), the launcher, the READMEs and the docs. A final `rg -i prisma` must return only intentional hits, each documented.
- [ ] L4 — Live check: restart the runtime from the new path, then confirm credentials are intact, the HMI loads, login works and Leda answers. Also verify the dev launcher and the control Chrome.

## TDD

- Mode: strict, ON.
- Runners:
  - hmi-app: `npm test`.
  - Runtime: the offline gate per the runtime README.
- A mechanical rename keeps the existing tests as the regression net. The migration (L2) gets RED/GREEN tests.

## Progress

- 2026-10-01: inventory done (read-only mapper). Feature document created.
