# Leda browser routing

The HMI browser uses fixed same-origin routes for Leda. Browser code does not select a Leda runtime, store upstream addresses, or connect to loopback services directly.

UNI-1, UNI-2, and UNI-3 are complete offline after corrected independent verification. This guide does not claim live browser, backend, provider, or production forwarding acceptance.

## Route map

| Browser route | Method | Development upstream | Purpose |
|---|---|---|---|
| `/api/leda/session` | `POST`, `DELETE` | `http://127.0.0.1:5057/hmi/session` | Document-session creation and revocation |
| `/api/leda/snapshot` | `POST` | `http://127.0.0.1:5057/hmi/current-snapshot` | Current valid dashboard presentation frame |
| `/api/leda/events/latest` | `GET` | `http://127.0.0.1:5057/hmi/voice/latest` | Latest voice event polling |
| `/api/leda/ask` | `POST` | `http://127.0.0.1:5057/local/ask` | Question within the current document session |
| `/api/leda/voice-config` | `GET`, `PUT` | `http://127.0.0.1:5057/hmi/leda-config` | Voice-effect configuration envelope |
| `/api/leda/tts/live` | `POST` | `http://127.0.0.1:5056/leda/speak-live` | Progressive PCM audio stream |
| `/api/leda/admin/auth/status` | `GET` | Same path on `http://127.0.0.1:5057` | Offline-provisioning status |
| `/api/leda/admin/auth/login` | `POST` | Same path on `http://127.0.0.1:5057` | Administrator login |
| `/api/leda/admin/auth/session` | `GET` | Same path on `http://127.0.0.1:5057` | Validated session bootstrap/revalidation |
| `/api/leda/admin/auth/logout` | `POST` | Same path on `http://127.0.0.1:5057` | Administrator revocation |
| `/api/leda/admin/credentials` | `GET` | Same path on `http://127.0.0.1:5057` | Metadata-only credential status |
| `/api/leda/admin/credentials/gemini` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Explicit Gemini credential save and deletion |
| `/api/leda/admin/credentials/gemini/verify` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit, non-generating Gemini API key verification |
| `/api/leda/admin/credentials/telegram` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Telegram credential save (applies/restarts the bot with the new token in the same request) and deletion (stops the bot) |
| `/api/leda/admin/credentials/telegram/apply` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit Telegram apply and restart, kept for callers that need to re-apply without saving a new credential |
| `/api/leda/admin/credentials/telegram/verify` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit, non-sending Telegram (Canal B) bot token verification |
| `/api/leda/admin/credentials/telegram_channel_a` | `PUT`, `DELETE` | Same path on `http://127.0.0.1:5057` | Channel A credential save (applies/restarts the bot with the new token in the same request) and deletion (stops the bot) |
| `/api/leda/admin/credentials/telegram_channel_a/verify` | `POST` | Same path on `http://127.0.0.1:5057` | Explicit, non-sending Channel A bot token verification |
| `/api/leda/hmi-config` | `GET` | Same path on `http://127.0.0.1:5057` | Shared HMI configuration document (public read) |
| `/api/leda/hmi-config/revision` | `GET` | Same path on `http://127.0.0.1:5057` | Shared configuration revision (cheap poll, public read) |
| `/api/leda/admin/hmi-config` | `PUT` | Same path on `http://127.0.0.1:5057` | Admin-only batch write of the shared configuration |
| `/api/leda/health` | `GET` | `http://127.0.0.1:5057/health` | Passive runtime diagnostics |

## Shared HMI configuration

The shared configuration is the HMI's own settings (what an administrator configures in one browser
and every other browser must show). It is stored by the runtime in its own SQLite file under the
runtime state dir; it never reaches the plant or Node-RED.

- `GET /api/leda/hmi-config` returns `{"ok": true, "revision": <int>, "items": {<key>: <JSON string>}}`.
  No login: every viewer reads it.
- `GET /api/leda/hmi-config/revision` returns `{"ok": true, "revision": <int>}`; this is the cheap poll.
- `PUT /api/leda/admin/hmi-config` writes a batch: `{"set": {<key>: <string>}, "delete": [<key>]}` (both
  members optional, at least one non-empty, no key in both). It returns `{"ok": true, "revision": <int>}`
  with the revision incremented once per batch. It requires the administrator session cookie plus the
  `X-CSRF-Token` header and the same Origin/Host checks as the credential routes.
- The write is mounted under `/api/leda/admin` on purpose: the session cookie is scoped to that path
  and would not be sent to `/api/leda/hmi-config`. The public reads stay outside the admin prefix.
