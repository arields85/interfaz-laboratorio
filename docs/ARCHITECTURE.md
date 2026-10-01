# Arquitectura — Interfaz-Laboratorio

> **TL;DR**: Flujo de datos unidireccional service → adapter → domain → query/store → UI. Estado separado entre datos del servidor (TanStack Query) y UI del cliente (Zustand). Tres tipos de estado ortogonales que no se mezclan. Tree completo del código fuente al final.

> ← Volver a [`AGENTS.md`](../AGENTS.md)

---

## Flujo de datos

```
Fuente externa → service → adapter → domain model → query/store → componente UI
```

1. **`services/`** — acceso a datos (HTTP, configuración compartida, mocks)
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

## Configuración compartida

La configuración de la propia HMI (dashboards, plantillas, jerarquía, tipos de nodo, catálogo de variables, conexión de datos, nombre, loader, opciones temporales, orbe de Leda, tema, diseño y shader) **vive en el servidor**, no en cada navegador. Lo que un administrador guarda en un navegador lo ven todos, incluidos los que ya están abiertos. Es configuración de la HMI, nunca un comando hacia la planta (no cambia el contrato de datos de planta de [`DATA_CONTRACT.md`](DATA_CONTRACT.md)).

- **Servidor**: el runtime de Leda guarda un documento clave/valor con una revisión global (`GET /api/leda/hmi-config`, `GET /api/leda/hmi-config/revision`, `PUT /api/leda/admin/hmi-config`). Rutas, límites y errores: [`leda/LEDA_BROWSER_ROUTING.md`](leda/LEDA_BROWSER_ROUTING.md).
- **Adaptador cliente**: `hmi-app/src/services/sharedConfigStorage.service.ts` expone `getItem`/`setItem`/`removeItem` síncronos sobre una copia en memoria. Los módulos de configuración lo usan en lugar de `localStorage` y mantienen su API. Las lecturas nunca escriben.
- **Arranque**: `main.tsx` espera `load()` antes de aplicar la configuración y renderizar. Si el servidor no responde, usa la última copia buena guardada en `localStorage` (solo caché, `hmi:shared-config-cache`).
- **Fallback local de arranque**: mientras el servidor nunca fue escrito (revisión 0, sin claves), las claves compartidas se leen de los datos locales de este navegador (solo lectura). Cualquier revisión mayor a 0 gana por completo. El primer guardado siembra los demás valores locales, pasando por los mismos límites que cualquier escritura, y antes verifica que la revisión siga en 0. Límite conocido: dos navegadores en fallback que guardan a la vez pueden pisarse en esa ventana (en el servidor real, un navegador nuevo no tiene datos locales).
- **Escritura**: `setItem`/`removeItem` actualizan la memoria al instante y envían lotes con sesión de administrador y CSRF. Un error de guardado es visible (`SharedConfigSaveNotice` en el layout admin) con opción de reintentar.
- **Propagación**: cada ~10 s el cliente consulta `GET /revision`. Si cambió, vuelve a leer el documento y avisa a los suscriptores: los módulos de configuración se re-aplican (`app/sharedConfigAppliers.ts`), las páginas de contenido recargan (`useSharedConfigVersion`) y las consultas de conexión de datos se invalidan.
- **Lista de claves**: `SHARED_CONFIG_KEYS` en `hmi-app/src/domain/sharedConfig.types.ts` es la única lista de claves compartidas; un test la fija contra la constante de cada módulo. Todo lo demás es **por navegador** (pestaña de ajustes abierta, nodos expandidos, grilla visible, historial de alertas, sesión admin, caché, bandera de acceso oculto).

## Acceso oculto

El visor común no muestra el ícono de usuarios ni el de Leda. Se revelan con `Ctrl+Alt+A` (alterna) o entrando a `/acceso` (los revela, abre el login y vuelve a `/`). La bandera `hmi:hidden-access` es local a cada navegador y nunca se comparte (`services/hiddenAccess.service.ts`). Ocultar el ícono **no es** la barrera de seguridad: las rutas `/admin` y las escrituras siguen protegidas por la sesión del servidor.

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
