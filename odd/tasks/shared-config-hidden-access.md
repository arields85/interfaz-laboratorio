# Shared configuration and hidden access — ODD feature document

> ODD feature task (not SDD). Branch `feat/shared-config-hidden-access` (from main `c57b11c`).
> Engram mirror: `odd/shared-config-hidden-access/tasks`.

## Objective

Prepare the HMI for its first real deployment on a server that several PCs open as viewers.

1. **Shared configuration.** What an administrator configures in one browser applies to every browser, including those already open.
2. **Hidden access.** The plain viewer shows neither the users icon nor the Prisma icon. Only someone who knows a key combination, or a direct URL, can reveal them to log in as administrator or to use Prisma.

## Problem / why

- **Configuration is per browser.**
  - Every piece of HMI configuration lives in the browser's `localStorage`: 19 client modules hold dashboards, templates, hierarchy, node types, the variable catalog, the data connection, the HMI name, the loader and temporal options, the Prisma orb, the theme, the design and the shader.
  - An admin change therefore stays in that admin's browser.
  - Any other PC would open an empty HMI.
- **The icons are visible to everyone.** Today the users and Prisma icons are visible to every viewer.
- **Prisma is installed but restricted.**
  - The Prisma runtime is installed and works exactly as today: admin login, assistant, voice and Telegram.
  - For this first test it must only be usable by whoever knows the hidden access.

## User decisions (2026-10-01)

- Configuration must reach every browser instance, including open ones.
- Propagation by periodic check: every open viewer asks the server for a revision number every few seconds (target 10 s). When it changes, the viewer reloads the configuration without anyone reloading the page. A delay of a few seconds is accepted.
- The Prisma runtime is installed and runs as today.
- The plain viewer hides the users icon and the Prisma icon. `Ctrl+Alt+A` or the URL `/acceso` reveal both.
  - The revealed state is remembered in that browser until the same combination hides it again. This is the default taken; the user may change it.
- PW-015 (user accounts and access levels) stays pending. This feature is not PW-015: there are still no users besides the single admin.

## Design

- **Server: a shared configuration store in `services/prisma-runtime`, next to `admin_http.py`.**
  - Storage: a key/value document in its own SQLite file under the runtime state dir. The keys are the current `localStorage` keys, with JSON string values. A single global revision is incremented on every write. Writes are atomic.
  - `GET /api/prisma/hmi-config` returns every key plus the revision. No login, because every viewer must read it.
  - `GET /api/prisma/hmi-config/revision` returns only the revision; this is the cheap poll.
  - `PUT /api/prisma/hmi-config` writes a batch of keys (set or delete). It requires the admin session plus CSRF (`_authorized_session(require_csrf=True)`) and the same origin and host checks as the credential routes.
  - The new routes are added to `docs/prisma/PRISMA_BROWSER_ROUTING.md` and to the Vite proxy.
  - Read-only rule: this writes the HMI's own configuration to its own server, never to the plant. That is allowed by AGENTS.md §2.
- **Client: a `sharedConfigStorage` adapter with a synchronous `getItem`/`setItem`/`removeItem`, so the existing modules keep their API.**
  - At boot, the app loads the whole document from the server before it renders the routes. If the server is unreachable, it falls back to the last good copy, kept in `localStorage` as a cache only.
  - Reads come from the in-memory document.
  - `setItem`/`removeItem` update memory immediately and send the batch to the server through the admin client (CSRF). A failure surfaces as a visible save error and is never silent.
  - Poll: every ~10 s, `GET /revision`. When the revision changes, the client refetches the document, replaces memory, and notifies subscribers:
    - TanStack Query invalidation for dashboards and other async services;
    - re-apply theme and design;
    - re-read config hooks. This replaces the cross-tab `storage` event listeners.
- **Stays local per browser:**
  - `hmi-global-settings-tab`;
  - the hierarchy expanded nodes;
  - `ui.store` grid visibility;
  - the voice prebuffer history;
  - the admin auth exit and revocation keys;
  - alert history (history, not configuration; out of scope);
  - the new hidden-access flag.
- **One-time migration.** An admin action, "Subir la configuración de este navegador al servidor", copies the shared keys from this browser's `localStorage` to the server. It asks for confirmation because it replaces the server copy.
- **Hidden access.**
  - The Topbar renders the users and Prisma icons only when the browser-local flag is on.
  - `Ctrl+Alt+A` toggles the flag.
  - The route `/acceso` sets the flag, opens the login and replaces the URL with `/`.
  - Hiding the icon is not the security boundary: the admin routes stay protected by the server session.

