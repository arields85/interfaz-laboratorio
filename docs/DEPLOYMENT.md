# Despliegue en servidor — interfaz HMI

> **TL;DR**: Un solo contenedor ejecuta nginx (TLS + archivos estáticos + enrutado `/api/leda/*`) y los dos procesos Python de Leda en loopback, con un volumen persistente para el estado y una clave maestra aparte. IT despliega y opera el servidor; el propietario del proyecto configura la HMI desde la interfaz de administración. El repositorio todavía **no** incluye Dockerfile, CI ni configuración de nginx: este documento define lo que deben cumplir.

> ← Volver a [`AGENTS.md`](../AGENTS.md)

---

## 1. Reparto de responsabilidades

| Responsable | Alcance |
|-------------|---------|
| **IT** | Imagen, contenedor, red, TLS, nginx, volumen y respaldos, auto-deploy, provisión inicial (§9), variables de entorno. |
| **Propietario del proyecto** | Todo lo que se configura desde la propia HMI tras el despliegue: dashboards, conexión de datos, tema, credenciales de Gemini y Telegram (Leda), cambio de la contraseña de administrador. |

La HMI es de **solo lectura** (`AGENTS.md` §2): no envía comandos, setpoints ni escrituras a la planta. Ningún componente de este despliegue debe habilitar un camino de escritura hacia el proceso industrial.

---

## 2. Componentes

| Pieza | Origen | Qué produce / ejecuta |
|-------|--------|-----------------------|
| **hmi-app** | `hmi-app/` (React + Vite, SPA) | `npm ci && npm run build` (`tsc -b && vite build`) genera `hmi-app/dist/`: archivos estáticos. Desarrollo con Node 24; `package.json` no declara `engines`. |
| **leda-runtime** | `services/leda-runtime/` (Python 3.14, ver `.python-version`) | Dos aplicaciones Flask independientes. |

Procesos de `leda-runtime` (con `PYTHONPATH=services/leda-runtime/src`):

| Comando | Escucha | Función |
|---------|---------|---------|
| `python -m leda_runtime.local_presentation` | `127.0.0.1:5057` | Sesiones, snapshots, preguntas, autenticación de administrador, credenciales, configuración compartida de la HMI, Telegram. |
| `python -m leda_runtime.voice_service` | `127.0.0.1:5056` | Síntesis de voz (Gemini) y transcripción. |

Ambos enlazan a `127.0.0.1` fijo en el código (no es configurable); el servicio de presentación llama al de voz en `http://127.0.0.1:5056` (por defecto; `LEDA_LOCAL_VOICE_URL` lo sobrescribe) y el de voz llama de vuelta a `127.0.0.1:5057` para rutas internas. **Los puertos 5056/5057 nunca deben publicarse ni exponerse por nginx** (rutas `/internal/*`, `/leda/*`).

Dependencias Python: `pip install --require-hashes -r services/leda-runtime/requirements.lock.txt` (Flask, google-genai, cryptography, httpx, requests, imageio-ffmpeg). El lock no declara marcadores de plataforma; confirme en el primer build de imagen que resuelve todas las ruedas para Linux.

---

## 3. Topología obligatoria

**nginx y los dos servicios Python deben compartir el mismo contenedor (o el mismo network namespace).** Motivos verificados en el código:

1. `TransportPolicy` (`admin_http.py`) exige que el par TCP de las rutas de administración sea **loopback**; un nginx en otro contenedor llegaría con una IP no loopback y recibiría rechazo.
2. Esas rutas validan `Host` contra `LEDA_PUBLIC_ORIGIN` y exigen `Origin` idéntico a ese origen en las escrituras.
3. Con `LEDA_PUBLIC_ORIGIN` definida, la cookie de sesión se emite con `Secure`: el acceso de administración **requiere HTTPS**. Sin la variable, solo se aceptan los orígenes de desarrollo (`http://localhost:5173`, `http://127.0.0.1:5173`).

```
Navegador ──HTTPS──▶ nginx :443 ─┬─ archivos estáticos (dist/)
                                 ├─▶ 127.0.0.1:5057  (presentación)
                                 └─▶ 127.0.0.1:5056  (voz, solo /api/leda/tts/live)
        un contenedor, usuario fijo no root para los procesos Python
```

