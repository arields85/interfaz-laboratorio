# Sistema de Diseño — Interfaz-Laboratorio

> **TL;DR**: Tailwind v4 sin `tailwind.config.js` — tokens en `@theme {}` de `hmi-app/src/index.css`. Regla de oro: nunca hardcodear colores hex ni fuentes en componentes, siempre usar tokens via clases Tailwind. Íconos exclusivamente Lucide React.

> ← Volver a [`AGENTS.md`](../AGENTS.md)

---

## Tailwind v4 — Sin `tailwind.config.js`

Tailwind v4 **no usa `tailwind.config.js`**. La configuración se hace con el bloque `@theme {}` en `hmi-app/src/index.css`. Tailwind expone cada variable como clase utilitaria y como variable CSS nativa.

## 🔴 Regla de Oro

> **NUNCA hardcodear colores hex ni nombres de fuente en los componentes.**
> **SIEMPRE usar las variables CSS del `@theme {}`.**

Esta regla es arquitectural: el panel de administración incluirá un ícono de configuración (⚙️) para que el usuario cambie colores y fuentes dinámicamente, reasignando valores de variables. Si un componente usa `#ef4444` en lugar de `text-status-critical`, el theming dinámico se rompe.

## Categorías de tokens

| Categoría               | Prefijo CSS                | Tokens principales                               | Uso                                      |
|-------------------------|----------------------------|--------------------------------------------------|------------------------------------------|
| Industrial base         | `--color-industrial-*`     | `bg`, `surface`, `hover`, `border`, `text`, `muted` | Superficies y texto base de la app     |
| Colores de acento       | `--color-accent-*`         | `cyan`, `purple`, `pink`, `blue`, `green`, `amber`, `ruby` | Acentos de UI, indicadores            |
| Modo admin              | `--color-admin-*`          | `accent`, `selection-from`, `selection-to`       | Acento estructural del panel admin       |
| Gradientes de widget    | `--color-widget-*`         | `gradient-from`, `gradient-to`, `icon`           | Degradados base de métricas sin umbral   |
| Colorización dinámica   | `--color-dynamic-*`        | `normal-from/to`, `warning-from/to`, `critical-from/to` | Degradados según umbral de métrica  |
| Estado operativo        | `--color-status-*`         | `normal`, `warning`, `critical`                  | Indicadores de estado de equipos        |
| Superposición modal     | `--color-modal-*`          | `overlay`                                        | Fondo oscuro semitransparente detrás de todo modal centrado (`ModalBackdrop`) |

## Temas visuales (marco de widgets y botones)

La pestaña **Tema** de Configuración general elige un tema predefinido que define la forma del marco de los widgets y de los botones, con valores separados para **reposo** y **hover**.

- **Modelo:** `hmi-app/src/domain/themeStyle.types.ts`. Temas incorporados: `classic` ("Clásico", el aspecto original), `outline` ("Contorno") e `instrument` ("Instrumento", vidrio sobrio con esquinas apenas redondeadas). El marco de Instrumento (2026-09-29, elección del laboratorio) usa radio de 5 px en reposo y hover, borde de reposo al 12 % y remate de esquinas oculto de 25 px de largo.
- **Aplicación:** `hmi-app/src/services/themeStyle.service.ts` convierte el tema en variables CSS sobre `document.documentElement`, persiste el tema activo en `localStorage` (`hmi-theme-style`) y lo reaplica al iniciar (`applyThemeStyleOverrides()` en `main.tsx`). "Clásico" no escribe variables: usa los valores por defecto de `index.css`.
- **Marco (`--frame-*`):** `.glass-panel` y `.widget-state-*` leen radio, relleno, borde, desenfoque y remate de esquinas desde variables registradas con `@property`; cada una tiene su par `-rest` / `-hover` y la transición entre ambos es animada. Las variantes semánticas (`glass-panel-danger/-warning`, `widget-state-warning/-critical`) conservan sus colores de estado sobre cualquier tema.
- **Botones (`--button-*`):** `AdminActionButton`, `AdminIconToolbarButton`, `HmiButton`, `.admin-accent-ghost` y los selectores de período de los widgets usan la clase compartida `.theme-button` más una clase de color por variante. `--button-base-strength` conserva el color propio de cada variante (100 % en Clásico) o lo desvanece para que domine el contorno del tema (0 % en Contorno e Instrumento). Las acciones primarias y críticas mantienen su color semántico.
- **Tags (`--tag-*`):** `AdminTag` usa la clase compartida `.theme-tag` (radio, relleno `--tag-fill`, tinte del color propio del tag `--tag-tint` y fondo base según el estilo `--tag-base-background`: transparente en "glass"/"outline", superficie oscura en "flat") más el borde `--tag-border` mezclado con el color propio del tag (`--tc`, fijado por variante). Los tags son etiquetas estáticas sin estado hover. "muted" y "admin" fijan su propio `--tc` más un factor de escala (`--tag-fill-scale`/`--tag-border-scale`) para reproducir su proporción de hoy (10 % blanco y 20 %/30 % del acento admin) sin dejar de seguir el `--tag-fill`/`--tag-border` vivo del tema. Clásico y Contorno están fijados a 4 px/5 %/40 %/0 %/"outline"; Instrumento a 3 px/0 %/0 %/14 %/"flat"; cada variante de color mantiene su semántica en cualquier tema.
- **Remate de esquinas:** un `::after` enmascarado a las cuatro esquinas. Oculto significa opacidad 0, pero conserva su largo, grosor y color: son el punto de partida de la animación hacia el otro estado.
- **Reglas:** no hardcodear radios, bordes ni fondos de marco, botón o tag en componentes; usar las clases del tema. Para agregar un tema, sumar un preset al modelo y su tarjeta en la pestaña.
- **Diseño de temas nuevos:** el laboratorio de estilos (`tools/style-lab/`) permite probar combinaciones y copiar la elección para convertirla en preset.

