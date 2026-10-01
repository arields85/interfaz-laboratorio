# Admin Conventions — Interfaz-Laboratorio

> Convenciones operativas para crear y mantener páginas, paneles y componentes del modo administrador.
> Leé este archivo completo antes de tocar cualquier cosa bajo `/admin`.

---

## 1. Esqueleto obligatorio de toda página admin

Toda página nueva bajo `/admin` DEBE usar `AdminWorkspaceLayout` (`hmi-app/src/components/admin/AdminWorkspaceLayout.tsx`) como shell. Este componente implementa los 4 bloques fundamentales de la interfaz admin:

```
┌─────────────────────────────────────────────────────┐
│  1. CONTEXT BAR  │ zona rail │ zona panel │ zona main │  ← contextBar / contextBarPanel
├──────┬───────────┬───────────────────────────────────┤
│      │           │                                   │
│  2.  │    3.     │           4. MAIN                 │
│ RAIL │   PANEL   │      (área de contenido)          │
│      │           │                                   │
└──────┴───────────┴───────────────────────────────────┘
```

| Zona | Prop de `AdminWorkspaceLayout` | Descripción |
|------|-------------------------------|-------------|
| 1. Context bar | `contextBar` (zona main) + `contextBarPanel` (zona panel) | Barra superior con breadcrumb, acciones y búsqueda |
| 2. Rail | `rail` | Columna estrecha de íconos de acción. Sin líneas divisorias. |
| 3. Panel | `sidePanel` | Panel lateral de configuración o exploración (árbol, lista, templates) |
| 4. Main | `children` | Área de contenido principal — canvas, listado, detalle, formulario |

**Reglas:**
- Nunca construir el shell manualmente — siempre usar `AdminWorkspaceLayout`.
- El rail solo contiene botones de ícono (`h-9 w-9`), listados con `gap-1`. Sin texto, sin líneas divisorias, sin ningún `<div className="... h-px ..." />` entre ellos. Referencia canónica: `WidgetCatalogRail.tsx` y `HierarchyActionsRail.tsx`.
- El panel lateral usa las primitives de `adminSidebarStyles.ts` (ver sección 3).
- El main es `overflow-hidden` por defecto; activar `mainScrollable` solo si el scroll debe ser del área completa (no recomendado si hay header sticky interno).

---

## 2. Context bar

- Los labels informativos de la context bar admin deben reutilizar `ADMIN_CONTEXT_BAR_LABEL_CLS` desde `hmi-app/src/components/admin/adminSidebarStyles.ts`.
- El estilo estándar es `text-[10px] font-black uppercase tracking-widest text-industrial-muted`.
- Casos canónicos actuales: `TIPO:` en `DashboardBuilderPage.tsx` y `Dashboards:` / `Templates:` en `DashboardManagerPage.tsx`.

---

## 2.0. Historial del builder (deshacer / rehacer)

- `DashboardBuilderPage` mantiene el draft en `useHistoryState` (`hmi-app/src/hooks/useHistoryState.ts`), no en un `useState` plano. Los botones **Deshacer** / **Rehacer** están en la context bar, junto a **Guardar**; los atajos son Ctrl+Z, Ctrl+Y y Ctrl+Shift+Z.
- Toda mutación nueva del draft debe pasar por el setter de la historia. No crear un estado paralelo del dashboard.
- Acciones discretas (agregar, borrar, duplicar, operar vistas, confirmar un drag o resize) usan `{ coalesce: false }` para ser un paso propio. Las ediciones de texto continuas (PropertyDock, título y subtítulo del header) usan el coalescing por defecto (500 ms), para que un tipeo sea un solo paso.
- Una operación que mueve o modifica varios widgets a la vez (por ejemplo, mover un grupo) debe entrar como un único `set`, para que se deshaga en un solo paso.
- Resincronizar el draft con lo persistido (Guardar / Publicar) usa `replaceCurrent`: no crea un paso ni borra la historia.
- Un efecto persistido e irreversible fuera del draft (por ejemplo, eliminar una variable del catálogo) no es deshacible: se aplica a todas las entradas con `mapAll`, para que ningún paso de deshacer restaure una referencia ya eliminada.
- Los atajos no actúan si el foco está en un campo editable o hay un diálogo abierto, para no pisar el deshacer nativo del texto.
- La historia vive mientras dura la sesión del builder: se reinicia al cargar un dashboard y se pierde al salir de la página.

---

## 2.1. Badges de template

