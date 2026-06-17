# Apply Progress: hmi-configurable-loader-options

## Change
- Name: `hmi-configurable-loader-options`
- Work unit: `PR 3 / Unit 3`
- Mode: `Strict TDD`
- Delivery: `feature-branch-chain`
- Scope boundary: `runtime shield wiring + caller skip flows`

## Completed Tasks
- [x] 1.1 RED: Create `hmi-app/src/config/loaderOptions.config.test.ts` for defaults, bounds, corrupt storage fallback, restore-defaults draft inputs, and UI-only persistence.
- [x] 1.2 GREEN: Create `hmi-app/src/config/loaderOptions.config.ts` with storage key, defaults, enable flags, normalization, reset helpers, and seconds/ms conversion.
- [x] 1.3 RED: Extend `hmi-app/src/shield/__tests__/shieldController.test.ts` for future-request-only snapshots and disabled request skip semantics.
- [x] 1.4 GREEN: Update `hmi-app/src/shield/shieldEvents.ts`, `hmi-app/src/shield/shieldProfiles.ts`, and `hmi-app/src/shield/shieldController.ts` to resolve request-scoped runtime loader metadata.
- [x] 2.1 RED: Create `hmi-app/src/components/admin/LoaderOptionsSettingsTab.test.tsx` for `Opciones` label, enable toggles, disabled inputs, helper text, invalid persisted fallback, restore-without-save, and save persistence.
- [x] 2.2 GREEN: Create `hmi-app/src/components/admin/LoaderOptionsSettingsTab.tsx` using existing admin field styles and save/draft conventions.
- [x] 2.3 RED: Create `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx` for tab-switch draft survival across `Conexion`, `Diseno`, `Opciones`, and close-without-save discard behavior.
- [x] 2.4 GREEN: Update `hmi-app/src/components/admin/GlobalSettingsDialog.tsx` to register `Opciones`, keep tab panels mounted, route active-tab save refs, and track per-tab dirty state.
- [x] 3.1 RED: Update `hmi-app/src/hooks/useBootShield.test.tsx` for static boot long separation, disabled runtime skip, request duration snapshots, and unchanged active loader after save.
- [x] 3.2 GREEN: Update `hmi-app/src/hooks/useBootShield.ts` to keep static boot defaults, resolve runtime requests once, and skip visualization when disabled.
- [x] 3.3 RED: Update `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/components/layout/Topbar.test.tsx`, and `hmi-app/src/layouts/AdminLayout.test.tsx` for immediate continuation when runtime requests are disabled.
- [x] 3.4 GREEN: Update `hmi-app/src/hooks/useReloadShield.ts`, `hmi-app/src/components/layout/Topbar.tsx`, and `hmi-app/src/layouts/AdminLayout.tsx` to continue immediately and avoid canvas hiding when no loader was shown.
- [x] 4.1 REFACTOR: Remove duplicated loader-duration assumptions across shield callers; keep profile visuals/messages in `hmi-app/src/shield/shieldProfiles.ts` only.
- [x] 4.2 VERIFY: Run targeted Vitest suites for config, admin dialog/tab, boot shield, reload shield, topbar, admin layout, and shield controller scenarios from all three delta specs.

## TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `hmi-app/src/config/loaderOptions.config.test.ts` | Unit | N/A (new) | ✅ Written — import failed before module existed | ✅ Passed — `npm run test -- src/config/loaderOptions.config.test.ts` | ✅ 4 cases — defaults, bounds, corrupt storage, UI-local persistence | ✅ Clean — extracted normalization + cloning helpers |
| 1.2 | `hmi-app/src/config/loaderOptions.config.test.ts` | Unit | N/A (new) | ✅ Written | ✅ Passed — `npm run test -- src/config/loaderOptions.config.test.ts` | ✅ Same 4 cases forced real normalization logic | ✅ Clean — kept pure config helpers and runtime resolver |
| 1.3 | `hmi-app/src/shield/__tests__/shieldController.test.ts` | Unit | ✅ 6/6 passing baseline — `npm run test -- src/shield/__tests__/shieldController.test.ts` | ✅ Written — new assertions failed on missing snapshot/skip behavior | ✅ Passed — `npm run test -- src/shield/__tests__/shieldController.test.ts` | ✅ 2 cases — future-request snapshots + disabled skip | ✅ Clean — reused config resolver instead of duplicating rules |
| 1.4 | `hmi-app/src/shield/__tests__/shieldController.test.ts` | Unit | ✅ 6/6 passing baseline | ✅ Written | ✅ Passed — `npm run test -- src/shield/__tests__/shieldController.test.ts` | ✅ Existing + new cases verify event payload and skip path | ✅ Clean — event contract carries resolved request metadata |
| 2.1 | `hmi-app/src/components/admin/LoaderOptionsSettingsTab.test.tsx` | Integration | N/A (new) | ✅ Written — test failed before the tab UI existed | ✅ Passed — `npm run test -- src/components/admin/LoaderOptionsSettingsTab.test.tsx` | ✅ 3 cases — label/helper text + toggle gating, invalid persisted fallback, restore-defaults draft/save persistence | ✅ Clean — extracted draft/config conversion helpers and blur normalization |
| 2.2 | `hmi-app/src/components/admin/LoaderOptionsSettingsTab.test.tsx` | Integration | N/A (new) | ✅ Written | ✅ Passed — `npm run test -- src/components/admin/LoaderOptionsSettingsTab.test.tsx` | ✅ Same 3 cases forced real mounted draft + persistence behavior | ✅ Clean — save ref moved into effect to satisfy React hooks lint |
| 2.3 | `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx` | Integration | N/A (new coverage for existing dialog file) | ✅ Written — test failed while `Opciones` was not registered | ✅ Passed — `npm run test -- src/components/admin/GlobalSettingsDialog.test.tsx` | ✅ 2 cases — tab-switch draft survival and close-without-save discard | ✅ Clean — mocked child tabs kept the test focused on dialog orchestration |
| 2.4 | `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx` | Integration | N/A (new coverage for existing dialog file) | ✅ Written | ✅ Passed — `npm run test -- src/components/admin/GlobalSettingsDialog.test.tsx` | ✅ Same 2 cases forced mounted hidden panels, active-tab save routing, and design revert-on-close | ✅ Clean — parent only owns tab visibility + dirty/save refs |
| 3.1 | `hmi-app/src/hooks/useBootShield.test.tsx` | Integration | ✅ 12/12 passing baseline — `npm run test -- src/hooks/useBootShield.test.tsx` | ✅ Written — new static-boot, disabled-skip, and snapshot assertions failed before runtime request sampling existed | ✅ Passed — `npm run test -- src/hooks/useBootShield.test.tsx` | ✅ 3 cases — static boot ignores runtime disable, disabled runtime short skips, active long keeps original 5s snapshot after later save | ✅ Clean — helper now resolves request-scoped visibility budgets with boot defaults isolated |
| 3.2 | `hmi-app/src/hooks/useBootShield.test.tsx` | Integration | ✅ 12/12 passing baseline | ✅ Written | ✅ Passed — `npm run test -- src/hooks/useBootShield.test.tsx` | ✅ Same 3 cases forced request-start sampling instead of import-time constants | ✅ Clean — `requestShieldReveal()` returns visualization status and embeds resolved snapshots |
| 3.3 | `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/components/layout/Topbar.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Integration | ✅ 9/9 passing baseline — `npm run test -- src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx` | ✅ Written — disabled-runtime continuation assertions failed before skip-aware runtime wiring | ✅ Passed — `npm run test -- src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx` | ✅ 3 cases — reload keeps canvas visible, admin navigation still routes, logout still completes when runtime loader is disabled | ✅ Clean — mounted shield helpers keep caller tests behavioral and focused |
| 3.4 | `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/components/layout/Topbar.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Integration | ✅ 9/9 passing baseline | ✅ Written | ✅ Passed — `npm run test -- src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx` | ✅ Same 3 cases verified immediate continuation with no fallback loader | ✅ Clean — reload hides the canvas only when a runtime long reveal actually visualized; top-level callers stay immediate |
| 4.1 | `hmi-app/src/hooks/useBootShield.test.tsx`, `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/components/layout/Topbar.test.tsx`, `hmi-app/src/layouts/AdminLayout.test.tsx` | Integration | ✅ 27/27 passing focused baseline after 3.x GREEN | ✅ Approval coverage — refactor protected by the new runtime behavior tests first | ✅ Passed — `npm run test -- src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx` | ✅ Cross-profile coverage kept both static boot defaults and runtime snapshots honest | ✅ Clean — removed duplicated duration assumptions by resolving per-request visibility budgets centrally |
| 4.2 | `src/config/loaderOptions.config.test.ts`, `src/shield/__tests__/shieldController.test.ts`, `src/components/admin/LoaderOptionsSettingsTab.test.tsx`, `src/components/admin/GlobalSettingsDialog.test.tsx`, `src/hooks/useBootShield.test.tsx`, `src/hooks/useReloadShield.test.tsx`, `src/components/layout/Topbar.test.tsx`, `src/layouts/AdminLayout.test.tsx` | Unit + Integration | N/A (verification task) | ✅ Verification scope frozen before execution from the three delta specs | ✅ Passed — targeted suite command below | ✅ 44 focused assertions across all affected spec slices | ➖ None needed — verification-only task |

