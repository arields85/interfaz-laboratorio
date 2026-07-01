# Convención de creación de widgets

> Esta guía existe para que **todo widget nuevo** salga consistente con el sistema actual desde el día 1.

## Objetivo

Todo widget nuevo debe:
- verse consistente en grid y header
- reutilizar primitives compartidos
- respetar `subtitle` vs `subtext`
- integrarse al builder sin affordances paralelas

## Checklist obligatorio

### Shell visual
- Usar `glass-panel` como superficie base del widget.
- No inventar otro radio ni otra materialidad.
- No hardcodear colores ni fuentes.
- Usar siempre `hmi-scrollbar` en cualquier contenedor scrolleable del widget o de su UI asociada.
- Incluir la clase `group` en el contenedor `glass-panel` para que las utilidades `group-hover:*` de `WidgetHeader` funcionen (transición de opacidad del ícono, transición de color del título).
- `glass-panel` usa `isolation: isolate` como stacking context. Los hijos directos NO reciben `position: relative` forzado — las utilidades de Tailwind como `absolute` funcionan normalmente en hijos directos.

### Header
- Si el widget tiene encabezado, usar `components/ui/WidgetHeader.tsx`.
- `subtitle` = texto secundario del header.
- `subtext` = texto inferior/footer del widget.
- Usar `WidgetHeader` con alineación estándar (default). No pasar `alignment` salvo excepción justificada.
- No usar wrappers con `-translate-y-*` alrededor del header ni offsets ad-hoc por renderer.
- No duplicar la lógica de header dentro del renderer.
- `WidgetHeader` soporta `iconPosition?: 'left' | 'right'` (default: `'right'`). Usar `'left'` cuando el ícono debe preceder al título (ej. widgets de chart con controles overlay a la derecha).
- El título se lee de `widget.title` (campo que escribe el PropertyDock). El renderer debe usar `widget.title ?? displayOptions?.chartTitle ?? 'Título Default'`.
- Los títulos largos se truncan automáticamente con puntos suspensivos gracias a `grid-cols-[minmax(0,1fr)]` en el grid del header.
- El comportamiento hover está integrado en `WidgetHeader`: el ícono transiciona `opacity-70 → opacity-100`, el título transiciona `text-industrial-muted → text-white`. Requiere la clase `group` en el `glass-panel` ancestro.

### Layout (elegir patrón explícito)
- **Patrón A — flujo natural (`header + body + footer`)**:
  - Usar cuando el contenido debe empezar debajo del header.
  - Ejemplo: listas, tablas, charts con eje temporal, layouts con footer fijo.
- **Patrón B — centrado óptico en superficie completa**:
  - Usar cuando el contenido principal debe quedar centrado respecto de TODO el widget (alto/ancho completos), no del espacio restante bajo el header.
  - Usar `components/ui/WidgetCenteredContentLayout.tsx`.
  - Ejemplo típico: indicador central (badge/estado/gauge puntual) con header informativo arriba.
- **Patrón C — overlay controls (controles locales flotantes)**:
  - Usar cuando el widget tiene controles interactivos (selectores, toggles) que deben flotar sobre el header sin participar de su layout.
  - Los controles se posicionan con `absolute right-5 top-5 z-10` como hijo directo del `glass-panel`.
  - El `WidgetHeader` NO debe usar `trailing` para controles multi-fila; usar overlay en su lugar.
  - Ejemplo: `prod-history` con selector de bucket + toggle OEE como overlay.

### Acciones y selección
- El widget en grid debe convivir con:
  - `GridSelectionFrame`
  - `WidgetHoverActions`
- Si el widget puede ir al header, debe convivir con:
  - `HeaderSelectionFrame`
  - `HeaderWidgetCanvas`
- No crear overlays, focus rings ni botones hover propios.

### Integración
- Registrar el renderer en `widgets/WidgetRenderer.tsx`.
- Tipar `displayOptions` en `domain/admin.types.ts`.
- Todo widget nuevo hereda `navigationTargetDashboardId` desde `WidgetConfigBase`; no redeclararlo por tipo.
- Si el widget tiene propiedades configurables, exponerlas en:
  - `components/admin/PropertiesPanel.tsx`
  - `components/admin/PropertyDock.tsx`
- La UI lateral de configuración debe reutilizar `components/admin/adminSidebarStyles.ts` para mantener el look industrial del `PropertyDock`.
- No implementar lógica de navegación dashboard-a-dashboard dentro del renderer: `WidgetRenderer`/`HeaderWidgetCanvas` la resuelven en viewer y el bloque `Navegación` debe quedar al final del panel.
- Si aplica al header, declarar explícitamente su compatibilidad con las reglas del header.

### Panel de propiedades del widget

El panel de propiedades debe ser compacto, legible y consistente. No debe parecer un panel dentro de otro panel.

- Dentro de un grupo/desplegable, no crear contenedores visuales anidados para resumir o agrupar información.
- La única tipografía en mayúsculas dentro del bloque debe ser el título del grupo/desplegable.
- El contenido interno usa minúsculas y la tipografía estándar del panel de propiedades.
- Evitar información excesiva, repetida o decorativa: mostrar solo lo necesario para configurar o entender el valor actual.
- Cuando un label tiene un desplegable a la derecha, el label debe tener como máximo 9 caracteres. Si excede ese largo, abreviarlo sin perder sentido.
- Los títulos visibles del widget deben quedar en una sola línea. Usar como referencia máxima 17 caracteres y separar palabras con guion (`-`) cuando sea necesario abreviar.
- Si un control horizontal se superpone con su label, mover el control debajo y permitir que ocupe todo el ancho útil del grupo.
- Los subtítulos internos excepcionales pueden usar color blanco, pero deben conservar la tipografía y tamaño estándar del panel.
- Para configuración de color, usar una estructura plana:
  - label del color, por ejemplo `color inicial`
  - swatch/cuadro de color
  - texto `hex #` junto al campo de código
  - el campo de código contiene solo el valor hexadecimal, sin `#`
  - campo de `alfa (%)` separado y explícito
