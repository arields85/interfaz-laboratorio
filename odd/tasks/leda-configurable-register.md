# Configurable register (usted / rioplatense / neutro) — ODD feature document

> ODD feature task (not SDD). Branch `feat/leda-configurable-register` from `main` `dcc3f4a`.
> Engram mirror: `odd/leda-configurable-register/tasks`. Backlog: PW-025 (`backlog/leda-configurable-register`).

## Objective

Today every Spanish text addressed to the user uses "usted" (AGENTS.md §5, docs/CONVENTIONS.md). Add ONE global admin setting with three registers:

- **usted** (default, today's behavior);
- **rioplatense** (vos: "podés", "ingresá", "tu");
- **neutro** (tú: "puedes", "ingresa", "tu").

It applies ONLY to Leda's fixed messages (Channel A, Channel B, voice-note replies). The HMI UI copy stays in usted (user decision 2026-10-02).

## User decisions (2026-10-01)

- Three registers: usted, rioplatense and neutro. Default usted.
- ~~The HMI adopts the setting too~~ — superseded on 2026-10-02: the user clarified that only Leda changes; the HMI stays in usted. ("La hmi también lo adopta" had been read as the HMI copy changing too.)
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
- **Admin UI.** A "Trato al usuario" selector with three options. R1 put it in Opciones; because the setting now affects only Leda, R3 moves it to the Leda tab and makes its helper text say it changes how Leda addresses people.
- **Server validation.** The HMI-config PUT rejects values of `hmi:copy-register` other than the three registers.
- **Rule change.** AGENTS.md §5 and docs/CONVENTIONS.md: HMI text stays always in usted; Leda's fixed messages follow the configurable register (usted by default), and every new Leda fixed message must be added to `leda_copy.py` in all three registers.

## Tasks

- [x] R1 — Setting: shared-config key, domain type, reader/writer, hook, server validation, and the "Trato al usuario" selector in Opciones. Route: delegated (runtime + HMI).
- [x] R2 — Runtime: register-aware copy module for the ~28 fixed messages, the register resolver over `HmiConfigStore`, the bot wiring, and a register test matrix that replaces the usted-only guards. Route: delegated.
- [x] R3 — Move the "Trato al usuario" selector from Opciones to the Leda tab, with Leda-only helper text, keeping the dialog's Guardar flow. Route: delegated.
- [-] ~~R4 — HMI sweep, admin components~~ — cancelled (scope is Leda only).
- [-] ~~R5 — HMI sweep, admin pages, widgets, layout, ui and viewer~~ — cancelled (scope is Leda only). The first R3 attempt (HMI copy mechanism, commit `0b30545` plus uncommitted area changes) was stopped and discarded with `git reset --hard 5cedde5`.
- [ ] R6 — Docs: AGENTS.md §5, docs/CONVENTIONS.md, ADMIN_CONVENTIONS.md and the Leda master document. Close PW-025 in `docs/PENDING_WORK.md`. Route: inline.
- [ ] R7 — Live check (switch the register; check both Telegram channels; the HMI copy stays usted) and native review of the last slice.

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
  - R2 done (delegated writer). Commits bb7a237 (`fix(leda-runtime)`: R3-001, a code-less `HmiConfigInvalid`/`HmiConfigTooLarge` now answers `HMI_CONFIG_INVALID_REQUEST`/`HMI_CONFIG_DOCUMENT_TOO_LARGE` instead of an `IndexError` 500) and 220752c (register-aware fixed messages).
  - Design: `leda_copy.py` holds 23 message ids as `{usted, rioplatense, neutro}` whole-sentence templates (`leda_text`, `leda_template`); the usted variants are byte-identical to the previous literals and the old constant names stay importable as the usted values. `copy_register.py` adds `CopyRegisterResolver` (TTL 5 s, injectable clock, any store failure reads as usted) and `active_register`. `create_app` builds one `HmiConfigStore` and one resolver, shared by the admin boundary, the Channel B bot factory, the Channel A activation (dialogue and query notice) and `/local/ask`.
  - Message ids: no_dashboard_open, access_requested, access_requests_full, access_request_hint, access_pending, access_denied, access_approved, message_limit, migration_restart, bot_ready, bot_help, voice_note_too_long, voice_note_too_large, voice_note_download_failed, voice_note_transcription_empty, voice_note_transcription_unavailable, confirmation_prompt, welcome, destination_unavailable, action_refused, inactivity_warning, unlink_confirm_prompt, query_unavailable.
  - RED: 7 test modules failed to import (`leda_copy`, `COPY_REGISTER_TTL_SECONDS`, `active_register` missing) and the R3-001 case returned 500 instead of 400. GREEN: runtime 2075 tests OK (was 2020).
  - Known limit: Channel A hands `answer_from_snapshot` itself as `parse` (pinned by `test_channel_a_root`), so its no-dashboard text stays usted; that branch is practically unreachable there because Channel A fails closed on a missing context (only a context without a `widgets` list would hit it).
- 2026-10-02: R3 done (delegated writer). Commit e8912d5 (`feat(admin)`: selector moved from Opciones to the Leda tab). Opciones restored to its pre-R1 behavior (files checked out from `dcc3f4a`, plus a test that it no longer renders the selector). The helper text now says it changes how Leda addresses people in its messages (Telegram, Canal A y Canal B) and that the HMI does not change.
  - Placement: `VoiceSettingsTab.tsx:314`, after the credential blocks (name, Gemini, Channel B access) and above the playback buffer and voice effects sections.
  - Save model: the Leda tab's shared Guardar (`handleSave`, one `saveRef`), the same one the orb and voice config use; credential sections keep saving on their own and are not touched. The register has a draft and a saved copy: a change calls `markPersistentEdit` (dirty), Guardar writes `hmi:copy-register` once and only if it differs from the saved value (after the voice-config validity check, so an invalid save writes nothing), and returning to the saved value clears dirty. Descartar is the dialog's discard (unmounting the tab), so nothing is written.
  - RED: 5 new tests failed (selector missing from the Leda tab). GREEN: HMI `npm test` 300 files / 4008 tests, `npx tsc -b` and `npm run lint` clean. The pre-commit review passed.
