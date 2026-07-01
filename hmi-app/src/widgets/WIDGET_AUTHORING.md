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

El panel de propiedades debe ser compacto, legible y consistente. Su estructura se compone de secciones colapsables (`DockSection`), filas de propiedad (`DockFieldRow`), controles reutilizables y ayudas contextuales (`DockInfoBox`). No debe parecer un panel dentro de otro panel.

- Dentro de una sección colapsable (`DockSection`), no crear contenedores visuales anidados para resumir o agrupar información.
- Dentro de una sección colapsable, solo el título de la sección puede usar mayúsculas sostenidas.
- Los labels internos de filas de propiedad (`DockFieldRow`) usan capitalización normal: primera letra en mayúscula y el resto en minúscula cuando corresponda.
  - Correcto: `Incluido`, `Excluido`, `Color inicial`, `Alfa (%)`
  - Incorrecto: `incluido`, `INCLUIDO`, `COLOR INICIAL`
- La tipografía del panel de propiedades se toma únicamente de las primitives/clases compartidas del panel (`DockFieldRow`, `DockInfoBox`, `ADMIN_SIDEBAR_LABEL_CLS`, `ADMIN_SIDEBAR_INPUT_CLS`, etc.). No ajustar tamaño, peso, tracking, interlineado o familia tipográfica localmente para “hacer entrar” contenido.
- No usar clases tipográficas ad-hoc dentro del panel (`text-sm`, `text-xs`, `text-[...]`, `font-*`, `tracking-*`, `leading-*`, etc.) para labels, resúmenes o ayudas.
- Evitar información excesiva, repetida o decorativa: mostrar solo lo necesario para configurar o entender el valor actual.
- Si hace falta una leyenda aclaratoria, usar `components/admin/DockInfoBox.tsx`; no crear avisos locales.
  - Mantener el estilo visual del patrón: contenedor `border-white/5 bg-white/5` y texto `text-industrial-muted` para leyendas normales.
  - El ícono puede variar según el contenido de la leyenda, o puede omitirse si la leyenda no lo necesita.
  - Espaciado canónico: `flex items-start gap-2 rounded border px-2 py-1.5`, con el ícono `mt-0.5 shrink-0`.
  - Usar este patrón para ayuda contextual breve, como el bloque de la sección `NAVEGACIÓN`.
- Cuando un label tiene un selector (`AdminSelect`) a la derecha, el label debe tener como máximo 9 caracteres. Si excede ese largo, abreviarlo sin perder sentido.
- La información secundaria, listas de detalle o auditoría debe ir compactada detrás de controles reutilizables: `AdminSelect` cuando se elige una opción, o una primitive equivalente de expansión de detalle cuando solo se muestra información.
- No mostrar listas completas abiertas por defecto dentro de una sección colapsable.
- Para selectores/dropdowns de opciones del panel admin, priorizar `AdminSelect`. Si el caso no es selección sino expansión de detalle, crear o reutilizar una primitive equivalente del panel antes de inventar marcado local.
- Si una corrección necesaria para cumplir estas reglas puede cambiar semántica visible o datos guardados —por ejemplo renombrar el título de un widget—, no asumir. Preguntar al usuario y esperar confirmación antes de modificar.
- Los títulos visibles del widget deben quedar en una sola línea. Usar como referencia máxima 17 caracteres y separar palabras con guion (`-`) cuando sea necesario abreviar.
- Si una sección colapsable queda demasiado larga, dividirla en secciones colapsables específicas en vez de crear una única sección gigante.
  - Ejemplos: `COLORES PRODUCCION`, `COLORES SETUP`, `COLORES DETENIDA`, `COBERTURA SIN DATOS`, `BANDAS TENDENCIA % PROD`, `BARRAS AGRUPADAS`, `DONUT`.
- Si un control horizontal se superpone con su label, mover el control debajo y permitir que ocupe todo el ancho útil de la sección.
- Evitar espacios vacíos dentro de una fila. Ordenar controles para aprovechar la línea completa.
- Los subtítulos internos excepcionales pueden usar color blanco, pero deben conservar la tipografía y tamaño estándar del panel.
- Los campos internos no pueden superar el ancho estándar de un control de `DockFieldRow`: label `w-14` + control `flex-1`. Pueden ser menores, nunca mayores.
- Para configuración de color, usar una estructura plana:
  - label del color, por ejemplo `Color inicial`
  - primera línea: swatch/cuadrado de color sin tarjeta, marco ni contenedor visual adicional + texto `Hex #` + campo de código
  - el campo de código contiene solo el valor hexadecimal, sin `#`
  - segunda línea: `Alfa (%)` + campo numérico
- No usar cajas, tarjetas o bloques internos para cada color si la sección colapsable padre ya define el contexto visual.

#### Primitives recomendadas para paneles de propiedades

Estas reglas deben cristalizarse en primitives reutilizables siempre que el patrón se repita. No resolver cada widget con marcado local si existe o corresponde crear una primitive compartida.

- `DockInfoBox` — ayuda contextual o leyenda aclaratoria breve. Ya existe en `components/admin/DockInfoBox.tsx`.
- `DockDetailDisclosure` — detalle expandible, listas secundarias o auditoría compactada detrás de una expansión. Crear/reutilizar antes de mostrar listas abiertas por defecto.
- `DockColorField` — edición de color con layout canónico: swatch + `Hex #` + campo, y debajo `Alfa (%)` + campo numérico.
- `DockInlineControlRow` — fila interna compacta para casos donde una propiedad necesita varios controles alineados sin exceder el ancho estándar de `DockFieldRow`.

Si una primitive requerida todavía no existe, crearla en `components/admin/` antes de corregir múltiples widgets con el mismo patrón.

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
