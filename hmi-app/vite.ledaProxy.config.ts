import type { ProxyOptions } from 'vite';
import type { ServerResponse } from 'node:http';

// Mirrors dev.mjs's minimal LEDA_STARTUP_FAILURE marker (T1b/T4b): { reason, port }, or the
// env var absent/malformed when the launcher detected no specific failure. Never trusted beyond
// this shape — an unknown reason or an out-of-range port is treated as "no detail available".
interface LedaStartupFailure {
    reason: 'port_in_use';
    port: number;
}

const KNOWN_STARTUP_FAILURE_REASONS = new Set<LedaStartupFailure['reason']>(['port_in_use']);

function readLedaStartupFailure(): LedaStartupFailure | null {
    const raw = process.env.LEDA_STARTUP_FAILURE;
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { reason, port } = parsed as Record<string, unknown>;
        if (typeof reason !== 'string' || !KNOWN_STARTUP_FAILURE_REASONS.has(reason as LedaStartupFailure['reason'])) return null;
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
        return { reason: reason as LedaStartupFailure['reason'], port };
    } catch {
        return null;
    }
}

interface LedaProxyRoute {
    browserPath: string;
    pattern: string;
    target: string;
    // null: the upstream path is the browser path itself (used by dynamic-segment routes,
    // whose browserPath is a label and cannot be rewritten to a fixed string).
    upstreamPath: string | null;
    methods: readonly string[];
    stripSessionCapability?: boolean;
}

function createRoute(
    browserPath: string,
    target: string,
    upstreamPath: string,
    methods: readonly string[],
    stripSessionCapability = false,
): LedaProxyRoute {
    return {
        browserPath,
        pattern: `^${browserPath}(?:\\?.*)?$`,
        target,
        upstreamPath,
        methods,
        stripSessionCapability,
    };
}

// A route whose path carries a dynamic segment: `browserPath` is a readable label and
// `pathPattern` the regex source matched against the request path. The path is forwarded
// to the runtime unchanged (same path on 5057), so no rewrite target is needed.
function createDynamicRoute(
    browserPath: string,
    pathPattern: string,
    target: string,
    methods: readonly string[],
    stripSessionCapability = false,
): LedaProxyRoute {
    return {
        browserPath,
        pattern: `^${pathPattern}(?:\\?.*)?$`,
        target,
        upstreamPath: null,
        methods,
        stripSessionCapability,
    };
}

// Telegram chat ids are canonical decimal integers (negative for groups); the runtime caps
// them at 20 characters (admin_http.parse_chat_id), so up to 19 digits after an optional sign.
const CHANNEL_B_ACCESS_PATH = '/api/leda/admin/channel-b/access';
const CHANNEL_B_CHAT_ID_PATTERN = '-?[0-9]{1,19}';

