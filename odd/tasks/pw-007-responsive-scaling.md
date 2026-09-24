# PW-007 HMI responsive scaling across resolutions — ODD feature tracker

> ODD feature task (not SDD). Branch `feat/prisma-responsiveness-and-scaling` (from `main` b20edba),
> shared with PW-006 (`odd/tasks/pw-006-prisma-responsiveness.md`). Every commit belongs to one task
> of one feature. Engram mirror: `odd/pw-007-responsive-scaling/tasks`. Backlog detail:
> `backlog/hmi-responsive-scaling`.

## Objective

Make the HMI look right without manual browser zoom across CSS viewports from ~1440×900 to
~2560×1440 (16:9 and 16:10).

## Problem and evidence (user-reported 2026-09-23)

The HMI was designed for 1920×1080 at Windows scale 100% and browser zoom 100%, where it looks
perfect. Computed CSS viewports:

| Screen | Windows scale | CSS viewport | User workaround |
|---|---|---|---|
| 1920×1080 | 100% | 1920×1080 (baseline) | none |
| 3840×2160 | 150% | 2560×1440 | browser zoom 125% (~2048×1152 effective) |
| 2880×1800 (14" laptop) | 200% | 1440×900 | browser zoom 90% (~1600×1000 effective) |

Browser zoom steps are coarse, so neither non-baseline setup looks perfect.

## Scope and constraints

- Must respect `docs/CONVENTIONS.md` anti-hardcode dimensional policy and the grid/widget layout
  system; tokens only (`hmi-app/src/index.css` `@theme`).
- Candidate approaches (not decided): fluid root font-size/rem scaling (clamp on viewport),
  whole-canvas scale-to-fit (letterboxing for 16:10), true responsive breakpoints. The approach is a
  user decision after exploration.
- Out of scope: plant control of any kind; PW-006 behavior.

## TDD

Strict TDD: enabled (source: global orchestrator config). Runner: `cd hmi-app && npm test`
(vitest; focused: `npx vitest run <file>`). Visual acceptance is manual at the three viewports.

## Delivery

Strategy: `ask-on-risk`. Forecast pending until the approach is chosen. RDD: off (global) — no
native review. Work-unit commits on the shared branch; integrate to `main` by fast-forward at the
end together with PW-006; NO push.

## Tasks

- [x] **T1 — Layout/sizing map (read-only).** Map how sizes are defined today (root font-size, px vs
  rem, tokens, grid/widget layout, fixed dimensions, runtime measurements, shader canvas) and
  evaluate the candidate approaches with tradeoffs. Route: delegated (mapping trigger, 4+ files).
  Findings (2026-09-23):
  - No root font-size override (browser default 16px); zero `@media` queries in shipped styling.
  - Tailwind utilities are rem, but absolute-px islands bypass rem: Lucide `size={N}` icons,
    admin-configurable `--font-size-*` tokens written as px (`DesignSettingsTab.tsx`
    `applyFontStateToDocument`), `AdminWorkspaceLayout.tsx` rail/panel defaults `52px`/`280px`,
    82 arbitrary/inline px occurrences across 30 files.
  - Widget grid is already fluid: persisted `cols`/`rows`, `minmax(0,1fr)` columns, row height from
    measured canvas height (`gridConfig.ts`, `BuilderCanvas.tsx`, `DashboardViewer.tsx`).
  - Risks: `transform: scale` breaks `position: fixed` overlays and pointer math in admin
    drag/resize; standardized CSS `zoom` keeps `getBoundingClientRect`, `clientWidth` and pointer
    coordinates consistent and does not create a containing block.
  - Recommendation: app-wide CSS `zoom` on a 1920-wide design reference (1920×1080 → zoom 1, a
    structural no-op). Refinement by parent: derive zoom from width and let the fluid grid absorb
    extra height at 16:10 instead of letterboxing. Note: the user's manual zoom choices (125% on
    2560×1440 vs proportional 133%; 90% on 1440×900 vs proportional 75%) suggest a dampened curve,
    not pure proportional scaling — to confirm in T2.