## Forma del marco (Estándar / Pestaña)

Configuración general → Tema → "Forma del marco" elige entre **Estándar** (el marco redondeado de siempre, por defecto) y **Pestaña**: el título pasa a una pestaña translúcida (blanco al 15 %) al ras de la esquina superior izquierda, con su lado derecho recortado a 45°; el cuerpo no lleva chaflán por defecto (`--tab-frame-body-cut: 0px`, ajustable) y el ícono del header se coloca con la regla de más abajo. Toda la silueta (pestaña + cuerpo) es una sola forma con **todas** las esquinas redondeadas con el radio del tema (`--frame-radius-rest`): las dos esquinas libres de la pestaña, el empalme cóncavo donde la diagonal de la pestaña se une al borde superior del cuerpo, los dos vértices del corte del cuerpo (si lo hay; con corte 0 los dos vértices coinciden y se funden en uno, sin segmentos de largo cero ni arcos degenerados) y las esquinas inferiores. Es global (se combina con los tres temas: relleno, desenfoque y color del borde siguen saliendo de los `--frame-*` del tema activo) y no cambia el tamaño externo ni la posición del contenido (subtítulo, indicador, valor y pie).

- **Estado:** `services/frameShape.service.ts` (clave `hmi-frame-shape` en `localStorage`; solo se guarda el override, una instalación nueva es Estándar) y un store Zustand (`store/frameShape.store.ts`) que lee el hook `useFrameShape`; se refleja como `data-frame-shape` en `<html>`. Igual que un tema, elegirla previsualiza en vivo; Guardar persiste y Descartar o cerrar sin guardar restauran lo guardado. `main.tsx` la reaplica al arrancar.
- **Quién la aplica:** `components/ui/WidgetFrame.tsx` es la raíz enmarcada de los widgets del grid. La decisión vive en un solo lugar (`hooks/useTabFrameActive.ts`): forma Pestaña elegida + dentro de un grid de dashboard (`GridFrameScope`, que emiten `DashboardViewer` y `BuilderCanvas`) + tipo elegible (`supportsTabFrame` en `utils/widgetCapabilities.ts`) + con título. Los gráficos con selector de período en el header (`activity-analytics`, `prod-trend`, `prod-history`, `trend-chart`, `trend-chart-v2`) también son elegibles (ver "Gráficos con selector" más abajo). Conservan el marco estándar: widgets sin título, `status`, `text-title`, `connection-status`, `alert-history`, widgets del header y todo `.glass-panel` fuera del grid (diálogos, páginas, esqueletos).
- **DOM en modo Pestaña:** un envoltorio `.hmi-tab-frame` (tamaño externo de siempre) con hermanos: (solo con alerta) la capa de brillo `.hmi-tab-frame-glow`, la superficie pintada (`.hmi-tab-frame-surface`, las mismas clases de vidrio, sin borde ni sombra CSS, recortada a la silueta) que contiene la franja de relleno de la pestaña (`.hmi-tab-frame-fill`) y el trazo del borde (`.hmi-tab-frame-border`, un `<svg><path>`), el contenido (sin recorte, con el padding y los refs de siempre) y la pestaña (`.hmi-tab-frame-tab`), que recibe el título desde `WidgetHeader` mediante un portal. La regla base `.glass-panel` no cambia.
- **Un solo trazado para toda la silueta:** `clip-path: polygon()` no puede redondear esquinas, así que `utils/tabFramePath.ts` (`buildTabFramePath`) genera UN trazado SVG con arcos en todos los vértices (el empalme cóncavo con el sentido contrario; el radio se limita a la mitad del lado más corto). `WidgetFrame` lo calcula a partir de la caja medida (`hooks/useTabFrameGeometry.ts`: `ResizeObserver` + tokens `--tab-frame-*` + radio del marco; sin trabajo por fotograma) y lo aplica como `clip-path: path()` en línea a la superficie (el polígono de `index.css` es solo el respaldo hasta medir). El mismo trazado, con otro `inset`, se usa en el borde, el brillo, el anillo de selección/fantasmas del builder y el destello y contorno de la entrada del visor.
- **Borde:** el borde de reposo sigue **solo el cuerpo** (como la referencia: la pestaña no lleva borde). Es un trazo SVG del mismo trazado, al doble de grosor y centrado sobre el borde de la silueta (la superficie recortada se queda con la mitad interior), recortado con `inset(var(--tab-frame-height) 0 0 0)` para saltarse la franja de la pestaña.
- **Ícono del header:** conserva una distancia fija al borde derecho del widget (`--tab-frame-icon-right`, nunca lo sobrepasa). Su posición preferida es justo bajo la línea superior del cuerpo (alto de la pestaña + `--tab-frame-icon-gap`); si con el corte actual no cabe dentro del triángulo del corte (con la holgura `--tab-frame-icon-clearance` respecto de la diagonal), sube lo justo hacia la franja de la pestaña, sin pasar del borde superior del widget (`--tab-frame-icon-min-top`). Con corte 0 queda en la franja de la pestaña, a la derecha. `utils/tabFrameIcon.ts` (`resolveTabFrameIconPlacement`) lo calcula con los tokens (`hooks/useTabFrameIconPlacement.ts`), `WidgetFrame` publica `--tab-frame-icon-top` y `--tab-frame-icon-reserve` en el envoltorio y el header dibuja el ícono en `.hmi-tab-frame-icon-host` (portal), dejando en su fila un hueco invisible del mismo tamaño para que nada se mueva. Cuando el ícono ocupa la franja, la pestaña y su título truncado se detienen antes de él (`--tab-frame-icon-reserve` = ancho del ícono + distancia derecha + `--tab-frame-icon-tab-gap`, o el corte si es mayor).
- **Gráficos con selector (contenido `trailing` del header):** con la forma Pestaña, los cinco gráficos con `WidgetHeaderTemporalControls` toman la pestaña (alternativa B elegida en el laboratorio de estilo, 2026-09-30). El título (y el punto de modo) va en la pestaña, el ícono arriba a la derecha (aunque el header estándar lo lleve a la izquierda) y el `trailing` del header (el selector; en `trend-chart-v2` también "Back to preset") **sube a la franja superior**, a la derecha, centrado en la franja y **inmediatamente a la izquierda del ícono**. `WidgetHeader` lo lleva por portal a `.hmi-tab-frame-trailing-host` (primer hijo del envoltorio, así el teclado llega al selector antes que al gráfico; el anfitrión no captura el puntero, solo sus botones). Separación entre los elementos de la franja (pestaña, selector, ícono): `--tab-frame-trailing-gap` (15 px). El selector va a escala 100 % (unos 22,5 px de alto en la franja de 25 px) y usa SIEMPRE la variante `underline` en la franja: lo decide `WidgetHeaderTemporalControls` en un solo lugar (lee `TabFrameStripContext`, que `WidgetHeader` provee dentro del anfitrión), no cada gráfico; con Estándar cada gráfico conserva `pill`. La pestaña del título se detiene antes del selector: `useTabFrameStrip` mide el anfitrión y `utils/tabFrameTrailing.ts` calcula la reserva (desplazamiento derecho + ancho del anfitrión, que incluye el ícono y su hueco, + un hueco), publicada como `--tab-frame-tab-reserve` (más `--tab-frame-icon-strip-extent`). Si al rótulo del título le quedan menos de `--tab-frame-min-title` (12 px, regla del laboratorio) la pestaña se **oculta** (`data-tab-title-hidden`, `visibility: hidden`) y todas las capas que trazan la silueta coinciden: `TabFrameReporter` informa `TAB_FRAME_TITLE_HIDDEN` (`-1`; `0` sigue siendo "sin medir") y `buildTabFramePath` con `tabWidth` 0 arranca el cuerpo en la línea superior con la esquina superior izquierda convexa (superficie, borde, brillo, anillos y fantasmas del builder, destello y contorno de la entrada del visor). La fila del header deja de ocupar altura: solo conserva el hueco hasta la franja (`--tab-frame-header-clearance` = alto de la pestaña − padding − borde del contenido, medido) y el gráfico gana el resto (para estos widgets se relaja a propósito la regla "el contenido no se mueve"); un subtítulo, si lo hay, sigue debajo. Los widgets sin `trailing` (kpi, metric-card, info-card, group, machine-activity) no cambian.
- **Colores de la pestaña:** relleno `--tab-frame-fill` (blanco al 15 %). El título reutiliza el comportamiento del título estándar (blanco al 70 %, blanco pleno con el widget en hover, `transition-colors`) a través de `--tab-frame-text` / `--tab-frame-text-hover`, para afinarlo en un solo lugar. El punto de modo de dato conserva su significado (simulado apagado, real verde). En `metric-card` con `widget-state-warning/-critical` (`data-alert-state` en el envoltorio, sigue el estado en vivo) el relleno es el color del estado al 40 % (`--tab-frame-alert-fill-opacity`) y el título el color del estado al 100 %.
- **Brillo de alerta:** el `box-shadow` de `.widget-state-*` no sobrevive al recorte, así que vive en `.hmi-tab-frame-glow`, capa hermana DETRÁS de la superficie (un `filter` en un ancestro rompería el `backdrop-filter` del vidrio): la silueta crecida `--tab-frame-glow-spread`, desenfocada (`blur` 7 px = mitad del radio de 14 px del box-shadow; 9 px en hover) con el color del estado al 20 % (28 % en hover), y un recorte par-impar deja solo lo que queda fuera de la silueta. Aproximación: el crecimiento de hover (de 2 px a 3 px de expansión) se aproxima con más desenfoque y opacidad, sin cambiar el trazado.
- **Builder y entrada del visor siguen la forma:** el ancho de la pestaña depende del título, así que cada `WidgetFrame` en modo Pestaña lo informa desde el primer pase de layout (`TabFrameReporter`, `hooks/useTabFrameWidths.ts`; `0` = "forma Pestaña, ancho aún sin medir", `null` = forma Estándar) y `BuilderCanvas` y `DashboardViewer` lo entregan a las capas hermanas que no ven la pestaña. En el builder, el anillo de selección/hover de `GridSelectionFrame` y los fantasmas de ubicación trazan el `<path>` unificado en lugar del `<rect>` redondeado, y las acciones de hover quedan en el borde superior del widget, por encima de la pestaña (la misma posición que en la forma Estándar, sea cual sea el alto de la pestaña). En el visor, el destello se recorta con `clip-path: path()` en línea y el contorno traza un `<path pathLength="1">` con la misma regla animada que el `<rect>`. Un widget en forma Pestaña **nunca** muestra el rectángulo: mientras el ancho de la pestaña o la caja no están medidos, estas capas no dibujan nada. Sin pestaña (forma Estándar o widgets no elegibles) ambas capas son las de siempre. Los widgets del header nunca usan la forma Pestaña, por eso `HeaderSelectionFrame` no cambia.
- **Título con tamaño propio (widget `group`):** con la forma Pestaña, el título del `group` toma exactamente la tipografía del widget `text-title` (`--font-dashboard-title`, `--font-weight-dashboard-title`, `--tracking-dashboard-title`, tamaño en px, interlineado 1,1; `utils/dashboardTitleTypography.ts`), tal como se escribe (sin mayúsculas forzadas) y sin las opciones Alinear ni Color; relleno y color en reposo/hover son los de las demás pestañas. El tamaño (`displayOptions.titleFontSize`, control "Tamaño" en General, por defecto 30 = `DEFAULT_GROUP_TITLE_FONT_SIZE`; el widget `text-title` conserva 35) hace crecer la pestaña **hacia abajo**: alto = caja de línea del título + `--tab-frame-title-pad-y` por lado, nunca menos que `--tab-frame-height` (`utils/tabFrameHeight.ts`, `hooks/useTabFrameHeight.ts`). El tamaño externo del widget no cambia; la línea superior del cuerpo baja con la pestaña. `WidgetFrame` publica el alto efectivo como su propio `--tab-frame-height` (relleno, recorte del borde, pestaña y anfitrión del ícono lo siguen), la silueta y la regla del ícono lo usan, y lo informa junto al ancho (`TabFrameReporter(ancho, alto)`, `useTabFrameWidths().heights`) para las capas que están fuera del envoltorio y no ven ese token: anillos y fantasmas de `GridSelectionFrame`, y destello/contorno de la entrada del visor. El lado inclinado de la pestaña conserva SIEMPRE el ángulo de la pestaña estándar (recorte `--tab-frame-tab-cut` sobre alto `--tab-frame-height`): con una pestaña más alta el recorte efectivo es `--tab-frame-tab-cut` x alto efectivo / `--tab-frame-height` (`scaleTabFrameCut` en `utils/tabFrameHeight.ts`, ej. 19 x 47 / 25 = 35,72 px). `WidgetFrame` lo publica como su propio `--tab-frame-tab-cut` (la pestaña CSS y su relleno derecho lo siguen), la silueta usa el mismo valor y las capas de fuera del envoltorio (`useTabFrameGeometry`) lo derivan del alto informado, así todas coinciden; sin tamaño propio el recorte es el token (19 px). Con la forma Estándar el `group` se dibuja exactamente como siempre.
- **Estados:** el trazo del borde toma el borde del tema en reposo y hover, y el color de estado (2 px, 35 %/55 %) en `widget-state-warning/-critical`.

