# Proposal: Fix admin logout viewer transition flash

## Intent

Remove the regression that re-shows the global boot shield on warm resume, and fix the deterministic malformed viewer flash after admin logout by making first render wait for shared valid canvas metrics.

## Scope

### In Scope
- Revert global `useResumeShield` wiring and behavior that causes black blink/loader overlay on tab focus and restore.
- Preserve #1088 boot/reload shield timing and typewriter loader while restoring canonical font-readiness sourcing.
- Extend shared canvas measurement readiness so fresh viewer mounts do not render zero-metric layouts; keep the invalid-measurement guard.
- Simplify admin logout navigation if confirmed redundant with existing auth guard.

### Out of Scope
- New process-control behavior, widget-specific layout patches, or new overlay systems.
- Changing approved #1088 timing constants or redesigning loader visuals.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `runtime-boot-shield`: limit shield usage back to boot/reload, remove resume-triggered reveal, and gate exit on canonical runtime typography readiness.
- `canvas-bounds`: add first-valid-measurement readiness so builder/viewer withhold frame-dependent layout until shared canvas metrics are valid.

## Approach

Roll back the root resume shield path in `App.tsx`/`useResumeShield.ts`. Keep the existing boot shield lifecycle, constants, and loader, but move font readiness to a shared canonical typography source instead of hook-local literals. Expand `useCanvasReference()` to expose whether a first valid measurement exists; consumers such as `DashboardViewer` (and shared builder paths where applicable) should render a neutral shell until readiness is true. Remove duplicate logout navigation if `RequirePermission` already owns the redirect.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/App.tsx` | Modified | Remove global resume shield wiring |
| `hmi-app/src/hooks/useResumeShield.ts` | Removed/Modified | Revert or retire resume overlay behavior |
| `hmi-app/src/hooks/useBootShield.ts` | Modified | Canonical font-readiness gating only |
| `hmi-app/src/utils/useCanvasReference.ts` | Modified | Publish first-valid-measurement readiness |
| `hmi-app/src/components/viewer/DashboardViewer.tsx` | Modified | Gate frame-dependent render on canvas readiness |
| `hmi-app/src/layouts/AdminLayout.tsx` | Modified | Remove redundant logout redirect if verified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Blank gap before first measurement | Med | Render neutral shell, not malformed grid |
| Font source misses runtime override | Med | Derive from canonical typography/bootstrap source |

## Rollback Plan

Restore current shield/resume wiring and remove the new canvas-readiness gate; keep changes isolated to shield, typography readiness, canvas primitive, and logout flow.

## Dependencies

- Existing `runtime-boot-shield` and `canvas-bounds` specs.

## Success Criteria

- [ ] Tab focus/restore no longer shows black blink or loader overlay over live UI.
- [ ] Boot/reload still honor #1088 constants and typewriter loader behavior.
- [ ] Admin logout lands in viewer without zero-measurement malformed layout flash.
- [ ] No widget-specific hacks are introduced; shared canvas guard remains intact.
