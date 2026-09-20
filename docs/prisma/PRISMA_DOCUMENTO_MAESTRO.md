# Prisma — documento maestro

> **Autoridad activa:** referencia funcional, arquitectónica y de entrega de Prisma en este repositorio.
>
> **Versión documental:** 2.0.10
>
> **Fecha:** 2026-09-20
>
> **Estado del producto:** runtime local, enrutamiento web same-origin y acceso protegido (autenticación y credenciales) cerrados offline; la carrera de sembrado concurrente quedó corregida y endurecida (`f865e79`, `855c26b`); despliegue productivo, aceptación integral y el trabajo posterior del asistente siguen pendientes.
>
> **Alcance de esta versión:** cierre de la sesión de diagnóstico del sondeo de Telegram, no del
> recorrido local completo. Se registran el diagnóstico saneado de salud, la corrección del esquema
> estricto administrativo, la recuperación del sondeo tras la corrección del token por parte del
> usuario y la aceptación real de UI del `Apply`. El próximo paso vigente (§11.1) deja de ser solo
> launcher y credenciales sin probar: pasa a la prueba de mensaje propiedad del usuario y a la
> verificación fresca observable. `PW-002`, `PW-003` y `PW-004` siguen pendientes o aplazados. Cambio
> exclusivamente documental: no ejecuta servicios, pruebas ni proveedores.

## 1. Objetivo y estado general

Prisma debe convertirse en el asistente de consulta de solo lectura de la HMI. Debe
consultar datos consistentes de instalaciones autorizadas y ofrecer dos experiencias
separadas:

- **Canal A — HMI:** conversación por voz, búsqueda de equipos o variables aunque no
  estén en la vista actual, aclaración de ambigüedades, navegación de la sesión que
  originó la consulta y respuesta audible.
- **Canal B — Telegram personal:** consultas de texto sobre una instalación
  autorizada, sin navegador, sin publicador de snapshots y sin producir audio ni
  navegación global en la HMI.

El objetivo está **aprobado pero no implementado**. El repositorio ya contiene un
runtime de presentación y voz, integración HMI y contratos parciales, pero su flujo
actual sigue dependiendo del último snapshot visible y no satisface el modelo completo de dos
canales ni el despliegue remoto. La configuración protegida está cerrada offline (PAC-1 a PAC-5),
pero su validación productiva sigue pendiente.

### 1.1 Resumen de estado

| Área | Estado al 2026-09-17 | Conclusión |
|---|---|---|
| Runtime bajo propiedad del repositorio | Integrado localmente con evidencia offline | En Windows, `npm run dev` adquiere Prisma antes de Vite con ownership exacto; bootstrap sigue siendo explícito. Faltan aceptación real de arranque e instalación limpia, despliegue/supervisión productivos, validación productiva del acceso protegido y retiro controlado del legado. |
| Voz HMI y orbe | Implementados con evidencia histórica parcial | Hubo aceptación manual exitosa; continuidad, audibilidad humana, cancelación y recuperación no están aceptadas de forma integral. |
| Consultas de datos | Implementación limitada | El parser responde por palabras clave sobre un único snapshot visible persistido. No consulta aún una instalación completa ni garantiza datos fuera de pantalla. |
| Canal A — micrófono y navegación | Pendiente | No existe entrada STT/micrófono ni navegación solicitada por Prisma. La HMI sí posee rutas publicadas que pueden ser una base futura. |
| Canal B — Telegram autónomo | Pendiente | El bot actual consulta el snapshot visible y publica un evento global de voz; no es el canal de texto aislado aprobado. |
| Datos reales | Disponibles en la HMI según reporte del usuario | El usuario reporta tres máquinas reales visualizables; esta revisión no accedió a ellas ni validó alcance histórico. |
| Presentación simulada | Parcialmente implementada | Existen bindings simulados y fixtures determinísticos; todavía falta un modo demo unificado donde HMI y Prisma compartan un dataset coherente. Nunca debe actuar como fallback silencioso ante una falla real. |
| Configuración y diagnósticos | Cerrados offline con verificación independiente | Health expone configuración sin verificar proveedores y el runtime tolera secretos ausentes. El almacenamiento cifrado, la API protegida, el flujo de credenciales en Configuración general → Prisma y el modelo separado de estados se cerraron offline (PAC-2 a PAC-4, verificación PAC-5); la aceptación real y el modelo completo de estados siguen pendientes. |
| Seguridad de acceso | Protegida offline; insuficiente para despliegue remoto | La autenticación de administrador backend y el almacenamiento cifrado de credenciales se cerraron offline (PAC-1 a PAC-4, verificación PAC-5). El CORS wildcard histórico del servicio de voz y la autorización por instalación siguen sin resolver para un despliegue remoto productivo. |
| Enrutamiento web de Prisma | Cerrado offline con verificación independiente | El navegador usa cuatro rutas same-origin fijas. Node-RED continúa como fuente de telemetría industrial, no como runtime Prisma seleccionable. |

La autoridad de descubrimiento del trabajo pendiente continúa en
[`../PENDING_WORK.md`](../PENDING_WORK.md). El detalle se conserva en los topics
estables `backlog/prisma-runtime-monorepo-integration` y
`backlog/prisma-dual-channel-assistant`; este documento no crea un backlog paralelo.

## 2. Cómo interpretar esta referencia

Este documento separa cinco clases de información para evitar que una aspiración se
lea como capacidad entregada:

1. **Implementado:** existe en el repositorio y su comportamiento fue inspeccionado.
2. **Verificado:** existe evidencia con fecha y alcance declarados.
3. **Objetivo aprobado:** define el producto deseado, pero puede no existir aún.
4. **Diseño propuesto:** recomendación pendiente de decisión o implementación.
5. **Decisión abierta:** no debe cerrarse por inferencia.

El código ordinario evidencia el comportamiento actual; no convierte un defecto en
requisito correcto. Las pruebas aportan evidencia sobre los casos cubiertos; no
reemplazan una aceptación de navegador, audio, proveedor o máquinas reales. El
objetivo aprobado define hacia dónde debe evolucionar el producto.

## 3. Límites invariantes

### 3.1 Solo lectura industrial

Prisma puede consultar telemetría y navegar la interfaz, pero nunca controlar la
planta. Quedan prohibidos en ambos canales:

- arranque o parada de equipos;
- cambios de setpoints, recetas o parámetros industriales;
- actuación sobre PLC, actuadores o procesos;
- reconocimiento, reseteo o confirmación de alarmas;
- escrituras a endpoints de control industrial.

La navegación por dashboard, vista o filtro es una acción de interfaz de solo lectura,
no una orden de planta. La configuración de la propia HMI y sus integraciones también
queda fuera del plano de control industrial.

### 3.2 Separación entre datos y asistente

La HMI consume un contrato JSON estable; no consume una tecnología específica. El
contrato vigente está en [`../DATA_CONTRACT.md`](../DATA_CONTRACT.md). Node-RED u otra
tecnología puede seguir aportando telemetría detrás de ese contrato. Lo retirado como
objetivo es el antiguo **producto Prisma Server/Node-RED**, no la posibilidad de usar
Node-RED como fuente desacoplada de datos de solo lectura.

### 3.3 Privacidad y credenciales

Tokens, claves, identificadores privados de cuentas o chats, preguntas y contenido de
audio no deben publicarse en documentación, logs ni exportaciones de diagnóstico. Los
secretos tampoco pueden quedar en Git, `localStorage`, bundles del cliente, parámetros
GET ni respuestas de lectura. El backend protegido puede conservar el estado operativo
mínimo necesario para autenticación, pairing, autorización y revocación, con acceso y
retención limitados. Las pruebas pagadas o que envían mensajes deben requerir una
acción separada y explícita.

## 4. Implementación actual observada

### 4.1 Runtime del repositorio

El runtime actual vive en
[`../../services/prisma-runtime/`](../../services/prisma-runtime/). Sus componentes
principales son:

| Componente actual | Responsabilidad observada |
|---|---|
| [`local_presentation.py`](../../services/prisma-runtime/src/prisma_runtime/local_presentation.py) | Recibe y persiste un snapshot visible, aplica un parser determinístico, coordina el bot y expone el último evento global. |
| [`voice_service.py`](../../services/prisma-runtime/src/prisma_runtime/voice_service.py) | Genera TTS con Gemini, aplica DSP, transmite PCM y puede derivar audio para Telegram. |
| [`paths.py`](../../services/prisma-runtime/src/prisma_runtime/paths.py) | Resuelve estado mutable fuera del código del servicio. |
| [`operations/`](../../services/prisma-runtime/operations/) | Bootstrap, inicio, preflight, detención y verificación locales. |

