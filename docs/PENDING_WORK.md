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
| PW-001 | pending | Configuración general | aplicar a CONEXIÓN, DISEÑO, OPCIONES y AJUSTES el patrón aprobado en VOZ para mostrar el estado de guardado en el footer a la izquierda de Guardar, con tonos semánticos. | `backlog/global-settings-save-status-all-tabs` | 2026-08-10 |
| PW-002 | pending | Prisma Runtime | Con PAC-3 completo y aceptado offline, aceptar arranque e instalación limpios reales; corregir la carrera concurrente de inicialización de estado y completar forwarding, despliegue, supervisión, recuperación durable y retiro de la instalación legacy. | `backlog/prisma-runtime-monorepo-integration` | 2026-08-30 |
| PW-003 | pending | Prisma Assistant | PAC-4 y PAC-4B están completos y aceptados offline. Quedan el cierre final del paquete PAC-5 y el trabajo posterior del asistente; se conserva la misma sesión administrativa y no existe un segundo login. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