| Token | Valor inicial | Uso |
|-------|---------------|-----|
| `--tab-frame-height` | `25px` | Alto de la pestaña (franja sobre el cuerpo) |
| `--tab-frame-tab-cut` | `19px` | Recorte del lado derecho de la pestaña estándar (alto `--tab-frame-height`); una pestaña más alta lo escala para conservar el ángulo |
| `--tab-frame-body-cut` | `0px` | Chaflán de la esquina superior derecha del cuerpo (45°); 0 = sin chaflán |
| `--tab-frame-fill` | `color-mix(in srgb, #fff 15%, transparent)` | Relleno de la pestaña (blanco al 15 %) |
| `--tab-frame-alert-fill-opacity` | `40%` | Opacidad del relleno de la pestaña con el color del estado (warning/critical) |
| `--tab-frame-text` / `--tab-frame-text-hover` | `color-mix(in srgb, #fff 70%, transparent)` / `#fff` | Color del título de la pestaña en reposo y con el widget en hover (también el del punto simulado) |
| `--tab-frame-pad-start` / `--tab-frame-pad-end` | `0.625rem` / `0.3rem` | Relleno horizontal de la pestaña (el inicio deja el punto y el título más a la izquierda) |
| `--tab-frame-gap` | `0.375rem` | Separación entre el punto de modo de dato y el título |
| `--tab-frame-glow-blur` / `-hover` / `--tab-frame-glow-spread` | `7px` / `9px` / `2px` | Brillo de alerta: desenfoque en reposo y hover, y expansión de la silueta |
| `--tab-frame-icon-right` | `0px` | Distancia fija del ícono del header al borde derecho del widget (sin margen) |
| `--tab-frame-icon-gap` | `4px` | Separación preferida del ícono bajo la línea superior del cuerpo |
| `--tab-frame-icon-clearance` | `3px` | Holgura del ícono respecto de la diagonal del corte |
| `--tab-frame-icon-min-top` | `0px` | Tope superior del ícono (nunca sube más arriba del borde del widget; sin margen) |
| `--tab-frame-icon-tab-gap` | `8px` | Separación entre el final de la pestaña y el ícono cuando este ocupa la franja |
| `--tab-frame-icon-scale` | `0.9` | Escala del ícono hacia la esquina superior derecha (la regla de ubicación usa el tamaño escalado) |
| `--tab-frame-trailing-gap` | `15px` | Separación entre los elementos de la franja de un gráfico con selector: pestaña, selector (`trailing` del header) e ícono |
| `--tab-frame-min-title` | `12px` | Espacio mínimo para el rótulo del título; con menos, la pestaña del título se oculta |
| `--tab-frame-title-pad-y` | `4.25px` | Espacio vertical sobre y bajo un título con tamaño propio (widget `group`); la pestaña mide la caja de línea del título más este espacio por lado, nunca menos que `--tab-frame-height` (por defecto, el espacio de la pestaña estándar) |

