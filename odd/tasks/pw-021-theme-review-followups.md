# PW-021 — Theme review follow-ups — ODD feature document

> ODD feature task (not SDD). Branch `chore/theme-review-followups` (from main `90a3aa9`).
> Engram mirror: `odd/pw-021-theme-review-followups/tasks`. Backlog detail: `backlog/theme-review-followups`.

## Objective

Close the non-blocking findings left by the native reviews of the 2026-09-29/30 theme work (tab frame shape, charts in the tab shape, icon cutout, link corner accents), and review the unreviewed tail `6d0c56f` + `f27d55e`.

## Problem / why

Findings never expand scope by themselves; they were parked so the features could ship. Most are missing tests or test-guard loopholes; a few are stale or not worth their cost.

## Scope

- In: test-only hardening, the style lab preset sync, a small dedup refactor in the trend charts, pinning the `parseCssLengthPx` unit limit, and A2 once the user decides.
- Out (closed with reason, see "Dropped findings"): A4, B2, B3, C1, C3, C4, C6, C10, D2.
- No user-visible behavior change except A2, and only if the user picks it.

## Constraints

- Read-only HMI rules, design tokens, and conventions in `AGENTS.md` and `docs/CONVENTIONS.md`.
- The dev server serves this checkout, so do not switch branches, and make one write per `index.css` edit.
- About 400 authored lines per task is only a planning guide.

## TDD

- Mode: strict, ON (source: global orchestrator config "Strict TDD Mode: enabled").
- Runner: `npm test` in `hmi-app/` (`vitest run --allowOnly=false`); for a single file, `npx vitest run <path>`.
- Full gate: `npx tsc -b`, `npm run lint`, `npm test` and `npm run build`.
- Test-only tasks cover behavior that already exists, so RED is shown in one of two ways:
  - a guard-helper fix (B1, C5) first proves the loophole with a fixture that the old helper wrongly accepts;
  - a new coverage test is mutation-checked once, by breaking the code under test temporarily.
- Known flaky test: Topbar "continues admin navigation immediately when runtime short is disabled". It passes in isolation.

## Tasks

- [ ] T1 — Test hardening (route: delegated writer, 2+ non-trivial test files)
  - A1: a test that proves the link accent grid fits the viewer content box, not the padded box (`DashboardViewer.linkAccents.test.tsx`).
  - A3: a test that moving the radius slider to exactly its default (5) removes the stored override, unless `linkCornerAccentGeometry.service.test.ts` already covers it.
  - B1: `iconCutout.css.test.ts` splits selector lists only on commas at paren depth 0, using a helper.
  - C5: `tabFrame.css.test.ts` closes the hex guard loophole (`(?!\s*var)`) and fixes the stale test title.
  - C7: the inline `offsetWidth.mockRestore()` calls in `WidgetFrame.test.tsx` move to `afterEach` / `vi.restoreAllMocks()`.
  - C8: re-measure tests for `useTabFrameIconPlacement` and `useTabFrameHeight` (with a mocked ResizeObserver), only where they are missing.
  - D1: a test that the hidden-title sentinel (-1) passes through the reporter and ghosts without drawing.
- [ ] T2 — C9: sync the style lab Instrumento preset with the app (`tools/style-lab/style-lab.html`, radius 5 and its hint text, plus any other stale values). Route: inline.
- [ ] T3 — D3: extract the frame title resolution shared by trend-chart and trend-chart-v2 into one tested helper, with no behavior change. Route: delegated writer.
- [ ] T4 — C2: document that `parseCssLengthPx` supports only px and rem, and pin that limit with a test. Route: delegated writer.
- [ ] T5 — A2: a locked group with a link but no frame. Waiting on the user's decision.
- [ ] T6 — Native review of the slice `e1a8cb7..HEAD`, which includes the tail `6d0c56f` + `f27d55e`. Then close PW-021 in `docs/PENDING_WORK.md` and Engram.

## Dropped findings (cost > value or stale)

- A4: stale. The link accent radius is now a fixed token with no auto fallback.
- B2: the Safari ring clip needs a rendering redesign for a 1 px ring on one browser that is not a target.
- B3: the alert ring color jump needs a new `@property` registration, and state changes are rare.
- C1: the remount on a frame-shape switch is latent, happens only on a theme switch, and the refactor carries medium risk.
- C3: the entrance flash is one commit late, which is imperceptible.
- C4: the fallback band only shows while the title host width is 0, and it was never seen live.
- C6: the radius test has to be mocked because jsdom has no layout. A real-browser test is not worth it.
- C10: the fallback of `normalizeTitleFontSize` only ever receives constants.
- D2: the two-pass strip measure has no visible shift.

## Acceptance criteria

- Every T task is checked off with the observed test output.
- The full gate is green (apart from the known flaky test).
- The native review of the slice is approved.
- PW-021 is removed from the index.

## Progress

- 2026-10-01: PW-020 discarded by the user (`c1b3c57`). Triage done. The tail assessment is medium, 195 lines, `under_budget`, so it stays pending in this slice.
