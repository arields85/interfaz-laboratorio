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

- **Modelo:** `hmi-app/src/domain/themeStyle.types.ts`. Temas incorporados: `classic` ("Clásico", el aspecto original), `outline` ("Contorno") e `instrument` ("Instrumento", vidrio sobrio con esquinas apenas redondeadas).
- **Aplicación:** `hmi-app/src/services/themeStyle.service.ts` convierte el tema en variables CSS sobre `document.documentElement`, persiste el tema activo en `localStorage` (`hmi-theme-style`) y lo reaplica al iniciar (`applyThemeStyleOverrides()` en `main.tsx`). "Clásico" no escribe variables: usa los valores por defecto de `index.css`.
- **Marco (`--frame-*`):** `.glass-panel` y `.widget-state-*` leen radio, relleno, borde, desenfoque y remate de esquinas desde variables registradas con `@property`; cada una tiene su par `-rest` / `-hover` y la transición entre ambos es animada. Las variantes semánticas (`glass-panel-danger/-warning`, `widget-state-warning/-critical`) conservan sus colores de estado sobre cualquier tema.
- **Botones (`--button-*`):** `AdminActionButton`, `AdminIconToolbarButton`, `HmiButton`, `.admin-accent-ghost` y los selectores de período de los widgets usan la clase compartida `.theme-button` más una clase de color por variante. `--button-base-strength` conserva el color propio de cada variante (100 % en Clásico) o lo desvanece para que domine el contorno del tema (0 % en Contorno e Instrumento). Las acciones primarias y críticas mantienen su color semántico.
- **Tags (`--tag-*`):** `AdminTag` usa la clase compartida `.theme-tag` (radio, relleno `--tag-fill`, tinte del color propio del tag `--tag-tint` y fondo base según el estilo `--tag-base-background`: transparente en "glass"/"outline", superficie oscura en "flat") más el borde `--tag-border` mezclado con el color propio del tag (`--tc`, fijado por variante). Los tags son etiquetas estáticas sin estado hover. "muted" y "admin" fijan su propio `--tc` más un factor de escala (`--tag-fill-scale`/`--tag-border-scale`) para reproducir su proporción de hoy (10 % blanco y 20 %/30 % del acento admin) sin dejar de seguir el `--tag-fill`/`--tag-border` vivo del tema. Clásico y Contorno están fijados a 4 px/5 %/40 %/0 %/"outline"; Instrumento a 3 px/0 %/0 %/14 %/"flat"; cada variante de color mantiene su semántica en cualquier tema.
- **Remate de esquinas:** un `::after` enmascarado a las cuatro esquinas. Oculto significa opacidad 0, pero conserva su largo, grosor y color: son el punto de partida de la animación hacia el otro estado.
- **Reglas:** no hardcodear radios, bordes ni fondos de marco, botón o tag en componentes; usar las clases del tema. Para agregar un tema, sumar un preset al modelo y su tarjeta en la pestaña.
- **Diseño de temas nuevos:** el laboratorio de estilos (`tools/style-lab/`) permite probar combinaciones y copiar la elección para convertirla en preset.

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
| `--viewer-entrance-flash-peak` | `0.16` | Opacidad máxima del destello (sube rápido al pico y decae a 0) |
| `--viewer-entrance-flash-duration` | `650ms` | Duración total del destello |
| `--viewer-entrance-flash-offset` | `60ms` | Espera del destello tras el arranque de su marco |
| `--viewer-entrance-outline-color` | `#ffffff` | Color del contorno que se traza por el perímetro |
| `--viewer-entrance-outline-width` | `1px` | Grosor del contorno |
| `--viewer-entrance-outline-duration` | `700ms` | Duración del trazado del contorno |
| `--viewer-entrance-outline-fade` | `350ms` | Fundido del contorno al terminar de trazarse |
| `--viewer-entrance-outline-offset` | `0ms` | Espera del trazado tras el arranque de su marco |
| `--viewer-entrance-count-duration` | `900ms` | Duración del conteo ascendente del valor principal (lo lee también JS) |

**Destello y contorno de marco.** Son dos capas decorativas (`ViewerEntranceFrameOverlays`, solo bajo el visor) dentro de la superficie de cada item, hermanas del widget y no parte de ningún renderer: no chocan con `.glass-panel::after` (remate de esquinas) ni con `.glass-panel-group::before` (fondo del grupo) y usan el mismo inset de superficie (`resolveWidgetSurfaceInset`) y el radio `--frame-radius-rest` del tema. El destello es una capa con gradiente del color del token cuya opacidad sube al pico y decae; el contorno es un `<rect pathLength="1">` cuyo `stroke-dashoffset` va de 1 a 0 (sirve para cualquier tamaño) y luego se desvanece sobre el borde propio del tema (en Instrumento, sin borde, se traza y desaparece). Ninguna anima los `--frame-*` (llevan las transiciones de hover), así que se ven igual en Clásico, Contorno e Instrumento. Los widgets sin marco (`text-title`) no las reciben. `rx`/`ry` del `<rect>` se resuelven por CSS (`rx: var(--frame-radius-rest)`) para no hardcodear el radio.

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
