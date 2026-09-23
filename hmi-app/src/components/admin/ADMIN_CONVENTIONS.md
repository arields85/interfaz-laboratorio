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

## 2.1. Badges de template

- El badge `Template` del modo admin debe usar `<AdminTag label="TEMPLATE" variant="cyan" />` directamente.
- `AdminTag` es el primitive unificado para todos los tags admin (ver `hmi-app/src/components/admin/AdminTag.tsx`).
- No hardcodear badges inline para templates en paneles o listados.

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
  - overlay: `fixed inset-0 z-50` + `bg-black/60` + `backdrop-blur-sm`
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
