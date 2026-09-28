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
- **Tags (`--tag-*`):** `AdminTag` usa la clase compartida `.theme-tag` (radio, relleno blanco `--tag-fill`, tinte del color propio del tag `--tag-tint` y fondo base según el estilo `--tag-base-background`: transparente en "glass"/"outline", superficie oscura en "flat") más el borde `--tag-border` mezclado con el color propio del tag (`--tc`, fijado por variante en `AdminTag.tsx`). Los tags son etiquetas estáticas sin estado hover. Clásico y Contorno están fijados a 4 px/5 %/40 %/0 %/"glass"; Instrumento a 3 px/0 %/0 %/14 %/"flat"; cada variante de color mantiene su semántica en cualquier tema.
- **Remate de esquinas:** un `::after` enmascarado a las cuatro esquinas. Oculto significa opacidad 0, pero conserva su largo, grosor y color: son el punto de partida de la animación hacia el otro estado.
- **Reglas:** no hardcodear radios, bordes ni fondos de marco, botón o tag en componentes; usar las clases del tema. Para agregar un tema, sumar un preset al modelo y su tarjeta en la pestaña.
- **Diseño de temas nuevos:** el laboratorio de estilos (`tools/style-lab/`) permite probar combinaciones y copiar la elección para convertirla en preset.

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
