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
| PW-003 | pending | Prisma Assistant — Canal A | RCA-5j/RCA-5k: administración de credenciales del Canal A — backend y su integración frontend en la tarjeta existente, con status/Apply explícitos y warning+reintento solo para A — aceptada **solo offline**, incluida la corrección de rotulado aprobada por el usuario. Siguiente: proyección QR/status por capability con rutas proxy/cliente y apertura **manual** del QR en `Pyramid`, inmediatamente a la derecha de Logs, reutilizando la respuesta y el audio existentes; sin nuevas concesiones de fuente. La próxima sesión debe **leer primero el documento maestro de Prisma completo** (§11.1/§3.4) y reconciliar el tracker con el código real. Base `9864c25`, sin commit nuevo; sin push ni PR. **Sesión cerrada (cierre documental):** el usuario autorizó UN commit local único de checkpoint sobre los 20 paths actuales (backend+frontend+tests+docs) — supera el «sin commit» solo para este checkpoint; el parent lo ejecuta desde la base `9864c25` (pre-commit) y el hash real se registra en Engram tras su éxito. Reanudar leyendo el maestro completo y recuperando `checkpoint/prisma-channel-a-manager-resume`, `odd/tasks/prisma-channel-a-remote.md`, este índice y Git; primera acción: mapeo read-only del wiring restante y congelar el contrato/TDD acotado antes de tocar fuente. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
