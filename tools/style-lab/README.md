# Style lab

A standalone, dev-only page to design and compare visual styles for the HMI before turning them
into themes. It is not part of the app build.

- Published copy (private to the owner): https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8
- Source: `style-lab.html` in this folder. It is written as an Artifact page body (no
  `<!doctype>`/`<html>` wrapper, which the publisher adds). Opening it directly in a browser works
  for quick checks.

## How to ask for it in a new session

Ask the agent for "el laboratorio de estilos" (or "style lab"). The agent should read this README,
edit `tools/style-lab/style-lab.html` and republish it to the SAME artifact URL above (Artifact
tool, `url` parameter) so the link keeps working. To turn a result into a theme, paste the
"Copiar elección" text in the chat.

## What it covers

Every section has separate **rest** and **hover** values (tags have no hover), with transitions
between them.

- **Widgets:** frame base (glass, flat, outline), radius, fill, border, backdrop blur and the
  corner accent (visible or hidden, length, thickness, opacity, color).
- **Group container:** same frame as widgets, plus its own background: "Base" (opacity of the
  frame's own background) and "Fondo" (white overlay). The preview shows a container with two
  widgets on top of it.
- **Buttons with text:** style (glass, flat, outline), radius, fill, border, corner accent.
- **Icon-only buttons:** catalog rail and builder toolbar preview; radius, fill, border, accent.
- **Tags:** style (glass, flat, outline), radius, fill, border and color tint (each tag uses its
  own color).
- **Presets:** Actual (Clásico), Vidrio con remate, Industrial recto, Contorno (HMI).
- A hidden corner accent keeps its length, thickness and color: they are the start point of the
  rest-to-hover animation (registered `@property` custom properties transitioned on the element).
- "Copiar elección" produces a text summary of every section to turn into a theme.

## How a lab result becomes a theme

The HMI's "Tema" tab (Configuración general) offers built-in presets: Clásico, Contorno and
Instrumento. A style chosen here is added as a new preset in the theme model
(`hmi-app/src/domain/themeStyle.types.ts`, `hmi-app/src/services/themeStyle.service.ts`; history in
`odd/tasks/theme-tab.md` and `odd/tasks/theme-polish.md`). The lab technique is the reference
implementation for the frame, accent, button, tag and container CSS (`docs/DESIGN_SYSTEM.md`,
"Temas visuales").

## Improving the lab

Edit `style-lab.html`, then republish it to the same artifact URL. Keep the preview colors and
fonts aligned with the HMI tokens (`DesignSettingsTab` defaults).