- [x] **T2 — Approach decision.** Decided by the user (2026-09-23):
  - App-wide CSS `zoom`, automatic, width-based, damped curve: `zoom = (viewportWidth / 1920) ^ k`
    with `k ≈ 0.6` (≈84% at 1440 CSS px, 100% at 1920, ≈119% at 2560). The user confirmed those
    values match what the browser zoom approximated on the laptop and the 4K monitor.
  - Rationale: the Windows display scale already compensates physical size and viewing distance,
    so CSS px arrive pre-corrected; pure proportional scaling over-corrects.
  - Width-based; extra height at 16:10 is absorbed by the fluid grid (no letterboxing).
  - Optional per-device fine-tune factor (default 100%), stored per browser (not shared settings),
    as a safety net. `k` is a single system constant calibrated during manual acceptance.
  - Scope: whole app (viewer and admin); admin px font-size tokens are multiplied by zoom like
    everything else.
- [x] **T3 — Automatic damped zoom.** Pure function for the curve + application at the app root with
  resize handling; portals, fixed overlays, `vh`/`vw`/`h-screen` usages, pointer math and the shader
  canvas must stay correct. Named uncertainty: how standardized CSS `zoom` interacts with viewport
  units when applied at the root — resolve with docs before choosing the application point.
  Findings (2026-09-23):
  - **Application point: `document.documentElement` (`<html>`)**, applied in a hook called from
    `App.tsx` (covers both viewer and admin routes). Rejected an inner app-root wrapper div because
    two overlay primitives (`AnchoredOverlay`, `HoverTooltip`) `createPortal(..., document.body)`;
    only zooming a common ancestor of the app tree AND `document.body` keeps portaled content in the
    same scaled coordinate space as the rest of the UI.
  - Research (CSS Viewport Module Level 1, https://drafts.csswg.org/css-viewport/#zoom-property;
    MDN `zoom`, https://developer.mozilla.org/en-US/docs/Web/CSS/zoom; MDN `Element.currentCSSZoom`,
    https://developer.mozilla.org/en-US/docs/Web/API/Element/currentCSSZoom): `zoom` pre-multiplies
    the used value of length properties (excluding `auto`/`<percentage>`) by the element's
    *effective* zoom (its own zoom combined with every ancestor's, per `currentCSSZoom`);
    `getBoundingClientRect`/`getClientRects`/`IntersectionObserver` "must return rects with scaled
    lengths"; `zoom` does not create a new containing block (unlike `transform`), so
    `position: fixed` descendants stay anchored to the true viewport. Verified fact: percentages and
    `auto` are excluded from the pre-multiplication, so `height:/width:100%`, `inset-0` and the fluid
    grid's `fr` tracks need no change. Reasoned-but-not-spec-quoted (flag for manual T5 check): since
    `vh`/`vw` are plain lengths (not `auto`/percentage), they ARE pre-multiplied — because they first
    resolve against the true unzoomed viewport and that value is then divided back out when the
    zoomed subtree is painted, a `100vh`/`h-screen` element should still visually fill exactly the
    real viewport at any zoom (this is the documented reason `zoom` replaces `transform:scale()` for
    whole-app scaling, but the spec text does not spell out this worked example verbatim).
  - Practical risk corroborating the getBoundingClientRect/pointer-consistency claim: a real Chrome
    128 regression (ONLYOFFICE DocumentServer issue #2859) shows the *standardized* zoom changed
    `getBoundingClientRect`-derived coordinate math versus the old non-standard behavior — consistent
    with the spec statement that scaled rects are now mandatory, and why no manual compensation
    should be added on top.
  - Files changed: `hmi-app/src/utils/viewportScale.ts` (pure curve, new — `VIEWPORT_SCALE_REFERENCE_WIDTH_PX = 1920`,
    `VIEWPORT_SCALE_DAMPING_EXPONENT = 0.6`, `computeDampedViewportZoom(width, factor = 1)`),
    `hmi-app/src/hooks/useAutomaticViewportZoom.ts` (new — applies/cleans up `documentElement.style` `zoom`,
    recomputes on `window resize`, `factor` param pre-wired for T4), `hmi-app/src/App.tsx` (wires the hook
    app-wide). No changes needed in `EventHorizonBackground.tsx` (fixed, `inset-0`/`h-full`/`w-full`
    canvas — percentage-based, unaffected), `AnchoredOverlay.tsx`/`HoverTooltip.tsx`/`widgetInteraction.ts`/
    `BuilderCanvas.tsx` (already `getBoundingClientRect`/`clientX`/`clientY`-based, self-consistent under
    zoom per spec) or `DesignSettingsTab.tsx` (admin px `--font-size-*` tokens are ordinary `font-size`
    lengths, auto-scaled by the root zoom like the spec says for inherited length properties).
  - Tests: `hmi-app/src/utils/viewportScale.test.ts` (11 tests: 1920→1 exactly, 1440→≈0.84, 2560→≈1.19,
    monotonic, invalid/zero/negative/NaN/Infinity width → 1, factor composition, invalid factor → 1) and
    `hmi-app/src/hooks/useAutomaticViewportZoom.test.tsx` (5 tests: applies on mount, no-op at 1920,
    updates on resize, listener + style cleanup on unmount, factor composition). RED observed for both
    (4/11 and 5/5 failing against stubs), then GREEN (11/11 and 5/5) after restoring the real
    implementation.
  - Verification: `npm test` 213 files / 2352 tests passed; `npx tsc -b` clean; `npm run lint` clean.
  - jsdom cannot verify actual layout/rendering (no real `zoom` painting, no WebGL) — visual
    confirmation at 1440×900, 1920×1080, 2560×1440 (and 16:10 equivalents) is T5 manual acceptance.
    Manual checks to prioritize: overlays/popovers/dialogs position correctly at non-1920 widths,
    admin drag/resize handles track the pointer accurately, the shader background canvas still fills
    the screen, and 1920×1080 is pixel-identical to before this change.
- [x] **T3b — Zoom coordinate-space corrections (reopens T3's "no changes needed" claim).**
  Parent measurement in headless Chrome (local `chrome.exe`, `zoom:1.25` on `<html>`, window
  1600×900, 2026-09-23) refuted the "vh is divided back out" assumption. Route: delegated writer
  (mapping + writer triggers, 20+ files touched).
  Corrected coordinate-space model (verified with an additional headless-Chrome probe during this
  task, `zoom:1.25`, window 1600×900 — a percentage/`inset:0` div+canvas: `getBoundingClientRect`
  1576×801 for both, but `clientWidth`/`clientHeight` 1261×641 for the descendants vs 1576×801 for
  `documentElement`): exactly two spaces exist.
  - **REAL/visual space** (freely comparable/combinable): `getBoundingClientRect()`,
    `PointerEvent.clientX/clientY`, `window.innerWidth/innerHeight`,
    `document.documentElement.clientWidth/clientHeight`.
  - **LAYOUT space** (pre-zoom-multiplication): `clientWidth`/`offsetWidth`/`offsetHeight` and
    `ResizeObserver` `contentRect`/`borderBoxSize` of any element OTHER than `documentElement` — even
    a percentage/`inset:0`-sized one, whose LAYOUT clientWidth is smaller than its own painted
    (real) size (1261 vs 1576 above), even though `getBoundingClientRect` still matches the true
    viewport for such boxes.
  - Writing a REAL-space value into a CSS length (`style.top`, a React style prop, an SVG coordinate
    whose viewBox is LAYOUT-space, or combining it with a LAYOUT-space measurement) doubles under
    zoom on paint; convert with the new `visualToLayoutPx`/`getEffectiveZoom` first. Same-space
    ratios/distances need no conversion.
  Files changed:
  - New `hmi-app/src/utils/zoomCoordinates.ts` (+ 9 tests): `getEffectiveZoom(element?)`
    (`currentCSSZoom` when available, else the `--viewport-zoom` mirrored on `<html>`, else 1) and
    `visualToLayoutPx(visualPx, zoom?)`.
  - `hmi-app/src/hooks/useAutomaticViewportZoom.ts` (+3 tests): mirrors the applied zoom onto a
    `--viewport-zoom` custom property alongside `zoom`; corrected the wrong "vh is divided back out"
    comment block with the model above.
  - `hmi-app/src/index.css`: `:root { --viewport-zoom: 1; --viewport-height: calc(100vh /
    var(--viewport-zoom)); --viewport-width: calc(100vw / var(--viewport-zoom)); }` and
    `.h-viewport`/`.min-h-viewport`/`.w-viewport` utilities — the single tokenized way to express
    viewport lengths, replacing every `vh`/`vw`/`h-screen` use found by a full re-grep (superset of
    T3b's list): `MainLayout`, `AdminLayout`, `PrismaOrbOverlay`, `anchoredOverlayStyle` (`maxWidth`),
    `EppiTopbarNavigation`, `ShaderSettingsPanel`, `GlobalSettingsDialog`, `RuntimeDialog`, plus
    `EppiTablePanel` (`35vw`/`45vw`), `DesignSettingsTab` (`55vh`), `NodeTypeConfigDialog` (`70vh`)
    which the T3b list had missed.
  - Coordinate conversions via `zoomCoordinates.ts`: `anchoredOverlayStyle.ts` (final
    `left`/`top`/`bottom`/`minWidth`, +3 tests) — `PrismaPairingControl` needed no separate change,
    it flows through this same fix; `HoverTooltip.tsx` (final `top`/`left`, +1 test);
    `BuilderCanvas.tsx` (drag/resize `deltaX`/`deltaY` before `applyPointerDeltaToPixelBounds`, and
    `CursorTooltip` `x`/`y`, +2 tests) — the physical-mouse drag-threshold distance stays real-space
    on purpose; `TrendChartV2InteractionLayer.tsx` `getRelativeX` (+1 test) — a real-space delta
    added to a layout-space SVG `plotLeft`; `TrendChartV2Widget.tsx` (both renderer variants'
    one-time initial `getBoundingClientRect()` measurement, to match every later
    `ResizeObserver`-based one — not independently unit-tested, the test harness's
    `MockResizeObserver` fires synchronously on `observe()` and overwrites the initial read before
    it can be asserted); `EventHorizonBackground.tsx` canvas backing-store sizing
    (`clientWidth × dpr × effectiveZoom`, +1 test) — confirmed via the headless-Chrome probe that
    `clientWidth` alone under-resolves a zoomed, percentage-sized canvas.
  - Left unchanged, documented in code comments (ratio-only or already correct):
    `TrendChartLegacyInteractionLayer.tsx` `handlePointerX` (real/real ratio);
    `EventHorizonBackground.tsx` mouse/click normalization (real/real ratio, canvas is
    percentage-sized so pinned to the true viewport); `vendor/leda-orb.js` `_resize()` (already
    `getBoundingClientRect() × dpr`, empirically correct); `GaugeDisplay.tsx` (SVG-only, `clientWidth`
    used consistently with `ResizeObserver` `contentRect`, both layout-space); `AnchoredOverlay.tsx`
    and `widgetInteraction.ts` (space-agnostic pure functions; correctness enforced at call sites).
  - Test-only: `EppiViewer.test.tsx` — 5 pre-existing class assertions updated for the new
    `w-[min(20rem,calc(var(--viewport-width)*0.35))]` token class.
  - Tests: 213 → 215 files, 2352 → 2372 tests. RED observed for `zoomCoordinates.test.ts` (module
    missing), the 3 new `useAutomaticViewportZoom` tests and 2 of the 3 new `anchoredOverlayStyle`
    tests (asserting real-px values pre-fix); GREEN after implementing. The `HoverTooltip`,
    `BuilderCanvas`, `TrendChartV2InteractionLayer` and `EventHorizonBackground` new zoom tests were
    written together with their fix and confirmed non-vacuous (their expected converted values
    differ from, and replace, the un-converted real-px values).
  - Verification: `npm test` 215 files / 2372 tests passed; `npx tsc -b` clean; `npm run lint` clean.
  - At zoom 1 (1920 width, `--viewport-zoom` unset in tests) every change is a no-op: all
    pre-existing tests pass unmodified except the 5 `EppiViewer` class-string assertions above.
  - Manual check needed at 1440×900 / 1920×1080 / 2560×1440 CSS px (DevTools device toolbar
    acceptable for a first pass): overlays/tooltips/dialogs position correctly at non-1920 widths,
    admin drag/resize and the resize tooltip track the pointer 1:1, the trend chart drag-to-zoom
    selection lands on the correct time range, the shader background renders sharp (not blurry) at
    zoom > 1, and 1920×1080 stays pixel-identical to before this change.
- [x] **T3c — Independent verification of T3/T3b (2026-09-23).** PASS for `d88e034` and `927e56e`,
  no defects. Every grep hit classified (converted / same-space ratio / unrelated); no stray viewport
  units. Headless Chrome probes (zoom 1.25): `var(--viewport-height)` fills exactly 801 px; a fixed
  element placed via the layout-px conversion lands at the intended real coordinates; `innerWidth`
  is unaffected by zoom (no feedback loop). `npm test` 215 files / 2372 tests, `tsc -b` and lint
  clean.
- [ ] **T4 — Per-device fine-tune. DEFERRED by the user (2026-09-23):** build it only if T5 manual
  acceptance on the laptop and the 4K monitor shows the automatic curve is not enough. Per-browser factor (default 100%, fine steps) combined with the
  automatic zoom; UI placement to be agreed with the user.
- [x] **T5b — Minimum layout width floor (user-approved 2026-09-24).** Evidence from T5 manual
  screenshots: 4K (2560×1440 CSS, zoom ≈1.19) OK; 1920×1080 identical to before; laptop
  (1440×900, zoom ≈0.84 → ~1714 px layout width) OK except T5c; TV (1920×1080 at Windows 150% →
  1280×720 CSS, below the planned range; zoom ≈0.78 → ~1633 px layout width) truncates labels
  ("ACTIVIDAD DE MÁQUI…", "PRODUCC…"), wraps "RENDIMIENTO DIARIO (ÚLTIMOS 7 DÍAS)" and shows the
  T5c overlap. Fix: `zoom = min(damped, viewportWidth / MIN_LAYOUT_WIDTH_PX)` with a single named
  constant (initial proposal ~1760 px) so the layout is never narrower than that; no change at
  ≥1920 CSS px. Calibrate the constant with automated headless screenshots of the running HMI at
  1280/1440/1920 widths before asking the user to re-check.
  Route: direct inline (single already-understood pure function, 2 files). Findings (2026-09-24):
  - Chose `MIN_LAYOUT_WIDTH_PX = 1760` (the initial proposal), calibrated primarily from the
    user's own already-measured evidence recorded above (1633 px layout width truncated labels;
    1714 px layout width was clean apart from T5c) — 1760 sits comfortably above both, and the
    floor formula (`zoom = viewportWidth / MIN_LAYOUT_WIDTH_PX` once it's the smaller term) makes
    the resulting layout width exactly `MIN_LAYOUT_WIDTH_PX` at any width where the floor is
    active, e.g. both 1280 and 1440 resolve to exactly 1760 px of layout width.
  - Screenshot calibration: local headless Chrome (`chrome.exe --headless=new`, isolated
    throwaway `--user-data-dir`, `--use-angle=swiftshader --enable-unsafe-swiftshader` — plain
    `--disable-gpu` crashed the renderer on this app's WebGL shader background) screenshotted the
    running dev server (`http://localhost:5173/`, not restarted) at 1280×720, 1440×900, 1920×1080
    and 2560×1440 CSS px. The fresh headless profile has no admin-published dashboard (mock
    `localStorage`-backed admin persistence, per `AGENTS.md` §7 — a fresh browser profile starts
    with none), so it renders the app shell's "Sin Vistas Publicadas" empty state rather than the
    user's specific Activity Analysis widget instance; reproducing that widget would need either
    the user's own authenticated/configured browser profile (out of reach and out of scope to
    touch) or fabricating a throwaway dashboard config, which risked not matching the user's real
    layout. The screenshots still gave real, useful evidence: the app shell (topbar branding,
    icons, search bar, shader background) rendered with no truncation, wrapping or horizontal
    overflow at any of the four widths, confirming the automatic zoom (T3/T3b) plus the new floor
    introduce no layout regression at the chrome level. The widget-specific truncation numbers
    (1633/1714 px) are the user's own prior measurements already recorded in this tracker; T5b's
    constant is calibrated from that evidence rather than re-derived from a fresh widget
    screenshot. Screenshots saved under the session scratchpad
    (`…/scratchpad/pw007/shot-*.png`), not committed.
  - Files changed: `hmi-app/src/utils/viewportScale.ts` (`MIN_LAYOUT_WIDTH_PX = 1760` constant;
    `computeDampedViewportZoom` now returns `Math.min(dampedZoom, viewportWidth /
    MIN_LAYOUT_WIDTH_PX)` — the optional `factor` composes *before* the floor caps the result, so
    a per-device fine-tune factor (T4, deferred) can never push the effective layout width below
    the floor; documented in the function's docstring and the module header).
  - Tests: `hmi-app/src/utils/viewportScale.test.ts` (11 → 15 tests): replaced the pre-floor
    1440px assertion with a floor-aware one (asserts `zoom < pureDampedZoom` and `1440/zoom ≈
    MIN_LAYOUT_WIDTH_PX`), added a 1280px floor test, a "never applies at/above 1920" test, a
    `MIN_LAYOUT_WIDTH_PX` existence test, and a factor/floor composition test (factor=1.5 at 1440
    is fully clamped by the floor). Moved the factor-composition test to 2560 (unaffected by the
    floor) so it isolates pure multiplication. RED observed by `git stash`-ing the implementation
    change only (keeping the updated tests) and running against the pre-floor code: 4 new/changed
    tests failed as expected; `git stash pop` restored the floor implementation → GREEN (15/15).
  - No change at 2560/1920 confirmed by both the unit tests and the headless screenshots (shell
    renders identically in proportion, no floor-driven layout shift since 1920/1760 > 1 and
    2560/1760 > damped zoom there).
  - Verification: `npm test` 215 files / 2388 tests passed; `npx tsc -b` clean; `npm run lint`
    clean (T5c not yet applied at this point).
- [x] **T5c — "sin comparación" labels overlap (widget defect).** In the Activity Analysis widget's
  best/worst ("MEJOR"/"PEOR") columns, the two "sin comparación" labels run into each other
  ("comparacióncomparación") at the laptop and TV widths; they must wrap or fit within their
  column instead of overlapping. Independent of zoom.
  **Reopened 2026-09-24 09:42** — the user's live re-check on the laptop (1440×900 CSS,
  zoom ≈0.82) and TV (1280×720 CSS, zoom ≈0.73) showed commit `a718bfc` (`min-w-0` on the row +
  `break-words` on the caption slots) did **not** fix the overlap: both the top pair
  (productivity-percent slot) and the bottom pair (label slot) still rendered
  "comparacióncomparación". 4K and 1920 continued to wrap correctly ("sin" / "comparación").
  Corrected root cause (this pass), verified with a faithful standalone reproduction (exact JSX
  structure, computed Tailwind classes and `--font-mono`/`--font-system` tokens from
  `hmi-app/src/index.css`, at the real-world resolved `comparisonColumnWidth` for this scenario —
  132 px total / ≈60 px per column, per `resolveTopRegionComparisonColumnWidth` /
  `resolveComparisonGridColumnGap` in the widget — rendered with local headless Chrome at 4×
  device-scale and at 1440×900/1280×720 with the app's own `zoom` mechanism applied to `<html>`):
  the grid (`grid grid-cols-2 ... justify-items-center` in `ComparisonPanel`) had
  `justify-items-center`. A non-`stretch` `justify-items`/`justify-self` value makes a grid item's
  *used* width resolve via its own shrink-to-fit/max-content size instead of being clamped to its
  `minmax(0, 1fr)` track's resolved size — `min-w-0` only removes the item's automatic
  *minimum*-width floor, it does not force the item to actually take the track's width when the
  item isn't stretched. So each `ComparisonRow` kept sizing itself to fit "comparación" unbroken
  (~90–100 px) and, being centered within its own ≈60 px track, visually overflowed by roughly a
  third on each side — the two centered, overflowing captions collided in the middle, reading as
  "comparacióncomparación". Screenshot evidence: BEFORE (unmodified `justify-items-center`) shows
  the two "comparación" words touching/merging with zero gap at 132 px column width; AFTER
  (`justify-items-stretch`) shows each caption fully confined to its own column, wrapping "sin" /
  "comparaci" / "ón" with no overlap, at both the zoomed-in close-up and the 1440×900/1280×720
  shots. Reproduction files kept under the session scratchpad
  (`scratchpad/t5c/repro-before.html`, `repro-after.html` + `before-*.png`/`after-*.png`), not
  committed (scratch, not part of the app).
  Fix (`ComparisonPanel`/`ComparisonRow` in `ActivityAnalyticsWidget.tsx`): replaced
  `justify-items-center` with `justify-items-stretch` on the comparison grid so each row actually
  takes its track's resolved width (the row's own `items-center`/`justify-center`/`text-center` and
  the panel's `items-center`/`justify-center` still center the row's *content* within that width —
  the visual "centering contract" is unchanged, only the row's outer box now matches its track
  instead of overflowing it). Added `w-full` to the two caption slots
  (`activity-analytics-comparison-percent`, `activity-analytics-metric-value`) so they inherit the
  row's now-correct width instead of reverting to their own shrink-to-fit sizing. Kept
  `break-words` as the hard fallback and added `hyphens-auto` + `lang="es"` (the document root is
  `lang="en"`; hyphenation needs its own explicit language) so a single word that still doesn't fit
  prefers a syllable break ("compara-ción") over an arbitrary mid-word one, per the task's
  preference for readable breaks. Caveat: local headless Chrome (swiftshader software rendering)
  did not render a visible hyphen character in the AFTER screenshot — it broke at a syllable
  boundary but without inserting "-", suggesting that build's hyphenation-dictionary data may be
  unavailable; this is a rendering-environment limitation of the verification tool, not something
  disprovable from here, so the hyphenation *character* itself is unverified (the wrap/containment
  fix, which is the actual regression, is fully verified). Tokens-only change (Tailwind utility
  classes), no hardcoded px; resolved in the widget's own responsible layer (anti-parches policy).
  Tests: `hmi-app/src/widgets/renderers/ActivityAnalyticsWidget.test.tsx` — updated the T5c
  regression test (jsdom has no layout engine, so it asserts the structural fix, not pixels):
  `activity-analytics-comparison-grid` has `justify-items-stretch` and not `justify-items-center`;
  every `activity-analytics-comparison-row` keeps `min-w-0`; every
  `activity-analytics-comparison-percent`/`activity-analytics-metric-value` node has `w-full`,
  `break-words`, `hyphens-auto` and `lang="es"`. Also updated the pre-existing "exposes the
  Mejor/Peor centering layout contract" test, which had locked in `justify-items-center` as part of
  the centering contract — that assertion changed to `justify-items-stretch` (the rest of the
  contract, row/panel-level centering classes, is untouched). RED confirmed by stashing only the
  source fix (`git stash push --keep-index -- ActivityAnalyticsWidget.tsx`) and running the T5c
  test against the unmodified component (failed as expected on the new `justify-items-stretch`
  assertion); `git stash pop` restored the fix → GREEN, then the centering-contract test's now-stale
  `justify-items-center` assertion was found and updated too.
  Verification: `npm test` 215 files / 2393 tests passed; `npx tsc -b` clean; `npm run lint` clean.
- [ ] **T5 — Manual acceptance and `k` calibration.** User checks 1440×900, 1920×1080 and
  2560×1440 CSS px; calibrate `k`.

## Acceptance criteria

- At 1440×900, 1920×1080 and 2560×1440 CSS px (and 16:10 equivalents) the HMI looks proportionate
  without browser zoom; 1920×1080 stays visually identical to today.
- No hardcoded dimensions introduced; all gates green (vitest, `tsc`, eslint).

## Progress

- 2026-09-23: feature document created. T1 started in parallel with PW-006 T1 (both read-only).

- 2026-09-23: T1 map done; T2 approach decided (damped automatic zoom + optional fine-tune).
  T3 started (route: delegated writer — 2+ non-trivial files).

- 2026-09-23: T3 done. Automatic damped zoom applied at `document.documentElement` via
  `useAutomaticViewportZoom` (wired in `App.tsx`), curve in `utils/viewportScale.ts`. All checks
  green (vitest, tsc, eslint). No structural regression expected at 1920×1080 (zoom computes to
  exactly 1); visual confirmation is T5.

- 2026-09-23: T3b done. Corrected T3's wrong "vh is divided back out" claim with a measured
  two-space coordinate model (real/visual vs layout px); added `--viewport-zoom` custom property and
  `--viewport-height`/`--viewport-width` tokens, replaced every `vh`/`vw`/`h-screen` use (including
  3 the original T3b list missed); added `zoomCoordinates.ts` and converted every
  `getBoundingClientRect()`/pointer value written back into a CSS length or SVG layout-space
  coordinate (overlay/tooltip positioning, drag/resize, trend chart interaction, the shader canvas's
  backing-store size); left ratio-only/already-correct code documented in place. All checks green
  (215 files / 2372 tests, tsc, eslint); no-op confirmed at zoom 1.

- 2026-09-24: T5b done (route: direct inline). Added `MIN_LAYOUT_WIDTH_PX = 1760` as a hard floor
  on `computeDampedViewportZoom`'s result (`zoom = min(dampedZoom * factor, viewportWidth /
  MIN_LAYOUT_WIDTH_PX)`), calibrated from the user's own previously-recorded truncation evidence
  (1633 px failed, 1714 px passed) and corroborated with headless-Chrome screenshots of the
  running dev server at 1280/1440/1920/2560 CSS px (general app-shell layout, no regression; the
  widget-specific screenshot needs the user's own configured dashboard, out of reach from a fresh
  browser profile — see T5b findings). TDD: RED confirmed via `git stash` of the implementation
  with tests updated, then GREEN. All checks green: `npm test` 215 files / 2388 tests, `npx tsc -b`
  clean, `npm run lint` clean.

- 2026-09-24: T5c done (route: direct inline). Fixed the "sin comparación" caption overlap in
  `ActivityAnalyticsWidget.tsx`'s `ComparisonRow`: a CSS grid item's default `min-width: auto` let
  it overflow past its computed track width under a narrow comparison column (as little as ≈61 px
  per column), and `justify-items-center` let the overflow bleed into the neighboring column.
  Added `min-w-0` to the row and `break-words` to its two long-caption text slots. TDD: RED
  confirmed against the unmodified component, then GREEN. All checks green: `npm test` 215 files /
  2389 tests, `npx tsc -b` clean, `npm run lint` clean.

- 2026-09-24: T5c reopened and fixed again (route: direct inline). The user's live re-check showed
  the first T5c fix (`min-w-0` + `break-words`) did not fix the overlap on the laptop/TV. Built a
  faithful standalone reproduction (exact classes/DOM/tokens, real-world resolved
  `comparisonColumnWidth` ≈132 px) and confirmed with local headless Chrome screenshots that
  `justify-items-center` — not the item's min-width floor — was the actual cause: a non-stretched
  grid item sizes to its own max-content width regardless of its track's resolved size, so each
  "comparación" caption overflowed its ≈60 px track and the two overflowing, centered captions
  collided. Fix: `justify-items-stretch` on the grid (clamps each row to its track), `w-full` on
  the caption slots (so they inherit that width instead of reverting to shrink-to-fit), and
  `hyphens-auto` + `lang="es"` as a readable fallback for a single word that still doesn't fit.
  Screenshot BEFORE reproduced the exact "comparacióncomparación" collision; AFTER showed both
  captions fully confined to their own columns at 132 px, 1440×900 (zoom 0.82) and 1280×720
  (zoom 0.73). Updated the T5c regression test plus a pre-existing centering-contract test that had
  locked in `justify-items-center`. TDD: RED confirmed by stashing only the source fix, then GREEN.
  All checks green: `npm test` 215 files / 2393 tests, `npx tsc -b` clean, `npm run lint` clean.

## Next step

User re-check needed on both the laptop and the TV — this is T5c's **second** fix attempt after the
first (`min-w-0` + `break-words` alone) failed the user's live re-check, so please verify directly
rather than assuming it's fixed: (1) the Activity Analysis widget's "MEJOR"/"PEOR" columns no
longer overlap ("sin comparación" or any other caption), and (2) the TV
(1280×720 CSS) no longer truncates/wraps widget titles ("ACTIVIDAD DE MÁQUINA", "PRODUCCIÓN",
"RENDIMIENTO DIARIO (ÚLTIMOS 7 DÍAS)"). If the 1760 px floor still isn't enough on the real TV,
increase `MIN_LAYOUT_WIDTH_PX` in `hmi-app/src/utils/viewportScale.ts` — recalibration never
requires touching call sites. After that, resume T4 (needs a user decision on UI placement for the
per-browser fine-tune factor: admin settings page vs. a viewer-accessible control) and T5 (full
manual acceptance and `k` calibration across 1440×900, 1920×1080, 2560×1440 CSS px, plus T3b's
manual-check list: overlay/tooltip positioning, drag tracking, trend chart selection, shader
sharpness at non-1920 widths).
