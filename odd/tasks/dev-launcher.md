# Dev launcher — bring the desktop launcher into the repo, readiness-triggered browser open, orange spinner

## Objective

The user's desktop launcher (`C:\Users\Ariel De Simone\Desktop\CoreAnalitycs\CoreAnalitycs.bat`,
outside the repo, not touched by this task) hardcodes an absolute project path and opens the
browser after a fixed 3 s delay regardless of whether Prisma/Vite are actually ready. Separately,
the Prisma startup wait indicator's animated "..." text is grey and dot-based; the user wants an
orange `| / - \` classic spinner instead. Three independent, bounded tasks:

- **L1** — commit an equivalent launcher inside the repo at `tools/dev-launcher/`, dev-only,
  excluded from `git archive` and never touched by the hmi-app Vite build or Prisma's own
  packaging/bootstrap scripts.
- **L2** — `hmi-app/scripts/dev.mjs` opens the browser itself, only once Prisma orchestration has
  settled AND the Vite dev server actually answers, behind an opt-in `--open` flag (never on by
  default, so plain `npm run dev` is unchanged).
- **L3** — `services/prisma-runtime/operations/console-progress.ps1`'s animated wait indicator
  becomes an orange `|/-\` spinner (0.1 s/frame, 0.4 s full cycle) instead of grey animated dots;
  `start-local.ps1`'s `Wait-VoiceReady`/`Wait-PresentationReady` tick it at that cadence.

## Scope / non-goals

- Never modify the user's actual Desktop `.bat` file — this task produces the in-repo replacement
  and reports what the Desktop shortcut should point to instead; the parent applies that.
- Never start the real launcher, Prisma runtime, or Vite dev server as part of verification.
- No change to Prisma's own startup/health-check timeout budget (still 30 attempts) — only the
  spinner's internal tick rate inside each 1 s attempt changes.
- No change to non-TTY (redirected stdout) wait-indicator behavior — it keeps printing the label
  once, unanimated (existing test-locked contract).

## TDD mode

Strict TDD, per session configuration ("Strict TDD Mode: enabled").
- JS/TS (`dev.mjs`): `hmi-app`'s vitest (`npx vitest run`), RED observed before implementation.
- PowerShell (`console-progress.ps1`, `start-local.ps1`): the existing Python `unittest`
  subprocess-harness style in `services/prisma-runtime/tests/test_runtime_safety.py`, RED observed
  before implementation.
- `tools/dev-launcher/CoreAnalytics.cmd` and its `README.md`: no test harness exists in this repo
  for batch scripts (the pre-existing `bootstrap-local.cmd` has none either) and the script must
  not be executed for real per this task's isolation constraints (it starts a new window running
  `npm run dev`). TDD does not apply; verified instead by careful static review plus the
  deployment/build exclusion grep below.

## Tasks

- [x] L1 — `tools/dev-launcher/CoreAnalytics.cmd` (path derived from `%~dp0`, no hardcoded
      absolute path, master-key env var kept as a default), `tools/dev-launcher/README.md`
      (English), `.gitattributes` marking the folder `export-ignore`; grep evidence that nothing
      in the hmi-app Vite build or Prisma's own bootstrap/packaging scripts references
      `tools/dev-launcher`.
- [x] L2 — `dev.mjs` gains an opt-in readiness-triggered browser open: Prisma settling (already
      ordered before Vite spawns) + an HTTP poll of the Vite dev server URL, raced against Vite
      exiting early; opens via the same `cmd /c start "" chrome.exe <url>` semantics as today,
      with the browser command/spawn and URL injectable for tests; on timeout or Vite exiting
      first, warns instead of opening. TDD: new vitest cases first (RED), then implementation.
- [x] L3 — `console-progress.ps1`'s interactive animation becomes a `| / - \` spinner glyph before
      the label, orange (ANSI truecolor/256-color when VT is supported, `DarkYellow` ConsoleColor
      fallback otherwise, unchanged plain non-TTY line). `start-local.ps1`'s two wait loops tick
      the indicator every 100 ms (10 ticks per 1 s health-check attempt) instead of once per
      attempt. Existing dot-based assertions rewritten; new tests added for the spinner sequence,
      the VT-orange path and the non-VT fallback. TDD: RED observed on the rewritten/new Python
      tests before implementation.

## Checks (per task, from the delegation brief)

- `cd hmi-app && npx vitest run` — baseline 221 files / 2531 tests passed (recorded below).
- `npx tsc -b`
- `npm run lint`
- `<repo>\services\prisma-runtime\.venv\Scripts\python.exe -m unittest discover -s <worktree>\services\prisma-runtime -p "test_*.py"` — baseline 1532 tests, 2 known env failures (worktree
  has no local `.venv`; both failures reference the missing worktree-local interpreter path),
  2 skipped. These 2 are pre-existing/environmental, not caused by this task, and are expected to
  remain exactly the same 2 after L3.

## Evidence ledger

| Task | RED evidence | GREEN / checks | Commit |
|---|---|---|---|
| L1 | n/a (no test harness for batch scripts) | grep evidence, static review | pending |
| L2 | vitest new cases fail before implementation | vitest/tsc/lint pass | pending |
| L3 | python unittest new/rewritten cases fail before implementation | python unittest pass (same 2 known env failures) | pending |