## Constraints

- AGENTS.md read-only rule, tokens, `usted` in UI copy, Lucide icons only, and the layer rules in `docs/ARCHITECTURE.md`.
- The dev server serves this checkout:
  - never switch branches;
  - make one write per `index.css` edit.
- About 400 authored lines per task is only a planning guide.
- Delivery: a feature branch with sliced native reviews (one per ~400-line slice or high-risk commit), then a fast-forward of main by ref when the user approves. This is the same practice as the previous features. There are no PRs.

## TDD

- Mode: strict, ON (source: global orchestrator config).
- hmi-app:
  - runner: `npm test` (`vitest run --allowOnly=false`), single file `npx vitest run <path>`;
  - full gate: `npx tsc -b`, `npm run lint`, `npm test`, `npm run build`;
  - known flaky test: Topbar "continues admin navigation immediately when runtime short is disabled".
- prisma-runtime:
  - Python `unittest` under `services/prisma-runtime/tests`;
  - the offline gate is `operations/verify-local.ps1`, run through the child-only supervisor described in `services/prisma-runtime/README.md` "Offline-safe verification".

## Tasks

- [x] T1 — Server shared configuration store and routes (`hmi_config` store, GET document, GET revision, PUT batch with admin session and CSRF), plus routing doc and Vite proxy. Python tests.
- [x] T2 — Client `sharedConfigStorage` adapter: boot load with cache fallback, sync read API, admin batch writes with CSRF, and the revision poll with a subscription API. Tests.
- [x] T3 — Move the content stores to the adapter: dashboards, templates, hierarchy, node types and the variable catalog, with query invalidation on a remote change.
- [x] T4 — Move the configuration modules to the adapter: data connection, HMI name, loader, temporal, Prisma orb, theme, frame shape, icon cutout, link accents, viewer entrance, design fonts and colors, and shader params. Re-apply on a remote change, replacing the `storage` listeners.
- [x] T5 — Bootstrap fallback to this browser's local content while the server document was never written. (The upload action was dropped by the user: export/import covers the migration.)
- [x] T6 — Hidden access:
  - the Topbar hides the users and Prisma icons unless the browser-local flag is on;
  - `Ctrl+Alt+A` toggles the flag;
  - `/acceso` reveals the icons and opens the login.
- [x] T7 — Docs (`ARCHITECTURE.md`, `DATA_CONTRACT.md` if affected, `PRISMA_BROWSER_ROUTING.md`, the admin conventions), and a live check with two browser profiles: the change in one appears in the other within about 10 s.
- [x] T8 — Single admin session. Added 2026-10-01 at the user's request, after the review's "two admins at once" finding.
  - When an admin logs in while another admin session is active, the HMI warns "Hay una sesión de administrador abierta en otro equipo. Si continúa, esa sesión se cerrará." and offers Continuar / Cancelar.
  - Continuar makes the server revoke every other session and keep only the new one.
  - The displaced browser shows "Su sesión se cerró porque se inició sesión en otro equipo." on its next focus or its next protected request (there is no session poll), and returns to the viewer. The server expires the displaced cookie with that first answer, so the notice appears once. Its unsaved work is lost, which is why the warning comes before confirming.
  - Before T8 the server allowed several concurrent sessions (`admin_auth.py` inserted without revoking).
  - Route: delegated writer.

## Acceptance criteria

- A change saved by the admin in browser A appears in an already-open browser B within about 10 s, without a reload.
- A fresh browser with an empty `localStorage` shows the configured dashboards.
- With the runtime down, the viewer still shows the last cached configuration, and admin saves fail visibly.
- A non-admin request to `PUT /api/prisma/hmi-config` is rejected: 401 without a session, 403 without CSRF.
- The plain viewer shows no users icon and no Prisma icon. `Ctrl+Alt+A` and `/acceso` reveal them, and Prisma works as today once revealed.
- The full gates are green, and the native reviews of the slices are approved.

## Progress

