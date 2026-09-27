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
| L2 (control Chrome redesign) | 3 rewritten vitest cases RED (old `cmd start`/`chrome.exe` args) | vitest 221 files/2544 tests, tsc clean, lint clean | `10f3c9a` |
| test fixture cleanup | n/a | vitest 49/49 in dev.test.ts | `c696322` |
| L1 | n/a (no test harness for batch scripts) | grep + `git check-attr` evidence (below), static review, vitest 221/2544, tsc clean, lint clean | `09ab126` |

### L1 build/deployment exclusion evidence

- `git check-attr export-ignore -- tools/dev-launcher/CoreAnalytics.cmd tools/dev-launcher/README.md hmi-app/scripts/dev.mjs`
  → `tools/dev-launcher/CoreAnalytics.cmd: export-ignore: set`, `.../README.md: export-ignore: set`,
  `hmi-app/scripts/dev.mjs: export-ignore: unspecified` — `git archive` will exclude the folder.
- `hmi-app/vite.config.ts` has no `root:` override (defaults to `hmi-app/`) and
  `hmi-app/tsconfig.app.json` only `"include": ["src"]` — the production build never reads
  outside `hmi-app/src`.
- Grep for `tools/dev-launcher` (and its Windows-path spelling) across `*.ps1/.psm1/.mjs/.js/.ts/.json/.cmd`
  found exactly one hit outside `tools/dev-launcher/` itself: a documentation comment in
  `hmi-app/scripts/dev.mjs` naming the standalone tool (the dependency direction is
  `tools/dev-launcher` → `hmi-app/scripts/dev.mjs`, never the reverse) — no functional coupling.
- `services/prisma-runtime/operations/*.ps1` bootstrap/packaging scripts: the only
  `Get-ChildItem`/`Copy-Item`/`Compress-Archive` use is `runtime-environment.ps1`'s sweep of stale
  `prisma_voice_config.json.*.tmp` files under Prisma's own state root — unrelated to `tools/`.

## Closure

All three tasks (L1, L2, L3) plus the mid-cycle control-Chrome decision are done, committed on
`feat/dev-launcher`, and independently green. Final full-suite verification (after all six
commits): `npx vitest run` → 221 files / 2544 tests passed; `npx tsc -b` → clean; `npm run lint` →
clean; the worktree's own Python runtime suite → 1533 tests, same 2 pre-existing/environmental
failures (both reference the worktree's missing local `.venv` interpreter, not caused by this
task) and 2 skipped, unchanged from the recorded baseline.

Six commits on `feat/dev-launcher`: `983354b` (task doc), `320da6e` (L2 readiness-triggered open),
`8fae16c` (L3 orange spinner), `10f3c9a` (L2 control-Chrome redesign), `c696322` (test fixture
privacy cleanup), `09ab126` (L1 in-repo launcher).

Residuals / follow-ups, not hidden:
1. `tools/dev-launcher/CoreAnalytics.cmd` and `OpenControlChrome.cmd` have no automated test
   coverage (no harness exists in this repo for batch scripts) and were never executed for real
   during this task, per the isolation constraint against starting the real launcher/Vite. They
   were syntax-reviewed statically; `open-control-chrome.mjs`'s import of `dev.mjs` was confirmed
   to resolve via a safe, side-effect-free `node --check` + dynamic-import probe.
2. The GGA pre-commit reviewer flagged minor, non-blocking readability duplication in
   `dev.test.ts` (`createNoopPortGuard`/`createRuntimeStub` declared both at top-level and inside
   the L2 describe block) across two commits; left as-is since it does not affect behavior or
   coverage, and fixing it was outside the requested scope.
3. The parent must still replace the user's actual Desktop shortcut
   (`C:\Users\Ariel De Simone\Desktop\CoreAnalitycs\CoreAnalitycs.bat`) — this task never touched
   it. See the final handback report for the exact replacement target.

## K1 — wait indicator: default-foreground label + blinking caret (2026-09-27)

Live test (2026-09-27) feedback on L3's orange `|/-\` spinner:

