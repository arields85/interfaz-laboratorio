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
| PW-003 | pending | Prisma Assistant — evolución posterior | CL aceptado para preguntas ejercitadas, Telegram, voz HMI y orbe; sin retest pendiente. [Diseño semántico acordado documentado](prisma/PRISMA_SEMANTIC_QUERY_SERVICE.md); [QRY-1–QRY-4](../odd/tasks/prisma-semantic-query-service.md) pendientes, sin implementar ni autorización nueva. El backlog amplio conserva catálogo, interpretación textual, STT y navegación; Canal B sigue aplazado. Implementar solo tras instrucción explícita nueva, sin pruebas, servicios ni proveedores automáticos. | `backlog/prisma-dual-channel-assistant` | 2026-09-17 |
| PW-006 | pending | Prisma — Canal A y voz HMI | Tras integrar la rama de correcciones: demora de ~1 min en los mensajes de vinculación por Telegram, texto de confirmación poco claro (menciona "documento"), botones de vincular/desvincular que se pierden al desplazarse, sin indicador de "escribiendo", y consultas por voz en la HMI con demora, sin orbe o sin audio (más fluido antes de la migración desde `C:\hmi_tts`). Requiere diagnóstico de causa raíz. | `backlog/prisma-channel-a-responsiveness` | 2026-09-23 |
| PW-008 | pending | HMI — widgets | El gráfico del widget «Índice de actividad» (24H) ocupa solo ~40 % del ancho de la tarjeta, con el eje de tiempo comprimido y una etiqueta suelta «mir»; se ve también a 1920×1080 con zoom 1, así que no es evidente que lo cause PW-007. Se desconoce cuándo se rompió; revisar primero `927e56e` y comparar contra `main`. | `backlog/activity-index-chart-clipped` | 2026-09-24 |
| PW-009 | pending | Prisma — respuestas | En un dashboard con varias máquinas, Prisma mezcla datos de equipos distintos: respondió «Paracetamol 500 mg, correspondiente al lote LX-0826» cuando LX-0826 es Diclofenac 50 mg (Reiner). Las preguntas ambiguas («¿Cuál es el OEE?») responden sin nombrar la máquina. Defecto de corrección en `answer_from_snapshot`; relacionado con PW-003. | `backlog/prisma-answer-mixes-machines` | 2026-09-24 |
| PW-004 | pending | Configuración general | `Guardar` se habilita con el OR del estado sucio de los cinco tabs pero despacha solo el guardado del tab activo, y el footer muestra estado solo del activo: se puede ver Guardar habilitado sin que guarde lo que el usuario cree pendiente. Decidir si Guardar guarda el tab activo o todos los que tengan cambios, y si los flags sucios de una sola dirección deben comparar contra lo persistido. | `backlog/global-settings-save-button-scope-desync` | 2026-09-19 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