- 2026-10-01: exploration done (configuration persistence map, Prisma runtime HTTP surface and auth, existing SSE and poll patterns). User decisions recorded. Feature document created.
- 2026-10-01 T1 done (`db0c94f` runtime store and routes, `93afda8` proxy and routing doc).
  - RED: `tests.test_hmi_config` failed with `ModuleNotFoundError: prisma_runtime.hmi_config_store`; the proxy test rows failed (3 failed) before the routes existed.
  - GREEN: 17 focused backend tests; proxy test file 87/87; whole backend discover 1807 tests OK.
  - Route decision: the session cookie is scoped to `/api/prisma/admin`, so it would not reach `/api/prisma/hmi-config`. The write is `PUT /api/prisma/admin/hmi-config`; the public reads stay at `GET /api/prisma/hmi-config` and `GET /api/prisma/hmi-config/revision`. The routes live in `AdminHttpBoundary` (`hmi_config_store=` parameter) and the store in `hmi_config_store.py` (file `<state>/hmi-config/hmi-config.sqlite3`, created lazily).
  - Wire: GET document `{ok, revision, items:{key:string}}`; GET revision `{ok, revision}`; PUT body `{set?:{key:string}, delete?:[key]}` returns `{ok, revision}`. Bounds: key `[A-Za-z0-9:._-]` up to 128, value up to 1 MiB, 200 operations per batch, 512 keys, 8 MiB document. Errors: `HMI_CONFIG_INVALID_REQUEST` 400, `HMI_CONFIG_VALUE_TOO_LARGE` / `HMI_CONFIG_DOCUMENT_TOO_LARGE` / `HMI_CONFIG_REQUEST_TOO_LARGE` 413, `HMI_CONFIG_UNAVAILABLE` 503, plus the existing 401/403/415 codes.
- 2026-10-01 T2 done (`d492404` domain types and admin write client, `69d32a2` adapter and boot wiring, plus one `fix(config)` commit isolating throwing status listeners, flagged by the pre-commit review).
  - RED: `sharedConfigStorage.service.test.ts` failed with no tests (module missing); `adminAuth.service.test.ts` 2 failed before `writeSharedConfig` existed; the status-listener test failed before the fix. GREEN: adapter 20/20, domain 4/4, admin client 65/65.
  - Adapter: `hmi-app/src/services/sharedConfigStorage.service.ts` (`sharedConfigStorage` singleton, `createSharedConfigStorage(options)` factory, options injectable: fetcher, adminClient, cache, pollIntervalMs, debounceMs, loadTimeoutMs). Domain types and parsers in `hmi-app/src/domain/sharedConfig.types.ts`. Admin write: `AdminAuthClient.writeSharedConfig(batch)` (PUT `/api/prisma/admin/hmi-config`, CSRF through the existing `protectedOperation`).
  - Public API: `load()`, `getItem`, `setItem`, `removeItem`, `getStatus()`, `subscribe(listener)` (remote changes, `{changedKeys}`), `subscribeStatus(listener)`, `retrySave()`, `startPolling()`, `stopPolling()`. Cache key `hmi:shared-config-cache` (must stay out of the migrated key set in T4/T5). Defaults: poll 10000 ms, debounce 300 ms, load timeout 5000 ms.
  - Decisions: unsaved edits overlay remote replacements; a write whose revision is not previous+1 triggers a refetch; the cache copy is only written from server-acknowledged state; no-op writes (same value, deleting an absent key) are not sent. The existing static boot shield in `index.html` is the loading state: `main.tsx` awaits `load()` before the appliers and the first render, so no new UI was added.
  - Deferred: a visible UI surface for `saveError` (banner/toast via `subscribeStatus`) is left to T3, when the first module actually writes through the adapter; nothing writes through it yet, so no save can be silent today. A retry/discard control is exposed as `retrySave()` only.
- 2026-10-01 F1-F4 fixups done (`3953aff` runtime, `1e6c903` client).
  - RED: backend 3 failed (bounds still 1 MiB/8 MiB, read took the write lock, missing Content-Length test); client 8 failed (batch splitting, permanent drop, bounds agreement). GREEN: `tests.test_hmi_config` 22/22; adapter + domain 33/33. The 413/503 HTTP tests (F3) pinned behavior that already worked, so they were green on first run (no RED to show).
  - F1: the adapter splits outgoing batches (200 operations, 16 MiB request) and sends the chunks in order. A chunk rejected with `HMI_CONFIG_DOCUMENT_TOO_LARGE`, `HMI_CONFIG_REQUEST_TOO_LARGE`, `HMI_CONFIG_VALUE_TOO_LARGE` or `HMI_CONFIG_INVALID_REQUEST` is dropped (local value reverts to the server value, change subscribers are notified), the error stays in `saveError` (sticky until `retrySave` dismisses it) and later chunks and writes keep flowing. Network, 5xx and 401/403 keep the chunk and every unsent one pending for `retrySave`.
  - F2: the schema is created and seeded once per store instance under a lock; reads are pure reads. WAL was not adopted: no other runtime store uses it.
  - F4: value 4 MiB, request 16 MiB, document 32 MiB, 200 operations, 512 keys. A TS test reads the Python constants and asserts the client mirrors them. `PRISMA_BROWSER_ROUTING.md` updated.
