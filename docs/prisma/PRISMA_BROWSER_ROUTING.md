# Prisma browser routing

The HMI browser uses four fixed same-origin routes for Prisma. Browser code does not select a Prisma runtime, store upstream addresses, or connect to loopback services directly.

UNI-1, UNI-2, and UNI-3 are complete offline after corrected independent verification. This guide does not claim live browser, backend, provider, or production forwarding acceptance.

## Route map

| Browser route | Method | Development upstream | Purpose |
|---|---|---|---|
| `/api/prisma/snapshot` | `POST` | `http://127.0.0.1:5057/hmi/current-snapshot` | Current valid dashboard presentation frame |
| `/api/prisma/events/latest` | `GET` | `http://127.0.0.1:5057/hmi/voice/latest` | Latest voice event polling |
| `/api/prisma/voice-config` | `GET`, `PUT` | `http://127.0.0.1:5057/hmi/prisma-config` | Voice-effect configuration envelope |
| `/api/prisma/tts/live` | `POST` | `http://127.0.0.1:5056/prisma/speak-live` | Progressive PCM audio stream |

Browser constants live in `hmi-app/src/config/prismaAssistant.config.ts`. Development-only targets and rewrite rules live in `hmi-app/vite.prismaProxy.config.ts` and must not be imported by browser modules.

## Development forwarding

Vite forwards only the exact pathnames above, optionally followed by a query string. The rules:

- preserve encoded query bytes during rewriting;
- reject suffixes, trailing slashes, encoded-path lookalikes, and unrelated `/api/prisma/*` paths;
- bypass Vite transforms and SPA fallback only for matched API requests;
- keep Vite host and CORS behavior unchanged; and
- use normal proxy streaming without response buffering or header replacement.

`npm run dev` owns the development runtime lifecycle described by the Prisma foundation documentation. Browser routing itself has no startup side effects.

## Production forwarding contract

The IT host must expose the same four browser routes and forward them to the corresponding upstream paths. The production boundary must preserve:

- HTTP methods, request bodies, status codes, and response headers;
- query strings without decoding and re-encoding them;
- cancellation and timeout propagation; and
- progressive, unbuffered response delivery for `/api/prisma/tts/live`.

The SPA fallback must never answer these API routes. A missing or unavailable upstream must remain an API failure rather than returning `index.html`.

## Security and deployment boundary

This route contract does not define authentication, authorization, secret storage, certificates, process supervision, or a specific reverse-proxy product. Those production controls belong to the IT deployment design and must not be inferred from the Vite development proxy.

Legacy runtime-mode, endpoint, snapshot-export, and TTS URL values may remain in browser storage, but they are inert and do not influence requests.
