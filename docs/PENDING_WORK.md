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
| PW-002 | pending | Prisma Runtime | Con la base backend, credenciales protegidas y adopción Gemini por sesión completas offline, aceptar arranque e instalación limpios reales; implementar forwarding, despliegue y supervisión administrados por IT, recuperación durable y retiro explícito de la instalación legacy externa. | `backlog/prisma-runtime-monorepo-integration` | 2026-08-30 |
| PW-003 | pending | Prisma Assistant | Con almacenamiento/API protegidos y voz Gemini aislada por sesión completos offline, adoptar Telegram mediante token almacenado y estado deseado/aplicado con reinicio seguro; después integrar Voz/admin UI y continuar el pipeline de datos compartidos. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
