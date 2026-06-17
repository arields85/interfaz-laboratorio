# Proposal: HMI Loader Original Long Restoration

## Intent

Restore one consistent original `long` loader contract. Today `long` flows mix the historical sequence with viewer-readiness and profile-cycle orchestration, creating inconsistent ceremonial behavior across boot, reload, admin/logout, and other reveals.

## Scope

### In Scope
- Restore the original `long` sequence for every `long` activation: fonts -> WebGL first draw -> stable frames -> minimum visible -> hide.
- Keep `short` as a separate fast cosmetic path that does not wait on heavy readiness gates.
- Define explicit lifecycle intent for boot, reload, admin/logout, and any other shield reveal using `long` or `short`.
- Allow `long` to extend past the restored sequence only when the destination truly has no content ready to show.

### Out of Scope
- Loader visual redesign or copy changes.
- Plant-control behavior, data-contract changes, or generic runtime orchestration cleanup beyond loader lifecycle scope.

## Capabilities

### New Capabilities
- `shield-reveal-profiles`: Defines product rules for `long` vs `short`, including the no-content safety exception across all shield activations.

### Modified Capabilities
- `runtime-boot-shield`: Updates boot and keyboard reload to use the restored original-`long` lifecycle instead of the current mixed viewer-readiness path.

## Approach

Introduce a dedicated original-`long` runner while preserving the current `short` fast path. Shared DOM/font/shader helpers may remain shared, but `long` MUST stop depending on default viewer-readiness restarts. `long` MAY hide after the restored sequence even if data is still resolving; waiting longer is allowed only as a true no-content safety exception.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/hooks/useBootShield.ts` | Modified | Split original-`long` and `short` lifecycle runners |
| `hmi-app/src/shield/shieldController.ts` | Modified | Pass explicit reveal lifecycle intent |
| `hmi-app/src/shield/shieldEvents.ts` | Modified | Align event contract with profile/lifecycle rules |
| `hmi-app/src/hooks/useReloadShield.ts` | Modified | Route reload through restored `long` behavior |
| `hmi-app/src/pages/Dashboard.tsx` | Modified | Limit viewer-ready wiring to true no-content cases |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Existing transition flows rely on current viewer-ready waits | Med | Define the exception narrowly and replace behavior with TDD-covered rules |
| "No content ready to show" remains ambiguous per destination | Med | Make the exception explicit in spec/design before implementation |

## Rollback Plan

Revert implementation follow-up to the current shared orchestrator and preserve the existing `short` path while restoring prior tests until replacement specs pass.

## Dependencies

- Existing shield shell in `hmi-app/index.html`
- Strict TDD coverage for lifecycle regressions

## Success Criteria

- [ ] Every `long` activation follows one contract: restored original sequence first, optional extension only for true no-content states.
- [ ] Every `short` activation remains fast and does not wait on fonts, shader stable frames, or generic viewer readiness.
- [ ] Boot and keyboard reload no longer depend on mixed viewer/profile orchestration.
- [ ] Follow-up spec/design/tasks can map behavior cleanly to `runtime-boot-shield` and `shield-reveal-profiles`.
