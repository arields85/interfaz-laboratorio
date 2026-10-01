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
- [ ] T2 — Client `sharedConfigStorage` adapter: boot load with cache fallback, sync read API, admin batch writes with CSRF, and the revision poll with a subscription API. Tests.
- [ ] T3 — Move the content stores to the adapter: dashboards, templates, hierarchy, node types and the variable catalog, with query invalidation on a remote change.
- [ ] T4 — Move the configuration modules to the adapter: data connection, HMI name, loader, temporal, Prisma orb, theme, frame shape, icon cutout, link accents, viewer entrance, design fonts and colors, and shader params. Re-apply on a remote change, replacing the `storage` listeners.
- [ ] T5 — One-time migration action in the admin to upload this browser's configuration, with confirmation.
- [ ] T6 — Hidden access:
  - the Topbar hides the users and Prisma icons unless the browser-local flag is on;
  - `Ctrl+Alt+A` toggles the flag;
  - `/acceso` reveals the icons and opens the login.
- [ ] T7 — Docs (`ARCHITECTURE.md`, `DATA_CONTRACT.md` if affected, `PRISMA_BROWSER_ROUTING.md`, the admin conventions), and a live check with two browser profiles: the change in one appears in the other within about 10 s.

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
