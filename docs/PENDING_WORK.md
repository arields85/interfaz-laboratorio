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
| PW-003 | pending | Prisma Assistant — Canal A | Preflight de nombre HMI del panel de emparejamiento completo y aceptado **solo offline** (cierre de sesión 2026-09-22 con UN único commit local de checkpoint autorizado por el usuario, base pre-commit `c82fe44`, rama `feat/prisma-telegram-credentials`; push/PR sin autorización; hash real en Engram `checkpoint/prisma-channel-a-manager-resume` tras el éxito): nombre ausente con copia accionable antes del QR y sin peticiones de pairing, nombre ilegible con copia distinta y veraz, relectura en cada apertura; verificación independiente 58 enfocadas PASS y 2.184 únicas PASS con umbrales 70 intactos. El emparejamiento real quedó **parcial**: el usuario confirmó con capturas el vínculo y respuestas de Telegram tras configurar el nombre; falta aceptar respuesta/audio en la HMI vinculada (audio/orbe intermitente con HMI visible, no solo calentamiento). Siguiente: en la próxima sesión, reconfirmar el gate del contrato CL1 documental (`odd/tasks/prisma-channel-a-context-lifetime.md` — distinguir visitas de vista de refrescos de rutina vía frameGeneration + deadline de la respuesta capturada) y recién entonces el TDD del arreglo y la aceptación manual; este cierre ni un «continúa» genérico autorizan implementación (§3.4 del maestro). Al reanudar: leer el maestro completo (§11.1/§3.4), recuperar `checkpoint/prisma-channel-a-manager-resume`, el tracker, este índice y Git. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |
| PW-005 | pending | Prisma Runtime — cierre de desarrollo | Aplazado por el usuario: investigar y corregir la persistencia de procesos Prisma tras cerrar la terminal o repetir Ctrl+C. Un registro de propietario huérfano puede perpetuar la retención; la causa exacta del incidente no está demostrada. Retomar con diagnóstico offline autorizado y preservar procesos ajenos y propietarios activos; no matar ocupantes de puertos indiscriminadamente. | `backlog/prisma-development-shutdown-recovery` | 2026-09-22 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