La integración actual usa dos procesos locales:

- presentación en `127.0.0.1:5057`;
- voz en `127.0.0.1:5056`.

Los endpoints ya inspeccionados y relevantes para describir el presente son:

| Servicio | Método y ruta | Uso actual |
|---|---|---|
| Presentación | `GET /health` | Liveness y metadata del puente; su readiness de voz deriva del probe al proceso 5056. |
| Presentación | `GET/POST /hmi/current-snapshot` | Lee o reemplaza el snapshot visible persistido. |
| Presentación | `GET /hmi/voice/latest` | Devuelve un único último evento global. |
| Presentación | `POST /local/ask` | Ejecuta el parser sin Telegram y publica un evento. |
| Presentación | `GET/PUT /hmi/prisma-config` | Proxy de configuración de voz. |
| Voz | `GET /health` | Liveness y metadata; `providerStatus` informa configuración y `verified:false` sin llamar al proveedor. |
| Voz | `GET/PUT /prisma/config` | Lee o reemplaza configuración local de voz. |
| Voz | `POST /prisma/speak-live` | Genera y transmite la locución. |

Esta lista describe API existente; no es una instrucción para iniciar servicios ni
autoriza pruebas contra proveedores.

Los campos `ok` y `ready` del health de voz declaran readiness del proceso, no del
proveedor. `providerStatus.configured` refleja solo presencia no vacía de la clave y
`verified` permanece en `false`; health no solicita Gemini. El health de presentación
confía en el `ok` del proceso local. Por tanto, prueban liveness y conectividad local,
no autenticación ni readiness genuina del proveedor.

### 4.2 Flujo actual de preguntas

El comportamiento actual es, de forma simplificada:

```text
dashboard visible
  -> snapshot periódico al puente local
  -> un archivo conserva el último snapshot
  -> Telegram o /local/ask entrega texto
  -> parser por palabras clave examina widgets[] visibles
  -> se genera respuesta textual
  -> se reemplaza un único evento de voz global
  -> todos los navegadores que consultan el endpoint pueden observar ese evento
  -> el navegador solicita TTS y presenta el orbe
```

[`answer_from_snapshot()`](../../services/prisma-runtime/src/prisma_runtime/local_presentation.py)
reconoce intenciones específicas como producto, lote, OEE, estado, actividad,
potencia, progreso, tiempo restante, alertas y resumen. No es un motor de consulta
general, no usa Gemini para comprender la pregunta y no puede buscar por sí mismo
equipos o variables fuera del snapshot visible.

El snapshot persiste sin una caducidad obligatoria después de cerrar el navegador.
Existe un único evento más reciente, también global. Esta combinación puede producir
respuestas obsoletas, consumo duplicado o interferencia entre contextos. Debe tratarse
como una limitación pendiente, no como contrato objetivo.

### 4.3 Integración HMI actual

La HMI consume Prisma exclusivamente mediante cuatro rutas same-origin fijas:
`/api/prisma/snapshot`, `/api/prisma/events/latest`, `/api/prisma/voice-config` y
`/api/prisma/tts/live`. El contrato completo se documenta en
[`PRISMA_BROWSER_ROUTING.md`](./PRISMA_BROWSER_ROUTING.md). El navegador no conoce
destinos de loopback, no selecciona runtimes y no acepta endpoints Prisma editables.

Durante desarrollo, Vite reenvía únicamente esas rutas exactas a los servicios de
loopback. En producción, el host administrado por IT deberá ofrecer forwarding
equivalente, preservar headers y streaming progresivo de TTS, y excluir estas rutas del
fallback de la SPA. El producto de proxy, autenticación, certificados y supervisión
continúa pendiente; el proxy de desarrollo no constituye autorización backend.

[`package.json`](../../hmi-app/package.json) enruta únicamente `dev` por un wrapper Node
que intenta adquirir Prisma en Windows y luego ejecuta el CLI instalado de Vite sin
modificar sus argumentos. `build`, `preview` y tests no adquieren Prisma. [`main.tsx`](../../hmi-app/src/main.tsx) y
[`App.tsx`](../../hmi-app/src/App.tsx) inicializan exclusivamente el cliente del
navegador: no existe allí un propietario del arranque del runtime ni el cierre de una
pestaña invoca su detención. El router usa `createBrowserRouter`, por lo que el futuro
host de producción también deberá resolver el fallback de la SPA. No se encontró en el
repositorio un propietario del despliegue productivo, servicio del sistema operativo ni
configuración de host: el pipeline administrado por IT sigue como objetivo y no debe
confundirse con el servidor de desarrollo de Vite.

La HMI ya puede consumir datos actuales mediante `/api/hmi-data`, resolviendo
`unitId/machineId + variableKey`, y usa un contrato separado para histórico. El
runtime Prisma no implementa esa fuente industrial. Dashboards, jerarquía y catálogo
se conservan hoy en el navegador; `catalogVariableId` aporta identidad canónica, pero
todavía no existe un mapeo backend completo de instalaciones, alias y permisos.

Las rutas de dashboard admiten `dashboardId` y `viewId` y ya validan destinos
publicados. Esa capacidad puede soportar una futura navegación declarativa, pero
Prisma todavía no la solicita ni recibe confirmación de finalización.

### 4.4 Configuración actual

La configuración no sensible de efectos de voz se lee y escribe mediante la ruta fija
same-origin `/api/prisma/voice-config` y se administra desde **Configuración general →
Voz**. El runtime también recibe configuración sensible mediante variables de proceso.
El backend ya inicia sin Gemini ni Telegram configurados. Desde PAC-2 a PAC-4 el
almacenamiento cifrado, la API protegida y la administración de credenciales desde
**Configuración general → Prisma** existen y fueron aceptados offline (ver §11); la
aceptación real y el despliegue productivo siguen pendientes.

El runtime del repositorio mantiene estado mutable bajo el directorio local de la
aplicación y un entorno virtual propio bajo el servicio. Esto coincide con la decisión
histórica de separar estado de máquina y estado derivado del checkout. El bootstrap
explícito conserva la creación del entorno y reconciliación del lock.
[`start-local.ps1`](../../services/prisma-runtime/operations/start-local.ps1) ya no lo
invoca: inicializa estado sin secretos, valida intérprete y dependencias propias, y falla
antes de lanzar procesos con remedio hacia `bootstrap-local.ps1` cuando faltan. Bajo
PowerShell 5.1, el stderr esperado de imports faltantes se normaliza sin ocultar
excepciones no relacionadas. Aun así:

- una instalación limpia reproducible no está aceptada en un entorno real;
- el lock con hashes no implica eliminación exacta de paquetes extra ya presentes;
- el arranque automático local está implementado y verificado offline, pero instalación
  limpia, operación real, recuperación durable y despliegue productivo siguen pendientes
  de aceptación.

Sin clave Gemini o con una clave en blanco, ambos endpoints de voz devuelven HTTP 503
con `GEMINI_API_KEY_MISSING` y remedio accionable, sin construir cliente ni llamar al
proveedor. Telegram opt-in sin token se informa como habilitado pero no configurado; no
construye ni inicia bot. Lo anterior describe la fuente legacy, vigente solo cuando el
modo protegido no fue seleccionado; el almacenamiento cifrado de secretos y la UI de
credenciales existen desde PAC-2–PAC-4 y se aceptaron offline (ver §11).

El wrapper local reutiliza un runtime manual verificado sin asumir ownership ni
detenerlo. Varias invocaciones de desarrollo comparten una generación y solo la última
liberación normal detiene identidades exactas iniciadas por desarrollo. Ctrl+C converge
en esa liberación; cerrar el navegador no detiene Prisma. No se afirma durabilidad ante
cierre abrupto de consola o reinicio del sistema operativo. `npm run dev` conserva esta
orquestación previa y Vite expone las cuatro rutas same-origin sin requerir una selección
en el navegador.

El selector Server/Local, el tipo y perfil de runtime, la rama de query y los endpoints
Prisma editables ya no forman parte del flujo activo. Las claves de modo, parámetros de
query y valores de endpoints anteriores pueden permanecer físicamente en el navegador,
pero son inertes; no se migran ni se eliminan globalmente. La telemetría industrial y el
resto de `localStorage` no fueron alterados por este retiro.

No existe un requisito aprobado de bootstrap limpio completamente offline. Las
dependencias de Internet continúan aplicando a Gemini y Telegram aun cuando la
telemetría sea simulada.

### 4.5 Frontera de acceso actual

