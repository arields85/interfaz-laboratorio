# Connection tab: copy, export and import of URLs — ODD feature document

> ODD feature task (not SDD). Branch `feat/connection-urls-copy-export`, stacked on `feat/login-rate-limit-behind-proxy`.
> Engram mirror: `odd/connection-urls-copy-export/tasks`.

## Objective

In Configuración general → Conexión:
- each URL field gets a copy button (icon only) that copies that field's value;
- an "Exportar" button downloads the four connection values;
- an "Importar" button loads such a file.

This works the same way the dashboards are exported and imported. It moves the connection settings from the development PC to the server, which starts empty.

## User decisions (2026-10-01)

- Copy: one icon button per field, copying that field's value individually.
- Export and import buttons, like the dashboard ones.
- Defaults taken (the user can override):
  - copy uses the current (possibly unsaved) field value;
  - import validates the file and FILLS the form, marking the tab dirty, but does not save by itself. The user reviews and presses Guardar, like any other edit in that tab.
- The base URL must be absolute; endpoints are paths appended to it. This is already true of the user's current values.

## Design

- **Export file.** JSON with a format/version marker and the four values: base URL, data endpoint, history endpoint, activity-series endpoint. Follow the dashboard portability conventions (naming, download helper, feedback) where they apply.
- **Import.** Parse and validate strictly. Validation reuses the same rules as manual entry: the base URL is an absolute http(s) URL; the endpoints are paths. Invalid files show a clear usted message and change nothing.
- **Copy.** Uses the Clipboard API. When the copy succeeds, the button gives brief visual confirmation (Lucide icon swap, aria-live). When it fails, it shows a clear message.
- Only Lucide icons, tokens and existing primitives. The UI copy is in Spanish (usted).

## Tasks

- [x] C1 — Copy buttons per field, with tests. (27fea9e)
- [x] C2 — Export and import of the connection values, with tests. (9fe240e, 376e736)
- [ ] C3 — Native review, plus a live check in the control Chrome (visual only; saving needs the user's login).

## TDD

Strict mode, ON. hmi-app: `npm test`.

## Progress

- 2026-10-01: feature document created.
- 2026-10-01 C1 (27fea9e): `CopyValueButton` on top of `AdminIconToolbarButton` (the pre-commit review rejected a first hand-built button). One `role="status"` live region announces success or failure; the Copy -> Check swap lasts 1.5 s.
  - RED: 9 of 14 tests failed in `ConnectionSettingsTab.test.tsx` (no copy buttons). GREEN: 14/14.
- 2026-10-01 C2 (9fe240e logic, 376e736 UI):
  - RED: `dataConnectionValidation.test.ts` and `dataConnectionPortability.test.ts` failed to load (modules missing); then the tab tests: 9 of 23 failed. GREEN: 29/29 and 23/23.
  - File format (`domain/dataConnectionPortability.types.ts`): `{ format: "interfaz-laboratorio-data-connection", schemaVersion: 1, exportedAt, connection: { baseUrl, endpoint, historyEndpoint, activitySeriesEndpoint } }`. File name: `interfaz-laboratorio-connection-YYYYMMDD-HHMM.json` (same timestamp as dashboard exports; the dashboard names do not include the HMI name).
  - Shared validation: `utils/dataConnectionValidation.ts`. Manual entry had NO inline validation (it saves whatever is typed), so there was nothing to extract; the function is new and is used by export and import. Manual entry behavior is unchanged on purpose.
  - Rules: base URL required, absolute http(s); snapshot endpoint required; history and activity-series endpoints may be empty (feature disabled, as in manual entry); non-empty endpoints must be paths starting with a single "/" and without whitespace. Parsing is strict (exact keys, strings only).
  - Shared helpers extracted to `utils/portableFile.ts` (`downloadJsonFile`, `formatPortableTimestamp`); `DashboardManagerPage` and `dashboardPortabilityService` now use them (no behavior change).

## Decisions

- Export uses the CURRENT FORM values, not the saved ones: the file matches what the user sees, and it is the way to move a configuration that was just edited. A hint under the buttons says so. Export refuses invalid values with a message, so a file that cannot be imported is never produced.
- Import only fills the form and marks the tab dirty; the user presses Guardar. Failures show a usted message and change nothing.
