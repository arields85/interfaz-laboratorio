# Despliegue en servidor — interfaz HMI

> **TL;DR**: Un solo contenedor con nginx (TLS, archivos estáticos, enrutado `/api/leda/*`) y los dos procesos Python de Leda en loopback, más un volumen persistente para el estado y una clave maestra aparte. IT despliega y opera el servidor; el propietario configura la HMI desde la interfaz de administración. La HMI es de solo lectura hacia la planta: ningún componente del despliegue debe habilitar escrituras.

> ← Volver a [`AGENTS.md`](../AGENTS.md)

---

## 1. Arquitectura

nginx y los dos procesos Python **deben compartir contenedor**: el runtime solo acepta pares TCP loopback en las rutas de administración y exige un origen `https` exacto (`LEDA_PUBLIC_ORIGIN`).

```
Navegador ──HTTPS──▶ nginx :443 ─┬─ archivos estáticos (dist/)
                                 ├─▶ 127.0.0.1:5057  (presentación)
                                 └─▶ 127.0.0.1:5056  (voz, solo /api/leda/tts/live)
```

Los puertos 5056/5057 enlazan a `127.0.0.1` fijo y **nunca se publican**. Exponer solo 80/443.

## 2. Build y ejecución

- **Front**: `cd hmi-app && npm ci && npm run build` → `hmi-app/dist` (se sirve desde nginx).
- **Runtime**: Python 3.14 (`.python-version`); `pip install --require-hashes -r services/leda-runtime/requirements.lock.txt`. Confirme en el primer build que el lock resuelve ruedas para Linux.
- **ffmpeg** en la imagen (voz de Telegram; sin él falla con `FFMPEG_NOT_FOUND`).
- Con `PYTHONPATH=services/leda-runtime/src`, lanzar ambos procesos con el usuario fijo:
  - `python -m leda_runtime.local_presentation` (`:5057`)
  - `python -m leda_runtime.voice_service` (`:5056`)
- Un gestor de procesos (tini + script, s6 o supervisord) lanza nginx y los dos procesos y reinicia el que muera.
- **Usuario fijo no root** (UID/GID estables) para los procesos Python y para los comandos de provisión (`docker exec -it -u <usuario> ...`).

## 3. Variables de entorno

Deben existir antes de arrancar (se leen una sola vez).

| Variable | Nota |
|----------|------|
| `LEDA_RUNTIME_STATE_DIR` | **Obligatoria.** Directorio de estado: volumen persistente. |
| `LEDA_CREDENTIAL_MASTER_KEY_FILE` | **Obligatoria.** Ruta absoluta de la clave (32 bytes), **fuera** del directorio de estado, sin enlaces simbólicos; también en los comandos de provisión. |
| `LEDA_PUBLIC_ORIGIN` | **Obligatoria.** Origen exacto `https://host[:puerto]`, sin barra final ni ruta. Inválido → `503 AUTH_CONFIGURATION_INVALID`. |

No defina `GEMINI_API_KEY` ni `LEDA_LOCAL_TELEGRAM_BOT_TOKEN` (las credenciales las carga el propietario desde la UI). No defina `WEB_CONCURRENCY` > 1 (el servicio de voz aborta). El resto de variables tiene valores por defecto correctos.

## 4. Volúmenes, permisos y respaldos

- Volúmenes **distintos** para el estado y para la clave. Ambos pertenecen al UID del usuario fijo; el directorio de la clave es dedicado (la provisión le aplica `chmod 0700`; no use `/etc`).
- El runtime verifica POSIX 0700 (directorios) / 0600 (bases) y propietario = UID del proceso, sin enlaces simbólicos en la ruta; si falla responde `AUTH_STORAGE_PERMISSIONS_INVALID`.
- Respalde el volumen de estado (sobre todo `hmi-config/` y `credentials/`) y, **por separado**, la clave maestra. Sin la clave, las credenciales guardadas son irrecuperables. Para copias consistentes de SQLite, detenga el contenedor o use la herramienta de respaldo de SQLite.

## 5. nginx (ejemplo ilustrativo)