- 2026-10-01 T3 done (`b2f7cbc` stores and refresh, `d5d1e6c` save notice).
  - Stores: Dashboard, Template, Hierarchy, NodeType and VariableCatalog services are exported classes taking a `ConfigStoragePort` (default `sharedConfigStorage`); public APIs unchanged. The hierarchy expanded-nodes key stays in localStorage. `legacyStorageCleanup` only purges old `steigen_*` keys, so it needed no change.
  - Decision: reads never write. The old seed-on-first-read (`[]`, default node types) and the on-read migrations (dashboard aspect/rows/snapshot, template dashboardType) now run in memory and are persisted by the next real save. A viewer has no session, so a write on read would stay pending and fail forever. Ten existing assertions of the old behavior were rewritten (RED observed: 10 failed), plus a new "never writes while reading" test.
  - Test seam: `src/test/setup.ts` mocks the `sharedConfigStorage` singleton with a localStorage-backed double (`src/test/localStorageSharedConfig.ts`, with `emitChange`), so the existing suites that seed localStorage keep working; `contentStorage.sharedConfig.test.ts` proves each service uses an injected memory port and never touches localStorage.
  - Refresh: the content stores are NOT read through TanStack Query (they are loaded by page effects), so there were no query keys to invalidate. Instead `useSharedConfigVersion(keys)` (counts remote changes touching the keys, from `sharedConfigStorage.subscribe`) is a dependency of each load effect: `Dashboard` viewer (dashboards, hierarchy; silent in-place reload, no loading state, same viewer element), `DashboardManagerPage` (dashboards, templates, hierarchy; node type labels on the node types key) and `HierarchyPage` (hierarchy, dashboards, node types). RED: each page test failed before the wiring.
  - Deferral: `DashboardBuilderPage` is not refreshed on a remote change, because reloading would overwrite the administrator's unsaved draft; it re-reads on its next load. `Topbar` reads at click time, so it is always current.
  - Save notice: `SharedConfigSaveNotice` (admin-only strip mounted in `AdminLayout` under the header, `role="alert"`, Lucide `AlertTriangle`, "No se pudo guardar la configuración en el servidor." plus a "Reintentar" button calling `retrySave`), driven by `subscribeStatus`. The plain viewer never mounts it.
  - Question for T4: the keys `hmi:snapshot-export-*` and `hmi:prisma-runtime-mode` may need to stay per browser (they describe this browser's exporter and runtime mode, not shared configuration); decide when moving the configuration modules.
  - Gates: `npx tsc -b` clean, `npm run lint` clean, `npm test` 279 files / 3701 tests, `npm run build` ok, backend offline gate 1814 tests OK.
- 2026-10-01 T5 done (`cd94723`). Scope change from the user: the upload action ("Subir la configuración de este navegador al servidor"), its confirmation dialog and the admin hint were dropped by the user: export/import covers the migration; the fallback keeps local data readable/exportable until the server is first written. Nothing of the upload was written.
  - Live regression fixed: since T3 the viewer read an empty server document (revision 0) and showed "Sin Vistas Publicadas" while the data was intact in localStorage.
  - RED: 5 adapter tests failed (no `legacyStorage` option, no `bootstrap` status) and the domain test failed with `SHARED_CONFIG_KEYS is not iterable`. GREEN: adapter + domain 39/39; full suite 279 files / 3707 tests.
  - Fallback: while the loaded server document has revision 0 and no items, reads of the shared keys fall back to this browser's localStorage (read-only; no server write, no cache copy). `status.bootstrap === 'local-fallback'` exposes it (null otherwise). Any revision above 0 wins entirely; a poll that sees 0 to above 0 refetches and notifies the changed keys (including those that were served from local), so open pages reload. An unreachable server does not use the fallback.
  - Shared keys: `SHARED_CONFIG_KEYS` in `hmi-app/src/domain/sharedConfig.types.ts` (the five content keys; T4 extends it). A domain test pins it to the existing key constants and excludes per-browser keys and the cache key.
  - Decision: the first save while in fallback also stages this browser's other shared values, so that leaving the fallback (revision above 0) does not make unsaved-to-server data disappear (e.g. saving one template would otherwise hide the dashboards).
- 2026-10-01 G1-G3 fixups done (`a811fb8`). Approved-review advisories of T3.
  - G1: the variable-catalog test now seeds a dashboard whose widget references the variable plus one that does not, and asserts exactly the first is found; green on first run (the port-reading code already satisfied it; the test now fails if localStorage were read).
  - G2 RED: the read-to-read test failed (published timestamp followed the clock). GREEN: the in-memory migration uses the epoch (`STABLE_MIGRATION_TIMESTAMP`) when the dashboard has no `lastUpdateAt`.
  - G3 RED: a 4 MiB control-character value (escapes to ~24 MiB) was queued. GREEN: `setItem` refuses it up front with `SHARED_CONFIG_VALUE_TOO_LARGE` (`fitsInOneRequest`), nothing is queued or sent.
- 2026-10-01 T4 done (`2583014` modules to the adapter, `c92daaf` live re-apply, plus a small follow-up exporting `SHADER_PARAMS_STORAGE_KEY`).
  - Moved to the adapter (public APIs unchanged, `localStorage.*` replaced by `sharedConfigStorage.*`): `dataConnection.config`, `hmiName.service`, `loaderOptions.config`, `temporalSettings.config`, `prismaOrb.config`, `themeStyle.service` (style + frame radius), `viewerEntranceStyle.service`, `frameShape.service`, `iconCutout.service`, `linkCornerAccents.service` (3 keys), `shaderParams.store` (zustand persist over the adapter), design fonts/colours (persistence moved out of `DesignSettingsTab.tsx` into the new `services/designSettingsStorage.service.ts`).
  - Final SHARED split. Shared (`SHARED_CONFIG_KEYS`, 24 keys): the 5 content keys; `hmi:node-red-base-url`, `hmi:node-red-endpoint`, `hmi:data-history-endpoint`, `hmi:activity-series-endpoint`; `hmi:prisma-hmi-name`, `hmi:loader-options`, `hmi:temporal-settings`, `hmi:prisma-orb-visual-config`; `hmi-theme-style`, `hmi-theme-frame-radius`, `hmi-viewer-entrance`, `hmi-frame-shape`, `hmi-icon-cutout`, `hmi-link-corner-accents`, `hmi-link-corner-accent-lengths`, `hmi-link-corner-accent-geometry`, `hmi-theme-fonts`, `hmi-theme-colors`, `hmi-shader-params`. A domain test pins the list to each module's own constant and asserts the local ones are excluded.
  - Local (per browser, never in the list): `hmi-global-settings-tab`, `laboratorio_hmi_hierarchy_expanded_v1`, `interfaz-laboratorio-ui`, `hmi-auth-session`, `hmi-admin-exit-pending`, `hmi-admin-revoked`, alert history, `hmi:shared-config-cache`, `hmi-prisma-voice-prebuffer-history`, the T6 flag, and the legacy `hmi:snapshot-export-*`, `hmi:prisma-runtime-mode`, `hmi:prisma-voice-tts-service-url`.
  - Verified for the snapshot-export/runtime-mode/TTS keys: no source file reads or writes them any more (the earlier `prisma-unified-browser-runtime` feature removed those APIs; they survive only as inert legacy values asserted by tests), and the data-connection module moved here holds only the four telemetry keys. So keeping them local is coherent and nothing needed to be stopped or reported.
  - Re-apply: `app/sharedConfigAppliers.ts` owns one group per key set (design fonts/colours, theme style + radius, entrance, frame shape, cutout, three accent keys, shader rehydrate, data-connection query invalidation). `main.tsx` calls `applySharedConfigToDocument()` after the document loads and `startSharedConfigReapply({ queryClient })`, which subscribes to the adapter and re-applies only the groups whose keys changed. The theme groups clear the document first so a value removed elsewhere does not linger. The two cross-tab `storage` listeners (`useTemporalSettings`, `usePrismaOrbVisualConfig`) now subscribe to the adapter by key; the `hmi:*-changed` events remain for same-document saves.
  - Reads never write: `applyThemeOverrides` used to rewrite the normalised font overrides and the Diseño tab did the same on mount, which for a viewer (no session) would sit pending forever and mask later remote values. Both writes were removed; saving still persists. Tests assert applying and opening the tab write nothing.
  - Unsaved edits: unlike the content pages, configuration tabs read once on mount and keep their drafts in React state, so they are never overwritten. Only Diseño and Tema preview live on the document; `GlobalSettingsDialog` holds the re-apply (`useHoldSharedConfigReapply`, backed by `sharedConfigReapplyHold.service`) while any tab is dirty. Changes that arrive meanwhile are remembered and applied when the drafts are saved or discarded. Known edge: the Fondo (shader) sliders persist as you drag, so a remote shader change while one is being dragged would rehydrate it; not held because it is not a dirty-draft flow.
  - RED/GREEN: domain key-list test failed (24-key list) then passed; hook tests failed with the old storage-event path then passed (7/7); the applier tests (12) and the hold hook test were written with the module and passed on first run (no separate RED observed for them). Full suite 281 files / 3721+ tests green.
  - Pre-commit review findings fixed: tuteo hint text in the colour palette (now usted and accurate), raw palette classes replaced with tokens, mount write removed, stale localStorage comments.
- 2026-10-01 T6 done (`178ed35`).
  - Flag: `services/hiddenAccess.service.ts` (own key `hmi:hidden-access`, value `on`, plain localStorage, never shared; in-memory fallback if storage is blocked; in-document listeners plus the `storage` event for other tabs of the same browser) and `hooks/useHiddenAccess.ts` (`useSyncExternalStore`).
  - Shortcut: `hooks/useHiddenAccessShortcut.ts`, mounted once in `App.tsx` (document `keydown`, `code === 'KeyA'` with Ctrl+Alt only, no Shift/Meta; ignored for input, textarea, select and contenteditable; `preventDefault` only when handled). No conflict: the builder's undo/redo uses Ctrl/Meta+Z/Y without Alt (`DashboardBuilderPage`), and `useReloadShield` only reacts to its own reload keys.
  - Topbar: the users button and `PrismaPairingControl` (the only Prisma entry in the Topbar) render only when the flag is on. The login overlay state moved from Topbar's `useState` to `store/loginOverlay.store.ts` so the route can open it; it closes when the icons are hidden and when the Topbar unmounts. An authenticated admin keeps the Administración and Personalizar fondo buttons and the `/admin` route (guards untouched).
  - Route: `{ path: 'acceso', element: <HiddenAccessRoute /> }` as a child of `MainLayout` in `app/router.tsx` (so the Topbar is mounted); `HiddenAccessRoute` sets the flag, opens the login and `navigate('/', { replace: true })`.
  - RED: the four existing Topbar tests that need the icons failed once the flag defaulted to hidden (they now reveal it in `beforeEach`); the service, shortcut, Topbar, route and router tests were written against the missing modules (service test failed with no module). GREEN: service 7, shortcut 5, Topbar 22 (incl. 6 hidden-access), HiddenAccessRoute 2, router 5; the shortcut/route/service tests cover default hidden, shown after the combination, hidden on the second press, persisted per browser, ignored while typing, `/acceso` reveals + opens login + lands on `/`.
  - Full suite 284 files / 3746 tests green on the second run; the first run had the known flaky Topbar test and one more failure that did not reproduce (isolation green, full rerun green).
- 2026-10-01 H1-H7 fixups done (`ea1def5` refactor H3-H6, `df90f10` H7, `be1d0e0` H1-H2). Approved four-lens review advisories.
  - H1 RED: 2 seeding tests failed (oversized and escape-heavy legacy values were queued). GREEN: `seedLocalValues` applies the same per-value and one-request checks as `setItem` (shared `isStageableValue`); skipped keys are reported in `saveError` (`SHARED_CONFIG_VALUE_TOO_LARGE`, new optional `keys`) and never sent.
  - H2 RED: 2 tests failed (no revision re-check; the seed overwrote another browser's document). GREEN: seeding moved from stage time to flush time; right before seeding the adapter does `GET /revision`. Revision 0 seeds; above 0 it refetches the document, leaves the fallback and sends only this browser's own edit; an unreachable server keeps the edits pending with a save error (retry works). Known limitation: a write that lands between the re-check and the PUT is not detected (no optimistic concurrency). Dev-only in practice: on the real server new browsers have no local data.
  - H7 RED: new `sharedConfigReapplyHold.service.test.ts` failed (keys dropped with no handler). GREEN: held keys are kept until a handler is registered, then delivered once. `publishedSnapshot.publishedAt` is displayed nowhere in the UI (only stored in `admin.types.ts` and written by the dashboard service), so a 1970 epoch cannot be shown; nothing to render differently.
  - H3-H6 refactors (tests stayed green): `''.repeat` in the escape test; `ENTRY_SEPARATOR_BYTES` named for the wire overhead; `LS_KEY_*` renamed to `*_STORAGE_KEY` (values unchanged); `isRecord` exported from `domain/sharedConfig.types.ts` and reused by `designSettingsStorage`; `handleResetFonts` and `handleReset` reuse `resetFontOverridesOnDocument` / `resetThemeOverridesOnDocument` (fonts-only reset keeps live colour previews); the eslint-disable justification fixed; `sharedConfigAppliers` no longer keeps a second `activeContext`. Skipped: R3-dialog-hold-untested (not trivial).
- 2026-10-01 T7 docs done, live check pending. Updated `docs/ARCHITECTURE.md` (shared configuration and hidden access sections; `SHARED_CONFIG_KEYS` as the single list) and `hmi-app/src/components/admin/ADMIN_CONVENTIONS.md` (section 7). `PRISMA_BROWSER_ROUTING.md` already had the three routes, bounds and errors: verified, unchanged. `DATA_CONTRACT.md` is not affected (plant contract), only pointed to from ARCHITECTURE. T7 stays unchecked until the live two-browser check.
- 2026-10-01 T7 live check (parent, control Chrome on the dev server):
  - Hidden access: the plain viewer shows neither the users button nor the Prisma button. `Ctrl+Alt+A`, sent through CDP, reveals both (screenshots shared with the user).
  - Propagation:
    - With the viewer open on revision 0 (local fallback showing the user's dashboards), the parent wrote `hmi-theme-style` straight into the dev store and bumped the revision to 1 at 10:55:43.
    - The open viewer picked it up WITHOUT a reload by 10:55:50, about 7 s later, inside the 10 s poll. Because the server document now won entirely, it showed "Sin Vistas Publicadas", as designed.
    - The store was then restored to revision 0 with no items, after a backup copy, and after a reload the viewer showed the local dashboards again.
  - Not checked live: the admin write path, because the control Chrome admin session had expired and the parent holds no credentials. It is covered by the HTTP tests (401/403/413/503) and the adapter tests.
- 2026-10-01 T8 done (`544883c` runtime, `8b44b67` client, plus the docs in both).
  - RED: backend 8 failed and 1 import error (`tests.test_admin_auth`, `tests.test_admin_http`) before the feature; client 16 failed and 1 passed across the three new files. GREEN: backend 46 focused, whole discover 1829 OK, offline gate (child-only supervisor) exit 0; client 11 + 20 focused, full suite 288 files / 3770 tests.
  - Server: `POST auth/login` takes an optional boolean `takeover` (other types are `400 INVALID_LOGIN_REQUEST`). After the password is verified, another live session (not absolute- or idle-expired) without `takeover` gives `409 ADMIN_SESSION_ACTIVE_ELSEWHERE`, no cookie and no session; a wrong password is always `401 INVALID_CREDENTIALS`, so existence is never revealed before authenticating. A verified password still clears its failure budget. With `takeover: true` one `BEGIN IMMEDIATE` transaction writes the markers, deletes every session and inserts the new one (a trigger-forced insert failure leaves the old session and no marker).
  - Replaced-session design: new table `replaced_sessions(session_id_hash, replaced_at, expires_at)`. Chosen over a revocation-reason column because it needs no change to `admin_sessions` or to schema version 1: it is created lazily (`CREATE TABLE IF NOT EXISTS`) on first use, so a database provisioned before this change keeps working without a version bump. A row lives until the replaced session's own absolute expiry (the cookie is useless after that), is purged on writes and reads, and is capped at 64 rows. `_unauthenticated()` in `admin_http.py` answers `401 ADMIN_SESSION_REPLACED` for `auth/session` and every `_authorized_session` route (credentials, `admin/hmi-config`); the extra query runs only on the already-failing path. Expiry, logout and password reset keep `AUTHENTICATION_REQUIRED`.
  - Client: `AdminAuthClient.login(..., takeover)` sends the flag only when true; `onSessionReplaced(listener)` fires from the central `request()` on the replaced code, so the shared-config write path and the credential panel are covered without touching them. `AdminSessionController`: `login(u, p, {takeover})`; a 409 returns `{ok:false, error: <warning>, code}` and is not a failure (no store error); `validateSession`, `handleProtectedRequestError` and the client listener all end in `handleSessionReplaced` (drops authority like a 401 and sets the new auth-store flag `sessionReplaced`). `RequirePermission` already sends an unauthenticated browser from `/admin` to `/`, so no new navigation code was needed.
  - UI: the confirmation (exact copy, Continuar / Cancelar) is rendered inside the `LoginOverlay` panel, not with `AdminDialog`: `AnchoredOverlay` closes on any click outside its own element and a portal dialog would be outside it. The credentials stay in the overlay's component state only; Cancelar clears the password. The displaced browser shows `SessionReplacedNotice` (alert strip with an `AlertTriangle` icon and 'Entendido', mounted in `AdminSessionLifecycle` above every route). The store `error` pattern was not used for it because that text is visible only while the login overlay is open, which a plain viewer (hidden access) rarely has. Plain expiry keeps its behaviour and shows no notice.
  - When the displaced browser notices: the controller validates the session on window focus and on its protected requests (credential panel, shared-config writes); there is no periodic session poll, and the viewer's revision poll is public and does not touch the session. So an idle displaced browser learns on its next focus or save. Accepted as the task allows; no polling was added.
  - Existing tests changed: the login-boundary assertion now includes `takeover=False`. Optional follow-up not done: a store action `dismissSessionReplaced` instead of calling `setState` from the notice.
- 2026-10-01 T8 review fixups J1-J8 (`a2aa3f2` runtime, `c75a576` client, plus this doc commit).
  - J1/J4/J5/J6 (runtime): `was_session_replaced` is now a pure read (`expires_at > now` filter, no `BEGIN IMMEDIATE`, no DDL, no purge; a missing table reads as not replaced) and any lookup failure falls back to the plain `401 AUTHENTICATION_REQUIRED`, never 503. Marker purging stays in the takeover write path. The table DDL is one constant (`REPLACED_SESSIONS_DDL`) used by schema init and re-asserted (IF NOT EXISTS) inside the takeover transaction, so databases provisioned before T8 still work without a version bump. One `_is_live_session` rule serves `read_session` and the 409 gate. `_unauthenticated` is a plain call.
  - J2: a `401 ADMIN_SESSION_REPLACED` response expires the session cookie (same name, path and attributes as logout), so the displaced browser is told once.
  - J3: could not reproduce the un-hydrated state: `handleSessionReplaced` calls `suspend(null, true)`, which sets `isHydrated` and clears `isAuthenticating` before `validateSession`'s `finally` is skipped. Tests for the bootstrap path, the focus path and the unstarted controller were added and passed before any production change, so no controller code changed.
  - J7: `AdminAuthClient.login(username, password, { signal?, takeover? })`; the gateway type, controller and tests follow.
  - J8: the T8 bullets now match the implementation.
  - RED (backend, before the change): lock-free lookup test errored (write lock contention), purge/DDL test failed (`0 != 1`, marker purged by a lookup), replaced-cookie-expiry test errored (no `Set-Cookie`), failing-lookup test failed (`503 != 401`). The forged-cookie HTTP test, the schema-init-adds-table test and the idle-expired-no-409 test were already green (characterization, no RED). GREEN: whole backend discover 1836 OK; the existing Mock-based HTTP tests now set `was_session_replaced.return_value = False` (tolerance lives in tests only), and the takeover HTTP test replays the stale cookie from fresh clients because the first answer now expires it.
  - Client: `tsc -b`, `eslint`, `npm test` 288 files / 3773 tests, `npm run build` all pass; offline gate (child-only supervisor) exit 0.
- 2026-10-01 closing slice review:
  - Native review of `d448341..5129ef9` (H1–H7, the T7 docs and the live check record): approved and acknowledged (lineage `review-d0aa99676cc458e9`). Reviewed boundary `5129ef9`. The whole feature is now reviewed.
  - Advisories:
    - `R3-seed-await-before-inflight`: false positive for a double flush. `flushNow` sets `flushPromise` before `performFlush` awaits `prepareSeed`, so a second debounced flush reuses the same promise. The only overlap is a poll that may run `refresh()` during the seed check, which is harmless.
    - `R3-reset-color-keyset-unproved`: there is no test that `COLOR_TOKEN_KEYS` equals the keys walked through `COLOR_GROUPS`. Left as a small follow-up.

## Status

T1–T8 are complete. T8 (single administrator session) was added on 2026-10-01 at the user's request; its review fixups J1-J8 are applied and the fixup commits await a re-check. Merging into main and pushing are the user's decisions. Next: the Prisma → Leda rename (a separate feature, branched from here).
- 2026-10-01 T8 reviews:
  - `5129ef9..e8448cb`: four lenses, approved and acknowledged (`review-e07ac098cab5f6fc`). Its warnings were fixed as J1–J8.
  - `e8448cb..56b9840`: four lenses, approved and acknowledged (`review-e8cfd33175ef797b`). Reviewed boundary `56b9840`.
  - Remaining non-blocking follow-ups:
    - A lookup failure degrades to a plain 401 without logging (`R4-silent-lookup-degradation`).
    - The test clock offsets are unexplained.
    - The missing-table detection matches SQLite's "no such table" wording.
    - The "replaced" notice can be lost if the client aborts the request that receives it, because the cookie is already expired. The user then sees a plain signed-out state instead of the notice. This is accepted.

