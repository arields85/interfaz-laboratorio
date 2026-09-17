# Prisma — historial curado y ledger de auditoría

> **Naturaleza:** registro histórico curado; no es la autoridad funcional activa.
>
> **Documento vigente:** [`PRISMA_DOCUMENTO_MAESTRO.md`](PRISMA_DOCUMENTO_MAESTRO.md).
>
> **Importante:** este archivo no es un archivo literal ni una copia íntegra del
> documento externo. El original 1.1.4 permanece intacto fuera del repositorio como
> respaldo histórico.

## 1. Propósito

Este ledger conserva decisiones materiales, evidencia y limitaciones que explican
por qué existe la arquitectura actual. Omite instrucciones operativas obsoletas,
identificadores privados y requisitos superados. Una entrada histórica demuestra lo
que se observó en su momento; no declara que siga aceptado hoy.

## 2. Fuente externa preservada

| Dato | Valor |
|---|---|
| Nombre | `PRISMA_DOCUMENTO_MAESTRO.md` |
| Versión | 1.1.4 |
| Fecha declarada | 2026-08-30 |
| Longitud observada | 2.436 líneas |
| SHA-256 observado antes de esta reconciliación | `B14DE554608DB98E84D9E7D7ABF1D8EB6700B108B419F22C87D4D7EDF79F49C1` |
| Tratamiento | Lectura y curación; no edición, movimiento ni importación literal. |

El hash sirve únicamente como evidencia de preservación. No convierte el original en
autoridad activa ni autoriza divulgar credenciales, IDs o detalles privados que pudiera
contener.

## 3. Línea de tiempo curada

### 2026-08-28 — MVP local y aceptación manual

La arquitectura local demostró el circuito de valor básico:

- la HMI publicó el dashboard visible;
- el parser respondió sobre dos máquinas vistas en momentos diferentes;
- Telegram entregó texto y audio;
- la HMI presentó voz y orbe sin duplicación observada en esa sesión;
- el escenario se ejecutó sin depender de la VPN del circuito central.

Esta aceptación fue válida para el MVP observado. No probó consulta fuera de pantalla,
multiusuario, instalación múltiple, despliegue remoto, recuperación durable ni ausencia
universal de cortes de audio.

### 2026-08-28 — aislamiento de perfiles

Se introdujeron fronteras explícitas entre perfil central y local:

- ownership de exportadores y listeners;
- destinos locales allowlisted;
- configuración local separada;
- TTS local sin fallback hacia la ruta legacy;
- conservación del perfil central durante cambios de modo.

Una reaceptación detectó que el scheduler central sobrevivía al cambio de perfil. La
causa se atribuyó a propietarios distintos del intervalo y el request. La corrección
unificó el ciclo de vida en el servicio y obtuvo cobertura automática. La evidencia
posterior del exportador cerró ese defecto específico, no toda la aceptación del
runtime.

### 2026-08-28 — contrato y ownership de configuración

La HMI aprendió a distinguir respuesta plana del perfil heredado y envelope local. El
backend instalado recibió una política donde el modo local permitía persistencia y el
modo administrado respondía 409. Esa distinción resolvía la coexistencia de dos modos
de la época.

**Estado actual de la decisión:** el requisito Managed/409 queda supersedido como
objetivo porque el producto Prisma Server/Node-RED fue retirado. Puede sobrevivir en
legado temporal; no es una condición que el nuevo runtime deba reproducir.

### 2026-08-28/29 — continuidad y estrategia de audio

Se observó una respuesta cuyo transporte duró considerablemente más que la duración
PCM resultante. La reproducción progresiva agotaba su adelanto y producía una pausa.
La corrección de aquella instalación acumuló PCM completo antes de iniciar una fuente
única y evitó el underflow en el escenario reproducido, a costa de latencia y memoria.
El navegador del repositorio actual volvió a una estrategia progresiva con umbral de
inicio o EOF; el resultado histórico no garantiza continuidad para esa ruta vigente.

Quedaron documentados estos límites:

- continuidad técnica no equivale a inicio rápido;
- una fuente iniciada no prueba audibilidad humana;
- las muestras disponibles no formaron un corpus repetido por longitud;
- un buffer finito no garantiza continuidad si el proveedor produce sostenidamente
  más lento que la reproducción;
- segmentación, paralelización o cambio de ruta TTS requieren medición previa;
- el PCM de HMI y el OGG de Telegram no deben compararse por igualdad binaria.

Un benchmark posterior terminó parcial tras una falla de proveedor antes del piloto.
No produjo mediciones aprobadas ni recomendación de modelo o estrategia. No se debe
reinterpretar como éxito o fracaso universal.

### 2026-08-30 — plan de migración al monorepositorio

La versión 1.1.4 definió trasladar selectivamente el runtime al repositorio, conservar
el entorno virtual bajo el servicio e instalar estado mutable en una ubicación de
máquina. También prohibió copiar ciegamente la instalación externa y borrar el legado
antes de aceptación.

