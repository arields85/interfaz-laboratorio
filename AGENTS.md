# AGENTS.md — interfaz HMI

> Guía de contexto para agentes de IA y desarrolladores. Leela completa antes de tocar código.

---

## 1. Identidad del Proyecto

**interfaz HMI** es una interfaz de visualización de datos en tiempo real (Human-Machine Interface) para entornos industriales, de solo lectura. Es una base escalable y reutilizable aplicable a distintas industrias, organizaciones y equipos. No es una interfaz cerrada para un único caso, planta o cliente.

- La aplicación vive en `hmi-app/` (es un proyecto Vite independiente dentro del monorepo).
- El código fuente está en `hmi-app/src/`.
- La raíz del repositorio contiene solo configuración, documentación y el subdirectorio `hmi-app/`.

---

## 2. Restricciones Críticas — SISTEMA DE SOLO LECTURA

> ⚠️ **ESTA APLICACIÓN ES ESTRICTAMENTE DE SOLO LECTURA.**

**Prohibido absolutamente:**
- Botones de acción que envíen comandos a la planta
- Setpoints, actuadores o cualquier escritura hacia el proceso industrial
- Formularios de control operativo
- Llamadas HTTP de tipo POST/PUT/DELETE hacia sistemas de control

**Permitido:**
- Visualización de telemetría, métricas y estados
- Navegación entre vistas
- Configuración de la propia interfaz (admin mode — ver [sección 7](#7-modo-administrador))

Si un stakeholder pide "agregar un botón para arrancar el motor", la respuesta es **NO**. Ese requerimiento está fuera del alcance por diseño.

---

## 3. Stack Técnico

| Tecnología       | Versión | Rol                                      |
|------------------|---------|------------------------------------------|
| React            | 19      | UI framework                             |
| TypeScript       | 5.9     | Tipado estricto                          |
| Vite             | 7       | Build tool y dev server                  |
| Tailwind CSS     | v4      | Estilos utilitarios + sistema de tokens  |
| Zustand          | 5       | Estado global del cliente                |
| TanStack Query   | 5       | Estado async / datos del servidor        |

---

## 4. Arquitectura

Flujo: `Fuente externa → service → adapter → domain model → query/store → componente UI`.

Estado separado: TanStack Query para datos del servidor, Zustand para UI del cliente. Tres tipos de estado ortogonales que no se mezclan: `EquipmentStatus`, `ConnectionState`, `MetricStatus`. Catálogo de variables centralizado via `CatalogVariable`, canónico por `catalogVariableId`.

Ver detalle completo, tree de archivos y reglas de capas: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Integración de datos en tiempo real: la HMI consume un contrato JSON estable, no una tecnología concreta. Health, timestamps y normalización se resuelven fuera de la HMI. Ver contrato oficial, estados, resolución y fallbacks: [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md).

---

## 5. Convenciones de Código

Lo crítico en el día a día:
- TypeScript estricto, cero `any` sin justificación.
- Tipos de dominio exclusivamente en `hmi-app/src/domain/`.
- Cero parches ad-hoc — resolver en la capa responsable.
- Cero valores hardcodeados cuando existe token, primitive o medición runtime.
- Scrollbars: siempre `hmi-scrollbar`.
- `Directrices/` contiene antecedentes históricos no normativos del proyecto: no es fuente de requisitos vigentes y sus archivos no deben modificarse. Ver [`Directrices/README_directrices.md`](Directrices/README_directrices.md).

Políticas completas (anti-parches, anti-hardcode, anti-hardcode dimensional): [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md).

---

## 6. Sistema de Diseño

Tailwind v4 **sin `tailwind.config.js`** — tokens en `@theme {}` de `hmi-app/src/index.css`.

> **Regla de Oro**: NUNCA hardcodear colores hex ni nombres de fuente en componentes. SIEMPRE usar tokens via clases Tailwind.

Íconos: solo Lucide React.

Tokens, fuentes, categorías completas: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

---

## 7. Modo Administrador

El modo admin es configuración de la propia HMI, no control de planta. Usar `AdminLayout.tsx` para rutas `/admin`. Layouts de dashboard persistidos via `DashboardStorageService`. Toda página admin usa `AdminWorkspaceLayout` con los 4 bloques (context bar, rail, panel, main).

Convenciones completas del modo admin: [`hmi-app/src/components/admin/ADMIN_CONVENTIONS.md`](hmi-app/src/components/admin/ADMIN_CONVENTIONS.md).

Para crear o corregir paneles de propiedades de widgets, cargá y seguí la skill de proyecto [widget-property-panel](.opencode/skills/widget-property-panel/SKILL.md).

---

## 8. Referencias

Para pendientes, backlog, continuación o próximos pasos, y antes de trabajar en un área indexada, consultá [`docs/PENDING_WORK.md`](docs/PENDING_WORK.md). Allí se define el protocolo de consulta y mantenimiento del índice y su detalle en Engram.

| Documento | Descripción |
|-----------|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Flujo de datos, capas, tipos ortogonales, catálogo de variables, capabilities, estructura de archivos |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Convenciones TS, anti-parches, anti-hardcode dimensional |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, fuentes, Tailwind v4, Regla de Oro |
| [`docs/TESTING.md`](docs/TESTING.md) | Stack de testing, coverage, TDD, mocks, fixtures |
| [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) | Contrato JSON estable de integración de datos en tiempo real, estados oficiales, resolución, fallbacks |
| [`docs/PENDING_WORK.md`](docs/PENDING_WORK.md) | Índice activo de pendientes y referencias a su detalle en Engram |
| [`hmi-app/src/widgets/WIDGET_AUTHORING.md`](hmi-app/src/widgets/WIDGET_AUTHORING.md) | Cómo crear widgets nuevos |
| [`hmi-app/src/components/admin/ADMIN_CONVENTIONS.md`](hmi-app/src/components/admin/ADMIN_CONVENTIONS.md) | Convenciones operativas del modo admin |
| [`docs/SHADER_BACKGROUND.md`](docs/SHADER_BACKGROUND.md) | Arquitectura del fondo WebGL shader, efectos, compatibilidad, performance, gotchas |
