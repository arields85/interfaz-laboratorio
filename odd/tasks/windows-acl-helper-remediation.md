# Windows auth ACL helper remediation

## Status

Direct non-SDD fix accepted; live auth-directory repair and independent read-only
verification passed. Backend status reports configured:true, and user confirmed native
local Chrome login after the separate fetch-receiver correction. PAC-5 subsequently
closed offline; the integrated closure record and its evidence live in
[prisma-protected-credentials.md](prisma-protected-credentials.md). This correction was
delivered as observed local commit `41dc286` on `feat/prisma-telegram-credentials` with
explicit user authorization; no push or PR was performed.

## Scope and boundaries

Preserve the existing private ACL policy: current user, LocalSystem and Administrators
only; protected directory inheritance; current-user FullControl; same owner. No elevation,
plaintext/.env administrator credentials, broad ACL grants, ownership changes, provider
operations, service restarts or unrelated source changes. Preserve pre-existing .gitignore.

## Evidence and delivery

- Initial provision/repair failed at PowerShell 5.1 Set-Acl with SeSecurityPrivilege.
- Native RED required a protected incident descriptor; a fresh unprotected directory
  did not reproduce. The internal PowerShell mechanism is not independently established.
- Mandatory project TDD; delegated direct writer and independent verification.
- Source scope: services/prisma-runtime/operations/protect-auth-state.ps1 and
  services/prisma-runtime/tests/test_storage_permissions.py only.
- Delivery: ask-on-risk; local work-unit commit `41dc286` created with explicit user
  authorization; no push or PR performed.

## Tasks

- [x] **ACL-1 — Map native descriptor behavior and test seam.**
  Mapped Framework-compatible Owner+Access reads and scoped ACL persistence; existing
  Windows tests were mocked/static. Runtime uses Windows PowerShell 5.1.

- [x] **ACL-2 — Correct helper and regression tests.**
  Shared DirectorySecurity reader requests Owner+Access, not Audit; persistence uses
  System.IO.Directory.SetAccessControl. Existing owner/policy/path checks remain.
  Native protected-descriptor RED/GREEN recorded by writer. Initial independent FAIL
  found static self.fail, raw timeout errors and absent database/sidecar coverage.
  Test-only correction closed all three. Independent mu7bpszt-d-ig7o PASS:
  9 permissions tests, 18 auth tests, two rendered synthetic traceback probes, scoped
  diff check. Native full VerifyOnly covers temporary database and journal/wal/shm files.
  Bounds: no independent historical RED replay, existing SACL-preservation proof or
  wrong-owner native test; no production acceptance claim.

- [x] **ACL-3 — Restore administrator readiness.**
  Corrected real directory-only repair exited 0 after parent checked non-elevated token,
  expected default state root and existing auth directory. Independent
  mu7btdca-e-oyy3 VerifyOnly/DirectoryOnly exited 0. Parent-requested final spotcheck
  initially found zero tests because parent supplied a trailing dot; exact corrected
  command then passed 9 tests, zero skipped, exit 0 (mu7buyf9-f-jor9).
  Backend status subsequently reported configured:true through both direct/proxied
  routes. User confirmed successful native local Chrome login after the separate
  frontend fetch-receiver fix. No account/password reset is needed. Acceptance does
  not cover deployment, other browsers or unrelated runtime residuals.

## Exact focused runner

Run from repository root (bash; no trailing dot):

```bash
./services/prisma-runtime/.venv/Scripts/python.exe -B -m unittest discover -s services/prisma-runtime -p 'test_storage_permissions.py' -v
```

## Remaining scratch artifact

Writer reported %TEMP%/acl_probe.ps1. Read-only inspection found an ordinary 2200-byte
file, SHA256 6223AF2BDA13ACBBC25140FC74FBE6F306F2E93D60471723AA60667F35FF9FBC.
Current-worker provenance/temporary-only behavior remain uncertain. Parent/verifier
never executed or removed it. Cleanup remains deferred, not claimed complete.