Adapte dominio, certificados y caché. Rutas verificadas contra `hmi-app/vite.ledaProxy.config.ts`; la tabla completa está en [`LEDA_BROWSER_ROUTING.md`](leda/LEDA_BROWSER_ROUTING.md).

```nginx
upstream leda_presentation { server 127.0.0.1:5057; keepalive 16; }
upstream leda_voice        { server 127.0.0.1:5056; keepalive 8; }

server { listen 80; server_name hmi.example.com; return 301 https://$host$request_uri; }

server {
    listen 443 ssl;
    http2 on;
    server_name hmi.example.com;                 # debe coincidir con LEDA_PUBLIC_ORIGIN
    ssl_certificate     /etc/ssl/hmi/fullchain.pem;
    ssl_certificate_key /etc/ssl/hmi/privkey.pem;
    root /usr/share/nginx/html;                  # contenido de hmi-app/dist
    client_max_body_size 17m;                    # snapshot 1 MiB, hmi-config 16 MiB

    # nginx NO hereda proxy_set_header en un location que defina el suyo:
    # por eso los dos locations que vacían la capability repiten el include.
    proxy_http_version 1.1;
    include /etc/nginx/snippets/leda-proxy.conf;
    # leda-proxy.conf:
    #   proxy_set_header Connection "";
    #   proxy_set_header Host $host;              # exigido por la validación de host
    #   proxy_set_header X-Real-IP $remote_addr;  # SOBRESCRIBE el valor del cliente (limitador de login)
    # Cookie, Origin, X-CSRF-Token y X-Leda-Session-Capability pasan por defecto.

    # Rutas con reescritura hacia :5057
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
        proxy_buffering off; proxy_cache off; proxy_read_timeout 3600s;
    }

    # Audio PCM progresivo hacia el servicio de voz (:5056).
    location = /api/leda/tts/live {
        proxy_pass http://leda_voice/leda/speak-live;
        proxy_buffering off; proxy_request_buffering off; proxy_read_timeout 300s;
    }

    location = /api/leda/health {
        include /etc/nginx/snippets/leda-proxy.conf;
        proxy_pass http://leda_presentation/health;
        proxy_set_header X-Leda-Session-Capability "";
    }

    # Misma ruta en :5057 (sin URI en proxy_pass se conservan ruta y consulta).
    # Regex anclado: solo estas 22 rutas exactas (la lista de acceso del Canal B y sus tres decisiones, con id de chat numérico, incluidas); cualquier otra cae al 404 de abajo.
    location ~ ^/api/leda/(hmi-config(/revision)?|admin/(hmi-config|credentials|auth/(status|login|session|logout|password)|credentials/(gemini(/verify)?|telegram(/apply|/verify)?|telegram_channel_a(/status|/apply|/verify)?)|channel-b/access(/-?[0-9]{1,19}/(approve|reject|revoke))?))$ {
        include /etc/nginx/snippets/leda-proxy.conf;
        proxy_pass http://leda_presentation;
        proxy_set_header X-Leda-Session-Capability "";
    }

    # Cualquier otra /api/leda/*: 404 JSON, nunca la SPA.
    location /api/leda/ { default_type application/json; return 404 '{"error":"not_found"}'; }

    location /assets/ { try_files $uri =404; add_header Cache-Control "public, max-age=31536000, immutable"; }
    location /        { try_files $uri /index.html; add_header Cache-Control "no-cache" always; }
}
```

Los métodos no permitidos de cada ruta los rechaza el backend con `405`. No reenvíe nunca `/internal/*` ni `/leda/*` del runtime.

## 6. Primera puesta en marcha (una sola vez)

Con el usuario fijo y las variables definidas:

1. `python -m leda_runtime.credential_cli provision-key` — crea la clave y el almacén cifrado. **Falla si ya existen: nunca borre ni regenere una clave existente.**
2. `docker exec -it -u <usuario> <contenedor> python -m leda_runtime.admin_cli provision-admin` — requiere TTY; contraseña de al menos **10 caracteres**; crea la cuenta `admin`.
3. Entregue la contraseña inicial al propietario por un canal seguro; él la cambia desde la UI.

