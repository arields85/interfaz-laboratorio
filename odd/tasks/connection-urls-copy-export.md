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

- [ ] C1 — Copy buttons per field, with tests.
- [ ] C2 — Export and import of the connection values, with tests.
- [ ] C3 — Native review, plus a live check in the control Chrome (visual only; saving needs the user's login).

## TDD

Strict mode, ON. hmi-app: `npm test`.

## Progress

- 2026-10-01: feature document created.
