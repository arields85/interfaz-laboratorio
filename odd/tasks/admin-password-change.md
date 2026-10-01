# Admin password change from the interface — ODD feature document

> ODD feature task (not SDD). Branch `feat/admin-password-change`, stacked on `feat/rename-prisma-to-leda`.
> Engram mirror: `odd/admin-password-change/tasks`.

## Objective

Let the administrator change their own password from the HMI admin. Today the only path is the server CLI (`leda_runtime.admin_cli reset-admin-password`), so on the deployed server the user would depend on IT for every change.

## User decision (2026-10-01)

Implement it before the first server deployment.
- IT (Lucas) creates the admin account once with a provisional password.
- The user then changes it from the interface without IT.
- The CLI reset stays as the recovery path for a forgotten password.

## Design

- **Server.** A new admin route, `POST /api/leda/admin/auth/password`, protected like every admin write: session, CSRF, origin and host checks.
  - Body: current password and new password.
  - It verifies the current password with the same hasher and login rate limiting.
  - It enforces the same password policy that `admin_cli` provisioning enforces.
  - It stores the new hash and bumps the credential version. All OTHER sessions are revoked atomically; the caller's session stays valid.
  - A wrong current password returns 401 with a distinct code, counts as a failed attempt, and does not reveal anything else.
- **Client.**
  - A "Cambiar contraseña" entry in the admin. Place it where admin account actions already live; document the choice.
  - Three fields: current, new, confirm (usted copy).
  - Client-side validation mirrors the server policy.
  - Success and error feedback use the existing patterns.
  - On success, a short confirmation; the session stays open.
- **Routing.** Add the route to `vite.ledaProxy.config.ts`, `docs/leda/LEDA_BROWSER_ROUTING.md` (also fix the stale route list there) and `ADMIN_CONVENTIONS.md`.

## Tasks

- [x] P1 — Server route, service method and tests (Python unittest, RED first). Commit `ef6f9d2`.
- [x] P2 — Client API, admin UI and tests (vitest, RED first); routing docs, including the stale-route fix. Commits `1c2388f`, plus the message fixup below.
- [ ] P3 — Native review and a live check in the control Chrome.

## TDD

- Mode: strict, ON.
- Runners:
  - hmi-app: `npm test`.
  - Runtime: the offline gate per `services/leda-runtime/README.md`.

## Progress

- 2026-10-01: feature document created after the user's approval.
- 2026-10-01: P1 done (`ef6f9d2`), route `POST /api/leda/admin/auth/password`.
  - RED: `unittest tests.test_admin_auth tests.test_admin_http` failed (import error for `PasswordChange`; 18 failures with 404 on the route). GREEN: 74 tests OK after the implementation.
  - Offline gate (child-only supervisor, README): 1888 tests OK, exit 0.
- 2026-10-01: P2 done (`1c2388f`).
  - RED: the new vitest files and cases failed (`changePassword is not a function`, missing modules). GREEN: 193 tests in the 5 touched files, then the full suite 291 files / 3815 tests, `tsc -b`, lint and build clean.
  - Review fixup: the dialog maps the server's single `PASSWORD_POLICY_REJECTED` code to a message naming both bounds (the earlier "too short" text could be wrong for a too-long password).

## Decisions

- **Policy.** One function, `password_bytes()` in `admin_auth.py`, now serves the hasher (CLI provision/reset) and the service. Bounds are the constants `MIN_PASSWORD_CHARACTERS = 15` and `MAX_PASSWORD_BYTES = 1024`. The client mirrors them in `domain/adminPasswordPolicy.types.ts`, and a test reads the Python constants to pin them.
- **Order of checks.** Policy and "same as current" (`400 PASSWORD_POLICY_REJECTED` / `PASSWORD_UNCHANGED`) come first and spend no login attempt, so they say nothing about the current password. Then the login rate limit, then the current password (`401 INVALID_CURRENT_PASSWORD`, counted as a failure; a verified change clears the budget).
- **Atomicity.** One `BEGIN IMMEDIATE` transaction checks the credential version and that the caller's session is still live, updates the hash and version, and deletes every other session. A concurrent reset or logout wins (`401 AUTHENTICATION_REQUIRED`); any storage failure rolls everything back (`503`).
- **Revoked sessions get plain `AUTHENTICATION_REQUIRED`, not `ADMIN_SESSION_REPLACED`.** The replaced marker means "another login took your place" and the client says exactly that. A password change by the same administrator is not that, and it matches the CLI reset, which also leaves no marker. Side benefit: no write to `replaced_sessions`.
- **UI placement.** A key icon in the `AdminLayout` topbar, next to the "Configuración general" gear and the "Cerrar sesion" button, because that is where the account actions live. It opens `AdminPasswordChangeDialog` (existing `AdminDialog`, `HmiButton`, sidebar input tokens, Lucide `KeyRound`). Fields are real `type="password"` inputs with `current-password` / `new-password` autofill hints, so the browser's password manager can update its entry. Passwords live only in component state and are cleared on success; unmount aborts an in-flight request.
- **Session handling in the client.** `401 INVALID_CURRENT_PASSWORD` is a form error. Only other 401/403 go to `controller.handleProtectedRequestError`.
- **Docs.** `LEDA_BROWSER_ROUTING.md` now lists exactly the 28 routes of `vite.ledaProxy.config.ts` (verified by script) and documents the password route; `ADMIN_CONVENTIONS.md` has the UI entry.