El servicio de presentación limita orígenes de desarrollo conocidos. El servicio de
voz responde actualmente con CORS wildcard para `GET`, `POST`, `PUT` y `OPTIONS`; esto
fue confirmado mediante probes Flask simulados sobre código preexistente en Git.
La explotabilidad desde un navegador depende del despliegue, pero la protección debe
resolverse antes de exponer credenciales o clientes web remotos.

La lista actual de chats permitidos y la vinculación del primer `/start` no equivalen
a autenticación de cuenta, autorización por instalación ni aislamiento de sesión.
Bot, cuenta personal y chat autorizado son identidades diferentes y deben modelarse
por separado.

## 5. Evidencia y limitaciones verificadas

### 5.1 Auditoría de 2026-09-17

Los siguientes resultados pertenecen a una auditoría anterior de la misma fecha. No
fueron reejecutados por esta actualización documental:

| Comprobación | Resultado informado |
|---|---|
| Python | 74/74; incluye 27 pruebas de entorno aún no rastreadas. |
| Python desde directorio alternativo | 27/27. |
| HMI focalizada | 72/72 en 7 archivos. |
| TypeScript | `noEmit` aprobado para app y Node. |
| PowerShell | 7/7 archivos aceptados por el parser AST. |
| Python en memoria | 21 archivos compilaron. |
| Whitespace | `git diff --check` aprobado. |

En esa auditoría, el checker de bindings terminó con código 1. El hash del archivo con
CRLF fue distinto del hash del contenido de Git con LF: esto demuestra sensibilidad a
finales de línea, no un cambio semántico posterior a la generación. El render TypeScript
coincidió tras normalizar LF. Los validadores del generador Python aceptan un payload requerido
ausente y un ID terminado en guion que TypeScript y el schema rechazan. Los productores
normales cumplían, pero en ese momento faltaban propiedad clara del generador, paridad
y tests reproducibles del checker. El cierre actual de ese subproblema se documenta a
continuación; este registro no modifica el schema canónico.

#### Incremento actual del contrato de audio

El incremento acotado FND-1/FND-2 corrigió ese subproblema sin modificar el schema
canónico ni ampliar requisitos de producto. El digest normaliza únicamente finales de
línea; el checker compara en memoria el cuerpo completo de ambas proyecciones; y el
validador generado Python aplica el patrón exacto de `run_id`, campos requeridos y
números finitos. Python conserva enteros arbitrarios para secuencias y contadores. La
proyección TypeScript continúa limitada al navegador y conserva la misma API pública;
allí las secuencias y payloads de tipo entero deben ser enteros seguros representables
por JavaScript mediante `Number.isSafeInteger`. Esta seguridad de representación no
modifica el schema canónico ni establece un máximo universal entre lenguajes.

La primera ejecución observó 14/14 pruebas Python de audio, 82/82 pruebas Python del
runtime, 6/6 pruebas TypeScript focalizadas y 1964/1964 pruebas HMI, además de ambos
typechecks y el checker con código 0. Son pruebas locales con estado temporal aislado:
no prueban audio real, proveedor, acceso remoto, durabilidad ni aceptación operativa.

La revisión independiente detectó después una ampliación involuntaria: cambiar
`Number.isSafeInteger` por `Number.isInteger` había debilitado la validación TypeScript
sin ser necesario para corregir la divergencia Python. La corrección restauró el límite
seguro y agregó al discovery Python una comprobación contra las proyecciones reales del
repositorio. La ejecución posterior observó 15/15 pruebas Python de audio, 83/83 del
runtime, 9/9 TypeScript focalizadas y 1967/1967 de la HMI en 198 archivos; ambos
typechecks y el checker finalizaron con código 0. El padre confirmó de forma
independiente 83/83 pruebas Python y 9/9 TypeScript focalizadas, además de checker y
`git diff --check` con código 0, schema y TypeScript generado sin diferencias, y hashes
sin cambios para Gauge/Kpi. La HMI completa 1967/1967 y ambos typechecks permanecen como
evidencia del escritor. Este cierre cubre solo hash, cuerpo generado, campos requeridos,
paridad validada y discovery por defecto; no prueba todos los bordes numéricos ni
constituye aceptación real de runtime, audio, proveedor o acceso. La Entrega 1.1
permanece abierta.

#### Incremento de inicio seguro sin configurar

FND-6/FND-7/FND-8 separó bootstrap e inicio normal, habilitó el backend sin secretos y
agregó diagnósticos pasivos sin llamadas a proveedor. La primera evidencia del escritor
y del verificador aprobó 92/92 pruebas, pero fue insuficiente: un probe real de imports
faltantes bajo Windows PowerShell 5.1 y `$ErrorActionPreference = 'Stop'` descubrió que
`NativeCommandError` evitaba el remedio previsto. Esa evidencia se conserva como hito
intermedio, no como cierre correcto.

La corrección agregó una regresión real con el intérprete propio y `-B -S`, normalizó
solo el error nativo esperado a resultado falso y conservó el rethrow de excepciones no
relacionadas. El escritor observó 31/31 pruebas focalizadas y 93/93 del runtime. El
verificador fresco confirmó 31/31, 93/93 y un probe separado con estos resultados:
dependencias ausentes → `false`; assertion → remedio `bootstrap-local.ps1`; dependencias
presentes → `true`; excepción ajena → rethrown. ScriptBlock, AST y `git diff --check`
aprobaron.

La aprobación es exclusivamente offline. No prueba listeners reales, arranque de
servicios, proveedor, audio, red, instalación limpia, despliegue productivo ni acceso.
RDD estuvo desactivado y no existe receipt.

#### Incremento de desarrollo local con `npm run dev`

FND-9/FND-10/FND-11 cerró offline el arranque local Windows mediante un wrapper Node y
ownership en el manifiesto canónico. La evidencia inicial del escritor —104 pruebas
Python, 1976 HMI y 9 del wrapper— fue insuficiente: PowerShell 5.1 emitía un BOM en el
receipt y Node rechazaba el JSON después de registrar al owner. La corrección abarcó la
clase completa de fallas de escritura, lectura y entrega: UTF-8 sin BOM, registro y
receipt bajo el mismo lock, rollback específico para adquisición fría o compartida,
recuperación estrecha por token de invocación e identidad viva canónica, release normal
todavía ligado a generación y limpieza temporal incapaz de reemplazar el resultado.

El escritor corregido aprobó Vitest 13, Python 107, HMI 1980/1980 en 199 archivos,
ambos typechecks, build y lint; el build transformó 2722 módulos en 7,86 s. El
verificador independiente aprobó 13/13, 107/107, cuatro ScriptBlock/AST, whitespace,
bytes reales PowerShell→Node y casos adicionales de ownership. El spotcheck final del
padre aprobó 13/13 en 274 ms y Python 107/107 en 12,278 s; no hubo cambios de fuente
posteriores. Solo persistieron warnings conocidos de `grid.svg`, tamaño de chunks,
Canvas de jsdom y LF/CRLF.

La aprobación es offline: no cubre Vite o Prisma reales, listeners, proveedor,
instalación, producción, cierre abrupto ni reinicio del sistema. RDD permaneció
desactivado; el rechazo del assessment nativo por tres archivos no rastreados se trató
como riesgo HIGH y se compensó con verificación independiente, sin receipt RDD.

### 5.2 Evidencia manual histórica

El usuario aceptó manualmente en sesiones anteriores el circuito HMI, audio, orbe y
Telegram. Esa evidencia demuestra valor de MVP y no debe descartarse. Tampoco debe
elevarse a aceptación universal: pruebas posteriores observaron ausencia de listeners
en 5056/5057 y un manifiesto obsoleto. No se reprodujo en vivo la causa durante la
auditoría de 2026-09-17.

El usuario aclaró posteriormente que Prisma no se detuvo espontáneamente durante el
uso: respondió en consultas posteriores mientras el launcher o su terminal no fueran
cerrados. Por esa razón se retira del alcance activo la investigación propuesta sobre
“por qué se detienen” los procesos. La observación de listeners ausentes y manifiesto
obsoleto permanece como hecho histórico, pero no demuestra una caída espontánea, una
causa ligada al terminal ni un bug corregido. Si aparece una falla real durante el uso,
se registrará como un incidente nuevo con evidencia reproducible.

La finalización del proceso iniciador bajo el ciclo de vida de un job de OpenCode es
una hipótesis no probada. La terminación en el camino exitoso del wrapper ya fue
corregida con pruebas en el commit `2bc7ff1`. La ausencia de identidad de creación del
proceso es un borde de robustez acotado, no una causa demostrada. Comparar de forma
exacta el binario del listener con el ejecutable del entorno virtual tampoco es seguro
en Windows, donde puede existir handoff entre wrappers.

### 5.3 Audio

