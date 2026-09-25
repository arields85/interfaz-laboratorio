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

## Mid-cycle user decision (2026-09-24)

Instead of opening the user's default Chrome, the launcher must open a dedicated CONTROL Chrome:
its own profile (`--user-data-dir`, default `%LOCALAPPDATA%\CoreAnalytics\ChromeControl`), a
localhost-only remote debugging port (default `9222`), `--no-first-run`,
`--no-default-browser-check`, and the HMI URL. Rationale (also documented in the README): Chrome
136+ ignores `--remote-debugging-port` entirely on the *default* user-data-dir, so a dedicated
profile is required, not optional; a separate profile also means tooling never touches the user's
personal Chrome profile/history. `createBrowserOpener` (L2) was redesigned to spawn `chrome.exe`
directly (never through `cmd /c start`) so a `--user-data-dir` value containing spaces (the
default does) needs no manual quoting and can never silently fall back to the default profile the
way an incorrectly quoted `cmd /c start` invocation could. Chrome path, user-data-dir and debug
port are configurable via `PRISMA_DEV_CHROME_PATH` / `PRISMA_DEV_CHROME_USER_DATA_DIR` /
`PRISMA_DEV_CHROME_DEBUG_PORT`, defaulting from `%ProgramFiles%`/`%LOCALAPPDATA%` (no
machine-specific absolute path in the repo). A new standalone `tools/dev-launcher/` script opens
only the control Chrome on the HMI URL (for when the dev server is already running), importing
`createBrowserOpener` from `hmi-app/scripts/dev.mjs` so the argument-building logic is shared, not
duplicated. TDD: `createBrowserOpener`'s tests were rewritten first (RED), then reimplemented.

## Tasks

- [x] L1 — `tools/dev-launcher/CoreAnalytics.cmd` (path derived from `%~dp0`, no hardcoded
      absolute path, master-key env var kept as a default), `tools/dev-launcher/README.md`
      (English), `.gitattributes` marking the folder `export-ignore`; grep evidence that nothing
      in the hmi-app Vite build or Prisma's own bootstrap/packaging scripts references
      `tools/dev-launcher`. Plus (mid-cycle decision) `tools/dev-launcher/open-control-chrome.mjs`
      + `OpenControlChrome.cmd`, a standalone control-Chrome-only opener sharing
      `createBrowserOpener` from `dev.mjs`.
- [x] L2 — `dev.mjs` gains an opt-in readiness-triggered browser open: Prisma settling (already
      ordered before Vite spawns) + an HTTP poll of the Vite dev server URL, raced against Vite
      exiting early; opens the dedicated CONTROL Chrome (mid-cycle decision above), with the
      browser command/spawn and URL injectable for tests; on timeout or Vite exiting first, warns
      instead of opening. TDD: new vitest cases first (RED), then implementation; redone in a
      second RED/GREEN round for the control-Chrome redesign. Opt-in is the
      `PRISMA_DEV_AUTO_OPEN=1` env var (not a CLI flag, to avoid colliding with Vite's own
      built-in `--open`).
- [x] L3 — `console-progress.ps1`'s interactive animation becomes a `| / - \` spinner glyph before
      the label, orange (ANSI truecolor `38;2;255;140;0` when VT is supported, detected once at
      dot-source time via a `kernel32.dll` `GetConsoleMode`/`SetConsoleMode` P/Invoke helper;
      `DarkYellow` ConsoleColor fallback otherwise; unchanged plain non-TTY line, now also
      `DarkYellow` for visual consistency). `start-local.ps1`'s two wait loops tick the indicator
      every 100 ms (10 ticks per 1 s health-check attempt, `$tick` drives the frame) instead of
      once per attempt — same ~30 s overall budget. Existing dot-based assertions rewritten; new
      tests added for the spinner sequence/wrap, the VT-orange escape path and the non-VT
      fallback (no escape garbage). TDD: RED observed on the rewritten/new Python tests before
      implementation. Done, commit pending below.

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
| L2 | 11 new vitest cases RED (import/undefined failures) | vitest 221 files/2543 tests, tsc clean, lint clean | `320da6e` |
| L3 | 3 new/rewritten cases RED (old dot-based text, no ANSI) | python unittest 1533 tests, same 2 known env failures + 2 known skipped | `8fae16c` |
| L2 (control Chrome redesign) | 3 rewritten vitest cases RED (old `cmd start`/`chrome.exe` args) | vitest 221 files/2544 tests, tsc clean, lint clean | pending |
| L1 | n/a (no test harness for batch scripts) | grep evidence, static review | pending |