Un gestor de procesos mínimo (por ejemplo `tini` + script, s6 o supervisord) debe lanzar nginx y los dos procesos Python, y reiniciar cualquiera que muera.

---

## 4. Variables de entorno

Deben estar presentes **antes** de arrancar: el runtime las lee una sola vez al construirse.

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `LEDA_RUNTIME_STATE_DIR` | **Sí** (en Linux) | Directorio de estado persistente (volumen). Sin ella el valor por defecto es una ruta de estilo Windows bajo `$HOME`. |
| `LEDA_CREDENTIAL_MASTER_KEY_FILE` | **Sí** | Ruta **absoluta** del archivo de clave maestra (32 bytes crudos), **fuera** de `LEDA_RUNTIME_STATE_DIR`, sin enlaces simbólicos en la ruta. Debe estar definida en ambos procesos y en los comandos de provisión. |
| `LEDA_PUBLIC_ORIGIN` | **Sí** | Origen público exacto: `https://host[:puerto]`, sin barra final, ruta ni credenciales. Un valor inválido hace responder `503 AUTH_CONFIGURATION_INVALID` en las rutas de administración. |
| `LEDA_LOCAL_TELEGRAM_ENABLED` | Solo Canal B | `1` activa la integración Telegram "Canal B" (credencial `telegram`). El token se guarda desde la UI. Canal A se configura desde la UI y su composición no lee esta variable. |
| `LEDA_VOICE_CONFIG_FILE` | No | Por defecto `<estado>/leda_voice_config.json`. Si falta, se usa la configuración por defecto. |
| `LEDA_LOCAL_SNAPSHOT_FILE`, `LEDA_LOCAL_STATE_FILE` | No | Por defecto `<estado>/leda_local_snapshot.json` y `<estado>/leda_local_state.json`. |
| `LEDA_LOCAL_VOICE_URL` | No | URL del servicio de voz; por defecto `http://127.0.0.1:5056`. No cambiar. |
| `LEDA_TELEGRAM_OPUS_BITRATE` | No | Bitrate Opus de las notas de voz de Telegram; por defecto `32k`. |
| `TELEGRAM_BOT_API_BASE` | No | Base de la API de Telegram; por defecto `https://api.telegram.org`. |
| `WEB_CONCURRENCY` | No | **No definir en un valor mayor que 1**: el servicio de voz aborta con `LEDA_VOICE_SINGLE_PROCESS_REQUIRED`. |
| `VITE_NODE_RED_BASE_URL` | No (build) | Alternativa en tiempo de build para la URL base de datos; la guardada desde la UI tiene prioridad (§8). |

No defina `GEMINI_API_KEY` ni `LEDA_LOCAL_TELEGRAM_BOT_TOKEN`: son fuentes heredadas que se ignoran cuando hay clave maestra (modo protegido). Las credenciales las carga el propietario desde la UI.

---

## 5. Usuario, permisos y volumen

`storage_permissions.py` verifica en cada acceso (POSIX) y falla de forma cerrada con `AUTH_STORAGE_PERMISSIONS_INVALID`:

- directorios `auth/` y `credentials/` con modo **0700** y archivos de base de datos (y `-journal`/`-wal`/`-shm`) con **0600**;
- propietario = **UID efectivo del proceso**;
- **ningún enlace simbólico** en toda la cadena de ruta (incluidos ancestros del directorio de estado y de la clave).

Consecuencias:

1. Cree un usuario fijo no root (UID/GID estables) y ejecute **ambos procesos Python y los comandos de provisión con ese mismo usuario** (`docker exec -it -u <usuario> ...`).
2. El volumen de estado y el directorio de la clave deben pertenecer a ese UID.
3. El directorio padre del archivo de clave es **dedicado**: la provisión le aplica `chmod 0700`. No use un directorio compartido (por ejemplo `/etc`).
4. Monte el estado y la clave como **volúmenes/bind mounts distintos** (la clave no puede quedar dentro del estado).

Contenido de `LEDA_RUNTIME_STATE_DIR`:

