# Pairing panel: require a configured HMI name

## SESSION CLOSE (2026-09-22) — ONE local checkpoint commit authorized

Documentation-only close update superseding the no-commit restriction in the original decision below for this one case only: the user authorized exactly ONE local checkpoint commit from pre-commit base `c82fe44` (branch `feat/prisma-telegram-credentials`). Push/PR remain unauthorized. The parent records the actual resulting hash in Engram `checkpoint/prisma-channel-a-manager-resume` after a successful commit; no self-referential hash is fabricated. All NAME-1..4 tasks are complete OFFLINE (independent verification `muc76rbg-g-87k1`: focused 58 PASS in 6 suites, full standard coverage 2,184 unique PASS with the 70 thresholds intact, build and lint PASS). Manual in-browser acceptance of the warning copy remains pending. No source or test changes were made in this documentation-only close.

## Decision and scope

The user authorized this bounded correction on 2026-09-22: explain a missing HMI name before showing a QR that Telegram will reject. The existing name service remains the authority. Do not change response/audio, context freshness, Telegram behavior, credentials, runtime lifecycle or pairing backend contracts.

Baseline: `c82fe44` on `feat/prisma-telegram-credentials`. The existing `docs/PENDING_WORK.md` modification records deferred PW-005 and must be preserved. No commit or push is authorized (original decision; superseded for this one case by the session-close note above). The latest user report of missing HMI output after switching dashboards is a separate read-only investigation, not part of this fix.

## Contract

- Read `readHmiName()` when opening the panel; re-read on later openings.
- A valid configured name preserves the current pairing flow and all existing panel behavior.
- With no configured name, show: `Configurá el nombre de esta HMI en Configuración general → Prisma antes de vincular un teléfono.`
- If the existing service cannot read/validate the saved name, do not falsely assert it is absent. Reuse `No se pudo leer el nombre guardado.` and direct the user to `Configuración general → Prisma`.
- Both blocked states pass `false` to the existing pairing hook and render no QR, even if a mocked/stale hook result contains one. Keep the close action.
- No new subscriptions, navigation buttons, storage writes or name validation rules. The normal settings route remounts the Topbar; re-opening also refreshes the read.
- No hook/backend changes, automatic Apply, provider calls, or live services during verification.

## Edit surfaces and routing

One coherent UI behavior with regression tests, estimated 80–180 authored diff lines excluding this short record. Delivery strategy: ask-on-risk; no delivery operation is currently authorized.

- `hmi-app/src/components/layout/PrismaPairingControl.tsx`
- `hmi-app/src/components/layout/PrismaPairingControl.test.tsx`
- This task record, maintained by the parent.

Mapping was delegated (multiple-file exploration). Test and source writing are delegated sequentially to one writer at a time. The existing name service, hook, administrative form, Topbar, pending-work index and broader tracker are not writer edit surfaces.

## Checks

TDD is ON per `docs/TESTING.md` and the existing feature workflow: test-only change, observed RED, source correction, GREEN. Vitest is the frontend runner. Run from the repository root; no dev/start script.

1. RED/GREEN: `npm --prefix hmi-app test -- src/components/layout/PrismaPairingControl.test.tsx src/hooks/useChannelAPairing.test.tsx src/components/layout/Topbar.test.tsx src/services/hmiName.service.test.ts src/domain/hmiName.test.ts src/components/admin/HmiNameSettings.test.tsx`
2. Final standard coverage: `npm --prefix hmi-app run test:coverage` (unchanged configuration and thresholds).
3. Build: `npm --prefix hmi-app run build`.
4. Lint: `npm --prefix hmi-app run lint`.
5. Parent structural readback and Git whitespace/scope check. Independent verification follows the native assessment plan; unavailable assessment is treated as high risk. No native approval is implied by offline tests.

## Progress

- [x] NAME-1: Map the existing name service, panel, settings route and test boundaries.
- [x] NAME-2: Add focused missing-name/read-failure/reopen regressions; observe RED without source changes.
- [x] NAME-3: Implement the component-only gate; preserve valid-name behavior; observe GREEN.
- [x] NAME-4: Complete verification and update the recovery record with actual evidence.

NAME-2 evidence: independent verifier `muc6wbj1-d-6y2p` ran command 1 once: 6 suites (5 passed, 1 failed), 58 tests (55 passed, 3 expected failures), 2.97 s, exit 1. The failures show the missing/read-failure messages absent and a QR still rendered; no fixture errors. The reopen test fails on its first assertion, so later transitions remain unverified. The writer initially overstated the baseline count as eight; Vitest reports seven existing panel cases passing plus three new failures. Git showed a pure 131-line test addition and no component source diff. The test writer also reported a read-only Git diff command despite its no-command scope; no mutation beyond its allowed test file was observed.

NAME-3 evidence: source writer `muc6zdri-e-lq6o` changed only the component, then ran command 1 (58/58 PASS in 6 suites, 2.87 s, exit 0) and lint (exit 0) once each. A `.tsx` typo for the domain test in its final report was reconciled against its retained tool invocation/output: the executed command used the authorized `.ts` path; no rerun was needed for that clarification. Parent read the complete component and confirmed the name-service gate, open-time refresh and unchanged hook/backend. Git whitespace check passed (LF/CRLF warnings); source plus tests are 182 authored diff lines, a small advisory forecast overrun, not a new work unit.

NAME-4 complete OFFLINE: native assessment was unavailable (`native-assess-unavailable`, RDD off), so the candidate was treated as high risk. Independent verifier `muc76rbg-g-87k1` ran all four exact commands once: focused 6 suites / 58 PASS (2.76 s); full standard coverage 209 suites / 2,184 UNIQUE PASS (80.29 s); build TypeScript + Vite PASS (Vite 9.94 s); lint without diagnostics. Numeric exits were not exposed. The 58 focused tests repeat inside the full total, not an additional unique count. Coverage: statements 87.42%, branches 80.64%, functions 86.56%, lines 88.30%; unchanged four 70% thresholds, standard configured coverage with no exhaustive-source-inclusion claim. The independent focused rerun also spot-checked the writer's GREEN.

Bounded static review found no blocker. Pre/post Git scope and source/test diffs matched; audio, backend and configuration were unchanged. Parent final whitespace/scope check passed with LF/CRLF warnings. Other nonfatal warnings: jsdom canvas, unresolved `/grid.svg`, large production chunk. Verifier memory persistence failed (ambiguous session binding); this parent-owned record preserves its evidence. This is independent offline verification, not native approval.

Result: the panel explains missing or unreadable names before QR/request issuance and refreshes the read at every opening. Browser acceptance of this new notice remains pending; the user's earlier successful real linking is separate evidence. Changes are UNCOMMITTED on baseline `c82fe44` (no push). Next work requires its own scope: intermittent HMI audio/orb and latency remain unresolved; Ctrl+C recovery is deferred under PW-005. No audio or runtime correction was made.