En automatización, haga la provisión condicional: `provision-key` solo si no existen ni la clave ni `credentials/provider-credentials.sqlite3`; `provision-admin` solo si `GET /api/leda/admin/auth/status` informa `configured: false`.

Contraseña olvidada: `python -m leda_runtime.admin_cli reset-admin-password` (borra las sesiones de administrador).

## 7. Auto-deploy

En cada push: reconstruir la imagen y recrear el contenedor conservando **volumen de estado, clave y variables**. La sesión de administrador persiste; las sesiones de las páginas visor abiertas (en memoria) se reinician y requieren recargar la página. Habrá una breve interrupción (sin réplicas).

## 8. Red

- **Salida**: API de Gemini (voz) y, opcional, `api.telegram.org` (polling de salida, sin puerto de entrada).
- **Node-RED** lo consulta el **navegador** de cada usuario, no el runtime. La URL base la define el propietario en la UI y **debe ser absoluta** (`https://hmi.example.com/node-red`, no `/node-red`). Opciones: Node-RED alcanzable por los navegadores con CORS y HTTPS, o publicado bajo el mismo origen mediante un `location` de nginx (recomendado: sin CORS ni contenido mixto).

## 9. Checklist

1. Host/DNS y certificado TLS; `LEDA_PUBLIC_ORIGIN=https://<host>`.
2. Usuario fijo y volúmenes (estado y directorio dedicado de la clave) con ese propietario.
3. Imagen con `dist`, `leda-runtime` (dependencias bloqueadas), nginx, ffmpeg y gestor de procesos; nginx según §5; 5056/5057 sin publicar.
4. Arrancar con las variables de §3.
5. Provisión de §6.
6. `curl -sS https://<host>/api/leda/health` → `"ok": true`, `"ready": true` (`false` = el proceso `:5056` no responde).
7. `curl -i https://<host>/api/leda/inexistente` → 404 JSON; `curl -sS https://<host>/api/leda/admin/auth/status` → `configured: true`.
8. Prueba de `X-Real-IP`: seis logins fallidos cambiando la cabecera falsa, `for i in 1 2 3 4 5 6; do curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'Origin: https://<host>' -H "X-Real-IP: 203.0.113.$i" -d '{"username":"admin","password":"incorrecta"}' https://<host>/api/leda/admin/auth/login; done` → el sexto debe dar `429`; si todos dan `401`, nginx no sobrescribe la cabecera.
9. Inicio de sesión de administrador sin `403 AUTH_TRANSPORT_REJECTED` (revise `Host`, `Origin`, `LEDA_PUBLIC_ORIGIN`); `docker logs` sin `AUTH_STORAGE_PERMISSIONS_INVALID`; `/api/leda/events/stream` permanece abierto.
10. Respaldo de la clave por separado, auto-deploy probado (el estado persiste) y definición de cómo se accede a Node-RED.

## 10. Limitaciones conocidas

- Ambos procesos usan el servidor de desarrollo de Flask (`app.run(threaded=True)`): un solo proceso, sin réplicas ni workers.
- No hay manejador de `SIGTERM`: use un `stop_grace_period` corto y no espere cierre ordenado.
- El repositorio aún no incluye Dockerfile, CI ni configuración de nginx: son entregables de IT.
- El limitador de login tiene un tope global de 100 filas de fallos vigentes; un atacante que rote muchas IP puede bloquear temporalmente los inicios de sesión (mitigar con limitación por IP en nginx o cortafuegos).

---

## Detalle técnico

- [`docs/leda/LEDA_BROWSER_ROUTING.md`](leda/LEDA_BROWSER_ROUTING.md) — tabla de rutas, contrato de producción y razones de la topología.
- [`services/leda-runtime/README.md`](../services/leda-runtime/README.md) — runtime, variables completas, credenciales, límites de sesión.
- [`docs/DATA_CONTRACT.md`](DATA_CONTRACT.md) — contrato JSON de datos en tiempo real.