Una corrección histórica de la instalación externa evitó el corte reproducido en aquel
escenario mediante buffering completo antes de reproducir, con el costo de aumentar el
tiempo hasta el primer sonido. No demuestra continuidad universal. El navegador del
repositorio actual usa transporte progresivo por defecto: encola PCM por chunks y
comienza al alcanzar un umbral o al llegar EOF. Las muestras previas no forman un
benchmark corto/medio/largo repetido; generación, decodificación y reproducción
técnica tampoco prueban ausencia de cortes ni audibilidad humana.

La autocalibración por dispositivo descrita en el documento externo fue una propuesta
histórica. No es un prerrequisito automático para el nuevo Canal B de Telegram de
texto, que no reproduce audio. Cualquier evolución futura de audio debe medirse y
aprobarse por separado.

## 6. Objetivo aprobado

### 6.1 Un runtime y dos formas de despliegue

El producto objetivo tiene un único Prisma bajo propiedad del repositorio:

- despliegue servidor para navegadores remotos;
- notebook de presentación autónoma para demostraciones o uso local controlado.

En ambos casos Prisma debe iniciar automáticamente y de forma invisible como parte de
la operación del despliegue HMI, no como un proceso manual por pestaña o navegador. El
cierre de un navegador no debe detener el runtime y Telegram debe conservar su
autonomía. Esto no define arranque automático del sistema operativo ni selecciona un
servicio, framework de escritorio o administrador de procesos: primero debe elegirse el
propietario real del despliegue.

El navegador no debe conocer puertos de loopback como arquitectura final. Se
recomienda una frontera backend del mismo origen para el cliente web. Los mecanismos
exactos de autenticación, almacenamiento de secretos, proxy o gateway y despliegue aún
no están seleccionados.

El modo Prisma Server/Node-RED anterior queda retirado como objetivo. Su requisito
histórico de configuración administrada y respuesta 409 está **supersedido para el
nuevo runtime**; no fue preservado ni corregido por esta documentación. El código o la
instalación legado solo se eliminarán tras aceptación y decisión explícitas, nunca de
forma automática.

### 6.2 Canal A — HMI por voz

El flujo objetivo es:

```text
usuario habla en una HMI
  -> STT obtiene texto dentro de esa sesión
  -> Prisma identifica instalación, equipo, variable y rango
  -> si hay ambigüedad, pregunta antes de actuar
  -> consulta la fuente compartida, incluso fuera de la pantalla visible
  -> si corresponde, solicita navegación declarativa
  -> la HMI valida un destino publicado y confirma la nueva vista
  -> Prisma responde con datos frescos y procedencia
  -> solo la sesión solicitante reproduce la respuesta
```

Reglas obligatorias:

- la navegación solo afecta a la sesión que hizo la pregunta;
- el destino debe estar publicado y validado mediante IDs estables;
- no se responde desde el contexto anterior si falla o vence la navegación;
- una nueva pregunta puede cancelar o reemplazar el trabajo anterior;
- la respuesta conserva alcance, timestamp, frescura y procedencia;
- no existe ningún comando industrial en el mismo canal.

### 6.3 Canal B — Telegram personal autónomo

El Canal B recibe texto y responde texto. Debe funcionar sin navegador, snapshot o
publicador de pantalla. Consulta una instalación previamente autorizada mediante la
misma frontera de datos que el Canal A.

Reglas obligatorias:

- no publica eventos globales de HMI;
- no reproduce audio ni navega una HMI;
- separa credencial del bot, cuenta personal y asociación de chat;
- autoriza explícitamente qué instalación puede consultar cada identidad;
- impide mezcla de datos entre usuarios, instalaciones y sesiones;
- aplica límites, cancelación, auditoría redactada y revocación.

Esta definición reemplaza la interpretación provisional anterior de “Telegram remoto
vinculado al navegador activo”.

### 6.4 Datos reales y presentación

El usuario informa tres máquinas reales visualizables actualmente. La primera entrega
de datos debe probar una máquina real y luego las tres, sin IDs especiales ni lógica
hardcodeada por máquina. No se asume que todas las instalaciones ofrecen histórico o
los mismos rangos de consulta.

La presentación simulada debe seleccionar explícitamente un catálogo y dataset
coherentes. HMI y Prisma deben observar los mismos valores, timestamps y procedencia.
Una falla de datos reales debe mostrarse como falla; no puede activar simulación en
silencio.

La frontera compartida de datos deberá resolver como mínimo:

- instalación y autorización;
- equipos, alias y variables canónicas;
- valor actual, unidad, timestamp, estado y fuente;
- histórico disponible y rangos admitidos, cuando existan;
- frescura y motivo de indisponibilidad.

Se propone un catálogo compartido de instalaciones y una frontera de consulta común.
Su modelo concreto está pendiente. Esto no autoriza reescribir toda la persistencia de
la HMI ni crear un framework genérico de plugins.

### 6.5 Configuración en la HMI

**Configuración general → Prisma** será propietaria de la experiencia de configuración
de Gemini, Telegram opcional y las integraciones que realmente necesite el runtime.
El flujo normal no debe pedir edición manual de `.env`.

Requisitos:

- el runtime inicia sin configurar y lo declara de forma segura;
- secretos guardados y leídos exclusivamente por el backend protegido;
- la UI puede recibir una credencial de forma transitoria para enviarla por un canal
  protegido, pero no persistirla ni volver a mostrarla;
- nunca se devuelven secretos en GET ni se almacenan en Git o `localStorage`;
- reemplazar y eliminar una credencial son operaciones explícitas;
- Guardar persiste; no afirma que el proveedor quedó verificado;
- Aplicar o reconectar informa qué proceso o sesión adoptó la configuración;
- una integración opcional deshabilitada no es un error;
- los tests pagos de audio o mensajería se activan por separado de los checks pasivos.

### 6.6 Diagnósticos honestos

Cada integración debe distinguir, como mínimo:

| Estado | Significado |
|---|---|
| `missing` | Falta configuración requerida. |
| `configured` | Existe configuración, aún no verificada. |
| `checking` | Hay una comprobación en curso. |
| `verified` | Una comprobación definida tuvo éxito para un alcance y momento concretos. |
| `failing` | La comprobación falló con razón y remedio. |
| `disabled` | Integración opcional deshabilitada deliberadamente. |
| `not-tested` | No se ejecutó la comprobación correspondiente. |
| `stale` | La última verificación perdió vigencia. |

El diagnóstico debe incluir timestamp, alcance, razón y acción correctiva. “Proceso
listo” no prueba autenticación. “Guardado” no prueba conexión. “Audio generado”,
“decodificado” o “reproducido” no prueba que una persona lo oyó.

## 7. Diseño propuesto y decisiones abiertas

### 7.1 Recomendaciones vigentes

- Enrutar navegadores remotos hacia un backend del mismo origen.
- Separar sesión HMI, identidad Telegram e instalación autorizada.
- Compartir catálogo y consultas de datos, no el estado de presentación.
- Correlacionar cada interacción con un ID opaco y conservar solo evidencia redactada.
- Usar navegación declarativa validada por el router; nunca clics por coordenadas.
- Aplicar TTL y procedencia a snapshots, valores actuales y resultados históricos.
- Mantener telemetría real y simulada detrás del mismo contrato, con modo explícito.

### 7.2 Decisiones aún abiertas

- proveedor y política de STT del Canal A;
- política, proveedor o modelo para interpretar lenguaje natural textual, como
  decisión separada de STT y sin elegir todavía un framework;
- autenticación y autorización del despliegue web;
- almacenamiento seguro y rotación de credenciales;
- modelo definitivo del catálogo de instalaciones, alias y permisos;
- API de consulta actual/histórica y límites por fuente;
- transporte de eventos por sesión y estrategia de cancelación;
- proceso de servicio durable, recuperación y actualización;
- criterios y momento de eliminación del legado externo;
- estrategia de audio que cumpla latencia, continuidad y audibilidad.

Ninguna decisión abierta debe presentarse como diseño final o estado SDD.

## 8. Plan unificado de entrega

La implementación funcional completa requiere autorización futura. El orden evita
construir canales nuevos sobre una frontera de datos, acceso y operación inestable.

### Entrega 0 — reconciliación documental y evidencia

**Objetivo:** establecer una autoridad vigente y conservar historia útil sin importar
requisitos obsoletos como presentes.

**Salida:** este documento, el ledger histórico y el backlog sincronizado.

### Entrega 1 — fundamentos, setup protegido y consulta textual independiente

Esta entrega reúne la base necesaria antes de habilitar canales autónomos. Se divide
en tres incrementos verificables, sin convertirlos en backlogs independientes.