La altura de la pestaña, el recorte, el chaflán del cuerpo, el relleno, el color del texto y los tokens del ícono son la elección del laboratorio de estilos del 2026-09-29 (con el marco de Instrumento: radio de 5 px); se afinan desde `index.css`.

## Entrada animada del visor

Al entrar a un dashboard o cambiar de vista, el visor arma la pantalla con movimiento: los marcos aparecen en orden aleatorio, los indicadores (barra y aro) se llenan hasta su valor y los gráficos SVG se revelan de izquierda a derecha. Es CSS puro, no retrasa ni condiciona la carga de datos, no se reproduce con el refresco periódico y queda desactivada con `prefers-reduced-motion`. Solo aplica bajo el marco del visor (`[data-viewer-entrance='true']`): el builder nunca anima.

Todos los tiempos viven en un único bloque `:root` de `hmi-app/src/index.css` para afinarlos en vivo:

| Token | Valor inicial | Uso |
|-------|---------------|-----|
| `--viewer-entrance-frame-duration` | `450ms` | Duración de la aparición de cada marco |
| `--viewer-entrance-spread` | `700ms` | Ventana aleatoria en la que arrancan los marcos (el grupo nunca después de sus miembros) |
| `--viewer-entrance-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | Curva compartida por marcos, indicadores y gráficos |
| `--viewer-entrance-value-duration` | `900ms` | Duración del llenado de indicadores y del revelado de gráficos |
| `--viewer-entrance-value-offset` | `150ms` | Espera del valor tras el arranque de su marco |
| `--viewer-entrance-ring-segment-fade` | `160ms` | Fundido de cada tramo del aro (el barrido completo dura `value-duration`) |
| `--viewer-entrance-flash-color` | `#ffffff` | Color del destello del fondo del marco |
| `--viewer-entrance-flash-peak` | `0.06` | Opacidad máxima del destello (sube rápido al pico y decae a 0). Ajustable desde Tema ("Intensidad del destello", 0–50 %) |
| `--viewer-entrance-flash-duration` | `650ms` | Duración total del destello |
| `--viewer-entrance-flash-offset` | `60ms` | Espera del destello tras el arranque de su marco |
| `--viewer-entrance-outline-color` | `#ffffff` | Color del contorno que se traza por el perímetro |
| `--viewer-entrance-outline-width` | `0.5px` | Grosor del contorno. Ajustable desde Tema ("Grosor del contorno", 0,5–3 px) |
| `--viewer-entrance-outline-opacity` | `0.4` | Opacidad pico de la línea animada del contorno (de donde parte su fundido; no es el borde en reposo del tema). Ajustable desde Tema ("Opacidad del contorno", 0–100 %) |
| `--viewer-entrance-outline-duration` | `700ms` | Duración del trazado del contorno |
| `--viewer-entrance-outline-fade` | `350ms` | Fundido del contorno al terminar de trazarse |
| `--viewer-entrance-outline-offset` | `0ms` | Espera del trazado tras el arranque de su marco |
| `--viewer-entrance-count-duration` | `900ms` | Duración del conteo ascendente del valor principal (lo lee también JS) |

