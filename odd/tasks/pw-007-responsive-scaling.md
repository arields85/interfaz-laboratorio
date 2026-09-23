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
- [ ] **T3 — Automatic damped zoom.** Pure function for the curve + application at the app root with
  resize handling; portals, fixed overlays, `vh`/`vw`/`h-screen` usages, pointer math and the shader
  canvas must stay correct. Named uncertainty: how standardized CSS `zoom` interacts with viewport
  units when applied at the root — resolve with docs before choosing the application point.
- [ ] **T4 — Per-device fine-tune.** Per-browser factor (default 100%, fine steps) combined with the
  automatic zoom; UI placement to be agreed with the user.
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

## Next step

T3 automatic damped zoom.
