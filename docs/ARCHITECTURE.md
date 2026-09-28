# Arquitectura — Interfaz-Laboratorio

> **TL;DR**: Flujo de datos unidireccional service → adapter → domain → query/store → UI. Estado separado entre datos del servidor (TanStack Query) y UI del cliente (Zustand). Tres tipos de estado ortogonales que no se mezclan. Tree completo del código fuente al final.

> ← Volver a [`AGENTS.md`](../AGENTS.md)

---

## Flujo de datos

```
Fuente externa → service → adapter → domain model → query/store → componente UI
```

1. **`services/`** — acceso a datos (HTTP, localStorage, mocks)
2. **`adapters/`** — transforman datos crudos al modelo de dominio
3. **`domain/`** — tipos canónicos del negocio (la única fuente de verdad de tipos)
4. **`queries/`** — hooks TanStack Query (datos async y caché)
5. **`store/`** — Zustand (estado UI puramente del cliente)
6. **`components/` / `pages/`** — consumen el estado, no lo producen

## Separación de estado

| Tipo                  | Herramienta      | Ejemplos                                  |
|-----------------------|------------------|-------------------------------------------|
| Datos del servidor    | TanStack Query   | Lista de equipos, telemetría, alertas     |
| Estado UI del cliente | Zustand          | Panel abierto/cerrado, selección activa   |

## Tres tipos de estado ortogonales

- **`EquipmentStatus`** — estado operativo del equipo (running, stopped, maintenance…)
- **`ConnectionState`** — estado del enlace de datos (connected, disconnected, degraded…)
- **`MetricStatus`** — umbral de la métrica (normal, warning, critical)

Estos tres tipos son **independientes** y no deben mezclarse ni colapsarse en uno solo.

## Catálogo de Variables

- El catálogo de variables centraliza identidades semánticas compartidas via `CatalogVariable { id, name, unit, description? }`.
- Su objetivo es que la agregación jerárquica matchee por identidad de variable y no solo por coincidencia de unidad.
- En `WidgetBinding`, `catalogVariableId` reemplaza a `variableKey` como identidad canónica para matching jerárquico.
- Flujo de referencia: `VariableCatalogStorageService → PropertyDock → widget.binding.catalogVariableId → hierarchyResolver`.
- La variable es **obligatoria** cuando el catálogo ya tiene entradas para esa unidad; esto evita errores de configuración a escala.
- La variable es independiente del modo jerárquico: también debe definirse correctamente en widgets hijos para que el matching del padre sea confiable.

## Sistema de Capacidades por Widget

- `utils/widgetCapabilities.ts` es el registro central de qué soporta cada tipo de widget.
- Capacidades actuales:
  - `catalogVariable` — el widget puede asociarse a una variable del catálogo.
  - `hierarchy` — el widget puede agregar valores desde hijos jerárquicos.
- `PropertyDock` y `DashboardBuilderPage` consumen este registro para decidir qué campos mostrar, habilitar y validar.
- Para habilitar capacidades en un widget nuevo, cambiar **una sola línea** en `widgetCapabilities.ts`.

---

## Estructura de Archivos

```
hmi-app/src/
├── app/                    # Providers globales y configuración de router
│   ├── providers.tsx
│   └── router.tsx
├── domain/                 # Tipos canónicos del dominio (fuente de verdad)
│   ├── equipment.types.ts
│   ├── alert.types.ts
│   ├── telemetry.types.ts
│   ├── widget.types.ts
│   ├── admin.types.ts
│   ├── assistant.types.ts
│   └── variableCatalog.types.ts
├── adapters/               # Transforman datos externos al modelo de dominio
│   ├── equipment.adapter.ts
│   └── alert.adapter.ts
├── services/               # Acceso a datos (HTTP, localStorage, mocks)
│   ├── equipment.service.ts
│   ├── alert.service.ts
│   ├── DashboardStorageService.ts
│   ├── HierarchyStorageService.ts
│   ├── TemplateStorageService.ts
│   └── VariableCatalogStorageService.ts
├── queries/                # Hooks TanStack Query
│   ├── useEquipmentList.ts
│   ├── useEquipmentDetail.ts
│   └── useAlerts.ts
├── store/                  # Estado global Zustand
│   └── ui.store.ts
├── mocks/                  # Datos mock para desarrollo
│   ├── equipment.mock.ts
│   ├── alerts.mock.ts
│   ├── telemetry.mock.ts
│   ├── admin.mock.ts       # fixture de tests únicamente (no se siembra en fresh install)
│   └── template.mock.ts    # usado en migración interna de TemplateStorageService + fixture de tests
├── pages/                  # Composiciones de página (viewer + admin)
│   ├── Dashboard.tsx
│   ├── EquipmentDetail.tsx
│   ├── AlertsPage.tsx
│   ├── TrendsPage.tsx
│   └── admin/
├── components/             # Componentes reutilizables
│   ├── ui/                 # Base UI (átomos)
│   ├── layout/             # Componentes de layout
│   ├── charts/             # Visualizaciones
│   ├── viewer/             # Componentes específicos del viewer
│   ├── admin/              # Componentes del modo admin
│   │   ├── CatalogVariableSelector.tsx
│   │   └── DockInfoBox.tsx
│   ├── Sidebar.tsx
│   └── Topbar.tsx
├── widgets/                # Sistema de widgets del dashboard builder
│   ├── renderers/          # Componentes de renderizado por tipo de widget
│   ├── resolvers/          # Lógica de resolución de datos por widget
│   └── WidgetRenderer.tsx
├── layouts/                # Layouts de página
│   ├── MainLayout.tsx      # Viewer principal
│   └── AdminLayout.tsx     # Modo administrador
├── styles/                 # Estilos globales adicionales
├── assets/                 # Recursos estáticos
├── utils/                  # Utilidades puras
│   ├── catalogMigration.ts
│   └── widgetCapabilities.ts
├── index.css               # @theme {} de Tailwind v4 — tokens del sistema de diseño
├── App.tsx
└── main.tsx
```

> Nota: `components/admin/TemplateBadge.tsx` fue eliminado. El badge canónico de template vive en `AdminTag`.
