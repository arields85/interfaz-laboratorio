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
| PW-003 | pending | Prisma Assistant — Canal A | RCA-5l aceptado **solo offline** en base `bffe4ed` (rama `feat/prisma-telegram-credentials`; cierre de sesión con UN único commit local de checkpoint autorizado por el usuario, base pre-commit `bffe4ed`; push/PR siguen sin autorización; hash real en Engram `checkpoint/prisma-channel-a-manager-resume` tras el éxito): proyección QR/status por capability con rutas proxy/cliente, hook efímero y panel manual en `Pyramid` (a la derecha de Logs, abierta solo por clic; la confirmación es del teléfono) + backend 156 PASS, frontend enfocado 189 PASS (36 UI), cobertura completa 2.181 únicas PASS con umbrales 70 intactos, build y lint PASS. Siguiente: acordar y autorizar la aceptación real teléfono → confirmación → consulta → respuesta/audio en la HMI vinculada, NO reimplementar QR. Al reanudar: leer el maestro completo (§11.1/§3.4), recuperar `checkpoint/prisma-channel-a-manager-resume`, el tracker, este índice y Git; el permiso de un commit del checkpoint anterior se consumió en `bffe4ed` y NO se hereda; el nuevo commit de cierre es único y no autoriza trabajo nuevo. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
