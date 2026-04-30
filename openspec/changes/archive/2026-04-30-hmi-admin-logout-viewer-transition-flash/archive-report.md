# Archive Report: hmi-admin-logout-viewer-transition-flash

## Summary

- Archived the verified logout/viewer transition flash fix after a `PASS WITH WARNINGS` verification with no blockers.
- Synced the `runtime-boot-shield` source of truth so warm resume no longer re-reveals the root shield while #1088 boot/reload behavior remains intact.
- Synced the `canvas-bounds` source of truth so builder and viewer MUST wait for a first valid shared canvas measurement before rendering frame-dependent layout, including the admin logout return-to-viewer path.

## Verification Gate

- Verification artifact: `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/verify-report.md`
- Verdict: `PASS WITH WARNINGS`
- Tasks complete: `17/17`
- Build: skipped by project rule (`Never build`)

## Spec Sync

| Domain | Action | Details |
|--------|--------|---------|
| `runtime-boot-shield` | Updated | Replaced the warm-resume shield requirement with explicit no-rereveal behavior and preserved approved #1088 boot/reload ownership, timing, and loader sequence. |
| `canvas-bounds` | Updated | Added first-valid shared canvas readiness, neutral-shell behavior before valid metrics, and stable admin logout → viewer shell expectations while preserving last-valid restore handling. |

## Main Spec Decisions Preserved

- Warm resume MUST NOT re-reveal `#hmi-shield`; remaining resume stability belongs to layout correctness, not overlay masking.
- Builder and viewer continue sharing the same canvas primitive, and first-valid readiness is now part of that shared contract.
- Approved #1088 boot/reload timing (`1200ms` min visible, `5000ms` timeout, `4` stable frames) and typewriter loader behavior remain the source of truth.

## Traceability

| Artifact | Engram Observation ID | OpenSpec Path |
|----------|------------------------|---------------|
| Exploration | `#1120` | `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/exploration.md` |
| Proposal | `#1122` | `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/proposal.md` |
| Spec | `#1124` | `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/specs/` |
| Design | `#1127` | `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/design.md` |
| Tasks | `#1128` | `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/tasks.md` |
| Apply Progress | `#1133` | `artifact-only: sdd/hmi-admin-logout-viewer-transition-flash/apply-progress` |
| Verify Report | `#1136` | `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/verify-report.md` |

## Archive Target

- Active change path moved from `openspec/changes/hmi-admin-logout-viewer-transition-flash/`
- Archive path: `openspec/changes/archive/2026-04-30-hmi-admin-logout-viewer-transition-flash/`

## Remaining Warnings

- Verification still recommends one integrated admin logout → viewer regression; current evidence remains component-level plus auth-layout coverage.
- `BuilderCanvas.tsx` and `DashboardViewer.tsx` still have some acceptable-but-uncovered branch edges.

## Post-Archive Checklist

- [x] Main specs updated before move
- [x] Archive report added to the change folder for filesystem audit trail
- [x] Change folder moved into dated archive folder
- [x] Active changes directory no longer contains the change
- [x] No destructive delta merge required warning
