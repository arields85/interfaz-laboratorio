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
| `/api/prisma/admin/credentials/gemini/verify` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit, non-generating Gemini API key verification |
| `/api/prisma/admin/credentials/telegram` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Telegram credential save (applies/restarts the bot with the new token in the same request) and deletion (stops the bot) |
| `/api/prisma/admin/credentials/telegram/apply` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit Telegram apply and restart, kept for callers that need to re-apply without saving a new credential |
| `/api/prisma/admin/credentials/telegram/verify` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit, non-sending Telegram (Canal B) bot token verification |
| `/api/prisma/admin/credentials/telegram_channel_a` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Channel A credential save (applies/restarts the bot with the new token in the same request) and deletion (stops the bot) |
| `/api/prisma/admin/credentials/telegram_channel_a/verify` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit, non-sending Channel A bot token verification |
| `/api/prisma/hmi-config` | `GET` | Same path on `http://127.0.0.1:5057` | Shared HMI configuration document (public read) |
| `/api/prisma/hmi-config/revision` | `GET` | Same path on `http://127.0.0.1:5057` | Shared configuration revision (cheap poll, public read) |
| `/api/prisma/admin/hmi-config` | `PUT` | Same path on `http://127.0.0.1:5057` | Admin-only batch write of the shared configuration |
| `/api/prisma/health` | `GET` | `http://127.0.0.1:5057/health` | Passive runtime diagnostics |

## Shared HMI configuration

The shared configuration is the HMI's own settings (what an administrator configures in one browser
and every other browser must show). It is stored by the runtime in its own SQLite file under the
runtime state dir; it never reaches the plant or Node-RED.

- `GET /api/prisma/hmi-config` returns `{"ok": true, "revision": <int>, "items": {<key>: <JSON string>}}`.
  No login: every viewer reads it.
- `GET /api/prisma/hmi-config/revision` returns `{"ok": true, "revision": <int>}`; this is the cheap poll.
- `PUT /api/prisma/admin/hmi-config` writes a batch: `{"set": {<key>: <string>}, "delete": [<key>]}` (both
  members optional, at least one non-empty, no key in both). It returns `{"ok": true, "revision": <int>}`
  with the revision incremented once per batch. It requires the administrator session cookie plus the
  `X-CSRF-Token` header and the same Origin/Host checks as the credential routes.
- The write is mounted under `/api/prisma/admin` on purpose: the session cookie is scoped to that path
  and would not be sent to `/api/prisma/hmi-config`. The public reads stay outside the admin prefix.
- Bounds: key 1-128 characters of `[A-Za-z0-9:._-]`; value a string up to 1 MiB (UTF-8); at most 200
  operations per batch, 512 keys and 8 MiB in the whole document. Stable failures: `401
  AUTHENTICATION_REQUIRED`, `403 CSRF_VALIDATION_FAILED` / `AUTH_TRANSPORT_REJECTED`, `415 JSON_REQUIRED`,
  `400 HMI_CONFIG_INVALID_REQUEST`, `413 HMI_CONFIG_VALUE_TOO_LARGE` / `HMI_CONFIG_DOCUMENT_TOO_LARGE` /
  `HMI_CONFIG_REQUEST_TOO_LARGE`, and `503 HMI_CONFIG_UNAVAILABLE`. Every response is `Cache-Control: no-store`.

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

The Channel A credential route writes or deletes a secret in the protected credential store; a save
also applies it (the manager attempts to restart the bot with the new token in the same request). A
`configured: true` metadata value means the store holds a Channel A credential; it does not by itself
mean the Channel A bot is running, verified, paired, or connected -- the post-save apply attempt can
still fail (captured in the Channel A status route's `lastError`, never raised back to the save
response). Channel A pairing and session routes are not part of this proxy yet.

The Gemini verify route triggers one on-demand, non-generating key check against Google (a model
lookup, never a generation call, so it never consumes generation quota) and reports a closed
classification (`verified`, `invalid_key`, `unreachable`, or `not_configured`) with a timestamp; it
never returns the secret or raw provider error text. The result lives only in the runtime's process
memory (not persisted) and resets to unverified whenever the Gemini credential is saved or deleted.

The Telegram and Channel A verify routes each trigger one on-demand, non-sending bot token check: a
single Telegram Bot API `getMe` call, never `getUpdates` (no update offset is read or consumed) and
never a message send, so verifying never starts, stops, or restarts the bot. They report a closed
classification (`verified`, `invalid_token`, `unreachable`, or `not_configured`) with a timestamp and,
only once verified, the bot's own public `username`; the token and any raw provider response are
never returned. Each result lives only in the runtime's process memory (not persisted) and resets to
unverified whenever that exact provider's credential is saved or deleted -- verifying Telegram never
resets Channel A's result or vice versa.

The `/api/prisma/snapshot` publish command may carry an optional `frameGeneration` (positive
JavaScript-safe integer): the browser exporter mints exactly one generation per view visit and
reuses it across that visit's periodic ticks and resumes, so a routine same-view refresh renews
context receipt freshness without a new context revision. It never renews the captured answer's
deadline. The wire detail is defined by the runtime contract in
`services/prisma-runtime/README.md`; routing, forwarding rules, and lifecycle ownership are
unchanged.

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