- El badge `Template` del modo admin debe usar `<AdminTag label="TEMPLATE" variant="cyan" />` directamente.
- `AdminTag` es el primitive unificado para todos los tags admin (ver `hmi-app/src/components/admin/AdminTag.tsx`).
- No hardcodear badges inline para templates en paneles o listados.

---

## 2.2. Agrupar widgets en el builder (contenedor `group`)

El widget contenedor (`group`, `hmi-app/src/widgets/renderers/GroupWidget.tsx`) agrupa otros
widgets del grid bajo una sola tarjeta clickeable. La acción de candado (Lucide `Lock`/`LockOpen`,
junto a copiar/eliminar en `WidgetHoverActions`) alterna entre cerrado (`locked: true`) y abierto
(`locked: false`).

### Reglas de cierre (candado)

- **Membresía (D1)**: al cerrar el candado, se agrupan los widgets cuyo layout queda
  **completamente** contenido en el área del contenedor en ese momento; un widget que solo se
  superpone parcialmente queda afuera. Al abrir el candado se liberan todos los miembros. Para
  agregar o quitar un miembro: abrir, reacomodar, volver a cerrar.
- **Un widget, un grupo**: un widget pertenece como máximo a un grupo bloqueado a la vez. Al
  cerrar un contenedor, un widget ya miembro de OTRO grupo bloqueado queda excluido de la
  candidatura aunque ahora quede geométricamente dentro del nuevo contenedor.
- **Sin anidamiento**: un contenedor nunca se agrupa a sí mismo ni a otro widget `group`.
- **Widgets del header excluidos**: un widget promovido al header del dashboard nunca vive en el
  grid, así que nunca puede ser ni quedar como miembro de un grupo. Si se promueve al header un
  widget que ya era miembro de un grupo bloqueado, la promoción lo libera del grupo en el mismo
  paso de historial.

### Edición con el candado cerrado: el grupo actúa como un solo widget (D6)

D6 reemplaza la parte de D4 que dejaba a los miembros seleccionables/arrastrables por separado
mientras el grupo estaba bloqueado. Con el candado cerrado y sin modo edición activo (ver más
abajo), el grupo se comporta como un único widget:

- Un click en cualquier parte del grupo — el contenedor o cualquiera de sus miembros — selecciona
  el **contenedor**: el panel de propiedades muestra el contenedor, nunca el miembro clickeado.
- Un arrastre iniciado sobre cualquier miembro mueve **todo el grupo**, exactamente igual que
  arrastrar el contenedor directamente.
- Un miembro no muestra sus propias acciones al pasar el mouse (copiar/eliminar individuales);
  solo el contenedor las ofrece, y esas acciones (copiar, eliminar, candado, lápiz) operan sobre
  el grupo.
- El contenedor se puede redimensionar, pero nunca por debajo del cuadro delimitador (bounding
  box) de sus miembros; la vista previa en vivo del resize respeta el mismo límite que el commit
  final, para que no haya un salto visual al soltar.
- Los contenedores se dibujan siempre debajo de todos los demás widgets, agrupados o no, en el
  builder y en el viewer: el orden de render lo resuelve `orderRenderItemsWithGroupsFirst`
  (`utils/groupWidget.ts`), sin depender del orden en que se crearon.

### Modo edición de contenido (lápiz, D6)

Cada contenedor **bloqueado** ofrece una acción adicional "Editar contenido" (Lucide `Pencil`) en
`WidgetHoverActions`, junto a candado/copiar/eliminar. Alterna el modo edición de ESE grupo:

- Es estado de UI puro (`editingGroupId` en `DashboardBuilderPage`) — nunca se persiste ni entra
  al historial de undo/redo.
- Mientras un grupo está en modo edición, sus miembros vuelven a ser individualmente
  seleccionables, arrastrables y redimensionables — pero su rect queda siempre clamp-eado (ver
  `clampRectInsideContainer` en `utils/groupWidget.ts`) para que nunca salga del área del
  contenedor. Cada movimiento/resize de un miembro es un paso de historial propio.
- El contenedor sigue siendo arrastrable en todo momento (mueve el grupo completo), incluso con
  el modo edición activo.
- Solo un grupo puede estar en modo edición a la vez.
- Se sale del modo edición al volver a tocar el lápiz, al hacer click fuera del grupo (en otro
  widget o en el canvas vacío), con Escape, o automáticamente si el grupo se desbloquea o se
  elimina. Un candado reabierto y vuelto a cerrar NO reactiva el modo edición por sí solo.

