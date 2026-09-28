# Visual defaults from the current setup — ODD feature document

> ODD feature task (not SDD). Worktree `D:\Proyectos\Interfaz-HMI\Interfaz-HMI-worktrees\visual-defaults`,
> branch `feat/visual-defaults` from `main` `3790cbd`. Engram: `backlog/visual-defaults-from-current`,
> mirror `odd/visual-defaults/tasks`.

## Objective

Make the visual configuration the user tuned in the browser the code DEFAULT, so any other origin,
port or fresh install starts with the same look.

## Problem and why

Visual settings are stored per browser origin in `localStorage` as overrides over code defaults.
Opening the HMI on another origin/port (e.g. `localhost` vs `127.0.0.1`, or 5174) shows the old
code defaults.

## Captured values (2026-09-28, control Chrome via CDP, origin `http://127.0.0.1:5173`)

Only overrides are stored; keys absent or null already equal the code defaults.

```json
{
  "hmi-shader-params": {
    "state": {
      "params": {
        "nebShow": 1,
        "nebSpeed": 0.11,
        "nebIntensity": 0.36,
        "nebAlpha": 0.89,
        "nebVariation": 0.14,
        "nebHue": 0,
        "nebContrast": 0.48,
        "nebBrightness": 1,
        "nebDensity": 0.3,
        "nebSat": 0.36,
        "nebColorVar": 0.3,
        "nebColorShift": 0,
        "starShow": 1,
        "starDensity": 1.1,
        "starBrightness": 0.8,
        "starHue": 0,
        "starSaturation": 1,
        "starContrast": 1,
        "starAlpha": 1,
        "starTwinkle": 0.6,
        "starSize": 0.95,
        "starParallax": 1,
        "lensShow": 1,
        "lensMass": 0.08,
        "lensSize": 0.27,
        "lensOpacity": 0.21,
        "lensAutoOpacity": 1,
        "lensAutoSpeed": 0.25,
        "lensDriftSpeed": 0.45,
        "chromShow": 1,
        "chromIntensity": 0.5,
        "chromHue": 0.84,
        "chromSaturation": 1,
        "chromBrightness": 1,
        "chromContrast": 1,
        "chromAlpha": 1,
        "nebMouseShow": 1,
        "nebMouseIntensity": 0.45,
        "nebMouseLag": 0.01,
        "cursorNebShow": 1,
        "cursorNebIntensity": 0.76,
        "cursorNebHue": 0.84,
        "cursorNebSaturation": 1,
        "cursorNebBrightness": 1,
        "cursorNebContrast": 1,
        "cursorNebAlpha": 1,
        "cursorNebRadius": 1.2,
        "cursorNebLag": 0.01,
        "haloShow": 1,
        "haloIntensity": 0.11,
        "haloHue": 0,
        "haloSaturation": 1,
        "haloBrightness": 1,
        "haloContrast": 1,
        "haloAlpha": 1,
        "haloLag": 0.21,
        "ringShow": 1,
        "ringIntensity": 0.3,
        "ringAlpha": 1,
        "ringBrightness": 1,
        "ringContrast": 1,
        "ringSpeed": 0.25,
        "ringWidth": 0.72,
        "ringLife": 1,
        "ringHue": 0.84,
        "ringSaturation": 1,
        "vigShow": 1
      }
    },
    "version": 0
  },
  "hmi-background-config": null,
  "hmi-theme-fonts": {
    "--font-size-mono": "11px"
  },
  "hmi-theme-colors": {
    "--color-accent-green": "#26c5aa",
    "--color-admin-accent": "#dee8f7",
    "--color-widget-gradient-to": "#29dde0",
    "--color-widget-icon": "#dee8f7",
    "--color-dynamic-normal-from": "#29dde0",
    "--color-dynamic-normal-to": "#229191",
    "--color-status-normal": "#29dde0"
  },
  "hmi-color-palette": null,
  "hmi:prisma-orb-visual-config": {
    "rays": 0.45,
    "speed": 1.85,
    "intensity": 0.8,
    "size": 290,
    "core": "#1b6ee0",
    "glow": "#8ff0ff"
  },
  "hmi:loader-options": null,
  "hmi-theme-style": null
}
```

## Scope (user request 2026-09-28)

- WebGL background: `hmi-shader-params` (`store/shaderParams.store.ts` defaults).
- Diseño tab: `hmi-theme-fonts` (`--font-size-mono: 11px`) and `hmi-theme-colors` (7 color
  tokens) — defaults live in `index.css` `@theme` AND in `DesignSettingsTab.tsx` DEFAULT_* maps;
  both must agree.
