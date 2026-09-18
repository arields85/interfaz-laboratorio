# Prisma administrator fetch receiver correction

## Intent and authorization

User authorized a bounded direct fix without SDD. Chrome confirmed
`TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`
at adminAuth.service.ts:306 after this.fetcher at :298. No auth request appeared
in Network. Backend direct/proxied status reports configured:true. Prior Windows
ACL correction and live repair passed; do not repeat provisioning/reset/ACL changes.
PAC-5 subsequently closed offline; the integrated closure record lives in
[prisma-protected-credentials.md](prisma-protected-credentials.md). This correction was
delivered as observed local commit `0cdf345` on `feat/prisma-telegram-credentials` with
explicit user authorization; no push or PR was performed.

## Scope and implementation

Only hmi-app/src/services/adminAuth.service.ts and its co-located test changed.
Constructor default now uses fetch.bind(globalThis); injected fetchers unchanged.
CSRF, same-origin/no-store/redirect:error, response/error validation and abort/generation
contracts remain. No UI, backend, dependency or unrelated transport changes.
Preserve existing Windows ACL files, tracking docs and external .gitignore modification.

## Routing and delivery

Delegated direct writer and independent verifier. Strict TDD under AGENTS.md bug policy.
Forecast under 100 authored source/test diff lines (advisory); ask-on-risk delivery.
No agent credential access, real login, services, provider or network actions.

## Tasks

- [x] **FETCH-1 — Correct default transport receiver with regression coverage.**
  Writer mu7cniwn-h-nkyf recorded receiver-sensitive RED: 1 failed / 32 passed with
  AUTH_TRANSPORT_UNAVAILABLE before changing production. GREEN: 33 passed. Default
  constructor session/login and injected transport contracts covered; globals restored.
  Independent review confirmed production behavior and test receiver logic.

- [x] **FETCH-2 — Independently verify and confirm browser access.**
  Technical verification COMPLETE PASS. User confirmed native local Chrome login:
  "ahora si, entro perfecto". This is user-reported browser acceptance, not a
  production deployment or cross-browser acceptance claim.
  First independent review passed tests/build but found an unused test parameter.
  Parent removed that parameter only. Final mu7cui7a-j-hphw verification/parent-requested
  spotcheck: 33/33 tests; scoped ESLint exit0; scoped diff check exit0. Prior build PASS
  retained because only an unused test parameter changed after build. Warnings:
  unresolved /grid.svg and oversized chunks; LF-to-CRLF advisories are not failures.
  Receiver-sensitive fake evidence does not claim native Chrome login acceptance.

## Exact checks from repository root

```bash
npm --prefix hmi-app test -- src/services/adminAuth.service.test.ts
npm --prefix hmi-app run build
(cd hmi-app && node node_modules/eslint/bin/eslint.js src/services/adminAuth.service.ts src/services/adminAuth.service.test.ts)
git diff --check -- hmi-app/src/services/adminAuth.service.ts hmi-app/src/services/adminAuth.service.test.ts
```

## Next action

Local login incident closed; PAC-5 subsequently closed offline and the package closure
record is [prisma-protected-credentials.md](prisma-protected-credentials.md). This
correction was delivered as local commit `0cdf345` with explicit user authorization;
push and PR remain separate parent decisions and were not performed. Deployment
requires updated frontend/runtime artifacts, same-origin API forwarding, configured
HTTPS public origin and backend storage/admin setup. Other browser engines still need
smoke tests; no browser-specific workaround was introduced. No password reset or ACL retry.
