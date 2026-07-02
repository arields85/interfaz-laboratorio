---
name: widget-property-panel
description: "Trigger: widget property panel, PropertyDock, DockSection, DockFieldRow, admin primitives. Enforce primitive-first widget property-panel UI and forbid local ad-hoc controls when shared primitives exist."
license: Apache-2.0
metadata:
  author: "gentle-ai"
  version: "1.0"
---

# Widget Property Panel

## Activation Contract

Use this skill when creating, editing, reviewing, or fixing widget property-panel UI in `PropertyDock`, `PropertiesPanel`, or widget-specific admin property sections.

## Hard Rules

- Primitive-first is MANDATORY.
- Reuse existing admin primitives before writing local markup.
- Use `DockSection` for sections, `DockFieldRow` for rows, `AdminSelect` for selectors, `DockInfoDropdown` for informational dropdowns, `DockInfoBox` for help legends, `DockColorField` for colors, `DockSliderField` for sliders, `DockCheckboxField` for checkbox semantics, and `DockInlineControlRow` only for compact internal sub-rows inside a compliant primitive/layout.
- For property-panel booleans, choose the control by semantics and visual fit: `DockToggleField` is allowed for compact on/off switches, but a checkbox is allowed when it is clearer, matches the requested/reference style, or avoids misleading switch semantics.
- Property-panel primitives are for admin/widget property panels; do NOT force `Dock*` controls into runtime widget legends, in-widget overlays, or viewer controls. Runtime boolean controls still must not use invented ad-hoc checkbox/toggle markup: reuse an existing context-appropriate primitive such as `WidgetRuntimeCheckbox`, or create a runtime/shared primitive first.
- Do NOT add local ad-hoc `text-sm`, `text-xs`, `font-*`, `tracking-*`, `leading-*`, custom input widths, or local range/color/toggle markup when a primitive exists. Checkbox markup is allowed only when the boolean decision gate chooses a checkbox.
- Do NOT override primitive width classes unless the user explicitly approves a new reusable rule.
- If a primitive is insufficient, update/create the reusable primitive first, then consume it.
- `DockColorField` owns the canonical color behavior: compact swatch, right-aligned Hex field, Hex value without `#`, alpha via `DockSliderField`.
- Visual/options booleans do NOT require `DockToggleField` by default; use the boolean decision gate below.
- If a convention-compliant fix may change visible semantics or saved data, ask the user first.
- If visual acceptance already exists, do not make layout changes without explicit user confirmation.
- Preserve the HMI read-only rule: never introduce plant writes or control actions.
- The PropertyDock badge beside `PROPIEDADES` is the canonical widget identity label (type/metadata), NOT the editable widget `Título` field.
- Editing `Título` must only change widget content/header text. It must never rename the PropertyDock badge.
- Canonical badge labels should stay short (reference max ~17 chars) and use hyphen-separated abbreviations when needed.

## Decision Table

| Need | Use |
|------|-----|
| Collapsible property group | `DockSection` |
| Standard property row | `DockFieldRow` |
| Option selection | `AdminSelect` |
| Read-only expandable detail | `DockInfoDropdown` |
| Context/help legend | `DockInfoBox` |
| Color editing | `DockColorField` |
| Slider/range editing | `DockSliderField` |
| Compact on/off switch in a property panel | `DockToggleField` |
| Boolean where checkbox is clearer, requested, or matches existing reference style | `DockCheckboxField` |
| Runtime widget legend, in-widget overlay, or viewer control | Use a context-appropriate runtime/shared primitive; do not invent ad-hoc checkbox/toggle markup |
| Compact inner control alignment inside a primitive | `DockInlineControlRow` |

## Execution Steps

1. Read `hmi-app/src/widgets/WIDGET_AUTHORING.md` and the referenced admin primitives before changing property-panel UI.
2. Map each needed control to an existing primitive.
3. Remove/reject local ad-hoc property-panel markup when a primitive already covers the case.
4. If no primitive fully covers the need, create or extend the reusable primitive in `hmi-app/src/components/admin/` first.
5. Only after the primitive contract is correct, wire it into the widget property panel.
6. Re-check for forbidden local typography, width, and control-markup overrides.

## Output and Verification Contract

- Report which property-panel primitives were reused.
- State whether any new reusable primitive/rule was required.
- Verify the changed panel still follows the documented width, typography, and read-only constraints.
- If this skill file is newly added or updated, remind the user that opencode restart is required before autocomplete/available-skills reflects it.

## References

- `AGENTS.md`
- `hmi-app/src/widgets/WIDGET_AUTHORING.md`
- `hmi-app/src/components/admin/DockColorField.tsx`
- `hmi-app/src/components/admin/DockCheckboxField.tsx`
- `hmi-app/src/components/admin/DockSliderField.tsx`
- `hmi-app/src/components/admin/DockToggleField.tsx`
- `hmi-app/src/components/admin/DockInfoDropdown.tsx`
- `hmi-app/src/components/admin/DockInfoBox.tsx`
- `hmi-app/src/components/admin/DockInlineControlRow.tsx`
- `hmi-app/src/components/admin/AdminSelect.tsx`
- `hmi-app/src/components/admin/adminSidebarStyles.ts`
