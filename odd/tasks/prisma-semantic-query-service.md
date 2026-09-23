# Prisma semantic query service — ODD feature tracker

## Objective and current boundary

Record the agreed source-neutral, typed, on-demand current-data query foundation for Prisma,
including how the design evolved, before any implementation. The HMI's interpreted result and
published configuration are the semantic authority, including targets outside the active view.
**Current work is documentation and stable-state backup only; no functional change.**

- Feature identity / full Engram mirror: `odd/prisma-semantic-query-service/tasks`.
- Repository locator: `odd/tasks/prisma-semantic-query-service.md`.
- Baseline accepted closure: `19adf7d` (parent-supplied; not a new documentation commit).
- DOC-1 is in progress. QRY-1 through QRY-4 are **UNAUTHORIZED / NOT STARTED**.
- Phase 1 tracker/full mirror readback was confirmed by the parent; Phase 2 documentation is authorized.

## Authorization, routing, and delivery

The user authorized recording the design, linking the master, recording pending implementation,
and backing up the current stable state with documentation before implementation. The chosen
delivery is fast-forward integration of the existing branch into main and push to `origin/main`
using configured Git authentication. **The parent exclusively owns all Git mutations and remote
operations.** This writer must not stage, commit, switch, merge, push, or create branches/worktrees.

- Route: delegated single documentation writer; trigger: 2+ nontrivial documentation/preparation
  steps. This tracker does not automatically route or authorize future implementation tasks.
- Delivery strategy: `ask-on-risk`; no PR requested. RDD is off per parent verification; no native
  review or receipt is claimed. Historical hook-skip permission does not carry forward.
- Intended work unit: one documentation commit, optionally followed by a short evidence commit
  recording its observed hash/closure. Commit identity remains pending until observed by parent.
- Forecast: approximately 300–390 authored lines across the focused document, this tracker, and
  minimal master/index changes. The 400-line heuristic is advisory, not a hard cap: report risk
  rather than minifying or omitting evidence to fit it.
- No tests, builds, lint, GGA, services, providers, new web/network calls, secret inspection,
  changes to `.gga`/hooks, or edits under `Directrices/`. No service implementation or dependencies.

## Design authority and recovery context

The [focused design](../../docs/prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md) owns the architecture,
alternatives and rationale; this tracker owns authorization, work units and evidence.
Its §§1–4 define source-neutral typed demand queries, published/assigned accessible identity,
shared interpretation/configuration/state, and honest freshness/cold unavailability. Sections 5–7
preserve the alternatives, provisional text-title lot proof, and optional discovery tooling.

Phase 1 wording is corrected there: an always-on server HMI is not inherently incompatible with
no end-user browser for B; its practical lifecycle/visibility, scope and configuration limits matter.
Truly nonvisual continuous processing has no rendering cost; hidden browser widgets do. Neither
capacity at 100 dashboards nor universal exhaustion was measured. State retention remains necessary
for some targets. No source/provider choice, timing constants or historical reporting is introduced.

## Tasks and acceptance

| ID | Status / authorization | Work unit and acceptance |
|---|---|---|
| DOC-1 | IN PROGRESS — documentation authorized | Preserve decisions and rationale in the focused document; reconcile master and PW-003; verify links, scope, and full mirror; parent records actual documentation delivery and backup evidence. |
| QRY-1 | UNAUTHORIZED / NOT STARTED | Assigned lot simple query: resolve an authorized published target by stable IDs and return its exact presentation text, off-view and without rendering; no order/lot substitution or arbitrary match. |
| QRY-2 | UNAUTHORIZED / NOT STARTED | Current MachineActivity: preserve shared state/clock semantics and HMI parity; cold start waits for usable state or returns temporary unavailable, never fabricated stopped; no new human-facing histories. |
| QRY-3 | UNAUTHORIZED / NOT STARTED | Publication changes/HMI parity: derived configuration revisions and activation preserve publication, assignment, permissions, and equivalent HMI/query interpretation; no duplicate manual configuration. |
| QRY-4 | UNAUTHORIZED / NOT STARTED | Cost/latency: measure bounded demand, reuse, retained state, and expiry with realistic dependencies; report measured limits, not presumed scaling or untested vendor performance. |

