Repository-relative file: odd/tasks/prisma-runtime-foundations.md

# Prisma runtime foundations — audio contract increment

## Objective and problem

Complete the deterministic audio-contract portion of E1.1 without claiming that runtime lifecycle or backend access work is finished. At the start, the checker mistook CRLF/LF differences for schema changes and could not detect edited projection bodies; generated Python accepted payloads and run IDs rejected by the existing contract.

## Authorized scope

The user authorized continuing E1.1 after documentation reconciliation. This increment may change the audio generator/checker, their regression tests, generated Python/TypeScript projections, relevant synthetic test fixtures, and matching documentation/progress records. Preserve all pre-existing edits, including schema tooling path-portability work.

## Constraints

- Keep the existing canonical schema and public projection APIs; change generated files through the generator, not hand-maintained patches.
- Do not change lifecycle, CORS/authentication, real credentials, industrial controls, UI behavior, or unrelated `GaugeDisplay.tsx` / `KpiWidget.test.tsx` edits in this increment.
- No production services, provider/Telegram requests, installations, external API probes, commits, staging, pushes, or legacy/worktree deletion.
- Use isolated temporary test state; disable Python bytecode writes and restore environment values after checks.
- English for new code/tests/comments; preserve neutral professional Spanish in the existing master. Preserve historical audit evidence as historical.
- About 400 authored lines per task is a planning heuristic only; do not omit tests, compress code, or split a coherent fix artificially to meet it.
- The task file and complete mirror `odd/prisma-runtime-foundations/tasks` must be updated and read back after each task.

## TDD and verification

- TDD: ON for these bugs and pure logic. Authority: `AGENTS.md` section 8 and `docs/TESTING.md` sections 5–6 (testing/TDD). Observe failing regression assertions before implementation, then GREEN and refactor.
- Python runner: repository-owned `services/prisma-runtime/.venv/Scripts/python.exe -B -m unittest discover`.
- Frontend runner: `npm.cmd run test -- src/domain/prismaAudioMetric.types.test.ts` from `hmi-app`.
- Python targeted checks: discovery under `services/prisma-runtime/tests`, patterns `test_audio_record_types.py`, `test_audio_bindings_generation.py`, and finally `test_audio*.py`.
- Generate with repository Python: `-B schemas/generate_prisma_audio_bindings.py`; check with `-B schemas/check_prisma_audio_bindings.py`, both from repository root.
- Full Python check: `-B -m unittest discover -s services/prisma-runtime -p test_*.py` with isolated state and runtime `src` on `PYTHONPATH`.
- Full frontend check: `npm.cmd run test`; type checks: `.\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit --incremental false` and the same for `tsconfig.node.json`, from `hmi-app`.
- Scope/whitespace: `git diff --check`; include new files through `git diff --no-index --check -- NUL <path>` (clean content difference exits 1, whitespace errors exit 3).
- RDD: off by default, observed through read-only mode status. Do not enable or start review. Parent risk assessment and independent verification still apply; no risk verdict is inferred from assessment failure.
- Final generator/normalizer writes precede final functional checks. Do not invent RED/GREEN evidence or count generated output as independent handwritten logic.

## Tasks

- [x] FND-1 — Make generator identity and projection ownership reproducible.
  - Normalize only CRLF/CR to LF for the schema digest; retain sensitivity to other schema edits.
  - Compare complete expected generated content without mutating files in the checker; tolerate checkout newline conventions only.
  - Tests must show newline portability, safe imports/temporary output generation, and detection of Python and TypeScript body drift despite unchanged embedded hashes.
- [x] FND-2 — Align generated Python validation with the existing schema.
  - Reject invalid run-ID suffixes, missing required browser fields, unknown payload keys, booleans as numbers and non-finite numeric values.
  - Preserve optional provider/backend fields and the browser-only TypeScript projection. Do not add schema maxima or expand product requirements.
  - Update only invalid synthetic fixtures; regenerate both outputs and add TypeScript parity guards.
- [x] FND-3 — Verify the increment independently and reconcile current status.
  - Observe targeted/full checks, compare scope against existing dirty work, update master/backlog detail without erasing historical failures, and read back the complete tracker mirror.
  - Keep PW-002 and PW-003 open. No runtime durability, access control, live acceptance or complete E1.1 closure is claimed.