| Ruta | Contenido |
|------|-----------|
| `auth/admin.sqlite3` | Administrador, hash de contraseña, **sesiones de administrador**, intentos fallidos. |
| `credentials/provider-credentials.sqlite3` | Credenciales de Gemini/Telegram, cifradas con la clave maestra. |
| `hmi-config/hmi-config.sqlite3` | **Toda la configuración compartida de la HMI** (dashboards, conexión, tema). |
| `leda_voice_config.json`, `leda_channel_a_config.json` | Configuración de voz y de Canal A. |
| `leda_local_snapshot.json`, `leda_local_state.json` | Snapshot de instalación y estado/emparejamiento de Telegram. |
| `logs/`, `run/` | Los crea el runtime; los usan los lanzadores de Windows. En contenedor, los logs de Flask salen por stderr (`docker logs`). |

---

## 6. Enrutado público (`/api/leda/*`)

Fuente de verdad: `hmi-app/vite.ledaProxy.config.ts`; contrato: [`docs/leda/LEDA_BROWSER_ROUTING.md`](leda/LEDA_BROWSER_ROUTING.md). El navegador usa rutas same-origin fijas; el servidor debe reenviar **exactamente** estas 28 (más una cadena de consulta opcional):

| Ruta pública | Métodos | Upstream |
|--------------|---------|----------|
| `/api/leda/session` | POST, DELETE | `:5057` `/hmi/session` |
| `/api/leda/snapshot` | POST | `:5057` `/hmi/current-snapshot` |
| `/api/leda/events/latest` | GET | `:5057` `/hmi/voice/latest` |
| `/api/leda/events/stream` | GET (**SSE**) | `:5057` `/hmi/voice/events` |
| `/api/leda/ask` | POST | `:5057` `/local/ask` |
| `/api/leda/voice/timeline` | POST | `:5057` `/hmi/voice/timeline` |
| `/api/leda/voice-config` | GET, PUT | `:5057` `/hmi/leda-config` |
| `/api/leda/tts/live` | POST (**stream PCM**) | **`:5056`** `/leda/speak-live` |
| `/api/leda/channel-a/pairing` | GET, POST | `:5057` `/hmi/channel-a/pairing` |
| `/api/leda/health` | GET | `:5057` `/health` |
| `/api/leda/hmi-config` | GET | `:5057` misma ruta |
| `/api/leda/hmi-config/revision` | GET | `:5057` misma ruta |
| `/api/leda/admin/hmi-config` | PUT | `:5057` misma ruta |
| `/api/leda/admin/auth/status` | GET | `:5057` misma ruta |
| `/api/leda/admin/auth/login` | POST | `:5057` misma ruta |
| `/api/leda/admin/auth/session` | GET | `:5057` misma ruta |
| `/api/leda/admin/auth/logout` | POST | `:5057` misma ruta |
| `/api/leda/admin/auth/password` | POST | `:5057` misma ruta |
| `/api/leda/admin/credentials` | GET | `:5057` misma ruta |
| `/api/leda/admin/credentials/gemini` | PUT, DELETE | `:5057` misma ruta |
| `/api/leda/admin/credentials/gemini/verify` | POST | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram` | PUT, DELETE | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram/apply` | POST | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram/verify` | POST | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram_channel_a` | PUT, DELETE | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram_channel_a/status` | GET | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram_channel_a/apply` | POST | `:5057` misma ruta |
| `/api/leda/admin/credentials/telegram_channel_a/verify` | POST | `:5057` misma ruta |

Reglas que el proxy debe cumplir:

1. **Solo coincidencia exacta** de ruta. Cualquier otra `/api/leda/*` responde **404** y **nunca** `index.html`. Los métodos no listados los rechaza el backend con `405`.
2. **Conservar** método, cuerpo, código de estado, cabeceras de respuesta y la cadena de consulta sin recodificar. Cabeceras que deben llegar al backend: `X-Leda-Session-Capability`, `Cookie` (`leda_admin_session`, con alcance `/api/leda/admin`), `X-CSRF-Token`, `Origin`, `Content-Type`; y de vuelta `Set-Cookie`, `Cache-Control: no-store`.
3. En las rutas `admin/*`, `hmi-config*` y `health` se **elimina** `X-Leda-Session-Capability` hacia el backend (igual que el proxy de desarrollo): la autoridad de administración es solo cookie + CSRF.
4. `Host` debe ser el host público (`proxy_set_header Host $host`) y el par TCP debe ser loopback (nginx en el mismo contenedor).
5. **SSE** (`/api/leda/events/stream`, keep-alive cada 15 s) y **PCM** (`/api/leda/tts/live`): `proxy_buffering off`, `proxy_http_version 1.1`, `Connection ""` y `proxy_read_timeout` largo. El backend ya envía `X-Accel-Buffering: no`.
6. Tamaños: el snapshot admite hasta 1 MiB y la escritura de `admin/hmi-config` hasta 16 MiB por petición: `client_max_body_size` debe ser al menos 17m.
7. Todo lo demás cae a la SPA: `try_files $uri /index.html` (la app usa `createBrowserRouter`).