- (a) the label must print in the SAME color as the npm lines above it (the console's own default
  foreground), not orange — remove the ANSI truecolor path and the `DarkYellow` fallback entirely
  (`console-progress.ps1`'s `Test-PrismaVirtualTerminalSupport` helper and its VT-state script
  variables are unused anywhere else in the repo, confirmed by grep, so removed cleanly rather than
  kept dead).
- (b) replace the `|/-\` spinner with the blinking underscore caret already used elsewhere in the
  HMI ("Cargando_" / `.widget-runtime-state-caret` in `hmi-app/src/index.css`): the label followed
  immediately (no space) by a `_` that alternates visible/hidden at the same 0.6 s cycle / 50% duty
  (~0.3 s each phase). `start-local.ps1`'s existing 100 ms tick (`$tick`, unchanged) means 3 ticks =
  one phase; `Update-PrismaWaitIndicator` now derives the caret from `[Math]::Floor($FrameIndex / 3)
  % 2` instead of the old 4-glyph spinner-frame index. The hidden phase overwrites the caret with a
  space (never omits it), so the line length never changes and no stray `_` is ever left behind.
  Overall ~30 s health-check budget, non-TTY (print-once, unanimated) behavior, and clear-on-ready
  all unchanged.

Route: direct inline (one already-understood file — `console-progress.ps1` — plus its Python test
file; no cross-cutting design left after L3).

TDD: Strict, same runner as L3 (`services/prisma-runtime/tests/test_runtime_safety.py`, Python
`unittest` subprocess-harness style). RED observed before implementation.

Checks: same as above (`test_runtime_safety.py`'s progress-indicator tests; full runtime suite
baseline 1791/1791 modulo the 2 known pre-existing worktree-`.venv` environmental failures).

### K1 evidence

- RED: rewrote `test_wait_indicator_cycles_the_orange_spinner_glyph_and_clears_it_when_the_console_is_interactive`
  into `test_wait_indicator_blinks_a_trailing_caret_after_the_label_and_clears_it_when_the_console_is_interactive`
  (asserts `"{label}_"`/`"{label} "` prefixes across FrameIndex 0-6 and a constant line length) and
  `test_wait_indicator_uses_orange_ansi_truecolor_around_the_spinner_when_vt_is_supported` into
  `test_wait_indicator_never_applies_any_color_matching_the_npm_output_lines_above_it` (structural:
  no `ForegroundColor`/`DarkYellow`/`38;2;255;140;0`/`prismaSpinnerFrames`/
  `Test-PrismaVirtualTerminalSupport` in source; behavioral: no `\x1b` anywhere). Both failed against
  the pre-fix source for the expected reason: `'| Starting Prisma voic' != 'Starting Prisma voice_'`
  (old spinner-glyph-before-label output) and `'ForegroundColor' unexpectedly found in <source>`.
- Fix: `console-progress.ps1` rewritten — removed `Test-PrismaVirtualTerminalSupport`,
  `$script:prismaSpinnerFrames`, `$script:prismaOrangeAnsiTrueColor`, `$script:prismaAnsiReset`,
  `$script:prismaVirtualTerminalEnabled` (grep-confirmed unused elsewhere in the repo);
  `Start-PrismaWaitIndicator`'s non-TTY line and `Update-PrismaWaitIndicator`'s interactive line
  both drop `-ForegroundColor` entirely. `Update-PrismaWaitIndicator` now computes
  `$phase = [Math]::Floor($FrameIndex / 3)`, caret = `'_'` when `$phase % 2 -eq 0` else `' '`, text =
  `"$Label$caret"` padded to the same 40-char width. `start-local.ps1`'s tick loops and comments
  updated to describe the caret instead of the retired spinner (no behavior change — same 100 ms
  tick, same ~30 s budget).
- GREEN: the 2 rewritten tests + `test_wait_indicator_prints_one_plain_line_when_output_is_not_a_tty`
  + `test_start_local_wires_the_progress_indicator_around_both_health_waits`, all passing. Full
  runtime suite: 1791/1791 modulo the same 2 known pre-existing worktree-`.venv` environmental
  failures, 2 skipped — unchanged from baseline (K1 adds no new test count since it rewrote existing
  tests rather than adding new ones).
- Commit: `8ddf80b`.