### Copiar y eliminar (D5, con la excepción D6 para eliminar bloqueado)

- Copiar (cualquier widget, no solo un contenedor) ya NO inserta la copia al instante: entra en
  **modo de ubicación** (P8). Clic en la acción "Duplicar widget" (o en el botón de duplicar del
  `PropertyDock`) muestra un fantasma del tamaño del original — un contenedor bloqueado se ve como
  UN fantasma rígido (contenedor + miembros, cada uno con su offset relativo) — que sigue el
  puntero, siempre encastrado a la grilla y clampeado dentro de sus límites (reutiliza
  `clampWidgetBounds`: una copia ya nunca puede caer fuera o debajo de la grilla). Un clic en
  cualquier parte del canvas — espacio vacío o encima de otro widget, la superposición está
  permitida — la ubica ahí; termina SELECCIONADA y es un único paso de historial
  (`{ coalesce: false }`). El fantasma reutiliza el look de selección/drag existente
  (`GridSelectionFrame` con `isHighlighted`), sin estilos nuevos.
- Cancelar (nada se crea, ningún paso de historial): Escape, volver a hacer clic en la misma
  acción de copiar, o salir del builder. El estado de ubicación es UI-only
  (`duplicatePlacementSourceWidgetId` en `DashboardBuilderPage`), como `editingGroupId` — nunca se
  persiste ni entra al historial de undo/redo, y se cancela solo si su widget fuente desaparece de
  la vista activa (eliminado, o cambio de vista).
- Copiar un contenedor **cerrado** duplica el grupo completo (contenedor + miembros, ya
  agrupados, con ids nuevos) en la posición donde se soltó el fantasma; `sanitizeGroupMemberIds`
  deduplica la lista de miembros antes de copiar, para que un `memberWidgetIds` corrupto (con un
  id repetido) nunca duplique ese miembro varias veces.
- Copiar un contenedor **abierto** duplica solo el contenedor vacío.
- Eliminar un contenedor **abierto** elimina únicamente el contenedor, sin diálogo de
  confirmación; los miembros permanecen en su lugar y quedan liberados (comportamiento D5 sin
  cambios).
- Eliminar un contenedor **cerrado** (D6) pide confirmación primero — el diálogo reutiliza
  `AdminDestructiveDialog` y nombra el contenedor y la cantidad de widgets agrupados que se van a
  eliminar. Al confirmar, se elimina el contenedor y TODOS sus miembros en un único paso de
  historial; al cancelar no cambia nada.
- Eliminar un miembro individual (en modo edición) lo quita también de la lista de miembros de su
  grupo, sin diálogo — comportamiento existente sin cambios.

### Historial

- Toda operación de grupo (cerrar/abrir candado, mover, redimensionar, copiar, eliminar) entra
  como un único paso de deshacer (ver sección 2.0): un solo `set` de `useHistoryState`.

### Viewer: prioridad de click y hover de grupo (D3)

- Un click en cualquier parte del grupo —incluso sobre un miembro— navega al destino del
  contenedor, salvo que ese miembro tenga su propio `navigationTargetDashboardId`, en cuyo caso
  gana el del miembro. Los controles interactivos internos de un miembro siguen funcionando
  (`NAVIGATION_INTERACTIVE_SELECTOR`).
- El contenedor muestra su estado hover mientras el puntero está en cualquier parte del grupo
  (contenedor o miembros); cada miembro conserva además su propio hover individual.

---

## 3. Paneles laterales (sidePanel)

- El `PropertyDock` es la referencia visual canónica para paneles laterales de propiedades/inspección del modo admin.
- Reutilizar las primitives de `hmi-app/src/components/admin/adminSidebarStyles.ts`.
- Shell del panel: superficie `bg-industrial-surface`, header sticky con `border-b border-white/5`, scroll con `hmi-scrollbar`.
- Bloques internos: `rounded-lg`, `border border-white/10`, `bg-black/10`. No usar `glass-panel` para sidebars de propiedades.
- Títulos de sección: compactos, uppercase, `tracking-widest`, color `text-industrial-muted`.
- Labels de campo: compactos, uppercase, alineados, ancho estable.
- Inputs/selects: fondo oscuro translúcido, borde fino, radio corto, focus con `admin-accent`; no inventar variantes paralelas.
- Si un panel admin nuevo necesita propiedades/configuración lateral, debe arrancar desde estas primitives antes de crear clases nuevas.

