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
| PW-002 | pending | Leda Runtime | Con PAC-3 completo y aceptado offline, aceptar arranque e instalación limpios reales y completar forwarding, despliegue, supervisión y recuperación durable; la instalación legacy `C:\hmi_tts` se retiró el 2026-09-29 (la carrera concurrente de inicialización de estado quedó corregida y commiteada en `f865e79`). | `backlog/leda-runtime-monorepo-integration` | 2026-08-30 |
| PW-003 | pending | Leda Assistant — evolución posterior | CL aceptado para preguntas ejercitadas, Telegram, voz HMI y orbe; sin retest pendiente. [Diseño semántico acordado documentado](leda/LEDA_SEMANTIC_QUERY_SERVICE.md); [QRY-1–QRY-4](../odd/tasks/leda-semantic-query-service.md) pendientes, sin implementar ni autorización nueva. El backlog amplio conserva catálogo, interpretación textual, STT y navegación; Canal B: respuestas con nota de voz (antes PW-012) y preguntas por nota de voz en ambos canales (antes PW-013) ya implementadas y verificadas en vivo; la fuente de datos propia de ambos canales y el manejo de transcripciones largas o de varios temas siguen pendientes aquí. Implementar solo tras instrucción explícita nueva, sin pruebas, servicios ni proveedores automáticos. | `backlog/leda-dual-channel-assistant` | 2026-09-17 |
| PW-015 | pending | Administración — usuarios | La HMI no permite crear usuarios ni asignar niveles de acceso: solo existe una cuenta admin. Implementar alta/baja de usuarios y niveles (por ejemplo, visualización y administración); el admin de prueba dedicado al Chrome de control (antes PW-014, ya resuelto) espera esta implementación para poder desactivarse por separado. | `backlog/hmi-user-management` | 2026-09-24 |
| PW-023 | pending | Administración — segundo factor | El acceso de administrador usa solo contraseña. El 2026-10-01 el mínimo se bajó de 15 a 10 caracteres a pedido del usuario, compensado por el límite de intentos por cliente, HTTPS y la red interna; la guía NIST recomienda 15 cuando la contraseña es el único factor. Agregar un segundo factor (por ejemplo, una app TOTP) al inicio de sesión de administrador. Se relaciona con PW-015. Implementar solo con instrucción explícita. | `backlog/admin-second-factor` | 2026-10-01 |
| PW-024 | pending | Despliegue en servidor (IT) | Primer despliegue real de la HMI en un servidor de la empresa: IT (Lucas) la dockeriza desde un repositorio privado de GitHub con auto-deploy en cada push; el usuario la configura de cero desde el admin. Guía para IT en [`docs/DEPLOYMENT.md`](DEPLOYMENT.md), enviada y actualizada. El 2026-10-02 se creó el repositorio privado `Steigen-Dev/interfaz-hmi` (remoto `steigen`) y se subió `main`. Próximos pasos: que IT configure el contenedor y el auto-deploy desde ese repo, coordinar la creación del admin el día del despliegue. Se relaciona con PW-002. | `backlog/server-deployment-it-handoff` | 2026-10-01 |

| PW-026 | pending | Leda — demora de la primera consulta | La primera consulta al bot del Canal B después de un rato o de un reinicio tarda bastante; las siguientes responden muy rápido. El usuario cree que antes de PW-022 no pasaba (sin verificar). Medir los tiempos de cada etapa en frío y en caliente antes de decidir la causa. Implementar solo con instrucción explícita. | `backlog/leda-first-query-warmup` | 2026-10-02 |
| PW-027 | pending | Repositorio público | Por ahora el repo público `arields85/interfaz-laboratorio` (remoto `origin`) queda como respaldo, y cada push va a los dos repos: `origin` y `steigen` (`Steigen-Dev/interfaz-hmi`, privado). Cuando el despliegue desde el repo privado funcione bien (PW-024), decidir qué hacer con el público: dejarlo, archivarlo, hacerlo privado, borrarlo o dejar de pushearle. Hoy todo el código está visible públicamente. Se relaciona con PW-024. | `backlog/public-repo-decision` | 2026-10-02 |

## Protocolo

**Alta:** guardar el detalle en Engram con un `topic_key` estable `backlog/<slug>`, verificarlo con `mem_search` y `mem_get_observation`, y luego agregar la fila al índice.

**Cierre:** actualizar o cerrar el detalle en Engram y luego retirar la fila activa; Git conserva el historial.
