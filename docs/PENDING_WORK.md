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
| PW-003 | pending | Prisma Assistant — evolución posterior | CL aceptado para preguntas ejercitadas, Telegram, voz HMI y orbe; sin retest pendiente. [Diseño semántico acordado documentado](prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md); [QRY-1–QRY-4](../odd/tasks/prisma-semantic-query-service.md) pendientes, sin implementar ni autorización nueva. El backlog amplio conserva catálogo, interpretación textual, STT y navegación; Canal B: respuestas con nota de voz en PW-012 y preguntas por nota de voz en PW-013; la fuente de datos propia de ambos canales sigue aquí. Implementar solo tras instrucción explícita nueva, sin pruebas, servicios ni proveedores automáticos. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-012 | pending | Prisma — Canal B | En curso: el Canal B (bot personal a distancia) responde además con una nota de voz en el chat de Telegram, generada por el runtime sin depender de ninguna HMI abierta; la HMI no reproduce nada. De forma provisoria responde según lo que muestra la pantalla, como antes de la migración, hasta que exista la fuente de datos propia (PW-003). Tareas en [`odd/tasks/prisma-channel-b-voice-replies.md`](../odd/tasks/prisma-channel-b-voice-replies.md). | `backlog/prisma-channel-b` | 2026-09-24 |
| PW-013 | pending | Prisma — Canales A y B | Aceptar preguntas por nota de voz de Telegram (convertidas a texto) en los dos canales, además de las escritas. Proveedor y enfoque de voz a texto por decidir con el usuario; después de PW-012. | `backlog/prisma-voice-note-questions` | 2026-09-24 |
| PW-011 | pending | Prisma — Canal A y voz HMI | Seguimientos menores heredados de PW-006: ráfagas de 401 en `/internal/prisma/voice-events/<id>`, confirmar que la HMI vuelve de polling a SSE, la expiración por inactividad deja el menú y el teclado «Desvincular» en Telegram, logs de tiempos en nivel WARNING y la acción «escribiendo» que puede llegar después de la respuesta. | `backlog/prisma-voice-minor-followups` | 2026-09-24 |
| PW-008 | pending | HMI — widgets | El gráfico del widget «Índice de actividad» (24H) ocupa solo ~40 % del ancho de la tarjeta, con el eje de tiempo comprimido y una etiqueta suelta «mir»; se ve también a 1920×1080 con zoom 1, así que no es evidente que lo cause PW-007. Diagnosticado: `TrendChartV2PresentationRenderer` mide el mismo contenedor al que le fija 320 px (desde `4d55a85`, no PW-007); falta el arreglo. | `backlog/activity-index-chart-clipped` | 2026-09-24 |
| PW-009 | pending | Prisma — respuestas | En un dashboard con varias máquinas, Prisma mezcla datos de equipos distintos: respondió «Paracetamol 500 mg, correspondiente al lote LX-0826» cuando LX-0826 es Diclofenac 50 mg (Reiner). Las preguntas ambiguas («¿Cuál es el OEE?») responden sin nombrar la máquina. Defecto de corrección en `answer_from_snapshot`; relacionado con PW-003. | `backlog/prisma-answer-mixes-machines` | 2026-09-24 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
