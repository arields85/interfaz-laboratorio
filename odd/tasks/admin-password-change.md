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
- [x] P3 — Native review and a live check in the control Chrome.

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
- 2026-10-01: review fixups Q1-Q6 (`33ab045` client, `f69cba0` runtime).
  - Q1: Cancelar disabled and backdrop/Escape/onClose ignored while a request is in flight. RED: the new in-flight close test failed. GREEN: 21 dialog tests.
  - Q2: network, `AUTH_TRANSPORT_UNAVAILABLE`, `AUTH_RESPONSE_INVALID` and unexpected errors show a specific "unknown result, may already have changed" message; definitive server errors keep their messages. RED: 3 new cases failed, GREEN with Q1.
  - Q3: comment now names `hmi-app/src/domain/adminPasswordPolicy.types.ts`. Q4: `login_account_key()` shared by login, reservation and change; its test was RED (import error) then GREEN. Q5: request-size bound explained and `MAX_JSON_ESCAPE_BYTES_PER_SECRET_BYTE` / `MAX_CREDENTIAL_JSON_OVERHEAD_BYTES` referenced by name; `_password_bytes` wrapper removed.
  - Q6: the two route-mapping tests (SESSION_ENDED -> 401, AuthNotConfigured -> 503) pinned existing behavior and passed on first run (no RED).
  - Checks: `tsc -b`, lint, build clean; `npm test` 291 files / 3819 tests; offline gate exit 0.

## Decisions

- **Policy.** One function, `password_bytes()` in `admin_auth.py`, now serves the hasher (CLI provision/reset) and the service. Bounds are the constants `MIN_PASSWORD_CHARACTERS = 10` and `MAX_PASSWORD_BYTES = 1024`. The client mirrors them in `domain/adminPasswordPolicy.types.ts`, and a test reads the Python constants to pin them.
- **Order of checks.** Policy and "same as current" (`400 PASSWORD_POLICY_REJECTED` / `PASSWORD_UNCHANGED`) come first and spend no login attempt, so they say nothing about the current password. Then the login rate limit, then the current password (`401 INVALID_CURRENT_PASSWORD`, counted as a failure; a verified change clears the budget).
- **Atomicity.** One `BEGIN IMMEDIATE` transaction checks the credential version and that the caller's session is still live, updates the hash and version, and deletes every other session. A concurrent reset or logout wins (`401 AUTHENTICATION_REQUIRED`); any storage failure rolls everything back (`503`).
- **Revoked sessions get plain `AUTHENTICATION_REQUIRED`, not `ADMIN_SESSION_REPLACED`.** The replaced marker means "another login took your place" and the client says exactly that. A password change by the same administrator is not that, and it matches the CLI reset, which also leaves no marker. Side benefit: no write to `replaced_sessions`.
- **UI placement.** A key icon in the `AdminLayout` topbar, next to the "Configuración general" gear and the "Cerrar sesion" button, because that is where the account actions live. It opens `AdminPasswordChangeDialog` (existing `AdminDialog`, `HmiButton`, sidebar input tokens, Lucide `KeyRound`). Fields are real `type="password"` inputs with `current-password` / `new-password` autofill hints, so the browser's password manager can update its entry. Passwords live only in component state and are cleared on success; unmount aborts an in-flight request.
- **Session handling in the client.** `401 INVALID_CURRENT_PASSWORD` is a form error. Only other 401/403 go to `controller.handleProtectedRequestError`.
- **Docs.** `LEDA_BROWSER_ROUTING.md` now lists exactly the 28 routes of `vite.ledaProxy.config.ts` (verified by script) and documents the password route; `ADMIN_CONVENTIONS.md` has the UI entry.
- 2026-10-01 P3:
  - Four-lens native reviews:
    - `e2644f2..44afe70`: approved (`review-eeeb0df95f395425`). Its warnings were fixed as Q1–Q6.
    - `44afe70..7694c49`: approved (`review-4972195c48ab39c0`). Reviewed boundary `7694c49`.
  - Parent spot check: the full hmi-app suite passed, 291 files and 3815 tests, before the Q fixups.
  - On the restarted dev runtime, the route answers 403 to a request with no session or CSRF (rejection, not 404).
  - The live UI check needs the user's admin login (the parent holds no credentials) and is pending the user.
  - Remaining non-blocking follow-ups:
    - The dialog's close is blocked while a request is in flight, and there is no client timeout, so a hung request keeps it open until a reload.
    - The overhead comment cites a literal.
    - The backdrop-close assertion after settling is vacuous.
    - There is no exact-limit test for MAX_PASSWORD_CHANGE_REQUEST_BYTES.
  - Decision 2026-10-01 (user): admin password minimum lowered from 15 to 10 characters (second factor is backlog PW-023); after a successful change the dialog's secondary button reads "Cerrar". Commit d1d1e4c. RED: 1 Python failure (15 != 10) and 6 vitest failures; GREEN: test_admin_auth 46 OK, 2 vitest files 31 passed, full hmi-app 3870 passed, offline backend gate 1900 OK. Existing passwords are unaffected: only provisioning/reset/change pass provisioning=True; login verification enforces the byte ceiling only.

## Status

Complete, pending only the user's live check.

