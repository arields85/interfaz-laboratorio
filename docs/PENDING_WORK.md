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
| PW-003 | pending | Prisma Assistant — Canal A | RCA-5i: composición raíz del Canal A aceptada **solo offline** (manager + factory por defecto + ruta de configuración en `paths.py`; GREEN independiente de 13 métodos únicos y spotcheck de root). Siguiente: admin A (guardar/borrar credencial y Apply/status a través del manager/generación, con la auth/CSRF existente) y luego QR/status por proxy/cliente con apertura manual en `Pyramid`. La conexión de punta a punta sigue incompleta; reutilizar la respuesta/audio existentes; la cancelación/disponibilidad extra no es prerrequisito. Aprobar antes de ampliar alcance (maestro §3.4/§11.1). **Cierre de sesión 2026-09-21:** único permiso nuevo, un commit local de checkpoint de los seis archivos cambiados (hash registrado en Engram, no incrustado); la próxima sesión debe recuperar el checkpoint Engram `prisma-channel-a-manager-resume` y **leer primero el documento maestro de Prisma completo** (§11.1/§3.4) antes de planificar, reconciliando tracker y código real. Sin push ni PR. Continuación exacta y evidencia: `odd/tasks/prisma-channel-a-remote.md`. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