### Ejemplo ilustrativo de nginx

> **Referencia, no configuración final.** Adapte dominio, certificados, rutas y política de caché. Fue generada a partir de la tabla anterior; si cambian las rutas, regenere desde `vite.ledaProxy.config.ts`.

```nginx
upstream leda_presentation { server 127.0.0.1:5057; keepalive 16; }
upstream leda_voice        { server 127.0.0.1:5056; keepalive 8; }

server {
    listen 80;
    server_name hmi.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name hmi.example.com;                 # debe coincidir con LEDA_PUBLIC_ORIGIN
    ssl_certificate     /etc/ssl/hmi/fullchain.pem;
    ssl_certificate_key /etc/ssl/hmi/privkey.pem;

    root /usr/share/nginx/html;                  # contenido de hmi-app/dist
    client_max_body_size 17m;

    # Cabeceras comunes hacia Leda. Cuidado: nginx NO hereda proxy_set_header
    # a un location que defina las suyas; por eso los locations que eliminan
    # la capability repiten el include.
    proxy_http_version 1.1;
    include /etc/nginx/snippets/leda-proxy.conf;
    # leda-proxy.conf:
    #   proxy_set_header Connection "";
    #   proxy_set_header Host $host;             # imprescindible para TransportPolicy

    # --- Rutas con reescritura hacia :5057 ---------------------------------
    location = /api/leda/session            { proxy_pass http://leda_presentation/hmi/session; }
    location = /api/leda/snapshot           { proxy_pass http://leda_presentation/hmi/current-snapshot; }
    location = /api/leda/events/latest      { proxy_pass http://leda_presentation/hmi/voice/latest; }
    location = /api/leda/ask                { proxy_pass http://leda_presentation/local/ask; }
    location = /api/leda/voice/timeline     { proxy_pass http://leda_presentation/hmi/voice/timeline; }
    location = /api/leda/voice-config       { proxy_pass http://leda_presentation/hmi/leda-config; }
    location = /api/leda/channel-a/pairing  { proxy_pass http://leda_presentation/hmi/channel-a/pairing; }

    # SSE: sin buffering, lectura larga.
    location = /api/leda/events/stream {
        proxy_pass http://leda_presentation/hmi/voice/events;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }

    # Audio PCM progresivo hacia el servicio de voz (:5056).
    location = /api/leda/tts/live {
        proxy_pass http://leda_voice/leda/speak-live;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }

    # Salud (sin capability).
    location = /api/leda/health {
        include /etc/nginx/snippets/leda-proxy.conf;
        proxy_pass http://leda_presentation/health;
        proxy_set_header X-Leda-Session-Capability "";
    }

    # --- Rutas con la misma ruta en :5057 (admin y configuración compartida) ---
    # Sin URI en proxy_pass: se conserva la ruta original y la consulta.
    location ~ ^/api/leda/(hmi-config(/revision)?|admin/(hmi-config|credentials|auth/(status|login|session|logout|password)|credentials/(gemini(/verify)?|telegram(/apply|/verify)?|telegram_channel_a(/status|/apply|/verify)?)))$ {
        include /etc/nginx/snippets/leda-proxy.conf;
        proxy_pass http://leda_presentation;
        proxy_set_header X-Leda-Session-Capability "";
    }

    # Cualquier otra /api/leda/*: 404 JSON, nunca la SPA.
    location /api/leda/ {
        default_type application/json;
        return 404 '{"error":"not_found"}';
    }

    # --- SPA ------------------------------------------------------------------
    location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
    location / {
        try_files $uri /index.html;
        add_header Cache-Control "no-cache" always;   # index.html siempre revalidado
    }
}
```