## Baseline and progress

- Start: `main` at `82dd2f1`, ahead 1 of local `origin/main`; existing runtime environment, schema tooling, documentation and two unrelated HMI files are dirty.
- Previous audit reported 74 Python tests and 72 focused frontend tests passing; these are not current-run evidence.
- The previous checker failure was newline-sensitive hashing; Python/TypeScript contract divergence was independently confirmed before correction. Generated files are now owned by complete normalized-content checks plus actual-repository discovery coverage.
- Lifecycle mapping found the prior success-path wrapper kill already fixed and tested. Historical process disappearance remains unproven; no live lifecycle reproduction is authorized in this increment.
- FND-1 completed with strict TDD: the new 4-test generation/checker suite first failed on newline-sensitive hashing and undetected body drift, then passed after normalized hashing, LF-explicit writes, and complete in-memory Python/TypeScript comparisons.
- FND-2 completed with strict TDD: Python first failed 6 genuine assertions across exact run-ID matching, required browser payloads, and finite numeric validation. An added TypeScript unsafe-integer acceptance assertion also failed against the original safe-integer behavior; independent review identified that assertion and the resulting `Number.isInteger` change as unintended scope broadening, not prior bug evidence.
- Initial writer-side evidence passed after generation: checker exit 0, 82/82 Python tests, 1964/1964 HMI tests across 198 files, both TypeScript no-emit checks, `git diff --check`, and explicit whitespace checks for the new test/tracker/master files.
- The bounded correction restored TypeScript `Number.isSafeInteger` checks while preserving arbitrary Python integer counts, and added an actual-repository checker assertion to ordinary unittest discovery. Its strict RED was 2 unsafe-integer TypeScript rejection failures with 7/9 passing; corrected targeted checks passed 15/15 Python audio and 9/9 TypeScript tests. Final writer-side checks passed checker exit 0, 83/83 Python tests, 1967/1967 HMI tests across 198 files, and both TypeScript no-emit checks. At that checkpoint, these local results did not yet satisfy independent FND-3 verification or live acceptance.
- FND-3 closed after parent approval: independent targeted confirmation passed Python 83/83 and TypeScript 9/9 with both review findings resolved; parent checks also observed checker and diff exit 0, unchanged canonical schema and generated TypeScript, and preserved Gauge/Kpi hashes. Writer evidence retains HMI 1967/1967 and both TypeScript no-emit checks. Risk assessment was unavailable because the bounded scope is untracked; RDD remained off and no native lifecycle review was started. No live operation, access, provider, audio, install, commit, or cleanup evidence is claimed.

## Next step and rollback boundary

This audio-contract increment is complete. The rollback boundary is this increment's generator/checker/tests/projection/documentation delta, not the preceding environment migration or unrelated HMI work; do not reset entire files to HEAD.

Remaining E1.1 work after this increment: controlled offline lifecycle investigation, reproducible installation/operation acceptance, and explicit backend-access design before credential APIs or remote-browser exposure.

## Session-close handoff

The audio-contract increment is complete, but E1.1 and PW-002/PW-003 remain open. Resume from the active master at `docs/prisma/PRISMA_DOCUMENTO_MAESTRO.md`, this task record, `odd/tasks/prisma-documentation-reconciliation.md`, and the stable topics `backlog/prisma-runtime-monorepo-integration` and `backlog/prisma-dual-channel-assistant`. Do not repeat the completed schema/generator correction.

The required next step is:

> El siguiente paso es investigar el ciclo de vida de los procesos mediante una prueba controlada, sin proveedores ni credenciales, para identificar por qué se detienen antes de modificar los launchers.

That experiment must be local, controlled, offline with respect to providers, and free of real credentials. It must establish evidence before any launcher change and must not assume that the initiating process, OpenCode job lifetime, wrapper behavior, or process identity is the root cause. Clean-install and operation acceptance, backend-access protection, and the remaining E1.1–E4 roadmap still follow. The real data source, authentication model, and authorization policy remain undecided.