**Destello y contorno de marco.** Son dos capas decorativas (`ViewerEntranceFrameOverlays`, solo bajo el visor) dentro de la superficie de cada item, hermanas del widget y no parte de ningún renderer: no chocan con `.glass-panel::after` (remate de esquinas) ni con `.glass-panel-group::before` (fondo del grupo) y usan el mismo inset de superficie (`resolveWidgetSurfaceInset`) y el radio `--frame-radius-rest` del tema. El destello es una capa con gradiente del color del token cuya opacidad sube al pico y decae; el contorno es un `<rect pathLength="1">` cuyo `stroke-dashoffset` va de 1 a 0 (sirve para cualquier tamaño) y luego se desvanece sobre el borde propio del tema (en Instrumento, sin borde, se traza y desaparece). Ninguna anima los `--frame-*` (llevan las transiciones de hover), así que se ven igual en Clásico, Contorno e Instrumento. Los widgets sin marco (`text-title`) no las reciben. `rx`/`ry` del `<rect>` se resuelven por CSS (`rx: var(--frame-radius-rest)`) para no hardcodear el radio.

**Ajuste desde Tema.** Configuración general → Tema → "Animación de entrada" expone tres deslizadores (`DockSliderField`: deslizador + campo numérico con flechas y teclas ↑/↓, con unidad): grosor del contorno, opacidad del contorno e intensidad del destello. Son globales (valen para todos los temas). Siguen la regla del resto de la configuración visual: el código (`index.css` y `DEFAULT_VIEWER_ENTRANCE_SETTINGS`) es la fuente de verdad y solo se guardan los overrides, en `localStorage` bajo `hmi-viewer-entrance` (`services/viewerEntranceStyle.service.ts`); una instalación nueva muestra los valores iniciales de la tabla. Mover un deslizador previsualiza en el documento (tokens `--viewer-entrance-*` en `:root`, el CSS sigue siendo el único consumidor), Guardar persiste y Descartar o cerrar sin guardar restauran lo guardado. `main.tsx` reaplica los overrides al arrancar. Para ver el efecto, cambie de dashboard o de vista en el visor.

