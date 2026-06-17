# Design: HMI Configurable Loader Options

## Technical Approach

Add a dedicated `LoaderOptionsSettingsTab` to `GlobalSettingsDialog`, but preserve drafts for all settings tabs by keeping `Connection`, `Design`, and `Opciones` panels mounted while the dialog is open and toggling visibility instead of remounting content. That keeps the existing tab-local draft/save pattern intact, preserves unsaved edits across tab switches, and still discards unsaved drafts when the dialog closes. Persist loader settings in `hmi-app/src/config/loaderOptions.config.ts` as normalized localStorage data with shared defaults (`short=2s`, `long=8s`) and bounds (`0.2–15s`). Runtime callers will keep asking for `short`/`long`, but `requestShieldReveal` will resolve the effective config once per request and pass the resolved duration into the reveal event so in-flight loaders do not change after save. The initial visible shield from `index.html` + first `useBootShield()` mount remains static and uses default long timing only.

## Architecture Decisions

### Decision: Draft lifetime across settings tabs

| Option | Tradeoff | Decision |
|---|---|---|
| Lift all tab drafts into `GlobalSettingsDialog` state | Explicit orchestration, but refactors every tab and duplicates existing local form logic | Rejected |
| Keep tab-local drafts and render every tab panel while the dialog is open | Slightly more mounted UI, but preserves current tab APIs and prevents tab-switch data loss | Chosen |
| Persist unsaved drafts to storage | Survives close/reload, but changes current dialog semantics and risks stale partial config | Rejected |

### Decision: Storage + validation

| Option | Tradeoff | Decision |
|---|---|---|
| Persist in Zustand | Hydration timing leaks into non-React boot code | Rejected |
| localStorage config module | Slightly manual API, but matches `dataConnection.config.ts` and works before/without React | Chosen |

### Decision: Runtime sampling

| Option | Tradeoff | Decision |
|---|---|---|
| Read config continuously during hide cycle | Mid-flight saves mutate active loaders | Rejected |
| Resolve once at request start and embed `resolvedMinVisibleMs` in event detail | Requires request type update, but keeps “future requests only” exact | Chosen |

### Decision: Disabled behavior

| Option | Tradeoff | Decision |
|---|---|---|
| Fallback to another profile | Hides user intent and adds surprise delay | Rejected |
| Return “not visualized” and continue caller flow immediately | Requires reload path to skip canvas hiding | Chosen |

## Data Flow

`GlobalSettingsDialog` (active tab + per-tab dirty flags, mounted panels)
→ tab-local draft (`Connection` / `Design` / `Opciones`)
→ active-tab save handler
→ persisted config (`localStorage` / theme overrides)

Tab switch path:

`setActiveTab(nextTab)` → inactive panels stay mounted → draft state survives → returning to the tab restores the same unsaved fields

Close path:

`handleClose()` → revert live `Design` theme overrides if dirty → dialog unmount discards unsaved tab-local drafts

`Topbar` / `AdminLayout` / `useReloadShield`
→ `requestShieldReveal(profileId)`
→ `resolveRuntimeLoaderRequest(profileId)`
   - disabled → return `false`; caller continues immediately
   - enabled → `revealBootShield()` + dispatch event with resolved snapshot
→ `useBootShield.runReveal(requestSnapshot)`
→ hide after `request.resolvedMinVisibleMs`

Static boot remains separate:

`index.html` visible shield → first `useBootShield()` mount → static long cycle (not suppressible by saved config)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `hmi-app/src/components/admin/LoaderOptionsSettingsTab.tsx` | Create | New `Opciones` tab UI with long/short sections, toggles, helper text, draft reset, and save wiring consistent with the existing settings tabs. |
| `hmi-app/src/components/admin/LoaderOptionsSettingsTab.test.tsx` | Create | RTL coverage for draft behavior, bounds/default fallback, disabled inputs, and restore-defaults semantics. |
| `hmi-app/src/config/loaderOptions.config.ts` | Create | LocalStorage key, defaults, bounds, normalization, save/read/reset helpers, and seconds→ms conversion. |
| `hmi-app/src/config/loaderOptions.config.test.ts` | Create | Strict-TDD unit tests for corrupt storage, invalid values, and default restoration. |
| `hmi-app/src/components/admin/GlobalSettingsDialog.tsx` | Modify | Register `Opciones`, keep all tab panels mounted during the dialog session, and track dirty state per tab so unsaved drafts survive tab switches. |
| `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx` | Create | Assert `Conexion`, `Diseno`, and `Opciones` drafts survive tab switches and close without save still restores persisted values. |
| `hmi-app/src/shield/shieldEvents.ts` | Modify | Extend the shared reveal request contract with resolved runtime duration metadata. |
| `hmi-app/src/shield/shieldProfiles.ts` | Modify | Keep visual/message profile data only; stop being the source of configurable runtime durations. |
| `hmi-app/src/hooks/useBootShield.ts` | Modify | Use request-scoped runtime duration for reveals; keep initial mount on static default long timing. |
| `hmi-app/src/hooks/useReloadShield.ts` | Modify | Hide shader canvas only when a runtime long reveal was actually visualized. |
| `hmi-app/src/shield/shieldController.ts` | Modify | Reuse the same resolver so controller-driven reveals match request helper semantics. |
| `hmi-app/src/hooks/useBootShield.test.tsx` | Modify | Cover request-scoped durations, disabled skip path, and static boot separation. |
| `hmi-app/src/hooks/useReloadShield.test.tsx` | Modify | Assert reload continues without blanking the canvas when long is disabled. |
| `hmi-app/src/components/layout/Topbar.test.tsx` | Modify | Assert admin navigation still proceeds when short reveal is skipped. |
| `hmi-app/src/layouts/AdminLayout.test.tsx` | Modify | Assert logout still proceeds when long reveal is skipped. |
| `hmi-app/src/shield/__tests__/shieldController.test.ts` | Modify | Keep controller contract aligned with resolved runtime options. |

## Interfaces / Contracts

```ts
type LoaderProfileId = 'long' | 'short';

interface LoaderOption {
  enabled: boolean;
  durationSeconds: number;
}

interface LoaderOptionsConfig {
  long: LoaderOption;
  short: LoaderOption;
}

interface ShieldRevealRequest {
  profileId: LoaderProfileId;
  runner: 'original-long' | 'short';
  allowNoContentExtension: boolean;
  restartCycle: boolean;
  resolvedMinVisibleMs: number;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Unit | Config normalization/defaults/bounds | Vitest first on `loaderOptions.config.test.ts` |
| Integration | `Opciones` draft/save/revert/restore UX | RTL + `localStorage` assertions |
| Integration | Settings dialog draft preservation across `Conexion` / `Diseno` / `Opciones` | New `GlobalSettingsDialog.test.tsx` tab-switch and close-without-save scenarios |
| Integration | Runtime reveal resolution, disabled skip, static boot limitation | Update `useBootShield`, `useReloadShield`, `Topbar`, `AdminLayout`, and controller tests |
| E2E | N/A | No E2E layer is configured in this repo |

## Migration / Rollout

No data migration required. Missing/corrupt/legacy storage falls back to defaults. Rollback is safe: old runtime ignores the extra localStorage key, and removing the tab/config module restores fixed loader behavior.

## Open Questions

None.