Notas sobre el ejemplo: el `location` regex agrupa las 18 rutas de identidad (5 de `auth`, 1 de `credentials`, 2 de Gemini, 3 de Telegram, 4 de Canal A, 2 de `hmi-config`, 1 de `admin/hmi-config`); un proveedor no listado cae en el 404. Un `location` regex prevalece sobre el prefijo `/api/leda/`, y la coincidencia exacta (`=`) sobre ambos. Pruebe cada ruta con `curl` (§11) tras adaptarla.

---

## 7. Imagen (esquema)

Esquema orientativo; Lucas define la implementación final.

1. **Etapa build** (Node): `cd hmi-app && npm ci && npm run build` → `hmi-app/dist`.
2. **Etapa final** (Python 3.14, base Debian/Ubuntu): instalar `nginx` y **`ffmpeg`**; crear el usuario fijo; copiar `services/leda-runtime/` y el `dist` a `/usr/share/nginx/html`; `pip install --require-hashes -r services/leda-runtime/requirements.lock.txt`.
3. `ENV PYTHONPATH=/app/services/leda-runtime/src`; `LEDA_RUNTIME_STATE_DIR`, `LEDA_CREDENTIAL_MASTER_KEY_FILE` y `LEDA_PUBLIC_ORIGIN` se inyectan al ejecutar.
4. Gestor de procesos que lance nginx y los dos procesos Python (estos últimos con el usuario fijo), con reinicio automático y **`stop_grace_period` corto** (§12).
5. Exponer solo 80/443. Volúmenes: estado y clave (§5).

**ffmpeg** se recomienda en la imagen: `voice_service` usa `shutil.which("ffmpeg")` y, si no existe, el binario de `imageio_ffmpeg` (incluido en el lock); si ninguno se resuelve, la codificación de voz de Telegram falla con `FFMPEG_NOT_FOUND`.

---

## 8. Red externa y datos de planta

| Destino | Quién lo contacta | Notas |
|---------|-------------------|-------|
| API de Google Gemini (TTS/STT) | `leda-runtime` | Salida HTTPS. Sin credencial, la voz responde `GEMINI_CREDENTIAL_UNAVAILABLE`; la HMI sigue funcionando. |
| API de Telegram (`api.telegram.org`) | `leda-runtime` | Opcional. Usa *polling* de salida: no requiere puerto de entrada. |
| **Node-RED (datos de planta)** | **El navegador del usuario, directamente** | `leda-runtime` no intermedia los datos. |

La URL base de Node-RED la define el propietario en la UI (se guarda en la configuración compartida; `VITE_NODE_RED_BASE_URL` es solo respaldo de build). Dos opciones:

1. **Acceso directo (CORS)**: Node-RED debe ser alcanzable desde los navegadores de los usuarios y permitir CORS para el origen de la HMI. Si la HMI se sirve por HTTPS, Node-RED también debe ser HTTPS (contenido mixto bloqueado).
2. **Proxy por nginx (recomendado)**: publicar Node-RED bajo el mismo origen (por ejemplo `https://hmi.example.com/node-red/`), sin CORS ni contenido mixto, y sin exponer Node-RED a los usuarios.

**Limitación verificada**: la URL base **debe ser absoluta**. `dataHistory.service.ts` y `activitySeries.service.ts` usan `new URL(baseUrl)` sin base, de modo que una base relativa (`/node-red`) falla en histórico y series de actividad (la consulta general sí funcionaría con `fetch`). Con la opción 2, el propietario debe ingresar la URL completa (`https://hmi.example.com/node-red`).

Los endpoints esperados de la fuente están en [`docs/DATA_CONTRACT.md`](DATA_CONTRACT.md); la HMI solo realiza lecturas (GET).

---

## 9. Primera puesta en marcha (una sola vez)

Ejecute con el usuario fijo y con `LEDA_RUNTIME_STATE_DIR` y `LEDA_CREDENTIAL_MASTER_KEY_FILE` definidas.