**Conteo ascendente.** El valor principal de `kpi`, `metric-card` y `machine-activity` sube desde cero hasta su valor conservando el formato propio de cada widget (decimales y unidad). Es solo del visor: `DashboardViewer` entrega el orden de escalonado de cada item mediante `ViewerEntranceContext` y el hook `useViewerEntranceCountUp` (`hooks/`) devuelve un progreso 0..1 que el widget aplica solo al texto (`resolveViewerCountUpValue`, que redondea a los decimales del valor final y devuelve el valor exacto al terminar); los indicadores y los tweens propios de cada widget no se tocan. Los tiempos no se duplican: el hook lee `spread`, `value-offset`, `count-duration` y la curva `--viewer-entrance-ease` (solo `cubic-bezier()`; cualquier otro valor da una curva lineal) de los mismos tokens `--viewer-entrance-*` (`getComputedStyle` sobre `:root`), de modo que el conteo arranca junto con el llenado del indicador y sigue su misma curva. Es de una sola vez por montaje: el visor remonta la grilla en cada entrada (`entranceKey`) y un refresco de datos conserva el montaje, por lo que nunca se reproduce de nuevo. Si el primer valor llega dentro de la ventana de entrada, cuenta desde su llegada; si llega después, se muestra directo. Sin proveedor (builder, otras pantallas), con `prefers-reduced-motion` o sin tokens legibles, el valor se muestra directo.

