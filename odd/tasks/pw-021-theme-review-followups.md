# PW-021 — Theme review follow-ups — ODD feature document

> ODD feature task (not SDD). Branch `chore/theme-review-followups` (from main `90a3aa9`).
> Engram mirror: `odd/pw-021-theme-review-followups/tasks`. Backlog detail: `backlog/theme-review-followups`.

## Objective

Close the non-blocking findings left by the native reviews of the 2026-09-29/30 theme work (tab frame shape, charts in the tab shape, icon cutout, link corner accents), and review the unreviewed tail `6d0c56f` + `f27d55e`.

## Problem / why

Findings never expand scope by themselves; they were parked so the features could ship. Most are missing tests or test-guard loopholes; a few are stale or not worth their cost.

## Scope

- In: test-only hardening, the style lab preset sync, a small dedup refactor in the trend charts, pinning the `parseCssLengthPx` unit limit, and A2 once the user decides.
- Out (closed with reason, see "Dropped findings"): A2 (false positive, see T5), A4, B2, B3, C1, C3, C4, C6, C10, D2.
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

- [x] T1 — Test hardening (route: delegated writer, 2+ non-trivial test files)
  - A1: a test that proves the link accent grid fits the viewer content box, not the padded box (`DashboardViewer.linkAccents.test.tsx`).
  - A3: a test that moving the radius slider to exactly its default (5) removes the stored override, unless `linkCornerAccentGeometry.service.test.ts` already covers it.
  - B1: `iconCutout.css.test.ts` splits selector lists only on commas at paren depth 0, using a helper.
  - C5: `tabFrame.css.test.ts` closes the hex guard loophole (`(?!\s*var)`) and fixes the stale test title.
  - C7: the inline `offsetWidth.mockRestore()` calls in `WidgetFrame.test.tsx` move to `afterEach` / `vi.restoreAllMocks()`.
  - C8: re-measure tests for `useTabFrameIconPlacement` and `useTabFrameHeight` (with a mocked ResizeObserver), only where they are missing.
  - D1: a test that the hidden-title sentinel (-1) passes through the reporter and ghosts without drawing.
- [x] T2 — C9: sync the style lab Instrumento preset with the app (`tools/style-lab/style-lab.html`, radius 5 and its hint text, plus any other stale values). Route: inline.
- [x] T3 — D3: extract the frame title resolution shared by trend-chart and trend-chart-v2 into one tested helper, with no behavior change. Route: delegated writer.
- [x] T4 — C2: document that `parseCssLengthPx` supports only px and rem, and pin that limit with a test. Route: delegated writer.
- [x] T5 — A2: dropped as a false positive (2026-10-01). The user pointed it out and the code confirms it: `showFrame` ("Mostrar fondo y marco") exists only for the header-compatible widgets `status` and `connection-status` (`utils/headerWidgets.ts:3`, `getWidgetFrameOption`). A group always draws its frame in the grid, so its link accents always show.
- [x] T6 — Native review of the slice `e1a8cb7..HEAD`, which includes the tail `6d0c56f` + `f27d55e`. Then close PW-021 in `docs/PENDING_WORK.md` and Engram.

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