- No usar cajas, tarjetas o bloques internos para cada color si el grupo/desplegable padre ya define el contexto visual.

### Diseño y semántica
- Usar tokens de `index.css`.
- Usar solo íconos de Lucide React.
- Toda tipografía interna del widget debe consumir las categorías configurables del Builder (`Textos en general`, `Textos técnicos`, `Textos widget gráficos`, `Títulos de dashboard`, `Valores numéricos...`) mediante los CSS vars canónicos (`--font-*`, `--font-size-*`, `--font-weight-*`, `--tracking-*`). No hardcodear utilidades tipográficas como `text-xs`, `text-sm`, `text-lg`, `font-*`, tamaños, pesos ni tracking cuando ese texto deba responder al panel Design. Las utilidades semánticas de color de texto (por ejemplo `text-industrial-muted`) sí pueden usarse cuando corresponden al sistema de diseño.
- Mantener separados:
  - `EquipmentStatus`
  - `ConnectionState`
  - `MetricStatus`

## Prohibido

- Inventar un header custom si `WidgetHeader` resuelve el caso.
- Crear un focus frame específico del widget.
- Crear acciones hover específicas del widget si `WidgetHoverActions` cubre el patrón.
- Mezclar `subtitle` con `subtext`.
- Duplicar tipos fuera de `domain/`.
- Resolver centrado óptico con hacks ad-hoc por widget cuando existe `WidgetCenteredContentLayout`.
- Resolver alineación vertical de header no-KPI con wrappers locales u offsets mágicos.
- Aplicar parches globales para corregir un problema local del widget.
- Hardcodear copy de estados cuando ese copy deba ser configurable vía `displayOptions`.
- Usar scrollbars genéricos o `custom-scrollbar` en contenedores scrolleables.
- Usar un ancho hardcodeado para calcular posiciones de tooltip cuando `translateX(-100%)` o medición dinámica resuelven para cualquier contenido.
- Reimplementar hover/tooltip inline en un widget chart cuando existen `ChartHoverLayer` y `ChartTooltip` como primitives.
- Usar Recharts para tooltip o hover en widgets que consumen primitives SVG propias del proyecto.

## Regla de ownership de layout (anti-parche)

- Si un ajuste visual afecta solo un bloque (ej. título+estado), centrar/espaciar **ese bloque interno**, no todo el contenedor del card.
- Si el problema es de jerarquía de composición, resolverlo en la primitive responsable (`WidgetHeader`, `WidgetCenteredContentLayout`, `HeaderWidgetCanvas`, etc.), no con offsets arbitrarios en capas superiores.
- Priorizar cambios locales, semánticos y reversibles sobre workarounds globales.

## Flujo recomendado

1. Copiar el template base `/.agent/skills/interfaz-widget/assets/NewWidgetTemplate.tsx`
2. Adaptar el contenido del renderer
3. Tipar `displayOptions`
4. Registrar el renderer en `WidgetRenderer.tsx`
5. Exponer propiedades en admin si corresponde
6. Verificar visualmente grid + header si aplica

## Primitives canónicas

- `hmi-app/src/components/ui/WidgetHeader.tsx`
- `hmi-app/src/components/ui/WidgetCenteredContentLayout.tsx`
- `hmi-app/src/components/ui/WidgetHoverActions.tsx`
- `hmi-app/src/components/ui/GridSelectionFrame.tsx`
- `hmi-app/src/components/ui/HeaderSelectionFrame.tsx`
- `hmi-app/src/components/ui/AnchoredOverlay.tsx` — menús flotantes / dropdowns / popovers
- `hmi-app/src/widgets/WidgetRenderer.tsx`
- `hmi-app/src/components/ui/ChartTooltip.tsx` — tooltip panel compartido para widgets con charts. Posicionamiento automático con flip.
- `hmi-app/src/components/ui/ChartHoverLayer.tsx` — capa SVG de interacción hover para charts (hit areas + línea vertical + highlight dots).
- `hmi-app/src/utils/chartHelpers.ts` — funciones matemáticas compartidas para SVG charts (`smoothPath`, `buildAreaPath`, `formatTick`, `clamp`, `round2`).

## Menús flotantes / overlays contextuales

**Regla**: Todo menú desplegable, dropdown o popover anclado a un elemento debe usar `AnchoredOverlay`.

`AnchoredOverlay` encapsula:
- `createPortal` → escapa cualquier `overflow:hidden` o stacking context
- Posicionamiento `fixed` inteligente (arriba/abajo según espacio disponible)
- Cierre por click afuera y por `Escape`

**Prohibido** reimplementar portal + posicionamiento ad-hoc fuera de esta primitive.

```tsx
// Uso canónico:
<AnchoredOverlay
    triggerRef={myButtonRef}   // RefObject<HTMLElement>
    isOpen={open}
    onClose={() => setOpen(false)}
    estimatedHeight={180}      // altura estimada del contenido
    minWidth={200}             // o 'trigger' para heredar ancho del anchor
    align="start"              // 'start' | 'end' | 'center'
    gap={4}
>
    <div style={{ background: 'var(--color-industrial-surface)' }}>
        {/* contenido del overlay */}
    </div>
</AnchoredOverlay>
```

Componentes que ya usan esta primitive:
- `AdminSelect` — dropdown de opciones en panel admin
- `HeaderSlotContextMenu` — menú del `+` en el canvas de header
