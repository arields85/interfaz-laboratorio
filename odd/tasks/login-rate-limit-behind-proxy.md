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

- [ ] R1 — Runtime: trusted client-source resolution plus rate limiter wiring, with tests (RED first).
- [ ] R2 — Docs: `DEPLOYMENT.md` (nginx header, remove the limitation, verification step) and the routing doc.
- [ ] R3 — Native review.

## TDD

Strict mode, ON. Runtime: Python unittest, plus the offline gate per the runtime README.

## Progress

- 2026-10-01: feature document created.