- 2026-10-01 (writer) T1-T4 done; strict TDD, delegated writer.
  - T1 (`532ae70`, `495684a`, `45db72a`, `d15c2ea`, `432f23a`, `d6b1442`):
    - A1 + A3 (`532ae70`): the link accents suite proves the grid follows the observer content box (800x450 content vs 820x470 border box); mutation (hook reading `borderBoxSize`) gave RED 1 failed / 16 passed, restored 17 passed. A3: `linkCornerAccentGeometry.service.test.ts` has no UI path for it, so a Tema test was added (radius moved to 5 clears the root property, disables Restablecer, save removes the key); mutation of the default check in `linkCornerAccents.service.ts` gave RED (the new test and 4 neighbours failed), restored 29 passed.
    - B1 (`495684a`): `splitTopLevel` helper (also used by the specificity helper, which now takes one nested paren level). RED: `npx vitest run src/iconCutout.css.test.ts` 2 failed / 16 passed (fixture `.glass-panel:is(.a, [data-icon-cutout])` wrongly accepted; helper missing); GREEN 18 passed.
    - C5 (`45db72a`): `hardcodedHexColors` helper over the comment-stripped block, only the `color-mix(in srgb, #fff` base allowed; stale test title fixed. RED: `npx vitest run src/tabFrame.css.test.ts` 1 failed / 24 passed (`#ff0000 var(--x)` accepted by the old `(?!\s*var)`); GREEN 25 passed.
    - C7 (`d15c2ea`): the three inline `mockRestore()` calls moved to an `afterEach` `vi.restoreAllMocks()` in the width reporting describe; 57 passed (refactor, no RED).
    - C8 (`432f23a`): `useTabFrameWidths`-style hook suites added for `useTabFrameIconPlacement` and `useTabFrameHeight` (document style mutation re-measure, tab height change, inactive null). Mutation (removing the `MutationObserver.observe` in both) gave RED 2 failed / 5 passed; restored 7 passed. Skipped: the ResizeObserver re-measure of `useTabFrameHeight`, already covered by `WidgetFrame.test.tsx` "re-caps live when the widget is resized".
    - D1 (`d6b1442`): ghosts and selection frame already covered the sentinel (`ViewerEntranceFrameOverlays.tabFrame.test.tsx`, `GridSelectionFrame.tabFrame.test.tsx`, `WidgetFrame.trailing.test.tsx`); the gap was the reporter, so a `useTabFrameWidths` test keeps -1 as a present entry. Mutation (reporter dropping negative widths) gave RED 1 failed / 7 passed; restored 8 passed.
  - T2 (`e9baeb4`): lab Instrumento frame preset synced to the app: rest radius 3 to 5, border 8 to 12, accent length 20 to 25; hover radius 3 to 5. Button, icon, tag and group values already matched. No hint text mentions the radius (the ~1233 hint is about the tab), so none changed. Lab only; no test applies.
  - T3 (`b282557`): `utils/trendChartTitle.ts` (`resolveTrendChartTitle` keeps `??`, `resolveTrendChartV2Title` keeps `||`) used by both renderers. RED: `npx vitest run src/utils/trendChartTitle.test.ts` import failed (module missing); GREEN 5 passed; trend chart suites 98 passed. Tooltip series names (`widget.title ?? ...`) left as they were: a different rule, so no behavior change.
  - T4 (`06719ad`): doc comment states that em, %, vw, vh, ch and others read as 0; a test pins it. Mutation (adding `em` to the regex) gave RED 1 failed / 28 passed; restored 29 passed.
  - Gate (hmi-app): `npx tsc -b` clean; `npm run lint` clean; `npm test` 274 files / 3640 passed; `npm run build` built.
- 2026-10-01 T6:
  - Assessment of `e1a8cb7..5a989f1`: medium risk, 615 lines, `slice_budget_reached`.
  - Native review: lineage `review-6339417ca7dc6b3e`, one lens (reliability), consent granted under the standing consent. It was approved and acknowledged; authority is burned. The reviewed boundary is now `5a989f1`.
  - The review left two advisory findings, both fixed inline in `802a64a`:
    - `R3-offsetwidth-spy-restore-not-visible`: the "tab width reporting" describe in `WidgetFrame.test.tsx` had no restore. It now has `afterEach(vi.restoreAllMocks)`. This is cleanup only, so there is no RED.
    - `R3-stale-auto-radius-comment`: the comment in `index.css` `.hmi-link-accents` no longer says "auto"; it names the `--link-accent-radius` setting (default 5 px).
  - Check: `npx vitest run` on `WidgetFrame.test.tsx` and `linkCornerAccents.css.test.ts` passed 65 of 65.
  - `802a64a` is left unreviewed (test cleanup plus a CSS comment, under the budget) for the next slice.
- Closed: PW-021 removed from `docs/PENDING_WORK.md`; the Engram backlog `backlog/theme-review-followups` is closed.

## Next step

None. The feature is complete. Merging into main and pushing are the user's decisions.
