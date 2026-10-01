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

- [ ] P1 — Server route, service method and tests (Python unittest, RED first).
- [ ] P2 — Client API, admin UI and tests (vitest, RED first); routing docs, including the stale-route fix.
- [ ] P3 — Native review and a live check in the control Chrome.

## TDD

- Mode: strict, ON.
- Runners:
  - hmi-app: `npm test`.
  - Runtime: the offline gate per `services/leda-runtime/README.md`.

## Progress

- 2026-10-01: feature document created after the user's approval.
