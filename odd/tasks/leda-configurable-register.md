# Configurable register (usted / rioplatense / neutro) — ODD feature document

> ODD feature task (not SDD). Branch `feat/leda-configurable-register` from `main` `dcc3f4a`.
> Engram mirror: `odd/leda-configurable-register/tasks`. Backlog: PW-025 (`backlog/leda-configurable-register`).

## Objective

Today every Spanish text addressed to the user uses "usted" (AGENTS.md §5, docs/CONVENTIONS.md). Add ONE global admin setting with three registers:

- **usted** (default, today's behavior);
- **rioplatense** (vos: "podés", "ingresá", "tu");
- **neutro** (tú: "puedes", "ingresa", "tu").

It applies to Leda's fixed messages (Channel A, Channel B, voice-note replies) and to the HMI UI copy.

## User decisions (2026-10-01)

- Three registers: usted, rioplatense and neutro. Default usted.
- The HMI adopts the setting too, not only Leda.
- Default taken (the user can override): ONE global setting for the HMI and both Leda channels.

## Findings (read-only map, 2026-10-02)

- **Leda answers are not register-dependent.** `answer_from_snapshot` (`local_presentation.py:529+`) is a deterministic, third-person parser ("El lote activo es…"). HMI voice and the orb speak that same text, so they do not change.
- **Runtime fixed messages: about 28**, in 4 modules:
  - `local_presentation.py` constants at :157-165, plus inline literals at :1046, :1052 and :1072;
  - `channel_a_bot.py` templates at :197-234;
  - `voice_transcription.py` reply constants at :70-87, shared by both bots;
  - `channel_a_query.py:81`.
- **The only model prompt is `build_transcription_prompt`** (`voice_transcription.py:146`). It instructs the model to transcribe and does not shape any text the user reads, so it stays as is. TTS has no style instruction and reads the text verbatim.
- **HMI copy is inline.** There is no i18n mechanism, and `channelBAccessCopy.ts` is the only copy module. About 150-300 register-dependent strings sit in ~45 files; most of the ~1,200 Spanish lines are impersonal labels that do not change.
- **Home of the setting:** the shared HMI config store (`HmiConfigStore`, `PUT /api/leda/admin/hmi-config` with session and CSRF, 10 s polling in every browser).
  - The new key `hmi:copy-register`, stored as `{version: 1, register}`, follows the `hmi:leda-hmi-name` precedent.
  - The runtime presentation process already instantiates the store (`local_presentation.py:1603`), so the bots can read it in-process.
  - A missing or invalid value means usted.
- **Tests that enforce usted:**
  - `test_voice_transcription.py:70` and `:174`;
  - about 10 exact-literal assertions in `test_telegram_lifecycle.py` and `test_channel_a_bot.py`;
  - about 40 exact-string assertions across 13 HMI test files.

## Design

- **Runtime.** A copy module holds every fixed message in its three variants. Bots look messages up through a register resolver that reads `hmi:copy-register` from `HmiConfigStore`, with a short TTL cache and a fallback to usted. Messages with a dynamic part (f-strings, `{label}`) get whole-sentence variants, never word swaps.
- **HMI.**
  - A small typed helper, `RegisterCopy = { usted, rioplatense, neutro }`, plus a hook that reads the shared config value, so components pick the active variant.
  - Copy moves into per-area copy modules, next to the components, like `channelBAccessCopy.ts`.
  - Impersonal labels stay as they are.
- **Admin UI.** A "Trato al usuario" selector in Configuración general → Opciones with three options. It is saved with Guardar like the rest of the dialog. The placement is a default; the user can move it.
- **Server validation.** The HMI-config PUT rejects values of `hmi:copy-register` other than the three registers.
- **Rule change.** AGENTS.md §5 and docs/CONVENTIONS.md change from "siempre de usted" to "registro configurable, usted por defecto". New copy must be written in all three registers.

## Tasks

- [x] R1 — Setting: shared-config key, domain type, reader/writer, hook, server validation, and the "Trato al usuario" selector in Opciones. Route: delegated (runtime + HMI).
- [ ] R2 — Runtime: register-aware copy module for the ~28 fixed messages, the register resolver over `HmiConfigStore`, the bot wiring, and a register test matrix that replaces the usted-only guards. Route: delegated.
- [ ] R3 — HMI copy mechanism: the helper and hook, migrating `channelBAccessCopy.ts`, Leda pairing (`LedaPairingControl.tsx`) and auth/login (`LoginOverlay`, `SessionReplacedNotice`, `adminSession.controller`). Route: delegated.
- [ ] R4 — HMI sweep, admin components (`components/admin/**`: dialogs, settings, PropertyDock, BuilderCanvas, VoiceCredentialSettings…). Route: delegated.
- [ ] R5 — HMI sweep, admin pages, widgets, layout, ui and viewer. Route: delegated.
- [ ] R6 — Docs: AGENTS.md §5, docs/CONVENTIONS.md, ADMIN_CONVENTIONS.md and the Leda master document. Close PW-025 in `docs/PENDING_WORK.md`. Route: inline.
- [ ] R7 — Live check (switch the register; check the HMI and both Telegram channels) and native review of the last slice.

## TDD

Strict mode ON (global configuration). Runners:

- runtime: `services/leda-runtime/.venv/Scripts/python.exe -B -m unittest discover -s services/leda-runtime -p 'test_*.py'`, from the monorepo root with a fresh `LEDA_RUNTIME_STATE_DIR` (pass it through `cygpath -w`);
- HMI: `npm test`, `npx tsc -b` and `npm run lint` in `hmi-app`.

## Delivery

- Forecast: about 1,700-2,600 authored changed lines.
- Strategy: `ask-on-risk` with the `feature-branch-chain` chain, the user's earlier choice.
- Work-unit commits on this branch, and a native review per slice.
- Push and merge are the user's decision.

## Acceptance criteria

- With the setting on usted, every text is identical to today.
- Switching to rioplatense or neutro changes the HMI copy (within ~10 s in other browsers) and the Leda fixed messages in both Telegram channels, with no restart.
- Data answers are unaffected.
- An invalid stored value falls back to usted. The server rejects invalid writes.
- All runtime and HMI tests pass. The register tests cover all three variants of every fixed message.

## Progress

- 2026-10-02: code mapped (read-only explorer), feature document created.
- 2026-10-02: R1 done (delegated writer). Commits 46eabb8 (runtime validation, `HMI_CONFIG_INVALID_COPY_REGISTER`) and e155d8d (key `hmi:copy-register`, `CopyRegister` domain type, service, `useCopyRegister` hook, "Trato al usuario" selector in the Opciones tab). RED: runtime tests failed on the missing `copy_register` module; HMI tests failed on missing modules plus the new permanent-code case. GREEN: runtime 2020 tests OK, HMI `npm test` 300 files / 4005 tests, `npx tsc -b` and `npm run lint` clean.
- 2026-10-02: R1 native review (slice `dcc3f4a..817389d`, including the Connection tab icon fix `bacf70e`; medium, 689 lines): granted under standing consent, **approved** and acknowledged (lineage `review-44c21a6ce3229f83`).
  - `R3-001` (`admin_http.py:528-529`, `error.args[0]` without args) is folded into R2.
  - Not fixed: `R3-002` (`copyRegister.ts:26`) and `R3-003` (`ConnectionSettingsTab.tsx:428`).
  - Parent spot check: `test_copy_register.py` OK; the HMI copyRegister suites, 12 tests, OK.
  - R2 started (delegated).