La repetición por entrada se controla con `entranceKey` de `DashboardViewer` (`buildViewerEntranceKey`: id de dashboard + id de vista); el orden aleatorio se calcula una vez por clave (`utils/viewerEntrance.ts`).

## Convención para widgets nuevos

Ver guía completa: [`hmi-app/src/widgets/WIDGET_AUTHORING.md`](../hmi-app/src/widgets/WIDGET_AUTHORING.md)

## Convenciones del modo admin (paneles, context bar, rails, widgets)

Ver guía completa: [`hmi-app/src/components/admin/ADMIN_CONVENTIONS.md`](../hmi-app/src/components/admin/ADMIN_CONVENTIONS.md)

## Fuentes

| Token           | Uso                                              |
|-----------------|--------------------------------------------------|
| `--font-sans`   | Texto de interfaz, labels, tags, UI general      |
| `--font-mono`   | Datos, números, telemetría, IDs técnicos         |
| `--font-chart`  | Texto dentro de charts SVG (ejes, ticks, labels) |

> La familia tipográfica concreta de cada token se define en `@font-face` + `@theme {}` de `hmi-app/src/index.css`.
> Nunca referenciar nombres de fuente directamente en componentes — usar siempre los tokens via clases Tailwind (`font-sans`, `font-mono`).
> Las fuentes serán configurables dinámicamente desde el panel admin en el futuro.

## Íconos

**Solo Lucide React.** No importar de otras librerías de íconos.