## Verification
- ✅ `npm run test -- src/hooks/useBootShield.test.tsx`
- ✅ `npm run test -- src/hooks/useReloadShield.test.tsx`
- ✅ `npm run test -- src/components/layout/Topbar.test.tsx`
- ✅ `npm run test -- src/layouts/AdminLayout.test.tsx`
- ✅ `npm run test -- src/config/loaderOptions.config.test.ts src/shield/__tests__/shieldController.test.ts src/components/admin/LoaderOptionsSettingsTab.test.tsx src/components/admin/GlobalSettingsDialog.test.tsx src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx`
- ✅ `npx eslint src/hooks/useBootShield.ts src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.ts src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx src/shield/shieldEvents.ts`
- ⚠️ `npx tsc -b` still fails on pre-existing unrelated repo-wide type errors outside this change slice (for example `src/components/admin/BuilderCanvas.test.tsx`, `src/components/admin/DesignSettingsTab.tsx`, `src/pages/admin/DashboardBuilderPage.tsx`, `src/widgets/renderers/ProduccionHistoricaWidget.tsx`).

## Remediation Addendum
- Scope: Strict-TDD remediation after `verify` returned `partial`.
- Remediated changed-file TypeScript issues in `src/hooks/useBootShield.test.tsx` and `src/shield/__tests__/shieldController.test.ts`.
- Added direct `GlobalSettingsDialog.handleSave()` coverage for the `connection` and `design` branches.

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| R1 | `hmi-app/src/hooks/useBootShield.test.tsx`, `hmi-app/src/shield/__tests__/shieldController.test.ts` | Integration + Unit | ✅ 23/23 passing baseline — `npm run test -- src/hooks/useBootShield.test.tsx src/shield/__tests__/shieldController.test.ts` | ✅ Type gate failed first — `npx tsc -b` reported the changed-file tuple/cast errors before remediation | ✅ Passed — `npm run test -- src/hooks/useBootShield.test.tsx src/shield/__tests__/shieldController.test.ts` and changed-file TypeScript output is now clean | ✅ 2 typed paths — font-check spy arguments and profile-change event listener wiring | ✅ Clean — extracted a listener helper and tightened mock signatures without changing behavior |
| R2 | `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx` | Integration | ✅ 2/2 passing baseline — `npm run test -- src/components/admin/GlobalSettingsDialog.test.tsx` | ✅ Written first — added direct save-branch assertions for `connection` and `design` | ✅ Passed — `npm run test -- src/components/admin/GlobalSettingsDialog.test.tsx` | ✅ 2 cases — active connection save and active design save/preview persistence | ✅ Clean — extracted `getSaveButton()` to keep the dialog assertions focused |

### Remediation Verification
- ✅ `npm run test -- src/components/admin/GlobalSettingsDialog.test.tsx`
- ✅ `npm run test -- src/hooks/useBootShield.test.tsx src/shield/__tests__/shieldController.test.ts src/components/admin/GlobalSettingsDialog.test.tsx`
- ✅ `npm run test -- src/config/loaderOptions.config.test.ts src/shield/__tests__/shieldController.test.ts src/components/admin/LoaderOptionsSettingsTab.test.tsx src/components/admin/GlobalSettingsDialog.test.tsx src/hooks/useBootShield.test.tsx src/hooks/useReloadShield.test.tsx src/components/layout/Topbar.test.tsx src/layouts/AdminLayout.test.tsx`
- ✅ `npm run test -- src/hooks/shieldLifecycle.test.tsx`
- ✅ `npx eslint src/hooks/useBootShield.test.tsx src/shield/__tests__/shieldController.test.ts src/components/admin/GlobalSettingsDialog.test.tsx`
- ⚠️ `npx tsc -b` still fails on unrelated pre-existing repo-wide files, but the remediated files no longer appear in the TypeScript error output.

## Test Summary
- Total tests written: 19 scenarios across 9 focused files
- Total focused tests passing: 47
- Layers used: Unit (12), Integration (35), E2E (0)
- Approval tests: Runtime hook/caller focused suites protected the 4.1 refactor
- Pure functions created: `getDefaultLoaderOptionsConfig`, `normalizeLoaderOptionsConfig`, `toLoaderDurationMs`, `resolveRuntimeLoaderRequest`, `resolveRequestMinVisibleMs`

## Remaining Tasks
- None — all 14 tasks are now marked complete.

## Deviations from Design
- None — implementation matches the design, including the static pre-hydration boot limitation and future-request-only runtime snapshots.

## Issues Found
- Project-wide `npx tsc -b` remains red because of unrelated pre-existing type errors outside the loader-options scope. Targeted runtime/admin verification for this change is green.

## Rollback Boundary
- Revert PR 3 runtime files/tests plus the `tasks.md` / `apply-progress.md` updates.
- This rollback removes runtime sampling and skip behavior without undoing PR 1 config groundwork or PR 2 admin UI work.

## Status
- 14/14 tasks complete.
- Ready for verify.
