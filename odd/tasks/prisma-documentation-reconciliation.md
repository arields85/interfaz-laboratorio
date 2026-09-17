Repository-relative file: odd/tasks/prisma-documentation-reconciliation.md

# Prisma documentation reconciliation

## Objective

Bring the Prisma master reference into the repository and reconcile the existing migration gaps with the approved product direction, without changing application behavior.

## Problem and rationale

The external master describes an older implementation and roadmap. Recent audits and user decisions exist mainly in conversation and Engram. New feature planning must not hide unfinished migration, security, contract, or acceptance work.

## Authorized scope

- Create and update passive documentation under `docs/prisma/`.
- Update Prisma entries in `docs/PENDING_WORK.md` only after their Engram topics are retrievable.
- Add a documentation backlink to `services/prisma-runtime/README.md` while preserving all pre-existing content changes.
- Maintain this document and its full Engram mirror at `odd/prisma-documentation-reconciliation/tasks`.
- Read the external `PRISMA_DOCUMENTO_MAESTRO.md` supplied by the user; do not edit, move, or delete that original.

## Constraints

- No functional source, test, configuration, credentials, or `Directrices/` edits.
- No service operations, installations, external requests, commits, pushes, or legacy/worktree deletion.
- Preserve the pre-existing dirty worktree, especially `GaugeDisplay.tsx` and `KpiWidget.test.tsx`.
- Separate current implementation, approved target, proposals, historical evidence, and unresolved decisions.
- Preserve historical manual acceptance without upgrading it into complete operational acceptance.
- Do not copy secrets or private operational identifiers into versioned documentation.
- Keep one active master. Preserve useful history separately and identify the external original as an unchanged historical source, not a second maintained authority.
- `docs/PENDING_WORK.md` remains the active backlog discovery index; Engram topics carry its detailed state. The master links to them rather than creating an independent competing backlog.
- Existing Spanish documentation is updated in neutral professional Spanish. This new task tracker is in English.
- About 400 authored lines per task is an advisory planning heuristic only, not a cap or acceptance condition. Preserve necessary evidence and historical context without cosmetic compression.

## Testing and review policy

- TDD applicability: not applicable to this documentation-only change. Source: `AGENTS.md` section 8 and `docs/TESTING.md` lines 65–74 require TDD for logic and bugs, not passive prose.
- Functional test runner: not applicable; no code behavior is changed. Historical test results must be labeled with their actual date and scope, never claimed as rerun here.
- Required foreground check: `git diff --check` from the repository root.
- Structural checks: read every created/modified document, verify repository-relative links and referenced current files, check backlog-to-Engram traceability, and inspect final Git status/diff for scope preservation.
- RDD effective state: off, default source, observed through `gentle-ai review mode status`. Do not enable it or start review. Parent will assess the final diff for proportional verification.

## Tasks

- [x] DOC-1 — Reconcile source and audit evidence into one active repository master, preserving relevant history and distinguishing present behavior from approved goals.
  - Acceptance: the master covers both channels, real/presentation data, protected UI setup, diagnostics, session isolation, and read-only industrial boundaries; every prior gap is fixed, pending, superseded, or explicitly unproven with evidence.
  - Checks: source/readback comparison, repository-link validation, secret/privacy inspection, original external document preserved.
- [x] DOC-2 — Publish the unified delivery plan and synchronize backlog references.
  - Acceptance: migration remains open with exact residuals; broader assistant work has a retrievable stable topic before any new index row; PW-001 and unrelated changes remain intact; runtime README points to the active master.
  - Checks: full Engram readback before index edits, master/index/topic consistency, planned-versus-existing path distinction.
- [x] DOC-3 — Verify and close the documentation change honestly.
  - Acceptance: required whitespace and structural checks pass; baseline changes are preserved; no functional fixes, runtime acceptance, commit, push, or deletion are claimed.
  - Checks: `git diff --check`, final scope inspection, complete task-file and Engram mirror readback.

## Progress and evidence

- Initial state: `main` at `82dd2f1`, ahead of the local `origin/main` reference by one commit; Prisma environment migration and two unrelated HMI files already dirty. No remote refresh performed.
- Prior read-only audit: 74 Python and 72 focused frontend tests passed; schema checker failed due to newline-sensitive hashing; Python/TypeScript validator parity also needs correction. These are earlier audit results, not checks performed for this documentation change.
- External master: version 1.1.4, dated 2026-08-30, 2,436 lines, remains outside the repository and must stay untouched.
- Task tracker was created before the first documentation deliverable write; the parent read back its full Engram mirror and verified agreement before DOC-1 began.
- DOC-1 completed: created the active 2.0.0 master and a clearly non-verbatim historical ledger under `docs/prisma/`; separated implementation, evidence, approved target, proposals, open decisions, unified delivery, and acceptance.
- DOC-1 checks observed: both files read back in full (566 and 185 lines); every repository-relative target resolved; focused privacy scan found no bot handle, private chat ID, credential value, bearer token, or password; external original SHA-256 remained `B14DE554608DB98E84D9E7D7ABF1D8EB6700B108B419F22C87D4D7EDF79F49C1` before and after the write.
- DOC-1 Engram mirror `odd/prisma-documentation-reconciliation/tasks` was updated in full after the task checks.
- DOC-2 completed: kept PW-002 pending with current migration residuals, added PW-003 using the pre-verified `backlog/prisma-dual-channel-assistant` topic, preserved PW-001, and added one canonical-master backlink to the runtime README.
- DOC-2 checks observed: full readback of the 26-line backlog index and 182-line runtime README; stable topic strings match the master and index; the README link target exists; the master labels proposed versus existing paths and leaves authentication/storage mechanisms open; focused documentation privacy scan found no credential or private operational value.
- Independent verification completed read-only before this correction pass. It found bounded provenance, health, privacy, delivery-grouping, audio, simulation, history-capability, and text-query documentation defects; it made no edits.
- RDD remained off. Its assessment refused the untracked declaration and therefore produced no risk verdict; this is not a clean-verifier claim.
- Correction pass updated only passive documentation: health now means liveness/probe metadata, privacy permits minimal protected backend state and transient credential submission, audio claims are scoped, the roadmap is grouped as E0–E4, and E1.3 requires validated natural-language text queries before Telegram.
- Standard `git diff --check` does not inspect untracked documents. Final whitespace verification therefore also uses `git diff --no-index --check -- NUL <file>` for the master, history, and tracker: exit 1 with no whitespace diagnostics is the expected content difference from `NUL`; exit 3 denotes a whitespace check failure.
- DOC-3 completed: parent read back the corrected health, privacy, audio, simulation, query pipeline, E0–E4 roadmap and gap mapping; confirmed the runtime README adds only the authorized backlink over its existing changes.
- Final parent checks: tracked `git diff --check` exited 0; all three new-file `git diff --no-index --check -- NUL <file>` checks exited 1 with no whitespace diagnostics (expected content differences). LF-to-CRLF notices are Git conversion warnings, not whitespace failures.
- Parent independently confirmed the unchanged external original SHA-256. Final Git status retained the baseline source paths with only the authorized documentation paths added; preservation is supported by scope inspection and writer reports, not a claimed byte-level baseline hash for every source file.
- No functional tests, builds, installations, service operations, credentials, remote operations, commits, pushes, or legacy deletion were performed for this documentation change. Prior functional findings remain pending under PW-002/PW-003.

## Next step

Documentation reconciliation is complete. Resume from the active master and PW-002/PW-003 when the user authorizes the next functional/design scope, starting with the defined foundation increment E1.1. Do not infer implementation authorization or runtime acceptance from this documentation-only completion.
