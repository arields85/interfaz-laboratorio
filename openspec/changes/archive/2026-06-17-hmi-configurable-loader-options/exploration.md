## Exploration: hmi-configurable-loader-options

### Current State
Global admin settings live in `GlobalSettingsDialog`, which currently has `connection` and `design` tabs, tracks per-tab dirty state through `saveRef`/`revertRef`, and remembers the active tab in localStorage. Connection settings use a small localStorage-backed config module, while design/background settings write directly to DOM styles or persisted Zustand state. Shield runtime durations are still hardcoded in `SHIELD_PROFILES`, then consumed by `useBootShield` through import-time constants and by `shieldController` for profile metadata. `short` is requested from viewer -> admin navigation, while `long` is used for initial boot, keyboard reload, and admin logout. The root shield is rendered as visible in `hmi-app/index.html`, so disabling `long` at runtime cannot fully prevent the first pre-hydration paint without extra bootstrap work.

### Affected Areas
- `hmi-app/src/components/admin/GlobalSettingsDialog.tsx` — add the new options tab and wire dirty/save handling.
- `hmi-app/src/components/admin/ConnectionSettingsTab.tsx` — reference pattern for local draft + explicit save.
- `hmi-app/src/components/admin/DesignSettingsTab.tsx` — reference pattern for restore defaults and dialog revert behavior.
- `hmi-app/src/components/admin/AdminNumberInput.tsx` — reusable numeric input for duration fields.
- `hmi-app/src/config/dataConnection.config.ts` — closest existing convention for localStorage-backed admin configuration.
- `hmi-app/src/shield/shieldProfiles.ts` — current hardcoded loader defaults and messages.
- `hmi-app/src/hooks/useBootShield.ts` — current long/short timing logic and initial boot reveal.
- `hmi-app/src/shield/shieldController.ts` — profile application and reveal request dispatch.
- `hmi-app/src/components/layout/Topbar.tsx` — current short-loader caller for viewer -> admin navigation.
- `hmi-app/src/layouts/AdminLayout.tsx` — current long-loader caller for admin logout.
- `hmi-app/src/hooks/useReloadShield.ts` — current long-loader caller for keyboard reload.
- `hmi-app/index.html` — root-owned visible shield at first paint.
- `hmi-app/src/components/layout/Topbar.test.tsx` — navigation/reveal contract coverage.
- `hmi-app/src/layouts/AdminLayout.test.tsx` — logout/reveal contract coverage.
- `hmi-app/src/hooks/useBootShield.test.tsx` and `hmi-app/src/hooks/shieldLifecycle.test.tsx` — duration/lifecycle assertions that will change.

### Approaches
1. **Config module + runtime profile resolver** — add a localStorage-backed loader options module, expose normalized read/save/reset helpers, add one admin tab with local draft state, and resolve effective profile timing/enabled state at reveal time.
   - Pros: Matches existing connection-config convention, works from non-React shield runtime, avoids Zustand hydration coupling, keeps defaults centralized, easiest to unit test.
   - Cons: Requires refactoring import-time duration constants into runtime lookups; initial boot disable still cannot remove the very first HTML shield paint.
   - Effort: Medium

2. **Persisted Zustand loader store** — add a dedicated persisted store for loader options and read it from admin UI plus shield runtime.
   - Pros: Reactive state model, familiar pattern from shader settings, simple UI binding.
   - Cons: Worse fit for non-React callers and early boot; still needs runtime resolvers instead of import-time constants; introduces store hydration timing questions for boot behavior.
   - Effort: Medium

### Recommendation
Use **Config module + runtime profile resolver**. The minimal path is: add a new admin tab (e.g. `Options`) with two sections (`long`, `short`), each with enabled toggle + duration draft field, plus a restore-defaults action; persist through a small config module with defaults `long=8000ms` and `short=2000ms`; refactor shield runtime to resolve `enabled` and `minVisibleMs` at request/execution time instead of from hardcoded import-time constants.

For disabled requests, the safest minimal contract is **skip reveal and do not fallback to another loader**. That means viewer->admin navigation continues immediately if `short` is disabled, and logout/reload continue immediately if `long` is disabled. Fallback-to-other-profile would hide user intent and create surprising delays.

### Risks
- Product behavior is not fully defined for **disabled `long` during initial boot/reload**; current root-owned HTML shield makes first-paint suppression only partially configurable.
- Existing tests assert hardcoded duration values and current reveal dispatch behavior; they will need coordinated updates.
- If duration validation is weak, invalid persisted values could create zero/negative/very large waits; normalization rules must be explicit.

### Ready for Proposal
No — confirm whether disabling `long` must also suppress initial boot/reload behavior, or only explicit runtime requests after config is available.
