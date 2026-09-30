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
- **Frame shape and "Pestaña" section:** "Forma del marco" switches the widget previews between
  Estándar and Pestaña (default). The tab silhouette is ONE SVG path (same maths as
  `hmi-app/src/utils/tabFramePath.ts`) recomputed from the measured size (ResizeObserver): every
  corner uses the same radius, which is linked to the Widgets radius. Controls: tab fill (color and
  opacity), tab text color and opacity for rest and hover, radius, tab height, tab cut, body cut,
  start padding, optional border around the tab, and an alert preview (warning/critical) with
  tab fill and text taken from the alert color, plus the border and glow along the silhouette.
  "Reproducir entrada" replays the outline draw-in. "Copiar elección" lists every value with its
  `--tab-frame-*` token name. The "Producción" chart in the grid keeps the standard frame, as in
  the app today. The tab cut is defined for a 25 px tab and scales with the tab height (constant
  slope, like `scaleTabFrameCut`); the lab defaults are the accepted app tokens (height 25, cut 19,
  body cut 0, fill white 15 %, text white 70 % -> 100 %). A viewer's stored tuning still wins.
- **"Gráfico con selector" (tab frame for charts with a scale/period selector):** at the end of the
  preview, a sample chart (title, header icon, selector with the real options 1h 24h 7d 30d 12m, Y
  scale, grid and line, drawn in inline SVG from the measured plot box) in the tab shape, with three
  placements of the selector: **A** in the body's first row, right-aligned; **B** in the tab strip,
  right side, between the tab and the icon (the body row disappears, the chart gains that height, the
  tab and its truncating title stop before the selector); **C** in a second, mirrored tab flush with
  the right edge (slanted side to the left, same slope and fill, one silhouette and border for both
  tabs). The icon is 24 px at 90 %, pinned top-right. Controls: alternative (A/B/C), "Mostrar las
  tres juntas" (compare view), selector style (píldora / subrayado, as `WidgetHeaderTemporalControls`),
  gap between the strip elements, selector scale, sample width (with narrow 280 / wide 560 shortcuts,
  to see the title truncate) and title text. Rest and hover are testable like the other widgets
  (hover the sample, or use "Texto hover"). With the Estándar shape the sample shows today's header.
  "Restablecer la pestaña a los valores aceptados" resets the tab tokens above. "Copiar elección"
  adds a "Gráfico con selector" part: the chosen alternative and its placement rule (so a later
  session can port it exactly), gap, selector style and scale, sample width and title, and the tab
  values used. Adjustments are remembered in the browser like the rest of the lab.
- **Presets:** Instrumento (the app's `INSTRUMENT_THEME_STYLE`, and the lab's initial state), Actual
  (Clásico), Vidrio con remate, Industrial recto, Contorno (HMI). Switching preset keeps the shape
  and tab settings.
- **"Remate de la esquina" (finish of the body's top-right corner under the header icon):** a switch that
  applies to every widget with the Pestaña shape (the main sample widgets and the chart sample; not to the chart's
  alternative C, whose icon lives in its own tab). Options: **Actual** (the reference: rounded corner, or the 45°
  chamfer when "Corte cuerpo" is above 0); **1 · Escalón**: the body's top line runs right from the tab junction, a
  diagonal goes down to the right and a flat shelf continues to the right edge, with the icon above the shelf.
  Controls: *profundidad* (the same value as "Corte cuerpo", 0-60 px; picking Escalón with 0 loads 16 px and gives the 0
  back when leaving it untouched) and *desplazamiento* (shelf width, 0-80 px; 0 = the diagonal reaches the right edge).
  The diagonal is parallel to the tab's slanted side (slope = tab cut / tab height, not 45°), every vertex uses the
  single silhouette radius, and the fill, border, glow, alert states and hover follow the same path. The step is
  clamped so it never crosses the title tab, the chart selector (in B it cannot start left of the selector's right
  edge) or the widget's height, and the content moves down just enough to stay 6 px below the shelf. **2 · Esquina
  abierta**: the fill stays closed but the top and right border fade to transparent before the corner (control:
  *desvanecer*, 8-120 px, a radial mask on the border layer). **3 · Ícono sobre la línea**: the icon is centered on the
  body's top line and the border is interrupted around it (control: *separación*, 0-16 px; in B it cannot exceed the
  strip gap). The values are remembered and validated on load, and "Copiar elección" adds a "Remate de la esquina" part
  naming the finish and its values (for Escalón: depth, displacement and that the slope equals the tab's).
- **"Calado del ícono" (icon cutout):** a toggle that makes the widget's background transparent inside a circle
  centered on the header icon, so the icon does not sit on the glass fill. It applies only with the **Actual
  (Clásico)** preset and the **Estándar** shape (in Pestaña the icon is already outside the body, so nothing is cut),
  to every sample widget with a header icon, the alert card and the chart sample included. The card's background,
  blur and border move to `::before`, which carries a radial `mask-image` built from the icon's measured center
  (`-webkit-mask-image` too); the corner accent intersects its mask with the same hole, and the alert glow stays on
  the card. The stage shows through, rest and hover. Controls: *margen* (circle radius = half the icon + margin,
  0-24 px), *suavizado* (feather, 0 = hard edge, up to 16 px, centered on the radius) and *anillo en el borde*
  (a thin ring with the frame's border colour, the alert colour on the alert card). Values are remembered, validated on
  load, and "Copiar elección" adds a "Calado del ícono" part.
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