### 3.1 Layout del `PropertyDock`

- Orden de bloques obligatorio: **GENERAL → DATOS → UMBRALES**.
- Los bloques **VISUAL** y **ACCIONES** fueron eliminados del layout canónico.
- Orden de campos dentro de **DATOS**: **Fuente → Unidad → Variable → Operación → Origen → Valor**.

### 3.2 Comportamiento de campos en `PropertyDock`

- El selector **Fuente** reemplaza al toggle anterior de modo jerárquico.
- Opciones canónicas:
  - `Usa valor propio`
  - `Calcula desde jerarquía`
- Si `Fuente = Calcula desde jerarquía`:
  - `Operación` habilitado.
  - `Origen` y `Valor` deshabilitados.
- Si `Fuente = Usa valor propio`:
  - `Operación` deshabilitado.
  - `Origen` y `Valor` habilitados.
- Todos los campos permanecen siempre visibles; cuando no aplican, se muestran deshabilitados en lugar de ocultarse.
- `Variable` permanece siempre visible y es obligatoria cuando el catálogo tiene entradas para la unidad seleccionada.
- Cuando hay una variable seleccionada, la unidad queda bloqueada para preservar consistencia semántica del binding.

### 3.3 Primitives nuevas para `PropertyDock`

- `DockInfoBox` — primitive reutilizable de mensaje contextual con ícono + texto.
  - Props: `text`, `variant: 'normal' | 'warning' | 'critical'`.
- `DockFieldRow` — helper de layout para mantener consistencia entre label + input dentro de `PropertyDock`.
- `CatalogVariableSelector` — dropdown presentacional para selección de variables con create/delete inline.
  - Props: `variables`, `selectedId`, `usedIds`, `onChange`, `onCreateNew`, `onDelete`, `hasRequiredError`, `disabled`.

### 3.4 Primitive canónica para estados vacíos: `AdminEmptyState`

- Archivo: `hmi-app/src/components/admin/AdminEmptyState.tsx`
- Contrato:

```tsx
interface AdminEmptyStateProps {
  icon: LucideIcon;
  message: string;
}
```

- Uso obligatorio para todo estado vacío / sin-selección / sin-contenido en modo admin (panel, área main, listados y resultados vacíos de búsqueda).
- Estilo canónico (heredado del empty state del `PropertyDock`):
  - contenedor: `flex h-full flex-col items-center justify-center gap-3 text-center`
  - ícono Lucide: `size={22}` con `text-industrial-muted`
  - mensaje: `text-xs font-semibold tracking-wide text-industrial-muted`
- No agregar bordes, tarjetas ni fondos especiales para empty states.
- Para búsquedas sin resultados, usar esta primitive con un ícono semántico como `SearchX`.

---

## 4. Primitive canónica para diálogos: `AdminDialog`

- Archivo: `hmi-app/src/components/admin/AdminDialog.tsx`
- Contrato:

```tsx
interface AdminDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode;
}
```

- Usar `AdminDialog` para todo diálogo/modal del modo admin: confirmaciones, prompts con campos, mensajes de error y acciones destructivas.
- Estilo base obligatorio:
  - overlay: `fixed inset-0 z-50` + `bg-modal-overlay` (token, `--color-modal-overlay` en `index.css`) + `backdrop-blur-sm`
  - panel: superficie oscura premium, `rounded-xl`, `border border-white/10`, `p-6`
  - título: `uppercase`, `font-black`, `tracking-widest`, tamaño compacto (`text-sm`)
  - cierre con `Escape`
- El cuerpo (`children`) define campos o texto contextual. Las acciones (`actions`) viven al pie, alineadas a la derecha.

### 4.1 Estructura básica

```tsx
<AdminDialog
  open={open}
  title="Confirmar eliminación"
  onClose={() => setOpen(false)}
  actions={(
    <>
      <AdminActionButton variant="secondary">Cancelar</AdminActionButton>
      <AdminActionButton variant="secondary">Eliminar</AdminActionButton>
    </>
  )}
>
  <p className="text-xs text-industrial-muted">¿Seguro que quiere continuar?</p>
</AdminDialog>
```

### 4.2 Regla obligatoria

- **Prohibido** usar `window.prompt`, `window.confirm` o `window.alert` dentro del modo admin (`pages/admin` y `components/admin`).
- Todo caso nuevo debe implementarse con `AdminDialog`.

### 4.3 Primitive canónica para acciones: `AdminActionButton`