1. **Clave maestra y almacén cifrado**: `python -m leda_runtime.credential_cli provision-key`. Crea la clave (32 bytes) y `credentials/provider-credentials.sqlite3`. **Falla (`CREDENTIAL_PROVISIONING_FAILED`, código 1) si la clave o la base ya existen.**
2. **Administrador**: `docker exec -it -u <usuario> <contenedor> python -m leda_runtime.admin_cli provision-admin`. Requiere terminal interactiva (TTY; sin ella falla con `INTERACTIVE_TERMINAL_REQUIRED`), pide y confirma la contraseña (mínimo **15 caracteres**, máximo 1024 bytes UTF-8) y crea la cuenta `admin`.
3. Entregue la contraseña inicial al propietario por un canal seguro. Él debe **cambiarla desde la UI** (ícono de llave en la barra superior del modo administración, `POST /api/leda/admin/auth/password`).

**Manejo idempotente en el auto-deploy**: estos comandos no se ejecutan en cada arranque ni en cada redeploy. Si automatiza la provisión, hágala condicional: ejecutar `provision-key` solo si **no existe** ni la clave ni `credentials/provider-credentials.sqlite3`, y `provision-admin` solo si `GET /api/leda/admin/auth/status` informa `configured: false`. **Nunca borre ni regenere una clave existente.**

**Recuperación** de contraseña olvidada: `python -m leda_runtime.admin_cli reset-admin-password` (misma forma interactiva; borra todas las sesiones de administrador).

---

## 10. Persistencia, respaldos y auto-deploy

**Respaldos**

- Respalde el **volumen de estado** (en especial `hmi-config/` y `credentials/`) y, **por separado**, el archivo de la **clave maestra**. Sin la clave, las credenciales cifradas son irrecuperables (no hay rotación ni lectura por API). No guarde ambos respaldos juntos.
- Para copias consistentes de SQLite, respalde con el contenedor detenido o con la herramienta de respaldo de SQLite.

**Qué sobrevive a un redeploy y qué no**

| Elemento | Se conserva | Detalle |
|----------|-------------|---------|
| Imagen (código, `dist`) | No, se reconstruye | Cada push genera una imagen nueva. |
| Volumen de estado y clave | **Sí** | Deben montarse igual en el contenedor nuevo. |
| Sesión de administrador | **Sí** | Está en `auth/admin.sqlite3` (inactividad 15 min, límite absoluto 8 h). |
| Sesiones de documento de la HMI (capacidad de Leda para voz/preguntas) | **No** | Son de memoria; cada reinicio las invalida. Una página abierta debe recargarse para obtener una nueva; la recuperación automática del navegador no se verificó. |
| Telegram | Reaplicado al arrancar | El runtime restaura la configuración aplicada; la entrega es "al menos una vez" y puede duplicar una respuesta cercana a un corte. |

**Auto-deploy en cada push** (a criterio de IT; el repositorio es privado): pipeline (p. ej. GitHub Actions o un runner en el servidor) que construya la imagen, la publique o la cargue en el servidor y recree el contenedor con los mismos volúmenes y variables. Use una *deploy key* o token de solo lectura para clonar el repositorio privado. Habrá una breve interrupción por redeploy (los procesos no admiten réplicas, ver §12).

---

## 11. Verificación

1. `curl -sS https://hmi.example.com/api/leda/health` devuelve JSON con `"ok": true`, `"service": "leda-local-presentation"` y `"ready": true` cuando el servicio de voz responde; `"ready": false` / `"ledaVoiceReady": false` indica que el proceso en `:5056` no está accesible.
2. `curl -i https://hmi.example.com/api/leda/inexistente` → **404** JSON (no HTML). `curl -i https://hmi.example.com/ruta-spa` → 200 con `index.html`.
3. `curl -sS https://hmi.example.com/api/leda/admin/auth/status` → indica si el administrador está provisionado (`configured`).
4. Abra `https://hmi.example.com/` (visor). Los íconos de usuarios y Leda están ocultos: **`Ctrl+Alt+A`** los revela (o la ruta `/acceso`).
5. Inicie sesión de administrador; el cambio de contraseña y el guardado de configuración deben completar sin `403 AUTH_TRANSPORT_REJECTED` (si aparece, revise `Host`, `Origin` y `LEDA_PUBLIC_ORIGIN`).
6. Confirme que `/api/leda/events/stream` permanece abierto (sin cortes por buffering/timeout) y que `docker logs` no muestra `AUTH_STORAGE_PERMISSIONS_INVALID`.

