# AGENTS.md — Interfaz-Laboratorio

> Guía de contexto para agentes de IA y desarrolladores. Leela completa antes de tocar código.

---

## 1. Identidad del Proyecto

**Interfaz-Laboratorio** es una interfaz HMI (Human-Machine Interface) industrial de visualización de datos en tiempo real. Está pensada como una base escalable y reutilizable para múltiples laboratorios de distintas firmas. No es una interfaz cerrada para un único caso o cliente.

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

---

## 8. Testing

Stack: vitest + @testing-library/react + jest-dom + user-event + jsdom. Tests co-locados como `*.test.ts(x)`. TDD obligatorio para lógica pura y bugs. Cobertura mínima 70/70 enforced.

Convención completa (targets por capa, mocks, TDD, accesibilidad): [`docs/TESTING.md`](docs/TESTING.md).

---

## 9. Reglas para Agentes IA

### Rol del agente principal — ORQUESTACIÓN SDD

El agente principal de este repositorio actúa como **COORDINADOR / ORQUESTADOR**, no como ejecutor por defecto. Su trabajo es ordenar el flujo, leer contexto, elegir la fase correcta y **delegar** la ejecución en sub-agentes especializados.

**Se delega por defecto:**
- Exploración e investigación
- Implementación de código
- Testing
- Verificación
- Refactors

Para cambios sustanciales, de producto, de arquitectura o que impacten comportamiento, se trabaja con flujo **SDD**. Verificá primero si el contexto SDD ya está inicializado y, cuando corresponda, iniciá o revalidá `sdd-init` antes de avanzar.

**Cambios inline son excepción, no regla.** Solo se admiten cuando:
- el usuario lo autoriza explícitamente, o
- el cambio es puramente mecánico, acotado y de riesgo bajo

Incluso en esos casos, mantené el criterio de mínimo alcance y no conviertas una excepción operativa en una implementación completa hecha inline.

> Regla explícita: **"cambio quirúrgico" NO es excusa para saltearse la delegación.** Si el trabajo deja de ser mecánico o aparece criterio de producto, diseño, testing, validación o refactor, vuelve al flujo delegado.

### Gestión de pendientes

- `docs/PENDING_WORK.md` es la autoridad de descubrimiento sobre **qué** está pendiente y su estado activo. Leelo cuando el usuario mencione pendientes, backlog, continuación o próximos pasos, y antes de trabajar en un área indexada.
- Para resolver el detalle, contexto, decisiones y criterios, usá el `Engram topic` de la fila: buscalo con `mem_search` y recuperalo con `mem_get_observation`. Nunca implementes basándote solo en el resumen del índice.
- Para dar de alta un pendiente: guardá primero el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificá que sea recuperable y recién entonces agregá la fila al índice. No uses IDs numéricos de Engram como referencia canónica ni dejes filas huérfanas sin un topic verificable.
- Para cerrar un pendiente: actualizá o cerrá primero el detalle en Engram y después retirá la fila activa. Git conserva el historial de las entradas resueltas o eliminadas.

### Antes de escribir código, verificá:

1. ¿El archivo que voy a modificar existe realmente? (no inventar rutas)
2. ¿Los tipos que uso están definidos en `domain/`?
3. ¿Estoy respetando el flujo de datos: service → adapter → domain → query/store → UI?
4. ¿Estoy usando tokens CSS del `@theme {}` en lugar de valores hardcodeados?
5. ¿Todo contenedor con scroll usa `hmi-scrollbar`?
6. ¿Estoy usando `widgetCapabilities.ts` para chequear capacidades en vez de hardcodear `widget.type === 'xxx'`?
7. ¿Pregunta de control: **"¿Esto refuerza una interfaz observadora, premium, industrial, clara y escalable?"**
8. ¿Escribí el test antes del código cuando corresponde (utils, adapters, services, resolvers, bugs)?
9. Si voy a crear/corregir un widget property panel, ¿cargué y seguí la skill de proyecto `.opencode/skills/widget-property-panel/SKILL.md`?

### Prohibido:

- Agregar cualquier funcionalidad de escritura o control hacia el proceso industrial
- Hardcodear colores hex o nombres de fuente en componentes
- Modificar archivos en `Directrices/` (son documentación fuente, no código)
- Crear tipos de dominio fuera de `hmi-app/src/domain/`
- Referenciar `tailwind.config.js` (no existe en este proyecto con Tailwind v4)
- Ignorar los tres tipos de estado ortogonales (mezclar `EquipmentStatus` con `MetricStatus`, por ejemplo)

### Ante la duda:

Consultá los documentos en `Directrices/` antes de tomar una decisión arquitectural.

---

## 10. Referencias

| Documento | Descripción |
|-----------|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Flujo de datos, capas, tipos ortogonales, catálogo de variables, capabilities, estructura de archivos |
| [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) | Convenciones TS, anti-parches, anti-hardcode dimensional |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Tokens, fuentes, Tailwind v4, Regla de Oro |
| [`docs/TESTING.md`](docs/TESTING.md) | Stack de testing, coverage, TDD, mocks, fixtures |
| [`docs/DATA_CONTRACT.md`](docs/DATA_CONTRACT.md) | Contrato JSON estable de integración de datos en tiempo real, estados oficiales, resolución, fallbacks |
| [`docs/PENDING_WORK.md`](docs/PENDING_WORK.md) | Índice activo de pendientes y referencias a su detalle en Engram |
| [`Directrices/Directiva_maestra_v3.1.md`](Directrices/Directiva_maestra_v3.1.md) | Directiva maestra: visión, principios, restricciones globales |
| [`Directrices/Arquitectura Técnica de Implementación HMI v1.3.md`](Directrices/Arquitectura%20Técnica%20de%20Implementación%20HMI%20v1.3.md) | Arquitectura técnica formal |
| [`Directrices/Especificación funcional_Modo Administrador.md`](Directrices/Especificación%20funcional_Modo%20Administrador.md) | Spec funcional del modo administrador |
| [`Directrices/UI_Style_Guide_Design_System_Base_v1.md`](Directrices/UI_Style_Guide_Design_System_Base_v1.md) | Guía visual formal |
| [`hmi-app/src/widgets/WIDGET_AUTHORING.md`](hmi-app/src/widgets/WIDGET_AUTHORING.md) | Cómo crear widgets nuevos |
| [`hmi-app/src/components/admin/ADMIN_CONVENTIONS.md`](hmi-app/src/components/admin/ADMIN_CONVENTIONS.md) | Convenciones operativas del modo admin |
| [`docs/SHADER_BACKGROUND.md`](docs/SHADER_BACKGROUND.md) | Arquitectura del fondo WebGL shader, efectos, compatibilidad, performance, gotchas |