- Archivo: `hmi-app/src/components/admin/AdminActionButton.tsx`
- Contrato:

```tsx
interface AdminActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: 'primary' | 'secondary';
}
```

- En modo admin existen **solo 2 estilos canónicos**:
  1. `secondary` = referencia exacta del botón **Guardar Draft** del editor (`DashboardBuilderPage`).
  2. `primary` = referencia exacta del botón **Publicar** del editor (`DashboardBuilderPage`).
- Toda acción de texto en context bar y diálogos admin debe reutilizar esta primitive.
- Acciones como **Mover** y **Eliminar** en jerarquía (y acciones equivalentes de confirmación) usan `secondary` para mantener consistencia visual del sistema.
- Evitar variantes paralelas (`danger`, `success`, etc.) para no romper el contrato visual.

---

## 5. Widgets nuevos — color

Todo widget nuevo que represente estado, severidad o umbrales debe usar exclusivamente los tokens semánticos definidos en `hmi-app/src/index.css`.

**Tokens para colorizado dinámico (umbrales):**
- `--color-dynamic-normal-from` / `--color-dynamic-normal-to`
- `--color-dynamic-warning-from` / `--color-dynamic-warning-to`
- `--color-dynamic-critical-from` / `--color-dynamic-critical-to`

**Tokens para íconos, acentos y subtexto:**
- `--color-widget-icon`, `--color-widget-gradient-from`, `--color-widget-gradient-to`
- `--color-status-normal`, `--color-status-warning`, `--color-status-critical`

**Tokens para UI estructural del modo admin:**
- `--color-admin-accent`, `--color-admin-selection-from`, `--color-admin-selection-to`

**Criterio de uso:**
- Sin estado dinámico → degradado base de widget (`--color-widget-*`)
- Responde a umbrales o severidad → `--color-dynamic-*`
- Muestra estado puntual → `--color-status-*`

**Prohibido:**
- Hardcodear colores hex en renderers, componentes o SVGs de widgets.
- Inventar una lógica cromática paralela por fuera de los tokens semánticos.

---

## 6. Widgets nuevos — estructura

- Shell visual base: `glass-panel`.
- Header canónico: `hmi-app/src/components/ui/WidgetHeader.tsx`.
- Acciones hover: `hmi-app/src/components/ui/WidgetHoverActions.tsx`.
- Foco/selección:
  - grid → `hmi-app/src/components/ui/GridSelectionFrame.tsx`
  - header → `hmi-app/src/components/ui/HeaderSelectionFrame.tsx`
- Registro obligatorio del renderer en `hmi-app/src/widgets/WidgetRenderer.tsx`.
- Si el widget agrega configuración nueva, tipar `displayOptions` en `hmi-app/src/domain/admin.types.ts`.
- `subtitle` = contexto de header. `subtext` = texto inferior/footer. Nunca mezclar.
- Template base para widgets nuevos: `.agent/skills/interfaz-widget/assets/NewWidgetTemplate.tsx`.
- Guía detallada: `hmi-app/src/widgets/WIDGET_AUTHORING.md`.

---

## 7. Guardado en el servidor y acceso oculto

- La configuración que guarda el modo admin va al **servidor** (adaptador `sharedConfigStorage`, sesión de administrador + CSRF), no al `localStorage`. Los servicios y módulos de configuración nuevos usan el adaptador y agregan su clave a `SHARED_CONFIG_KEYS` (`hmi-app/src/domain/sharedConfig.types.ts`) si debe compartirse; lo que es propio de cada navegador (pestaña activa, nodos expandidos) queda fuera de esa lista.
- Un guardado fallido nunca es silencioso: `SharedConfigSaveNotice` (montado en `AdminLayout`) muestra el aviso con "Reintentar".
- Las lecturas no escriben: aplicar o abrir una pantalla no debe guardar nada (un visor no tiene sesión y la escritura quedaría pendiente).
- Un cambio remoto no pisa borradores: un editor con cambios sin guardar retiene la re-aplicación con `useHoldSharedConfigReapply`; los cambios que llegan mientras tanto se aplican al guardar o descartar. Las páginas de contenido recargan con `useSharedConfigVersion`, salvo el builder, que no se refresca para no perder el borrador.
- Los íconos de usuarios y Prisma del visor están ocultos (`Ctrl+Alt+A` o `/acceso`). La barrera de seguridad es la sesión del servidor, no el ícono; un administrador autenticado conserva sus botones y la ruta `/admin`. Detalle: [`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md).
