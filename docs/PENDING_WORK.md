# Índice de Pendientes Activos

Este documento es la autoridad de descubrimiento sobre **qué** está pendiente y su estado activo; Engram, mediante cada `topic_key`, conserva el detalle, contexto, decisiones y criterios, mientras Git preserva el historial de las filas resueltas o eliminadas.

## Esquema Estable

- Las columnas son, en este orden: `ID | Estado | Área | Resumen | Engram topic | Agregado`.
- `Estado` admite únicamente `pending` y `blocked`.
- `ID` es estable y usa el formato `PW-NNN`.
- `Engram topic` usa el formato `backlog/<slug>`; nunca un ID numérico de Engram.
- El índice contiene solo pendientes activos. Al resolver uno, se elimina su fila y Git preserva la historia.
- El resumen facilita el descubrimiento y no reemplaza el detalle almacenado en Engram.

## Pendientes Activos

| ID | Estado | Área | Resumen | Engram topic | Agregado |
|---|---|---|---|---|---|
| PW-002 | pending | Prisma Runtime | Con PAC-3 completo y aceptado offline, aceptar arranque e instalación limpios reales y completar forwarding, despliegue, supervisión, recuperación durable y retiro de la instalación legacy (la carrera concurrente de inicialización de estado quedó corregida y commiteada en `f865e79`). | `backlog/prisma-runtime-monorepo-integration` | 2026-08-30 |
| PW-003 | pending | Prisma Assistant — evolución posterior | CL aceptado para preguntas ejercitadas, Telegram, voz HMI y orbe; sin retest pendiente. [Diseño semántico acordado documentado](prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md); [QRY-1–QRY-4](../odd/tasks/prisma-semantic-query-service.md) pendientes, sin implementar ni autorización nueva. El backlog amplio conserva catálogo, interpretación textual, STT y navegación; Canal B: respuestas con nota de voz (antes PW-012) y preguntas por nota de voz en ambos canales (antes PW-013) ya implementadas y verificadas en vivo; la fuente de datos propia de ambos canales y el manejo de transcripciones largas o de varios temas siguen pendientes aquí. Implementar solo tras instrucción explícita nueva, sin pruebas, servicios ni proveedores automáticos. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-015 | pending | Administración — usuarios | La HMI no permite crear usuarios ni asignar niveles de acceso: solo existe una cuenta admin. Implementar alta/baja de usuarios y niveles (por ejemplo, visualización y administración); el admin de prueba dedicado al Chrome de control (antes PW-014, ya resuelto) espera esta implementación para poder desactivarse por separado. | `backlog/hmi-user-management` | 2026-09-24 |
| PW-017 | pending | Mantenimiento — worktrees | Borrar las carpetas sobrantes `Interfaz-HMI-worktrees/group-g9` y `Interfaz-HMI-worktrees/visual-defaults` (bloqueadas por un proceso de CodeGraph) y decidir qué hacer con el worktree viejo `Temp/opencode/prisma-runtime-cutover`. | `backlog/leftover-worktree-cleanup` | 2026-09-28 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