#### Entrega 1.1 — fundamentos de runtime, contratos y acceso

**Alcance:**

- cerrar ownership y portabilidad del runtime del repositorio;
- integrar inicio automático en segundo plano con el propietario del despliegue HMI;
- separar instalación reproducible de operación normal y definir salud, detención y
  recuperación verificables;
- corregir paridad y ownership de bindings generados;
- establecer frontera de acceso antes de credenciales o navegadores remotos;
- retirar el modo Prisma Server/Node-RED como objetivo sin borrar automáticamente el
  legado;
- definir contratos por sesión e instalación.

**Prueba de cierre:** instalación reproducible en entorno autorizado; inicio automático
e invisible con el host HMI seleccionado, también sin configurar; salud con identidad
de proceso; detención, reinicio y recuperación; acceso no autorizado rechazado; schemas
y generados reproducibles; rollback o retiro explícitamente aceptado.

**Progreso actual:** los bindings de audio y generados quedaron corregidos en
FND-1/FND-2/FND-3. FND-6–FND-11 cerró offline el inicio sin secretos, la separación
bootstrap/inicio normal y la integración Windows con `npm run dev`, incluidas las
correcciones PowerShell 5.1. No cierra la entrega: faltan aceptación real de instalación
y operación, pipeline productivo administrado por IT, supervisión durable y frontera
backend protegida antes de secretos. No se selecciona todavía sistema operativo o
supervisor y no queda pendiente un experimento de caída espontánea.

#### Entrega 1.2 — configuración, secretos y diagnósticos

**Alcance:**

- UX en Configuración general → Prisma;
- almacenamiento backend seguro, reemplazo y eliminación de secretos;
- estados `missing/configured/checking/verified/failing/disabled/not-tested/stale`;
- checks pasivos separados de pruebas pagadas;
- protección CORS, autenticación y autorización acorde al despliegue seleccionado.

**Prueba de cierre:** runtime inicialmente sin configurar; una credencial puede
transitar de forma controlada desde el campo de entrada al backend, pero no persiste en
`localStorage`, bundle, GET, logs ni exportaciones de diagnóstico; estados con tiempo,
alcance, razón y remedio; guardar no se confunde con verificar; una integración
opcional deshabilitada permanece saludable.

#### Entrega 1.3 — lenguaje natural textual y datos compartidos

**Alcance:**

- catálogo y frontera de datos comunes para HMI y Prisma;
- pipeline de intención textual → consulta estructurada y validada, con instalación,
  entidad, variable y rango explícitos;
- resolución de entidades y alias, aclaración de ambigüedades y fallas determinísticas
  antes de habilitar Telegram autónomo;
- política de intérprete/proveedor/modelo aún abierta, separada de STT y obligada a
  fundamentar cada respuesta en la consulta validada;
- una máquina real primero y luego las tres reportadas, sin hardcode;
- valores fuera de pantalla con procedencia y frescura;
- histórico solo cuando la fuente declare disponibilidad y rango;
- modo de presentación explícito y coherente, sin fallback silencioso.

**Prueba de cierre:** lenguaje natural ambiguo se aclara o falla sin inventar; la
consulta estructurada validada puede trazarse hasta la respuesta; la misma consulta
devuelve datos consistentes en HMI y Prisma; el alcance de instalación se respeta;
datos vencidos o no disponibles no se presentan como actuales; una máquina real y
luego las tres reportadas pasan los mismos escenarios sin ramas especiales; el modo
demo comparte un dataset coherente entre HMI y Prisma.

### Entrega 2 — Telegram autónomo

**Alcance:** Canal B de texto, sin navegador, snapshot, audio ni navegación global;
pairing personal revocable; autorización por instalación; aislamiento multiusuario y
multiinstalación.

**Prueba de cierre:** consultas actuales autorizadas funcionan con el navegador
cerrado; las históricas funcionan solo cuando la fuente anuncia capacidad y rango, y
en caso contrario informan honestamente que no están soportadas; identidades no
autorizadas no reciben datos; ningún mensaje crea un evento HMI; rotación o revocación
corta acceso de forma verificable.

### Entrega 3 — micrófono, navegación HMI y voz por sesión

**Alcance:** STT, ambigüedad, resolución de catálogo, navegación a destino publicado,
confirmación del nuevo contexto y TTS exclusivo de la sesión solicitante.

**Prueba de cierre:** una consulta a equipo fuera de pantalla aclara si corresponde,
navega solo la sesión solicitante y responde después de confirmar contexto fresco;
timeout o cancelación nunca reutilizan contexto anterior; no hay acciones industriales.

### Entrega 4 — cierre operacional y aceptación

**Alcance:** despliegue servidor y notebook, concurrencia, reinicio, recuperación,
errores sin Internet, cancelación, frescura, observabilidad y decisión de limpieza del
legado.

**Prueba de cierre:** matriz multiusuario/multiinstalación; reinicios y cierres
inesperados; indisponibilidad de Gemini, Telegram y datos; aceptación humana de audio;
evidencia de ausencia de writes industriales; decisión explícita sobre rollback y
eliminación.

### 8.1 Trazabilidad de brechas

| Brecha o cierre verificado | Entrega | Evidencia requerida |
|---|---:|---|
| Inicio automático integrado, operación/detención/recuperación e instalación reproducible | 1.1 y 4 | **Parcial:** `npm run dev` Windows, inicio sin configurar y ownership verificados offline; faltan aceptación real, pipeline IT, supervisión durable, reinicio/recuperación e instalación limpia. |
| **Resuelto — bindings de audio: newline, cuerpo generado, campos requeridos y paridad** | 1.1 | checker 0; Python 83/83 y TypeScript 9/9 confirmados independientemente; TypeScript generado sin diff. |
| CORS wildcard y autorización frontend insuficiente | 1.1 y 1.2 | acceso permitido/rechazado desde los despliegues reales. |
| Secretos y configuración manual | 1.2 | almacenamiento backend, tránsito controlado, redacción, reemplazo y eliminación. |
| Diagnósticos que mezclan guardado, proceso y proveedor | 1.2 | estados y timestamps independientes. |
| Snapshot visible único, persistente y sin TTL | 1.3 | consultas compartidas con frescura y procedencia. |
| Falta de catálogo backend, alias y permisos | 1.3 | resolución uniforme de instalación/equipo/variable. |
| Parser limitado a keywords, sin consulta estructurada | 1.3 | intent → query validada, ambigüedad y fallas trazables. |
| Telegram ligado al snapshot y evento global | 2 | consulta con navegador cerrado y cero eventos HMI. |
| Sin micrófono/STT | 3 | entrada de voz aceptada con política de privacidad. |
| Sin navegación solicitada por Prisma | 3 | destino publicado, confirmación y aislamiento por sesión. |
| Evento global consumido por todos los navegadores | 3 | transporte y deduplicación por sesión solicitante. |
| Latencia y audibilidad de respuestas largas | 3 y 4 | corpus medido y aceptación humana, sin universalizar muestras. |
| Tres máquinas reales no verificadas por esta auditoría | 1.3 y 4 | aceptación sobre una y luego las tres en entorno autorizado. |
| Histórico no universal | 1.3 | capacidades y rangos declarados por fuente. |
| Limpieza del legado | 4 | decisión explícita posterior a aceptación; nunca automática. |

## 9. Criterios de aceptación transversales

Toda entrega funcional futura debe demostrar:

- solo lectura industrial mediante inventario y evidencia de red;
- separación de usuarios, sesiones e instalaciones;
- valores con timestamp, frescura y procedencia;
- errores explícitos, sin simulación o fallback silencioso;
- cancelación sin trabajo ni eventos tardíos;
- reinicio sin estado obsoleto presentado como actual;
- secretos ausentes de artefactos versionados y respuestas de lectura;
- pruebas automáticas más aceptación real cuando intervengan navegador, proveedor,
  Telegram, micrófono, audio o datos reales;
- checks de diagnóstico que generan audio, envían mensajes o consumen cuota se ejecutan
  solo mediante una acción de prueba explícita; la operación normal aprobada conserva
  su consumo esperado del proveedor.

## 10. Historia, fuentes y mantenimiento

El resumen curado de decisiones y evidencia histórica está en
[`PRISMA_HISTORIAL_CURADO.md`](PRISMA_HISTORIAL_CURADO.md). No es un segundo maestro.
El documento externo 1.1.4 permanece como respaldo histórico sin modificar fuera del
repositorio; no debe copiarse ciegamente ni mantenerse en paralelo.

Al actualizar este documento:

1. conservar la separación entre presente, evidencia, objetivo y propuesta;
2. actualizar el backlog por sus topics estables, no por IDs numéricos de memoria;
3. enlazar archivos existentes y marcar rutas futuras como planificadas;
4. no afirmar aceptación real a partir de tests simulados;
5. añadir una entrada breve al changelog y mover detalle histórico al ledger.

## 11. Cierre de etapa y reanudación

Los once incrementos FND y los tres incrementos UNI están completos offline: contratos de
audio, inicio seguro sin configurar, separación instalación/arranque e integración local
Windows con `npm run dev`, además del enrutamiento same-origin y el retiro del selector
legacy, cuentan con verificación independiente. Ese cierre corresponde a la etapa previa
registrada en el commit local `36eeaa4`.

Sobre esa base, `PAC-1`, `PAC-1a`, `PAC-2`, `PAC-3A`, `PAC-3A-S1`, `PAC-3B` y `PAC-3` están completos y aceptados
offline. Prisma dispone de autenticación backend propia, recuperación offline y almacenamiento
cifrado AES-256-GCM para credenciales Gemini/Telegram, con clave de instalación separada y API
administrativa protegida. La API solo expone estado configurado; no devuelve secretos ni afirma
que estén verificados, aplicados o en ejecución.

Gemini ya consume la credencial almacenada cuando el modo protegido está seleccionado. Ese modo
es autoritativo: una ausencia, eliminación, indisponibilidad o corrupción no vuelve a
`GEMINI_API_KEY`. La variable de entorno permanece únicamente como fuente legacy cuando el modo
protegido no fue seleccionado. Health, guardado y arranque no contactan al proveedor.

Cada documento HMI recibe una capacidad anónima emitida por el servidor y conservada solo en
memoria. Esa capacidad separa consultas, contexto de vista, respuestas, eventos, audio, replay,
cancelación y navegación. Dos navegadores pueden compartir backend, clave, catálogo, telemetría y
pools acotados sin compartir conversación. No existe fallback desde el contexto de una vista al
snapshot global de instalación. La capacidad no es una cuenta de usuario, identidad de dispositivo
ni protección frente al robo del bearer; una recarga obtiene otra sesión, el cierre es best effort
y el estado expira y no es durable ni multiworker.

La aceptación independiente final aprobó 63 pruebas backend focalizadas, 53 HMI focalizadas,
209 backend completas y 1844 HMI completas. La cobertura HMI fue 86,64 % statements, 80,00 %
branches, 85,87 % functions y 87,46 % lines. También aprobaron 40 archivos AST, `pip check`,
dos verificaciones TypeScript, build, lint y diff. Se conservaron las pruebas reales offline de
privacidad A/B mediante Flask y bridge/proveedor falsos, y las correcciones previas de recursos.
No se ejecutaron proveedores, FFmpeg, servicios, red, claves reales ni validaciones productivas.

### Base de código registrada al cerrar esta etapa

| Commit local | Alcance |
|---|---|
| `13f1822` | Cambios previos de Gauge/KPI revisados e incorporados; 63 pruebas focalizadas y ESLint correctos. |
| `f8cc42e` | Corrección de generación, checker y validación del contrato de audio con sus regresiones. |
| `43d8e02` | Entorno Python propio, dependencias bloqueadas y operaciones del runtime; 27 pruebas de entorno correctas en el cierre. |

Estos commits registran trabajo local; no implican publicación remota ni aceptación
del ciclo de vida de los servicios. Los cambios previos de Gauge/KPI no quedan como
modificaciones ajenas pendientes de resolver.

El próximo trabajo debe partir de este maestro, de
[`../../odd/tasks/prisma-runtime-foundations.md`](../../odd/tasks/prisma-runtime-foundations.md)
y de los topics estables `backlog/prisma-runtime-monorepo-integration` y
`backlog/prisma-dual-channel-assistant`. `PAC-3B` y `PAC-3` están completos y aceptados offline,
con un commit local y cierre de sesión autorizados en `feat/prisma-telegram-credentials` sobre
`b5fcaf2`. La identidad de entrega se registra en Git y en el checkpoint canónico de Engram una vez
confirmado el commit, sin incrustar un SHA autorreferencial en este árbol. La verificación final aprobó
27 pruebas Telegram focalizadas, 236 backend completas, `pip check`, diff y los escenarios de
ownership, retry, DELETE, shutdown, thread bloqueado, migración, offsets y no pérdida.

`PAC-4A` también está completo y aceptado offline. La autoridad administrativa proviene únicamente
de la sesión backend validada. Cerrar **Configuración general** conserva esa sesión; salir del modo
administrador elimina la autoridad local y mantiene una barrera durable hasta un nuevo login
explícito validado. Un `204` de logout confirma solo la revocación de la cookie presentada: no afirma
que un login anterior abortado haya dejado de ejecutarse en el servidor. La barrera impide que una
cookie tardía restaure automáticamente el rol HMI.

La aceptación final conservó **80 pruebas focalizadas en 9 archivos**, **1885 pruebas HMI en 199
archivos**, build, lint y diff correctos, además de **40 pruebas parentales en 3 archivos**. El gate
backend vigente aprobó **236 pruebas en 15,056 s**. Una ejecución anterior expuso una carrera
preexistente de check-then-copy durante el sembrado concurrente de estado; el diagnóstico de solo
lectura la dejó visible bajo PW-002 y no afirmó haberla corregido — cierre posterior registrado en
la conciliación 2.0.9 de este mismo §11.

`PAC-4B` y el paquete `PAC-4` están completos y aceptados offline tras una verificación independiente
COMPLETE PASS que cerró los cuatro hallazgos sin regresiones. **Configuración general → Prisma**
incorpora campos transitorios para las credenciales Gemini y Telegram, metadatos y diagnósticos
separados, y acciones explícitas de guardar, eliminar y aplicar que reutilizan la misma sesión
administrativa. Los secretos no ingresan en
TanStack Query, Zustand, almacenamiento del navegador ni el guardado global de efectos/orbe. Un
DELETE Telegram con `409 TELEGRAM_STOP_TIMEOUT` conserva la ausencia confirmada, actualiza estado
pasivo y ofrece un nuevo DELETE iniciado por el usuario; no aplica un token ausente ni repite acciones
automáticamente.

La prueba final aprobó **125 pruebas focalizadas en 10 archivos**, **1922 pruebas HMI en 202 archivos**,
cobertura de **86,79 % statements, 80,11 % branches, 86,07 % functions y 87,66 % lines**, build, lint,
diff y **236 pruebas backend**. El verificador externo añadió **6 pruebas** con cliente real, hook,
QueryClient y RTL; el padre confirmó **51 pruebas en 3 archivos** y la lectura estructural del cliente
y del hook. Se conservaron la barrera manual PAC-4A, R1/R2, proxies, Viewer/Voice, el guardado global
solo para efectos y el cierre de Settings sin cerrar la sesión administrativa.

Esto constituye aceptación offline, no prueba de navegador o captura real, proveedor, red, proxy
productivo, seguridad de despliegue ni readiness de producción. No se añade un segundo login, UI de
chat, historial persistido ni identidad de cuenta. La política existente de acceso a
`/hmi/prisma-config` tampoco quedó protegida por estos cambios y requiere tratamiento separado.

`PAC-5` cerró el paquete protegido offline. La verificación independiente integrada
(`mu7e3sey-q-bwyw`) aprobó una vez los seis gates con Git y `HEAD` sin cambios: **1924 pruebas HMI
en 202 archivos** con cobertura de **86,79 % statements, 80,12 % branches, 86,07 % functions y
87,66 % lines** (umbral global exigido de 70, cumplido; la capa `services` queda en 80,92 %
branches y no alcanza el objetivo del 90 % de `docs/TESTING.md`), build de **2734 módulos**, lint,
`git diff --check`, el gate backend canónico con **240 pruebas en 16,673 s** y `pip check`. Se
conservan las advertencias conocidas (`canvas.getContext` en jsdom, `/grid.svg` sin resolver,
chunk `main 1592,99 kB`, avisos CRLF) y la carrera preexistente de `PW-002`, que no se repitió
pero no fue corregida. El gate ambiente no se ejecutó: por una clave legacy heredada y una
configuración de voz real en import, la verificación corrió en un supervisor hijo aislado
(`TemporaryDirectory`) con variables ambiente sensibles limpiadas y el entorno del padre intacto;
el README del runtime documenta el wrapper reproducible de verificación offline.