Parte de esa migración existe hoy en
[`../../services/prisma-runtime/`](../../services/prisma-runtime/). El estado histórico
“no implementada” ya no describe el avance actual, pero tampoco puede considerarse
cerrada: faltan residual de launchers, schemas, instalaciones y aceptación, detallado
por `backlog/prisma-runtime-monorepo-integration`.

La ubicación de estado bajo `%LOCALAPPDATA%` y el entorno virtual propio del checkout
eran decisiones expresas, no anomalías. El bootstrap actual con lock hashado mejora
reproducibilidad, pero no prueba bootstrap limpio offline ni remoción exacta de paquetes
extra.

### 2026-09-17 — auditoría del repositorio

La auditoría previa a esta reconciliación informó:

- Python 74/74, incluidas 27 pruebas de entorno no rastreadas;
- ejecución desde cwd alternativo 27/27;
- HMI focalizada 72/72 en siete archivos;
- TypeScript app/Node sin emisión aprobado;
- parser PowerShell 7/7;
- compilación Python en memoria 21 archivos;
- `git diff --check` aprobado.

El checker de bindings falló por hashes distintos entre bytes CRLF y la versión LF de
Git. Después de normalizar LF, el render TypeScript coincidió. Por tanto, la evidencia
apunta a sensibilidad de newline, no a deriva semántica probada. Además, validadores
Python aceptaron dos formas que schema/TypeScript rechazan: payload requerido ausente e
ID con guion final. Los productores normales cumplieron, pero quedó pendiente paridad,
ownership y tests reproducibles.

En esa auditoría no había listeners en 5056/5057 y el manifiesto estaba obsoleto. No se
realizó reproducción en vivo de la causa. El cierre del proceso padre por OpenCode es
hipótesis; el fix previo del wrapper exitoso ya existe con pruebas. La identidad de
creación ausente es hardening pendiente, no causa demostrada.

## 4. Decisiones preservadas

| Decisión histórica | Tratamiento actual |
|---|---|
| Separar asistente y control industrial | Vigente e invariante. |
| Usar contexto estructurado, no píxeles | Vigente; debe evolucionar a fuente compartida con frescura. |
| Navegación declarativa, no clics por coordenadas | Vigente para el Canal A futuro. |
| Mantener una locución correlacionada | Vigente como intención; falta aislamiento por sesión. |
| Separar estado mutable del código | Vigente. |
| No copiar secretos ni estado generado | Vigente. |
| No borrar automáticamente el legado | Vigente hasta decisión explícita posterior a aceptación. |
| Prisma Local como sucesor del modo Server | Evolucionó a un único runtime repositorio con despliegue servidor y notebook. |
| Telegram refleja el navegador activo y dispara voz global | Supersedido por Canal B autónomo, personal y de texto. |
| Managed/409 para proteger configuración Server | Supersedido como requisito objetivo; solo puede persistir en legado. |
| Autocalibración U0.6 antes de evolucionar contexto | Ya no es gate universal; no aplica al Canal B de texto. Audio conserva aceptación propia. |
| Contexto limitado a widgets visibles | Limitación actual, no objetivo. |

## 5. Limitaciones que no deben perderse

- La aceptación manual histórica no reemplaza aceptación multiusuario, de reinicio o
  de despliegue remoto.
- El parser actual está acoplado a títulos, tipos e IDs de widgets y selecciona el
  primer match en varios casos.
- Un único snapshot persistido puede quedar obsoleto tras cerrar el navegador.
- Un único evento global puede ser consumido por contextos distintos.
- Telegram actual vincula chats, pero no autoriza cuenta, sesión e instalación como
  identidades independientes.
- El pairing y la revocación futuros pueden requerir identificadores mínimos en estado
  backend protegido; la prohibición aplica a su publicación en documentación, logs o
  exportaciones de diagnóstico, no a ese estado operativo autorizado.
- El runtime no implementa la fuente industrial ni garantiza datos fuera de pantalla.
- La HMI posee catálogo local y bindings canónicos parciales, no un catálogo backend
  completo con alias y permisos.
- Datos actuales e históricos son contratos distintos y no toda fuente garantiza
  histórico o cualquier rango.
- Gemini y Telegram requieren Internet incluso en presentación simulada.
- CORS wildcard del servicio de voz y configuración del frontend no son una frontera
  suficiente para clientes remotos o secretos.
- La latencia de respuestas largas y la audibilidad humana siguen sin aceptación
  integral.

## 6. Referencias vigentes

- Maestro activo: [`PRISMA_DOCUMENTO_MAESTRO.md`](PRISMA_DOCUMENTO_MAESTRO.md)
- Backlog activo: [`../PENDING_WORK.md`](../PENDING_WORK.md)
- Contrato de datos: [`../DATA_CONTRACT.md`](../DATA_CONTRACT.md)
- Runtime: [`../../services/prisma-runtime/`](../../services/prisma-runtime/)
- Arquitectura general: [`../ARCHITECTURE.md`](../ARCHITECTURE.md)

Los detalles privados del original, identificadores de eventos, cuentas y chats se
omitieron deliberadamente. Ante una contradicción, usar el maestro activo y verificar
el comportamiento actual; este ledger explica historia, no la gobierna.
