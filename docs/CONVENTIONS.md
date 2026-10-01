# Convenciones de Código — Interfaz-Laboratorio

> **TL;DR**: TypeScript estricto, cero `any`. Cero parches ad-hoc — resolver en la capa correcta. Cero valores hardcodeados cuando existen tokens, primitives o medición runtime disponible. La regla mental: si el valor *podría ser distinto* con otro contenido o contexto, medilo o calculalo, no lo hardcodees.

> ← Volver a [`AGENTS.md`](../AGENTS.md)

---

- **TypeScript estricto**: `strict: true` en tsconfig. **Cero `any`** sin justificación documentada.
- **Tipos en `domain/`**: Los tipos de negocio viven exclusivamente ahí. Nunca duplicar tipos inline en componentes.
- **Niveles de componentes** (de más genérico a más específico):
  1. `components/ui/` — Base UI reutilizable (átomos sin lógica de dominio)
  2. `components/viewer/` o `components/admin/` — Componentes industriales de dominio compartido
  3. `widgets/` — Composites de métricas y datos
  4. `pages/` — Composiciones de página, no reutilizables
- **Exports de barrel** via `index.ts` en los módulos que lo requieran.
- **Hooks custom** para lógica compleja en componentes. No lógica async directa en componentes.
- Los servicios de almacenamiento admin usan `localStorage` como capa mock; no asumir persistencia real.
- Para matching jerárquico, `catalogVariableId` reemplaza a `variableKey` como identidad canónica del binding.
- Las capacidades por tipo de widget se registran en `hmi-app/src/utils/widgetCapabilities.ts`; no hardcodear reglas dispersas por widget.

## Registro del texto visible al usuario (obligatorio)

Todo texto en español visible para el usuario se escribe tratando de **usted**, nunca con voseo ni tuteo. Aplica a la HMI (etiquetas, mensajes, placeholders, tooltips, `aria-label`, errores), a los mensajes fijos de Leda (bot de Telegram, respuestas predefinidas) y a las instrucciones de estilo que se entregan a modelos de lenguaje.

- Correcto: «Ingrese su usuario», «Reinicie el lanzador», «Puede consultar…».
- Incorrecto: «Ingresá tu usuario», «Reiniciá el lanzador», «Podés consultar…», «Ingresa tu usuario».
- Preferir formas impersonales cuando alcanzan: «No se pudo iniciar Leda».
- Los tests que buscan por texto o nombre accesible usan el mismo registro.

## Política anti-parches (obligatoria)

- **CERO parches ad-hoc**: no aplicar fixes globales para resolver un problema local si existe un bloque/primitive responsable de ese layout o comportamiento.
- **Resolver en la capa correcta**:
  - layout general → contenedor/layout
  - composición del widget → bloque interno del widget
  - estilo semántico → token del sistema
- Antes de tocar código visual: identificar **causa raíz** y dejar el ajuste en el nodo responsable (no en un wrapper genérico por conveniencia).
- Si por compatibilidad temporal se requiere workaround, debe quedar **documentado con TODO + motivo + plan de remoción**.

## Política de hardcode (obligatoria)

- No hardcodear valores visuales/semánticos cuando exista token, primitive o contrato de dominio.
- Colores y fuentes: siempre vía `@theme` (`hmi-app/src/index.css`).
- Labels de estado y copy configurable: siempre vía `displayOptions` tipadas (no strings mágicos dispersos).
- Scrollbars: usar siempre `hmi-scrollbar` en cualquier contenedor scrolleable. Prohibido usar scrollbars genéricos o `custom-scrollbar`.

## Política anti-hardcode dimensional (obligatoria)

- **CERO valores hardcodeados** para dimensiones, anchos, posiciones o cálculos que dependan del contenido o del contexto de renderizado.
- Si un valor depende del **contenido** (ej. ancho de un texto, alto de un bloque dinámico): medirlo en runtime (`canvas.measureText()`, `getBoundingClientRect()`, `ResizeObserver`, `translateX(-100%)`, etc.).
- Si un valor depende del **container** (ej. cuántas labels caben en el eje X): calcularlo a partir del ancho real disponible, no de una estimación fija.
- Los únicos hardcodes dimensionales permitidos son:
  - **Tokens del sistema de diseño** (`p-5`, `gap-2`, `text-[10px]`) — son constantes de diseño intencionadas.
  - **Valores estructurales fijos por definición** (ej. `radius = 60` de un SVG con `viewBox` fijo, `margin = { top: 10, ... }` de un chart).
  - **Valores temporales de testing** documentados con `// TODO: reemplazar por medición dinámica`.
- **Casos de referencia que violan esta regla y cómo se resolvieron:**
  - `tooltipWidth = 160` → reemplazado por `transform: translateX(-100%)` que usa el ancho real renderizado.
  - `estimatedLabelWidth = 38` → reemplazado por `canvas.measureText()` que mide el ancho exacto de cada string.
  - `.glass-panel > * { position: relative }` → reemplazado por `isolation: isolate` que crea stacking context sin pisar propiedades de los hijos.
- **Regla mental**: si el valor que estás hardcodeando *podría ser distinto* con otro contenido, otro idioma, o otro tamaño de container, entonces **no lo hardcodees — medilo o calculalo**.