- Prisma orb visual config (`config/prismaOrb.config.ts` defaults) — included as visual language.
- Loader options and color palette: no overrides stored, nothing to change.
- Out of scope: non-visual per-origin settings (data connection, temporal settings, HMI name) and
  the theme style (lives on `feat/theme-tab`).

## Constraints

- Reset buttons must now return to these new defaults.
- No hardcoded values outside the token/default layers; docs that list defaults must be updated.
- TDD: strict (global CLAUDE.md); runner Vitest.

## Tasks

- [x] **V1** — Update all defaults to the captured values (shader store, CSS tokens + Design tab
  default maps, orb defaults), adjust tests that pin old defaults, update docs that list them.
  Route: delegated writer.
- [x] **V3** — Fresh install creates NO example data (user decision 2026-09-28): stop seeding
  `mockDashboards` (DashboardStorageService), the example hierarchy tree `mockHierarchyNodes`
  (Steigen, areas, compressors, sector, line, folder, group — HierarchyStorageService), the 4
  invented catalog variables `mockVariableCatalog` (VariableCatalogStorageService) and
  `mockTemplates` (TemplateStorageService). KEEP the 9 default node types (NodeTypeStorageService
  `DEFAULT_NODE_TYPES`). Existing installs keep their data untouched. Route: delegated writer.
- [x] **V2** — Live check by the user on a fresh origin (e.g. 5174 or `localhost`).

## Progress

- 2026-09-28: values captured via CDP; worktree and document created.

- 2026-09-28: V1 done (route: delegated writer) — `9c29d07` feat(design): shader defaults
  changed nebIntensity 0.5->0.36, nebAlpha 1->0.89, nebSat 0.5->0.36, nebColorVar 1->0.3,
  nebColorShift 1->0, chromHue 0->0.84, cursorNebHue 0->0.84; `--font-size-mono` 10->11px;
  colors accent-green #26c5aa, admin-accent #dee8f7, widget-gradient-to #29dde0, widget-icon
  #dee8f7, dynamic-normal-from #29dde0, dynamic-normal-to #229191, status-normal #29dde0 (CSS
  `@theme` and Design tab maps kept in sync, CSS-contract sync test added); orb speed 1->1.85.
  No store version bump needed (key-by-key sanitize; existing stored tunings untouched). Docs list
  no literal defaults. RED 5 pinning tests against old values; GREEN 136/136. Writer: `npx tsc -b`
  clean, `npm run lint` clean, `npm test` 2620/2620, `npx vite build` OK. Parent check: script
  comparison — all 67 captured shader values equal the code defaults; store + orb tests 15/15.

- 2026-09-28: review (base `3790cbd`..`0cfd04f`, 407 lines, medium, user granted): lineage
  `review-de9cc5293f91865d` APPROVED, acknowledged, authority burned. Advisory SUGGESTIONs only
  (optional later): R3-css-token-regex-comment-shadowing, R3-reset-test-no-persistence-assertion
  (`DesignSettingsTab.test.tsx`).

- 2026-09-28: V3 done (route: delegated writer) — `8337cd0` feat(storage): the four services seed
  `[]` when their key is absent (existing installs untouched, migrations kept); node types still
  seeded; `hierarchy.mock.ts` and `variableCatalog.mock.ts` deleted (no consumers left),
  `mockDashboards` kept as a test fixture, `mockTemplates` kept (template migration uses it);
  `DEFAULT_DASHBOARD_ROWS` now reuses `gridConfig.DEFAULT_ROWS`; ARCHITECTURE tree updated.
  Empty screens checked (manager, templates, builder entry, viewer home, hierarchy, catalog
  selector, topbar): all already had empty states. RED 4 / GREEN 72 focused. Writer: `npx tsc -b`
  clean, `npm run lint` clean, `npm test` 2619/2620 (Topbar flake, 16/16 isolated), build OK.

- 2026-09-28: V2 live check PASSED (user) on `127.0.0.1:5175` after clearing that origin's
  storage from the control Chrome: empty dashboards/hierarchy/catalog/templates, node types
  present, background/colors/typography/orb with the tuned values. Note: admin LOGIN is accepted
  only from origins on port 5173 (`admin_http.py` LOCAL_ORIGINS); an existing session cookie is
  shared by same-host ports, so test other ports on host `127.0.0.1`.

## Next step

Merge after the group widget and theme merges (rebase onto the new main); previous: V2 live check on a fresh origin; merge after the group widget and theme merges (rebase).