These are exactly four future proof goals, not authorization for broader Channel B, STT,
navigation, historical reporting, or operational deployment. Detailed implementation and runner
selection require a future authorized increment; no implementation is started by this checklist.

## DOC-1 checklist and progress

- [x] Read AGENTS, pending index, full master 2.0.20, one small ODD task, and explicit testing policy.
- [x] Confirm proposed tracker and focused-document paths do not already exist.
- [x] Create this single feature tracker before other file edits.
- [x] Persist full tracker mirror and read back file plus observation; parent confirmed Phase 1.
- [x] Author `docs/prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md` after parent Phase 2 authorization.
- [x] Link/reconcile master with version 2.0.21, current checkpoint, and concise changelog.
- [x] Update/read back PW-003 umbrella memory before its index row; preserve independent work.
- [x] Read back the four documents and local references; `git diff --check` reported no errors.
- [ ] Parent confirms final tracker/mirror readback and accepts the returned documentation evidence.
- [ ] Parent records observed commit identity and authorized main backup result; no invented hash.

CL questions exercised, Telegram, HMI voice, and orb remain user-accepted at baseline `19adf7d`.
PW-005 normal Ctrl+C is closed; do not reopen it or claim new full-suite verification. PW-002
and PW-004 remain independent. PW-003 remains the broad umbrella, not a duplicate feature plan.

## Verification and rollback

- Configured TDD: `docs/TESTING.md` requires test-first pure logic and bug fixes;
  `openspec/config.yaml` explicitly sets `strict_tdd: true` at top level and under testing.
  Applicability to DOC-1: **N/A, passive documentation only**. Runtime harness and functional
  tests: **N/A**, no runtime boundary changed. Do not infer mode from test-file presence.
- Exact allowed command from repository root: `git diff --check`.
- Full structural file/mirror readback is required. The new tracker and focused design are untracked
  and excluded by ordinary `git diff --check`; readback covers structure/content. Parent must run
  `git diff --cached --check` after staging only the intended documentation before committing.
- Check stable IDs, explicit authorization/status, future-path labeling, recovery links, and
  source/evidence qualifications. Phase 2 adds focused-document/master/index consistency checks.
- Observed documentation check: `git diff --check` reported no whitespace errors; Git emitted only
  LF-to-CRLF advisories for the two tracked documents. No functional tests or runtime checks ran.
  Final parent readback and delivery remain pending; full mirror evidence is returned separately.
- Rollback removes only intended documentation changes: this tracker, the focused
  document, and minimal DOC-1 master/index edits. Preserve all accepted runtime behavior and
  unrelated files; never reset the stable baseline or alter credentials/configuration.

## Next action and recovery links

Return the documentation and mirror for parent static readback, then parent-owned commit,
fast-forward integration to main and authorized push. Record only observed delivery evidence.
Do not implement QRY-1–QRY-4 without a fresh explicit user instruction.

- [Master: scope gate §3.4, semantic scope §6.4, delivery 1.3, checkpoint §11.1](../../docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md).
- [Pending-work authority: PW-003](../../docs/PENDING_WORK.md); umbrella topic `backlog/prisma-dual-channel-assistant`.
- [Focused design authority](../../docs/prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md).
- [Testing policy](../../docs/TESTING.md) and [explicit TDD configuration](../../openspec/config.yaml).
- [Small ODD convention reference](prisma-admin-fetch-receiver.md).
- Prior research: [Jev introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
  [Choice primitive](https://docs.typesafe.ai/primitives/choice),
  [typed function calling](https://developers.openai.com/api/docs/guides/function-calling),
  [RAG overview](https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview).
- Recover this feature through its repository locator and full topic mirror above; do not
  overwrite other feature topics or the parent-owned resume checkpoint.