Errores frecuentes: `503 AUTH_CONFIGURATION_INVALID` (origen mal formado), `403 AUTH_TRANSPORT_REJECTED` (host/origen/par no loopback), `AUTH_STORAGE_PERMISSIONS_INVALID` (UID, modos o enlaces simbólicos), `CREDENTIAL_STORAGE_UNAVAILABLE` (clave ausente, inaccesible o no coincide con la base).

---

## 12. Limitaciones conocidas

- **Servidor de desarrollo de Flask**: no hay servidor WSGI en `requirements`; ambos procesos usan `app.run(threaded=True)`. El servicio de voz debe ser de **un solo proceso** (`WEB_CONCURRENCY > 1` o el *reloader* abortan el arranque) y no se admiten múltiples réplicas ni workers.
- **Límite de sesiones**: el registro de sesiones de documento admite 64 simultáneas; al excederse, la creación responde `503 LEDA_SESSION_CAPACITY`.
- **Limitador de inicio de sesión**: se calcula por la IP de origen que ve el backend; detrás de nginx todos los clientes aparecen como `127.0.0.1` (no hay `X-Forwarded-For` en el código). El presupuesto de intentos fallidos es compartido.
- **Cierre**: el código no instala manejador de `SIGTERM`; una parada abrupta no ejecuta la limpieza (`finally`) de los gestores de Telegram. Use un `stop_grace_period` corto y no espere un cierre ordenado.
- **Repositorio**: aún no hay Dockerfile, CI ni configuración de nginx; son entregables de IT.
- **Scripts de operaciones** (`services/leda-runtime/operations/*.ps1`, `npm run dev`): son de desarrollo en Windows; no se usan en el servidor.
- **Pruebas**: parte de la suite del runtime invoca PowerShell y se omite en Linux (`skipUnless win32`); la aceptación de permisos POSIX, TLS y proxy en producción no está validada en vivo (`docs/PENDING_WORK.md`, PW-002/PW-003).
- **Voz en vivo**: no se validó contra Gemini ni Telegram reales; no hay verificación de producción de TLS/proxy.

---

## 13. Checklist de puesta en marcha

1. Reservar host/DNS y certificado TLS; fijar `LEDA_PUBLIC_ORIGIN=https://<host>`.
2. Crear usuario fijo (UID/GID) y los volúmenes: estado y directorio dedicado para la clave (propietario = ese UID).
3. Construir la imagen (§7): `dist`, `leda-runtime` con dependencias bloqueadas, `nginx`, `ffmpeg`, gestor de procesos.
4. Aplicar la configuración de nginx (§6) y verificar que 5056/5057 no se publican.
5. Arrancar con `LEDA_RUNTIME_STATE_DIR`, `LEDA_CREDENTIAL_MASTER_KEY_FILE`, `LEDA_PUBLIC_ORIGIN` (y `LEDA_LOCAL_TELEGRAM_ENABLED=1` si se usa Canal B).
6. Ejecutar `provision-key` y luego `provision-admin` con el usuario fijo (§9).
7. Respaldar la clave maestra en un lugar separado del respaldo del volumen.
8. Verificar (§11).
9. Entregar al propietario: URL, contraseña inicial y el aviso de cambiarla desde la UI.
10. Habilitar el auto-deploy (§10) manteniendo volúmenes y variables; probar un redeploy y confirmar que el estado persiste.
11. Programar respaldos periódicos del volumen y definir cómo se publica o se proxya Node-RED (§8).

---

## Referencias

- [`docs/leda/LEDA_BROWSER_ROUTING.md`](leda/LEDA_BROWSER_ROUTING.md) — contrato de rutas y contrato de producción.
- [`services/leda-runtime/README.md`](../services/leda-runtime/README.md) — runtime, credenciales, límites de sesión.
- [`docs/DATA_CONTRACT.md`](DATA_CONTRACT.md) — contrato JSON de datos en tiempo real.
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — arquitectura de la HMI.
