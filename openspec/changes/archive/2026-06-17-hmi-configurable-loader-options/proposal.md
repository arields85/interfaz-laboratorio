# Proposal: HMI Configurable Loader Options

## Intent

- Runtime loader behavior is partly hardcoded today (`short=2s`, `long=8s`) and cannot be tuned or disabled from admin settings.
- This change moves those runtime UI options into admin configuration so each lab can control loader usage without code edits.

## Scope

### In Scope
- Add an `Opciones` tab in `GlobalSettingsDialog` with `long` and `short` loader sections.
- Provide enable/disable plus duration input per loader; duration is editable only when that loader is enabled.
- Persist loader options with defaults and a restore-defaults action.
- Apply persisted loader options to runtime reveal requests after app config is available.
- Preserve unsaved drafts across `Opciones`, `Conexion`, and `Diseno` while the settings dialog stays open and the user switches tabs.

### Out of Scope
- Removing or suppressing the first pre-hydration HTML boot shield.
- Adding new loader profiles, changing loader visuals, or adding plant/process control writes.

## Capabilities

### New Capabilities
- `loader-options-admin-settings`: Admin-managed loader enablement, duration, and restore-defaults behavior.

### Modified Capabilities
- `shield-reveal-profiles`: Runtime `long`/`short` requests become configurable for enablement and duration.
- `runtime-boot-shield`: Initial pre-hydration boot/reload behavior remains static until config is available.

## Approach

- Add a localStorage-backed loader options config module with normalized defaults: `short=2000ms`, `long=8000ms`.
- Keep the settings tabs mounted while `GlobalSettingsDialog` is open so each tab keeps its in-memory draft across tab switches without changing save/close semantics.
- Refactor shield runtime to resolve `enabled` and `minVisibleMs` at request time instead of import-time constants.
- Disabled runtime requests skip visualization and continue immediately; no fallback to another loader profile.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hmi-app/src/components/admin/GlobalSettingsDialog.tsx` | Modified | Add `Opciones` tab and save/revert wiring |
| `hmi-app/src/config/loaderOptions.config.ts` | New | Persist, normalize, and reset loader options |
| `hmi-app/src/shield/` | Modified | Resolve runtime loader config for boot/reveal flows |
| `hmi-app/src/components/layout/Topbar.tsx`, `hmi-app/src/layouts/AdminLayout.tsx`, `hmi-app/src/hooks/useReloadShield.ts` | Modified | Respect disabled runtime requests |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Users expect `long` disable to remove first boot shield | Med | Document static boot limitation in specs and UI copy |
| Invalid persisted durations cause poor UX | Med | Define normalization/fallback rules in specs |

## Rollback Plan

Remove the `Opciones` tab/config module and restore fixed shield profile constants and current callers.

## Dependencies

- Existing admin settings draft/save/revert conventions
- Browser localStorage availability for UI configuration

## Success Criteria

- [ ] Admin can enable/disable `long` and `short`, edit enabled durations, and restore defaults.
- [ ] Unsaved drafts in `Opciones`, `Conexion`, and `Diseno` survive tab switches and are discarded when the dialog closes without save.
- [ ] Disabled runtime requests do not render a loader and do not fallback to another profile.
- [ ] Enabled runtime requests use persisted durations; defaults restore to `short=2s` and `long=8s`.
- [ ] Initial pre-hydration boot may still show static `long`; that limitation is preserved and documented.