- Bounds: key 1-128 characters of `[A-Za-z0-9:._-]`; value a string up to 4 MiB (UTF-8); at most 200
  operations and 16 MiB of request body per batch, 512 keys and 32 MiB in the whole document. The browser
  adapter splits its outgoing batches to respect the operation and request bounds. Stable failures: `401
  AUTHENTICATION_REQUIRED`, `403 CSRF_VALIDATION_FAILED` / `AUTH_TRANSPORT_REJECTED`, `415 JSON_REQUIRED`,
  `400 HMI_CONFIG_INVALID_REQUEST`, `413 HMI_CONFIG_VALUE_TOO_LARGE` / `HMI_CONFIG_DOCUMENT_TOO_LARGE` /
  `HMI_CONFIG_REQUEST_TOO_LARGE`, and `503 HMI_CONFIG_UNAVAILABLE`. Every response is `Cache-Control: no-store`.

## Single administrator session

The runtime keeps at most one live administrator session (idle and absolute expiry as before).

- `POST /api/leda/admin/auth/login` accepts an optional boolean `takeover` (default `false`; any other
  type is `400 INVALID_LOGIN_REQUEST`).
- If the password is verified and another non-expired session exists, login without `takeover` answers
  `409 ADMIN_SESSION_ACTIVE_ELSEWHERE`, sets no cookie and creates nothing. A wrong password never reaches
  that check: it is always `401 INVALID_CREDENTIALS`, so session existence is never revealed to an
  unauthenticated caller. Rate limiting is unchanged; a verified password clears its failure budget.
- With `takeover: true` the runtime revokes every other session and creates the new one in one transaction.
- A displaced session's next request on any admin route (`auth/session`, credentials, `admin/hmi-config`)
  answers `401 ADMIN_SESSION_REPLACED` instead of `401 AUTHENTICATION_REQUIRED`. The runtime remembers it in
  `replaced_sessions` (hash of the session id; row kept until the replaced session's own absolute expiry, at
  most 64 rows). Expiry, logout and a password reset keep the generic code.

Browser constants live in `hmi-app/src/config/ledaAssistant.config.ts`. Development-only targets and rewrite rules live in `hmi-app/vite.ledaProxy.config.ts` and must not be imported by browser modules.

## Development forwarding

Vite forwards only the exact pathnames above, optionally followed by a query string, and only their listed methods. The rules:

- preserve encoded query bytes during rewriting;
- reject suffixes, trailing slashes, encoded-path lookalikes, and unrelated `/api/leda/*` paths;
- bypass Vite transforms and SPA fallback only for matched API requests;
- keep Vite host and CORS behavior unchanged; and
- use normal proxy streaming without response buffering or header replacement.

Admin and health routes strip `X-Leda-Session-Capability`; administrator authority uses only the
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

The `/api/leda/snapshot` publish command may carry an optional `frameGeneration` (positive
JavaScript-safe integer): the browser exporter mints exactly one generation per view visit and
reuses it across that visit's periodic ticks and resumes, so a routine same-view refresh renews
context receipt freshness without a new context revision. It never renews the captured answer's
deadline. The wire detail is defined by the runtime contract in
`services/leda-runtime/README.md`; routing, forwarding rules, and lifecycle ownership are
unchanged.

If auth status reports `configured: false`, provision the single administrator through the offline
runtime procedure in `services/leda-runtime/README.md` (`provision-admin`). The browser does not
provision administrator credentials, configure the master key, create accounts, or provide recovery commands.

`npm run dev` owns the development runtime lifecycle described by the Leda foundation documentation. Browser routing itself has no startup side effects.

## Production forwarding contract

The IT host must expose the same browser routes and forward them to the corresponding upstream paths. The production boundary must preserve:

- HTTP methods, request bodies, status codes, and response headers;
- query strings without decoding and re-encoding them;
- cancellation and timeout propagation; and
- progressive, unbuffered response delivery for `/api/leda/tts/live`.

The SPA fallback must never answer these API routes. A missing or unavailable upstream must remain an API failure rather than returning `index.html`.

## Security and deployment boundary

The backend routes define administrator authentication and authorization, but this document does not implement production forwarding, certificates, process supervision, or a reverse-proxy product. Those production controls belong to the IT deployment design and must not be inferred from the Vite development proxy.

Legacy runtime-mode, endpoint, snapshot-export, and TTS URL values may remain in browser storage, but they are inert and do not influence requests.
