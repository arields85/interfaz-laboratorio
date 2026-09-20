# Prisma browser routing

The HMI browser uses fixed same-origin routes for Prisma. Browser code does not select a Prisma runtime, store upstream addresses, or connect to loopback services directly.

UNI-1, UNI-2, and UNI-3 are complete offline after corrected independent verification. This guide does not claim live browser, backend, provider, or production forwarding acceptance.

## Route map

| Browser route | Method | Development upstream | Purpose |
|---|---|---|---|
| `/api/prisma/session` | `POST`, `DELETE` | `http://127.0.0.1:5057/hmi/session` | Document-session creation and revocation |
| `/api/prisma/snapshot` | `POST` | `http://127.0.0.1:5057/hmi/current-snapshot` | Current valid dashboard presentation frame |
| `/api/prisma/events/latest` | `GET` | `http://127.0.0.1:5057/hmi/voice/latest` | Latest voice event polling |
| `/api/prisma/ask` | `POST` | `http://127.0.0.1:5057/local/ask` | Question within the current document session |
| `/api/prisma/voice-config` | `GET`, `PUT` | `http://127.0.0.1:5057/hmi/prisma-config` | Voice-effect configuration envelope |
| `/api/prisma/tts/live` | `POST` | `http://127.0.0.1:5056/prisma/speak-live` | Progressive PCM audio stream |
| `/api/prisma/admin/auth/status` | `GET` | Same path on `http://127.0.0.1:5057` | Offline-provisioning status |
| `/api/prisma/admin/auth/login` | `POST` | Same path on `http://127.0.0.1:5057` | Administrator login |
| `/api/prisma/admin/auth/session` | `GET` | Same path on `http://127.0.0.1:5057` | Validated session bootstrap/revalidation |
| `/api/prisma/admin/auth/logout` | `POST` | Same path on `http://127.0.0.1:5057` | Administrator revocation |
| `/api/prisma/admin/credentials` | `GET` | Same path on `http://127.0.0.1:5057` | Metadata-only credential status |
| `/api/prisma/admin/credentials/gemini` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Explicit Gemini credential save and deletion |
| `/api/prisma/admin/credentials/telegram` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Explicit Telegram credential save and deletion |
| `/api/prisma/admin/credentials/telegram/apply` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit Telegram apply and restart |
| `/api/prisma/admin/credentials/telegram_channel_a` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Explicit Channel A credential save and deletion |
| `/api/prisma/health` | `GET` | `http://127.0.0.1:5057/health` | Passive runtime diagnostics |

Browser constants live in `hmi-app/src/config/prismaAssistant.config.ts`. Development-only targets and rewrite rules live in `hmi-app/vite.prismaProxy.config.ts` and must not be imported by browser modules.

## Development forwarding

Vite forwards only the exact pathnames above, optionally followed by a query string, and only their listed methods. The rules:

- preserve encoded query bytes during rewriting;
- reject suffixes, trailing slashes, encoded-path lookalikes, and unrelated `/api/prisma/*` paths;
- bypass Vite transforms and SPA fallback only for matched API requests;
- keep Vite host and CORS behavior unchanged; and
- use normal proxy streaming without response buffering or header replacement.

Admin and health routes strip `X-Prisma-Session-Capability`; administrator authority uses only the
backend cookie and CSRF contract. Cookies, `Set-Cookie`, `Origin`, CSRF, response status, and
`Cache-Control: no-store` otherwise pass through the development proxy unchanged.

The Channel A credential route only writes or deletes a secret in the protected credential store. A
`configured: true` metadata value means the store holds a Channel A credential; it does not mean the
Channel A bot is running, verified, paired, or connected. Channel A runtime status, apply, pairing,
and session routes are not part of this proxy yet.

If auth status reports `configured: false`, provision the single administrator through the offline
runtime procedure in `services/prisma-runtime/README.md` (`provision-admin`). The browser does not
provision administrator credentials, configure the master key, create accounts, or provide recovery commands.

`npm run dev` owns the development runtime lifecycle described by the Prisma foundation documentation. Browser routing itself has no startup side effects.

## Production forwarding contract

The IT host must expose the same browser routes and forward them to the corresponding upstream paths. The production boundary must preserve:

- HTTP methods, request bodies, status codes, and response headers;
- query strings without decoding and re-encoding them;
- cancellation and timeout propagation; and
- progressive, unbuffered response delivery for `/api/prisma/tts/live`.

The SPA fallback must never answer these API routes. A missing or unavailable upstream must remain an API failure rather than returning `index.html`.

## Security and deployment boundary

The backend routes define administrator authentication and authorization, but this document does not implement production forwarding, certificates, process supervision, or a reverse-proxy product. Those production controls belong to the IT deployment design and must not be inferred from the Vite development proxy.

Legacy runtime-mode, endpoint, snapshot-export, and TTS URL values may remain in browser storage, but they are inert and do not influence requests.
