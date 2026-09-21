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
| PW-003 | pending | Prisma Assistant — Canal A | Composición bot A → vinculación → contexto de la HMI correcta → respuesta aceptada offline con 10 pruebas; aún sin conectar al arranque. RCA-5e (contexto ordenado y cercas de revisión) aceptado offline acotado: 178 pruebas independientes + build/lint y spotcheck separado de 13 pruebas repetidas. RCA-5f (manager y configuración persistida) aceptado por el padre SOLO offline tras 57 métodos únicos PASS independientes, repetición final separada de 31 métodos PASS y lectura de fuente/tests; cronología RED, bloqueo por cadenas de excepciones y corrección preservados en el tracker. No implica activación de la aplicación ni aprobación nativa. RCA-5 sigue incompleto: proyección de vínculo por capability, conexión HTTP/admin de estado/Apply, scheduler/proxy/bootstrap y aceptación más amplia de identidad. Pausar antes de RCA-6: QR futuro solo por clic en `Pyramid` inmediatamente a la derecha de Logs, nunca automático. Espejo histórico completo de Engram #5599 aún desactualizado/pendiente; checkpoint y backlog quedan a cargo del padre. Sin nueva autorización de ejecución ni entrega. Bloqueo de credenciales resuelto tras reinicio del servicio por el usuario; A figura «Configurada», sin implicar activación del bot ni verificación del proveedor. Arneses auxiliares pausados. Ver `odd/tasks/prisma-channel-a-remote.md`. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