**Conciliación 2.0.9:** el párrafo `PAC-5` anterior se conserva como evidencia histórica con fecha.
La carrera de sembrado concurrente que registra ya no está abierta: los commits `f865e79`
(sembrado atómico) y `855c26b` (endurecimiento ante temporarios huérfanos y pérdida de energía)
la corrigieron y verificaron; la evidencia histórica se conserva en
[`../../odd/tasks/prisma-seed-atomicity.md`](../../odd/tasks/prisma-seed-atomicity.md) y
[`../../odd/tasks/prisma-seed-hardening.md`](../../odd/tasks/prisma-seed-hardening.md).
`PW-001` está cerrado en `f964113`.

Dos correcciones acotadas posteriores a `PAC-4`, aceptadas con evidencia local limitada confirmada
por el padre y no repetidas en la verificación `PAC-5`, quedan registradas en
[`../../odd/tasks/windows-acl-helper-remediation.md`](../../odd/tasks/windows-acl-helper-remediation.md)
(helper ACL con lecturas Owner+Access y persistencia `Directory.SetAccessControl`, reparación real
del directorio de autenticación sin elevación) y en
[`../../odd/tasks/prisma-admin-fetch-receiver.md`](../../odd/tasks/prisma-admin-fetch-receiver.md)
(`fetch.bind(globalThis)` conservando el transporte inyectado, login Chrome nativo confirmado por
el usuario). Con aprobación explícita separada se aprovisionó una clave maestra protegida nueva
con su almacén de cifrado vacío; ambos proveedores iniciaron «Sin configurar» y Telegram quedó
habilitado pero detenido. Ninguna de estas evidencias afirma verificación de proveedor,
despliegue ni readiness de producción.

El pipeline productivo administrado por IT sigue como objetivo posterior sin seleccionar
todavía OS o supervisor. Cualquier readiness adicional del loader del navegador es UX
opcional y no bloqueante, no un requisito obligatorio aprobado.

Esto no constituye aceptación de producción. PW-002 y PW-003 continúan activos para
instalación limpia y arranque real, forwarding, despliegue y
supervisión administrados por IT, recuperación durable, retiro explícito de la instalación legacy
y el trabajo posterior del asistente. La validación Linux real, el SACL nativo, los reparse
points nativos, backup/restore, TLS, proxy y el entorno productivo también permanecen abiertos.

### 11.1 Próximo paso vigente (2026-09-19, conciliado 2026-09-20)

**Registro 2.0.9 (histórico, se conserva con su fecha):** comprobar el funcionamiento local de punta
a punta, sin borrar la instalación vieja ni regenerar claves. Este registro solo documenta el próximo
paso acordado; no ejecuta servicios, pruebas ni proveedores y no afirma haber realizado la
comprobación.

Lo que la aceptación local futura debe observar:

- arranque automático de HMI y Prisma desde el launcher del usuario en Windows (`hmi-app npm run
  dev` → `scripts/dev.mjs` →
  [`start-local.ps1`](../../services/prisma-runtime/operations/start-local.ps1) → `.venv` propio de
  `services/prisma-runtime/`);
- configuración protegida operada desde **Configuración general → Prisma**;
- el camino implementado de snapshot, consulta y voz.

Condiciones y límites ya establecidos:

- la adquisición automática aplica a `npm run dev` en Windows; `build`, `preview`, tests y
  plataformas no-Windows no adquieren Prisma;
- no existe dependencia activa de fuente ni fallback a `C:\hmi_tts`; ese directorio queda como
  referencia documentada de rollback, no como requisito de runtime (su existencia física no fue
  reinspectada);
- los secretos de proveedor se administran desde la HMI; la clave maestra protegida y su almacén
  permanecen fuera de Git por diseño, y el aprovisionamiento inicial de clave y administrador ya
  está hecho: no repetirlo ni resetearlo;
- la aceptación offline `PAC-1`–`PAC-5` más el login local y la visibilidad del almacén no prueban
  aceptación real de proveedor de punta a punta;
- llamadas pagadas al proveedor y mensajes salientes requieren autorización explícita separada;
- `PW-002`, `PW-003` y `PW-004` permanecen pendientes o aplazados;
  [`../PENDING_WORK.md`](../PENDING_WORK.md) sigue siendo la autoridad de descubrimiento y sus tres
  filas no cambian.

La rama vigente es `feat/prisma-telegram-credentials` con `HEAD` `f964113` (cierre de `PW-001`).

**Conciliación 2.0.10 (2026-09-20):** el registro 2.0.9 anterior se conserva como evidencia histórica
con fecha. La comprobación local sigue incompleta, pero avanzó y ya no depende solo del launcher y de
credenciales sin probar. El detalle canónico está en
[`../../odd/tasks/prisma-telegram-poll-diagnostics.md`](../../odd/tasks/prisma-telegram-poll-diagnostics.md).

Cerrado en esta sesión (incidente de sondeo de Telegram, sobre `feat/prisma-telegram-credentials`):

- Diagnóstico y corrección del falso aviso de credencial protegida ausente cuando el estado ya estaba
  configurado.
- Telemetría de salud saneada y solo en memoria (`stage`, `category`, `httpStatus`, `failureAt`,
  `lastSuccessAt`, enums fijos, enteros 100..599, fechas UTC ISO-Z o `null`), sin excepciones, URLs,
  cuerpos, tokens, IDs ni rutas.
- El sondeo recurrente `getUpdates`/HTTP 409 quedó identificado; el usuario corrigió el token del bot
  correcto y lo revocó/regeneró personalmente, tras lo cual el sondeo se recuperó. El consumidor
  competidor anterior exacto **no** fue identificado; solo se descartó una segunda familia de runtime
  local duplicada.
- Regresión introducida por nuestro propio diagnóstico en el esquema estricto de la respuesta
  administrativa: `apply` de éxito y de error vuelven a proyectar exactamente los nueve campos
  existentes (`source`, `enabled`, `configured`, `desiredGeneration`, `appliedGeneration`, `running`,
  `verified`, `restartRequired`, `lastError`), sin exponer campos internos ni mutar el estado; la
  telemetría de salud permanece disponible por su vía propia.
- Verificación final independiente: 114 pruebas backend focalizadas, 285 backend completas y 38
  frontend aprobadas. Una respuesta Flask 200 simulada fue aceptada por el parser TypeScript real y
  los esquemas anidados 409/502 se comprobaron como esquema, no como trazas de respuesta viva. Las
  pruebas corrieron en un hijo aislado con directorio temporal nuevo y once variables de entorno
  anuladas según el README del runtime, sin credenciales reales ni llamadas a proveedores. Las
  revisiones anteriores fallidas quedaron corregidas.
- **Aceptación real de UI (D7):** la captura `pi-clipboard-80477efc-dfea-4fd2-9aca-70e3ac0190af.png`
  muestra «Cambio de Telegram aplicado y estado actualizado.», generación 1/1, activo, habilitado y
  verificado, sin cambios pendientes ni errores después del `Apply` solicitado. Resuelve el pie
  administrativo falso para la operación observada.
- Evidencia de proceso (histórica, no valores esperados permanentes): los reintentos de relanzamiento
  reutilizaron `PID 24560`; el padre ejecutó el `stop-local.ps1` oficial validado por identidad
  (autorizado) y, tras el relanzamiento del usuario, el nuevo proceso de presentación `PID 22060`
  arrancó el 2026-09-20T00:59:49Z, posterior a la edición de `admin_http.py` del 2026-09-20T00:21:06Z,
  con salud 1/1 y éxito registrado el 2026-09-20T01:03:07.752649Z. Ningún agente envió mensajes
  salientes: las acciones de proveedor las inició el usuario desde la UI o Telegram.

Lo que **no** está cerrado: la comprobación local de punta a punta. El próximo paso vigente ya no es
launcher y credenciales sin probar, sino la prueba de mensaje propiedad del usuario y la verificación
fresca observable.

Próximo paso vigente (2026-09-20):

1. Recuperar este maestro, el tracker
   [`../../odd/tasks/prisma-telegram-poll-diagnostics.md`](../../odd/tasks/prisma-telegram-poll-diagnostics.md)
   y el checkpoint de Engram, e inspeccionar Git. No repetir aprovisionamiento de credenciales ni de
   administrador, ni las correcciones ya completadas.
2. El usuario envía `/status` desde su propio chat al bot corregido (`/start` primero solo si se pide
   emparejamiento). Esta prueba de mensaje **no fue ejecutada ni observada** todavía.
3. Verificar después una captura fresca del dashboard visible, la consulta y la voz.

Límites vigentes: la última captura observada del dashboard (1 de septiembre) está vencida y no prueba
una sesión nueva; Gemini está configurado pero su verificación no se realizó, y las llamadas pagadas
siguen requiriendo autorización explícita separada. El usuario permite reinicios necesarios y pruebas
mínimas contra su propio bot, no contacto arbitrario ni reinicio de claves. Los refinamientos de UI
pedidos ahora esperan a la primera aceptación local; `PW-002`, `PW-003` y `PW-004` continúan aplazados
y [`../PENDING_WORK.md`](../PENDING_WORK.md) sigue siendo la autoridad de descubrimiento, sin cambios.

