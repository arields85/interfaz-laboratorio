## Exploration: hmi-loader-original-long-restoration

### Current State
`hmi-app/src/hooks/useBootShield.ts` no longer has a single preserved long boot path. The current hook routes both initial long boot and later long reveals through a shared profile/cycle orchestrator (`startCycle`). For non-admin long flows, `defaultWaitForViewerReady()` returns `true`, so the long cycle now waits on runtime fonts, then WebGL first draw, then stable frames, then `viewerReadiness`, while also repeating the typewriter animation until readiness resolves or the timeout wins.

The short profile is already separated in behavior: `profile.id === 'short'` bypasses fonts, shader, stable-frame, and viewer-readiness gates, and only waits its own visual budget before hiding. That fast path matches the recent intent and should stay intact.

Git inspection of `d538c33` and `c67e9a8` shows the original long behavior was linear and simpler: fonts -> shader first draw -> stable frames -> minimum visible -> hide. Those commits had no `viewerReadiness`, no repeat-cycle interval, no profile-change event orchestration, and no `Dashboard.tsx` readiness signaling.

### Affected Areas
- `hmi-app/src/hooks/useBootShield.ts` — current mixed lifecycle; the long original path must be isolated here first.
- `hmi-app/src/shield/shieldController.ts` — current reveal/profile entrypoint that dispatches `hmi-shield-profile-change` and passes `waitForViewerReady` into the hook lifecycle.
- `hmi-app/src/shield/shieldEvents.ts` — current event contract only expresses profile change + viewer-ready waiting, not lifecycle intent.
- `hmi-app/src/shield/viewerReadiness.ts` — current long viewer gate dependency; likely should stop affecting original boot/reload long.
- `hmi-app/src/hooks/useReloadShield.ts` — keyboard reload currently re-enters long via `shieldController.revealWithProfile('long', { waitForViewerReady: ... })`.
- `hmi-app/src/pages/Dashboard.tsx` — current `resetViewerReady()` / `signalViewerReady()` wiring is part of the present long divergence for viewer routes.
- `hmi-app/index.html` — still preserves the original root-owned shield shell and long visual baseline; safe to keep as the DOM source.
- `hmi-app/src/hooks/useBootShield.test.tsx` and `hmi-app/src/hooks/shieldLifecycle.test.tsx` — current tests encode the mixed long behavior and will need TDD replacement/splitting.

### Approaches
1. **Dedicated original-long runner plus kept transition runner** — keep shared DOM/font/shader helper functions, but split the lifecycle into an original-preserved long runner for boot + supported keyboard reload, a separate short runner, and an explicit transition/reveal runner only for flows that still need viewer-readiness orchestration.
   - Pros: minimal product risk, restores `d538c33` / `c67e9a8` semantics for #1088 boot/reload, preserves the short fast path, and avoids deleting potentially still-needed transition logic blindly.
   - Cons: requires a small contract change so long flows declare lifecycle intent instead of only profile id.
   - Effort: Medium.

2. **Remove viewer-readiness orchestration from long globally** — simplify long so every long cycle uses the original linear gates and stop using repeat-cycle/viewer-readiness for long at all.
   - Pros: smallest code model and closest to the historical long implementation.
   - Cons: higher regression risk for explicit reveal-driven flows (notably admin/logout-style transitions) because their current behavior may still rely on the extra gate.
   - Effort: Low/Medium.

### Recommendation
Use **Approach 1**. The minimal safe architecture is to restore an explicit original-long lifecycle for boot and keyboard reload, while keeping short isolated and leaving reveal-driven transition orchestration opt-in instead of default. In practice, the split point is `useBootShield.ts`: share only DOM normalization/reveal/hide/font/shader/stable-paint helpers, but stop routing original long through `viewerReadiness`, repeat-cycle timers, and generic profile-change orchestration.

### Risks
- `useReloadShield.ts` currently reaches long through `shieldController.revealWithProfile(...)`; proposal/design must decide whether reload calls the restored original-long path directly or passes a stronger lifecycle intent through the event contract.
- `Dashboard.tsx` readiness signaling may become dead code for boot/reload but still be needed for explicit transition flows; proposal should scope that cleanup carefully.
- Existing tests currently assert the divergent long behavior (viewer-ready wait, repeated typewriter). Strict TDD means those expectations must be intentionally replaced before implementation.
- If the split is done superficially inside one large hook without naming the lifecycle intent, the code will drift back into mixed behavior.

### Ready for Proposal
Yes — but proposal should first resolve one narrow product/behavior question: should non-#1088 explicit long reveals (for example admin/logout transition coverage) keep a separate viewer-readiness transition runner, or should every long reveal be normalized to the restored original-long sequence?
