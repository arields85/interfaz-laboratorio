# Archive Report: hmi-focus-resume-layout-flash

## Summary

- Archived the verified focus/resume flash bugfix after a PASS verification result with no critical or warning findings.
- Synced the new `runtime-boot-shield` capability into main specs and updated `canvas-bounds` only with the transient invalid-measurement resilience that this bugfix actually delivered.
- Preserved the explicit scope decision that aspect-fit / letterboxing product behavior remains outside this change.

## Verification Gate

- Verification artifact: `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/verify-report.md`
- Verdict: `PASS`
- Tasks complete: `11/11`
- Build: skipped by project rule (`Never build after changes`)

## Spec Sync

| Domain | Action | Details |
|--------|--------|---------|
| `runtime-boot-shield` | Created | Promoted the full capability spec from the change delta into `openspec/specs/runtime-boot-shield/spec.md`. |
| `canvas-bounds` | Updated | Merged only the shared-canvas resilience behavior for transient invalid restore/resume measurements; did not expand aspect-fit / letterboxing scope. |

## Main Spec Decisions Preserved

- The broader `canvas-bounds` source of truth still owns aspect-fit / letterboxing as an existing capability.
- This archived bugfix adds only transient invalid-measurement resilience and shared parity evidence to that capability.
- No archive merge claims that runtime aspect-fit / letterboxing product work was introduced by this change.

## Traceability

| Artifact | Engram Observation ID | OpenSpec Path |
|----------|------------------------|---------------|
| Proposal | `#1094` | `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/proposal.md` |
| Spec | `#1097` | `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/specs/` |
| Design | `#1100` | `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/design.md` |
| Tasks | `#1101` | `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/tasks.md` |
| Apply Progress | `#1106` | `artifact-only: sdd/hmi-focus-resume-layout-flash/apply-progress` |
| Verify Report | `#1108` | `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/verify-report.md` |

## Archive Target

- Active change path moved from `openspec/changes/hmi-focus-resume-layout-flash/`
- Archive path: `openspec/changes/archive/2026-04-29-hmi-focus-resume-layout-flash/`

## Post-Archive Checklist

- [x] Main specs updated before move
- [x] Archive report added to the change folder for filesystem audit trail
- [x] Change folder moved into dated archive folder
- [x] Active changes directory no longer contains the change
- [x] No destructive delta merge required warning
