# Style lab

A standalone, dev-only page to design and compare visual styles for the HMI's widget frames and
buttons before turning them into themes. It is not part of the app build.

- Published copy (private to the owner): https://claude.ai/artifact/F3aAjXDvvsCMFKYZxoT6A8
- Source: `style-lab.html` in this folder. It is written as an Artifact page body (no
  `<!doctype>`/`<html>` wrapper, which the publisher adds). Opening it directly in a browser works
  for quick checks.

## What it covers

- Widget frame base (glass, flat, outline) and button style (glass, flat, outline).
- Separate **rest** and **hover** states for everything: radius, fill, border, backdrop blur and
  the corner accent (visible or hidden, length, thickness, opacity, color).
- A hidden corner accent keeps its length, thickness and color: they are the start point of the
  rest-to-hover animation (registered `@property` custom properties transitioned on the element).
- "Copiar elección" produces a text summary of both states to turn into a theme.

## How a lab result becomes a theme

The HMI's "Tema" tab offers built-in presets. A style chosen here is added as a new preset in the
theme model (see `odd/tasks/theme-tab.md`); the lab technique is the reference implementation for
the frame and accent CSS.

## Improving the lab

Edit `style-lab.html`, then republish it to the same artifact URL so the link keeps working.
Keep the preview colors and fonts aligned with the HMI tokens (`DesignSettingsTab` defaults).
