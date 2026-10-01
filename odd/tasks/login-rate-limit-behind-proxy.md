# Login rate limit behind the reverse proxy — ODD feature document

> ODD feature task (not SDD). Branch `feat/login-rate-limit-behind-proxy`, stacked on `feat/admin-password-change`.
> Engram mirror: `odd/login-rate-limit-behind-proxy/tasks`.

## Objective

Rate-limit admin login attempts per real client when the runtime sits behind nginx. The current limiter keys on `request.remote_addr`, so behind the proxy every client appears as `127.0.0.1` and shares one failure budget: an attacker's failed attempts could lock the real admin out.

## User decision (2026-10-01)

Fix it now, before the server deployment.

## Design

The runtime derives the client source for rate limiting from a proxy header, but only when it is safe to trust it:
- The request's TCP peer is loopback (nginx in the same container; already required by TransportPolicy).
- A production origin is configured (`LEDA_PUBLIC_ORIGIN` set).
- The header value is a single valid IP.

Otherwise it falls back to `remote_addr`.

nginx MUST set the header itself with `proxy_set_header X-Real-IP $remote_addr;`, which overwrites any client-supplied value.

The design reviews whether an account-wide budget also exists and keeps it coherent: per-source limits stop one client from locking out the account for others; any account-wide protection must not become a lockout vector.

Update `docs/DEPLOYMENT.md` (nginx block and limitations) and `docs/leda/LEDA_BROWSER_ROUTING.md`.

## Tasks

- [x] R1 — Runtime: trusted client-source resolution plus rate limiter wiring, with tests (RED first).
- [x] R2 — Docs: `DEPLOYMENT.md` (nginx header, remove the limitation, verification step) and the routing doc.
- [ ] R3 — Native review.

## TDD

Strict mode, ON. Runtime: Python unittest, plus the offline gate per the runtime README.

## Progress

- 2026-10-01: feature document created.
- 2026-10-01 R1 (0a838f8): `AdminHttpBoundary._client_source()` wired into login and password change (the only two callers of `remote_addr` as a source). RED observed before implementation: 3 failures + 2 errors in `tests.test_admin_http` (new tests, `_client_source` missing, header ignored). GREEN: 40 admin_http tests, 85 with admin_auth.
  - Trust rule: `X-Real-IP` only when the peer is loopback AND the transport policy is valid with `LEDA_PUBLIC_ORIGIN` set AND the header is exactly one `ipaddress` address (max 45 chars, no surrounding whitespace); the value is normalized (`str(ip_address)`) so spelling variants of one IPv6 share a budget. Otherwise `remote_addr` (dev through Vite unchanged).
  - Account-budget decision: there is no account-only budget. The limits are per (account, source) = 5 and per source = 20 in a 15 minute window, so one source cannot lock the admin out of another source; no change needed (test added). Residual, documented in DEPLOYMENT.md: the global storage cap of 100 live failure rows can be exhausted by an attacker rotating many addresses (e.g. an IPv6 block), which temporarily blocks all logins; not mitigated in the app (nginx/firewall per-IP limiting suggested).
- 2026-10-01 R2 (8ff40ce): `docs/DEPLOYMENT.md` (rule 4, nginx snippet `proxy_set_header X-Real-IP $remote_addr;` with overwrite/no X-Forwarded-For note, limitation rewritten, verification step 7) and `docs/leda/LEDA_BROWSER_ROUTING.md` (production contract; that doc is in English, so the addition is too).
- Offline gate (child-only supervisor): 1899 tests OK, exit 0.
