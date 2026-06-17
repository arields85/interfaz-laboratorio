# Tasks: HMI Configurable Loader Options

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 650-900 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Config contract + normalization + runtime resolver | PR 1 | Base main; tests with code |
| 2 | `Opciones` tab + mounted-tab draft retention | PR 2 | Depends on PR 1; include dialog tests |
| 3 | Runtime shield wiring + caller skip flows | PR 3 | Depends on PR 2; include hook/layout/controller tests |

## Phase 1: Foundation TDD

- [x] 1.1 RED: Create `hmi-app/src/config/loaderOptions.config.test.ts` for defaults, `0.2..15s` bounds, corrupt storage fallback, restore-defaults draft inputs, and UI-only persistence.
- [x] 1.2 GREEN: Create `hmi-app/src/config/loaderOptions.config.ts` with localStorage key, `short=2s`, `long=8s`, enable flags, normalization, reset helpers, and seconds/ms conversion.
- [x] 1.3 RED: Extend `hmi-app/src/shield/__tests__/shieldController.test.ts` for future-request-only snapshots and disabled request skip semantics.
- [x] 1.4 GREEN: Update `hmi-app/src/shield/shieldEvents.ts`, `hmi-app/src/shield/shieldProfiles.ts`, and `hmi-app/src/shield/shieldController.ts` to resolve request-scoped runtime loader metadata.

## Phase 2: Admin UI TDD

- [x] 2.1 RED: Create `hmi-app/src/components/admin/LoaderOptionsSettingsTab.test.tsx` for `Opciones` label, enable toggles, disabled inputs, helper text, invalid fallback defaults, restore-without-save, and save persistence.
- [x] 2.2 GREEN: Create `hmi-app/src/components/admin/LoaderOptionsSettingsTab.tsx` using existing admin field styles and save/draft conventions.
- [x] 2.3 RED: Create `hmi-app/src/components/admin/GlobalSettingsDialog.test.tsx` for tab-switch draft survival across `Conexion`, `Diseno`, `Opciones`, and close-without-save discard behavior.
- [x] 2.4 GREEN: Update `hmi-app/src/components/admin/GlobalSettingsDialog.tsx` to register `Opciones`, keep tab panels mounted, route active-tab save refs, and track per-tab dirty state.

## Phase 3: Runtime Wiring TDD

- [x] 3.1 RED: Update `hmi-app/src/hooks/useBootShield.test.tsx` for static boot long separation, disabled runtime skip, request duration snapshots, and unchanged active loader after save.
- [x] 3.2 GREEN: Update `hmi-app/src/hooks/useBootShield.ts` to keep static boot defaults, resolve runtime requests once, and skip visualization when disabled.
- [x] 3.3 RED: Update `hmi-app/src/hooks/useReloadShield.test.tsx`, `hmi-app/src/components/layout/Topbar.test.tsx`, and `hmi-app/src/layouts/AdminLayout.test.tsx` for immediate continuation when runtime requests are disabled.
- [x] 3.4 GREEN: Update `hmi-app/src/hooks/useReloadShield.ts`, `hmi-app/src/components/layout/Topbar.tsx`, and `hmi-app/src/layouts/AdminLayout.tsx` to continue immediately and avoid canvas hiding when no loader was shown.

## Phase 4: Refactor / Verification

- [x] 4.1 REFACTOR: Remove duplicated loader-duration assumptions across shield callers; keep profile visuals/messages in `hmi-app/src/shield/shieldProfiles.ts` only.
- [x] 4.2 VERIFY: Run targeted Vitest suites for config, admin dialog/tab, boot shield, reload shield, topbar, admin layout, and shield controller scenarios from all three delta specs.