El cierre acordado de esta sesión es **un commit local completo** con código, pruebas y documentación
juntos, con excepción de tamaño aceptada explícitamente por el usuario (~1300+ líneas, en su mayoría
la matriz de regresión); sin push ni PR. La línea 2.0.9 de arriba, con `HEAD` `f964113`, se conserva
como historia. El `HEAD` previo al cierre 2.0.10 es `fe39ffe`; el hash observado del commit que
contiene este checkpoint se registra en Engram después de confirmarlo, y su localizador en el
repositorio es `git log -1 --format=%H -- odd/tasks/prisma-telegram-poll-diagnostics.md`, para no
incrustar un SHA autorreferencial. Esta versión documental no afirma que ese commit ya exista.

## 12. Changelog

### 2.0.10 — 2026-09-20

- Cierre de la sesión de diagnóstico del sondeo de Telegram en `feat/prisma-telegram-credentials`:
  falso aviso de credencial protegida ausente corregido, telemetría de salud saneada y solo en memoria,
  y sondeo `getUpdates`/HTTP 409 recuperado tras la corrección del token del bot por parte del usuario.
  El consumidor competidor anterior exacto no fue identificado.
- Regresión propia del esquema estricto administrativo corregida: `apply` de éxito y de error vuelven a
  proyectar exactamente los nueve campos existentes; verificación final de 114 pruebas backend
  focalizadas, 285 backend completas y 38 frontend, con parser TypeScript real y esquema anidado 409/502.
- Aceptación real de UI registrada (D7): `Apply` de Telegram aplicado y estado actualizado, generación
  1/1, activo, habilitado y verificado, sin pendientes ni errores.
- Próximo paso vigente actualizado (§11.1): ya no es solo launcher y credenciales sin probar; pasa a la
  prueba de mensaje propiedad del usuario (`/status`), todavía no ejecutada, y a la verificación fresca
  de dashboard, consulta y voz. `PW-002`, `PW-003` y `PW-004` siguen aplazados.
- Cierre acordado: un commit local completo con código, pruebas y documentación, con excepción de tamaño
  aceptada; sin push ni PR. Cambio exclusivamente documental: no ejecuta servicios, pruebas ni
  proveedores y no afirma aceptación local completa.

### 2.0.9 — 2026-09-19

- Conciliación documental de la carrera de sembrado concurrente: `f865e79` la corrigió y `855c26b`
  la endureció; la evidencia histórica queda en `odd/tasks/prisma-seed-atomicity.md` y
  `odd/tasks/prisma-seed-hardening.md`. `PW-001` está cerrado en `f964113`.
- Registro del próximo paso vigente (§11.1): comprobación local de punta a punta, sin borrar la
  instalación vieja ni regenerar claves; `PW-002`, `PW-003` y `PW-004` permanecen pendientes o
  aplazados.
- Cambio exclusivamente documental: no ejecuta servicios, pruebas ni proveedores y no afirma
  aceptación real.

### 2.0.8 — 2026-09-17

- Cierre offline del paquete protegido: verificación independiente integrada `PAC-5` aprobada
  (1924 pruebas HMI, 240 pruebas backend, build, lint, diff y `pip check`) y documentación
  conciliada; el cierre fue aceptado offline por el padre tras el readback documental
  `mu7f1mcu-v-6et3`.
- Registro de las correcciones acotadas de helper ACL y receptor `fetch`, y del aprovisionamiento
  controlado de la clave maestra protegida, como evidencia local limitada confirmada por el padre.
- El gate ambiente no se ejecutó; la verificación usó un supervisor hijo aislado documentado en el
  README del runtime. No se afirma aceptación de producción ni cobertura completa por capa.

### 2.0.7 — 2026-09-17

- Registro de la implementación UNI-1/UNI-2: cuatro rutas Prisma same-origin fijas,
  proxy Vite exacto de desarrollo y retiro del selector y endpoints editables.
- Node-RED continúa soportado como fuente de telemetría industrial; ya no es un runtime
  Prisma seleccionable por el navegador.
- Cierre offline UNI-3 tras corrección y verificación independiente: `140/140` pruebas
  focalizadas en `19` archivos, Dashboard `22/22`, ambos chequeos TypeScript y whitespace
  aprobados; confirmación final del padre `140/140` en `4.36s`.
- La evidencia inicial `1818` completa y `129` focalizada se conserva como historial
  insuficiente porque había perdido cobertura retenida; la corrección restauró `11`
  casos significativos y reemplazó espera temporal de Dashboard por una espera semántica.
- No se afirma aceptación real de Vite, backend, navegador, proveedores o forwarding
  productivo. Python `107/107` continúa como evidencia histórica FND, no como evidencia UNI.

### 2.0.6 — 2026-09-17

- Cierre offline independiente de FND-9/FND-10/FND-11: `npm run dev` integra Prisma
  local en Windows con ownership exacto, sin alterar build, preview ni tests.
- Corrección del receipt PowerShell 5.1 y de toda la clase de pérdida de ownership tras
  registro; evidencia final 13/13, 107/107 y spotchecks del padre aprobados.
- PW-002/PW-003 permanecen abiertos para aceptación real, acceso protegido, Voice,
  despliegue/supervisión administrados por IT y aceptación live; los cambios siguen sin
  commit.

### 2.0.5 — 2026-09-17

- Cierre offline independiente de FND-6/FND-7/FND-8: runtime sin secretos y separación
  entre bootstrap e inicio normal, sin aceptación live ni productiva.
- Evidencia corregida: el primer 92/92 fue insuficiente; tras cubrir el borde
  `NativeCommandError` de PowerShell 5.1, 31/31 focalizadas, 93/93 completas y probes
  missing/present/rethrow aprobaron junto con ScriptBlock, AST y diff check.
- PW-002 permanece abierto para instalación limpia, integración automática con
  `npm run dev`/pipeline IT, operación, recuperación y acceso protegido. PW-003 continúa
  abierto; no existe receipt RDD.

### 2.0.4 — 2026-09-17

- Retiro de la investigación de caída espontánea del alcance activo tras la aclaración
  del usuario; no se afirma causa reproducida ni bug corregido.
- Continuidad reorientada a inicio automático e invisible con el despliegue HMI,
  instalación separada, operación/recuperación y configuración/diagnósticos protegidos.
- Registro del único bloqueo de diseño vigente: elegir el propietario real del
  despliegue sin inventar plataforma ni requisito de arranque del sistema operativo.

### 2.0.3 — 2026-09-17

- Cierre de sesión con el incremento FND-1/FND-2/FND-3 completo y la Entrega 1.1
  todavía abierta.
- Próxima investigación limitada a una prueba local controlada del ciclo de vida,
  previa a cualquier cambio de launchers y sin asumir causa raíz.

La próxima investigación de esta entrada quedó supersedida por 2.0.4; se conserva solo
como historia de la recomendación anterior.

### 2.0.2 — 2026-09-17

- Corrección acotada de identidad, ownership y paridad de los bindings de audio, con
  evidencia automatizada y verificación independiente confirmada.
- La Entrega 1.1 permanece abierta; no se afirma aceptación real ni acceso remoto.

### 2.0.1 — 2026-09-17

- Corrección de semántica de health, procedencia de probes CORS y alcance histórico
  del audio según la verificación independiente.
- Precisión de privacidad: se permite estado operativo mínimo protegido y tránsito
  controlado de credenciales, sin persistencia ni exposición en cliente o diagnósticos.
- Reagrupación cosmética del plan en E0–E4 y agregado del pipeline textual validado
  previo a Telegram, sin cambiar el backlog ni autorizar implementación.

### 2.0.0 — 2026-09-17

- Reconciliación documental del runtime actual, auditoría y dirección aprobada.
- Definición de Canal A HMI por voz y Canal B Telegram de texto autónomo.
- Retiro del antiguo Prisma Server/Node-RED como objetivo, sin eliminación automática
  del legado ni de su valor histórico.
- Incorporación de despliegue web remoto, notebook de presentación, configuración
  protegida, diagnósticos honestos, aislamiento y fuente de datos compartida.
- Sustitución de hojas de ruta competidoras por un único plan de entregas y pruebas.
- Creación de un ledger histórico curado; el original externo 1.1.4 permanece intacto.
- Cambio exclusivamente documental: toda implementación funcional continúa pendiente
  de autorización.
