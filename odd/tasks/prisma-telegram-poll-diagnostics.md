# Prisma Telegram polling diagnostics

## Authority and limits

User authorized safe backend diagnostics, isolated tests, necessary runtime restarts and minimal test messages to their own bot. No Gemini spending, unrelated outreach, credential/key reset by agents, plant operations or agent-initiated commit/PR. User personally selected the intended bot and revoked/regenerated its token. UI adjustments remain deferred until local acceptance is resolved. On 2026-09-20 the user separately authorized one local closure commit as described in Closure strategy below.
Preserve user .gitignore edits, existing credentials/key/store/admin provisioning and legacy installation. Parent owns this record and full mirror `odd/prisma-telegram-poll-diagnostics/tasks`. Never disclose token, session, raw provider error, message data or credential files.

## Implemented scope

Runtime files: src/prisma_runtime/local_presentation.py, telegram_lifecycle.py, admin_http.py; tests/test_telegram_http.py and test_telegram_diagnostics.py, under services/prisma-runtime. No frontend design/parser changes, no intended provider/retry/offset/migration/cleanup behavior changes.
- Configured lifecycle state no longer falls back to stale protected-startup missing-token warning.
- Safe in-memory health diagnostic: stage/category/httpStatus/failureAt/lastSuccessAt, fixed enums, genuine integer100..599 excluding bool, valid UTC ISO-Z dates, null otherwise. No exception strings/URLs/bodies/tokens/IDs/paths. Success/failure instrumentation exception-contained; copied snapshots under lock. Preparation failure snapshot survives safe candidate cleanup, live status takes precedence, successful apply/delete clears saved failure.
- Admin apply success/error responses project EXACT nine existing fields: source, enabled, configured, desiredGeneration, appliedGeneration, running, verified, restartRequired, lastError. Internal/public-health diagnostic remains available; unknown internal fields excluded without mutating manager state. This fixes our introduced strict-frontend compatibility regression.

## Verification

TDD mandatory via AGENTS.md. All Python tests ran with owned interpreter in child-only fresh temporary PRISMA_RUNTIME_STATE_DIR, PYTHONPATH=src; supervisor imports stdlib only. Eleven environment overrides applied to the isolated child: PRISMA_VOICE_CONFIG_FILE, PRISMA_CREDENTIAL_MASTER_KEY_FILE, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, PRISMA_LOCAL_TELEGRAM_ENABLED, PRISMA_LOCAL_TELEGRAM_BOT_TOKEN, PRISMA_LOCAL_SNAPSHOT_FILE, PRISMA_LOCAL_STATE_FILE, PRISMA_LOCAL_VOICE_URL, PRISMA_PUBLIC_ORIGIN, TELEGRAM_BOT_API_BASE. No real provider calls in tests.
Focused unittest modules: diagnostics/http/lifecycle/credentials/runtime_safety/local_presentation under tests.test_telegram_* or tests.test_* as appropriate; full unittest discover -s <runtime_root> -p test_*.py. Frontend installed vitest: domain/adminCredential.types.test.ts and services/adminAuth.service.test.ts.
Initial review found timestamp sanitizer, success-clock noninterference and normal preparation observability gaps despite101/272 GREEN. Fixed with observed assertion RED; independent112/283 PASS. Later real usage revealed admin extra-key regression; corrected with RED3+1, independent114 focused/285 full/38 frontend PASS. Actual Flask200 response accepted by actual TS parser, nested409/502 accepted as schema checks only rather than full live response traces,3 diagnostic-injection negative controls rejected. Error service throws before success parser; full error-service bridge not claimed. Auth/CSRF/origin/no-store/status-copy/health diagnostic tests passed. Native assess unavailable, RDD off: independent review used. CRLF warnings only. Concurrent overlap remains probabilistic, source locking verified. Tool probe syntax/stdin issues resolved without real application side effects.

## Tasks and results

- [x] D1: Source map and safe test contract.
- [x] D2: Diagnostics and review corrections with TDD.
- [x] D3: Independent compatibility/privacy PASS, final verifier mu92sjqx-6-cf7q.
- [x] D4: Diagnostic activated; recurring getUpdates poll/http409 observed, no successful cycle initially.
- [x] D5: After USER token replacement/rotation, observed4/4 with advancing success and no409. Exact previous competing consumer not identified. Local inventory found one runtime family, one manifest owner; wrapper/base Python pairs are not duplicate bots.
- [x] D6: Strict admin nine-field projection corrected; backend/actual frontend bridge accepted.
- [x] D7: REAL UI ACCEPTANCE. Screenshot pi-clipboard-80477efc-dfea-4fd2-9aca-70e3ac0190af.png shows 'Cambio de Telegram aplicado y estado actualizado.', generation1/1, active/enabled/verified, no pending changes or errors after requested Apply click. False admin footer resolved for observed operation.

## Activation evidence

Several user relaunch attempts reused oldPID24560, started2026-09-19T23:53:50Z, older than admin_http.py edit2026-09-20T00:21:06Z. User clarified no Apply clicks then; Apply manages bot, not Python/code reload.
Parent executed official identity-validated stop-local.ps1 (under prior restart authorization), stopping voice24132/presentation24560; no credential/source changes. User relaunch produced NEW presentationPID22060, started2026-09-20T00:59:49Z after admin source modification. Health1/1, no errors, lastSuccessAt2026-09-20T01:03:07.752649Z (verifier mu944i83-9-np3c). New process supports activation, not byte-hash proof. Subsequent screenshot provides actual admin success feedback. Credentials persisted; counters reset per process.

## Next session start (2026-09-20)

1. Recover this tracker plus the parent Engram checkpoint, then inspect Git state. Do not redo credentials/admin provisioning and do not re-apply the completed D1–D7 fixes.
2. User sends `/status` from their own chat to the corrected bot (`/start` first only if pairing is requested). This message test HAS NOT been run or observed.
3. Then verify a FRESH visible-dashboard snapshot, consultation and voice.

Pending limits: this closes diagnostic/admin incident work, NOT full local Prisma E2E. The last observed snapshot (September1) is stale and is not fresh-session proof; Gemini is configured but its verification was not performed, and paid calls still require explicit separate permission. User permits necessary restarts and minimal tests against their own bot, not arbitrary outreach or key resets; no agent outgoing messages were sent. UI refinements requested now wait until first local acceptance is finished; PW-002/003/004 stay deferred.

## Closure strategy (approved 2026-09-20)

One complete LOCAL commit carrying code, tests and docs together, with explicit user acceptance of the size exception (~1300+ lines, mostly the regression matrix). No push, no PR. Branch `feat/prisma-telegram-credentials`; pre-closure `HEAD` `fe39ffe`. The parent records the observed closing hash in Engram AFTER committing; the repository locator for the commit containing this checkpoint is `git log -1 --format=%H -- odd/tasks/prisma-telegram-poll-diagnostics.md`, so no self-referential hash is embedded here. This checkpoint does not claim that a future commit hash exists or was observed. Source/test changes stay preserved and the user `.gitignore` edits remain excluded. Preserve the clear tests; do not shrink the diff to hit a line budget.

## Key learnings

- Admin response strictness: one extra internal key in apply success/error responses breaks the strict frontend parser; project exactly the nine existing fields.
- Process identity matters: relaunch attempts can silently reuse an old PID, so compare PID and start time against the source edit time before trusting runtime behavior.
- Credential incident: the user's revoked/regenerated token restored polling; the exact previous competing consumer was never identified, only ruled out as a duplicate local runtime family.
- Honest status: report a stale snapshot or an unverified Gemini as unverified instead of implying acceptance.