export const LEDA_PROXY_ROUTES: readonly LedaProxyRoute[] = Object.freeze([
    createRoute('/api/leda/session', 'http://127.0.0.1:5057', '/hmi/session', ['POST', 'DELETE']),
    createRoute('/api/leda/snapshot', 'http://127.0.0.1:5057', '/hmi/current-snapshot', ['POST']),
    createRoute('/api/leda/events/latest', 'http://127.0.0.1:5057', '/hmi/voice/latest', ['GET']),
    // T13 unit (c) / T10 unit 5: push voice events (SSE) instead of 1s
    // polling. T13b: the HMI reads this with a header-based fetch reader
    // (like every other route below), so the session capability travels
    // in the ordinary request header and is never stripped here.
    createRoute('/api/leda/events/stream', 'http://127.0.0.1:5057', '/hmi/voice/events', ['GET']),
    createRoute('/api/leda/ask', 'http://127.0.0.1:5057', '/local/ask', ['POST']),
    // T16: batched browser voice timeline diagnostics -- header-based
    // session capability, like every other route above.
    createRoute('/api/leda/voice/timeline', 'http://127.0.0.1:5057', '/hmi/voice/timeline', ['POST']),
    createRoute('/api/leda/voice-config', 'http://127.0.0.1:5057', '/hmi/leda-config', ['GET', 'PUT']),
    createRoute('/api/leda/tts/live', 'http://127.0.0.1:5056', '/leda/speak-live', ['POST']),
    createRoute('/api/leda/channel-a/pairing', 'http://127.0.0.1:5057', '/hmi/channel-a/pairing', ['GET', 'POST']),
    createRoute('/api/leda/admin/auth/status', 'http://127.0.0.1:5057', '/api/leda/admin/auth/status', ['GET'], true),
    createRoute('/api/leda/admin/auth/login', 'http://127.0.0.1:5057', '/api/leda/admin/auth/login', ['POST'], true),
    createRoute('/api/leda/admin/auth/session', 'http://127.0.0.1:5057', '/api/leda/admin/auth/session', ['GET'], true),
    createRoute('/api/leda/admin/auth/logout', 'http://127.0.0.1:5057', '/api/leda/admin/auth/logout', ['POST'], true),
    createRoute('/api/leda/admin/auth/password', 'http://127.0.0.1:5057', '/api/leda/admin/auth/password', ['POST'], true),
    createRoute('/api/leda/admin/credentials', 'http://127.0.0.1:5057', '/api/leda/admin/credentials', ['GET'], true),
    createRoute('/api/leda/admin/credentials/gemini', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/gemini', ['PUT', 'DELETE'], true),
    createRoute('/api/leda/admin/credentials/gemini/verify', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/gemini/verify', ['POST'], true),
    createRoute('/api/leda/admin/credentials/telegram', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram', ['PUT', 'DELETE'], true),
    createRoute('/api/leda/admin/credentials/telegram/apply', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram/apply', ['POST'], true),
    createRoute('/api/leda/admin/credentials/telegram/verify', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram/verify', ['POST'], true),
    createRoute('/api/leda/admin/credentials/telegram_channel_a', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram_channel_a', ['PUT', 'DELETE'], true),
    createRoute('/api/leda/admin/credentials/telegram_channel_a/status', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram_channel_a/status', ['GET'], true),
    createRoute('/api/leda/admin/credentials/telegram_channel_a/apply', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram_channel_a/apply', ['POST'], true),
    createRoute('/api/leda/admin/credentials/telegram_channel_a/verify', 'http://127.0.0.1:5057', '/api/leda/admin/credentials/telegram_channel_a/verify', ['POST'], true),
    // Shared HMI configuration: public reads (the session cookie is scoped to /api/leda/admin
    // and never reaches them) and the admin-only write under the admin prefix.
    createRoute('/api/leda/hmi-config', 'http://127.0.0.1:5057', '/api/leda/hmi-config', ['GET'], true),
    createRoute('/api/leda/hmi-config/revision', 'http://127.0.0.1:5057', '/api/leda/hmi-config/revision', ['GET'], true),
    createRoute('/api/leda/admin/hmi-config', 'http://127.0.0.1:5057', '/api/leda/admin/hmi-config', ['PUT'], true),
    // Channel B access control: the pending/approved chat list and the approve/reject/revoke
    // decisions. Same path on 5057; the decisions carry the chat id as a path segment.
    createRoute(CHANNEL_B_ACCESS_PATH, 'http://127.0.0.1:5057', CHANNEL_B_ACCESS_PATH, ['GET'], true),
    createDynamicRoute(
        `${CHANNEL_B_ACCESS_PATH}/:chatId/:decision`,
        `${CHANNEL_B_ACCESS_PATH}/${CHANNEL_B_CHAT_ID_PATTERN}/(?:approve|reject|revoke)`,
        'http://127.0.0.1:5057',
        ['POST'],
        true,
    ),
    createRoute('/api/leda/health', 'http://127.0.0.1:5057', '/health', ['GET'], true),
]);

export function createLedaProxyConfig(): Record<string, ProxyOptions> {
    // Read once, at config build time (T4c): a foreign process holding 5056/5057 IS a real
    // listener, so the proxy would otherwise forward to it successfully and the on('error')
    // handler below would never fire. When the launcher already reported a specific startup
    // failure, Leda itself never started this session, so nothing on those ports is ours —
    // every Leda route answers the same failure JSON directly, without ever forwarding.
    const startupFailure = readLedaStartupFailure();

    return Object.fromEntries(LEDA_PROXY_ROUTES.map((route) => [
        route.pattern,
        {
            target: route.target,
            changeOrigin: true,
            bypass: (request, response) => {
                if (startupFailure) {
                    if (!response) return false;
                    const body = JSON.stringify({ error: 'leda_runtime_unreachable', reason: startupFailure.reason, port: startupFailure.port });
                    response.statusCode = 503;
                    response.setHeader('Content-Type', 'application/json');
                    response.setHeader('Cache-Control', 'no-store');
                    response.end(body);
                    return false;
                }
                if (route.methods.includes(request.method ?? 'GET')) return;
                if (!response) return false;
                response.statusCode = 405;
                response.setHeader('Cache-Control', 'no-store');
                response.end();
                return false;
            },
            configure: (proxy) => {
                if (route.stripSessionCapability) {
                    proxy.on('proxyReq', (proxyRequest) => {
                        proxyRequest.removeHeader('X-Leda-Session-Capability');
                    });
                }
                // Vite's default proxy error handler (ECONNREFUSED etc.) answers a bodiless 500
                // (vite/dist/node/chunks/config.js), which the HMI client cannot distinguish
                // from any other server error. This answers a JSON 503 instead, carrying the
                // detected startup failure (T1b's LEDA_STARTUP_FAILURE env var) when present,
                // so the pairing popover can show the actual busy port.
                proxy.on('error', (_error, _request, response) => {
                    const serverResponse = response as ServerResponse;
                    if (!serverResponse || typeof serverResponse.writeHead !== 'function' || serverResponse.headersSent) return;
                    const failure = readLedaStartupFailure();
                    const body = failure
                        ? JSON.stringify({ error: 'leda_runtime_unreachable', reason: failure.reason, port: failure.port })
                        : JSON.stringify({ error: 'leda_runtime_unreachable' });
                    serverResponse.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                    serverResponse.end(body);
                });
            },
            rewrite: (path: string) => {
                const { upstreamPath } = route;
                if (upstreamPath === null) return path;
                return path.replace(new RegExp(`^${route.browserPath}(?=\\?|$)`), upstreamPath);
            },
        },
    ]));
}
