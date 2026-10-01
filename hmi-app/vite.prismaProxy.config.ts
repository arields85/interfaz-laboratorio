import type { ProxyOptions } from 'vite';
import type { ServerResponse } from 'node:http';

// Mirrors dev.mjs's minimal PRISMA_STARTUP_FAILURE marker (T1b/T4b): { reason, port }, or the
// env var absent/malformed when the launcher detected no specific failure. Never trusted beyond
// this shape — an unknown reason or an out-of-range port is treated as "no detail available".
interface PrismaStartupFailure {
    reason: 'port_in_use';
    port: number;
}

const KNOWN_STARTUP_FAILURE_REASONS = new Set<PrismaStartupFailure['reason']>(['port_in_use']);

function readPrismaStartupFailure(): PrismaStartupFailure | null {
    const raw = process.env.PRISMA_STARTUP_FAILURE;
    if (!raw) return null;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { reason, port } = parsed as Record<string, unknown>;
        if (typeof reason !== 'string' || !KNOWN_STARTUP_FAILURE_REASONS.has(reason as PrismaStartupFailure['reason'])) return null;
        if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
        return { reason: reason as PrismaStartupFailure['reason'], port };
    } catch {
        return null;
    }
}

interface PrismaProxyRoute {
    browserPath: string;
    pattern: string;
    target: string;
    upstreamPath: string;
    methods: readonly string[];
    stripSessionCapability?: boolean;
}

function createRoute(
    browserPath: string,
    target: string,
    upstreamPath: string,
    methods: readonly string[],
    stripSessionCapability = false,
): PrismaProxyRoute {
    return {
        browserPath,
        pattern: `^${browserPath}(?:\\?.*)?$`,
        target,
        upstreamPath,
        methods,
        stripSessionCapability,
    };
}

export const PRISMA_PROXY_ROUTES: readonly PrismaProxyRoute[] = Object.freeze([
    createRoute('/api/prisma/session', 'http://127.0.0.1:5057', '/hmi/session', ['POST', 'DELETE']),
    createRoute('/api/prisma/snapshot', 'http://127.0.0.1:5057', '/hmi/current-snapshot', ['POST']),
    createRoute('/api/prisma/events/latest', 'http://127.0.0.1:5057', '/hmi/voice/latest', ['GET']),
    // T13 unit (c) / T10 unit 5: push voice events (SSE) instead of 1s
    // polling. T13b: the HMI reads this with a header-based fetch reader
    // (like every other route below), so the session capability travels
    // in the ordinary request header and is never stripped here.
    createRoute('/api/prisma/events/stream', 'http://127.0.0.1:5057', '/hmi/voice/events', ['GET']),
    createRoute('/api/prisma/ask', 'http://127.0.0.1:5057', '/local/ask', ['POST']),
    // T16: batched browser voice timeline diagnostics -- header-based
    // session capability, like every other route above.
    createRoute('/api/prisma/voice/timeline', 'http://127.0.0.1:5057', '/hmi/voice/timeline', ['POST']),
    createRoute('/api/prisma/voice-config', 'http://127.0.0.1:5057', '/hmi/prisma-config', ['GET', 'PUT']),
    createRoute('/api/prisma/tts/live', 'http://127.0.0.1:5056', '/prisma/speak-live', ['POST']),
    createRoute('/api/prisma/channel-a/pairing', 'http://127.0.0.1:5057', '/hmi/channel-a/pairing', ['GET', 'POST']),
    createRoute('/api/prisma/admin/auth/status', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/status', ['GET'], true),
    createRoute('/api/prisma/admin/auth/login', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/login', ['POST'], true),
    createRoute('/api/prisma/admin/auth/session', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/session', ['GET'], true),
    createRoute('/api/prisma/admin/auth/logout', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/logout', ['POST'], true),
    createRoute('/api/prisma/admin/credentials', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials', ['GET'], true),
    createRoute('/api/prisma/admin/credentials/gemini', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/gemini', ['PUT', 'DELETE'], true),
    createRoute('/api/prisma/admin/credentials/gemini/verify', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/gemini/verify', ['POST'], true),
    createRoute('/api/prisma/admin/credentials/telegram', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram', ['PUT', 'DELETE'], true),
    createRoute('/api/prisma/admin/credentials/telegram/apply', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram/apply', ['POST'], true),
    createRoute('/api/prisma/admin/credentials/telegram/verify', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram/verify', ['POST'], true),
    createRoute('/api/prisma/admin/credentials/telegram_channel_a', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram_channel_a', ['PUT', 'DELETE'], true),
    createRoute('/api/prisma/admin/credentials/telegram_channel_a/status', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram_channel_a/status', ['GET'], true),
    createRoute('/api/prisma/admin/credentials/telegram_channel_a/apply', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram_channel_a/apply', ['POST'], true),
    createRoute('/api/prisma/admin/credentials/telegram_channel_a/verify', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram_channel_a/verify', ['POST'], true),
    // Shared HMI configuration: public reads (the session cookie is scoped to /api/prisma/admin
    // and never reaches them) and the admin-only write under the admin prefix.
    createRoute('/api/prisma/hmi-config', 'http://127.0.0.1:5057', '/api/prisma/hmi-config', ['GET'], true),
    createRoute('/api/prisma/hmi-config/revision', 'http://127.0.0.1:5057', '/api/prisma/hmi-config/revision', ['GET'], true),
    createRoute('/api/prisma/admin/hmi-config', 'http://127.0.0.1:5057', '/api/prisma/admin/hmi-config', ['PUT'], true),
    createRoute('/api/prisma/health', 'http://127.0.0.1:5057', '/health', ['GET'], true),
]);

export function createPrismaProxyConfig(): Record<string, ProxyOptions> {
    // Read once, at config build time (T4c): a foreign process holding 5056/5057 IS a real
    // listener, so the proxy would otherwise forward to it successfully and the on('error')
    // handler below would never fire. When the launcher already reported a specific startup
    // failure, Prisma itself never started this session, so nothing on those ports is ours —
    // every Prisma route answers the same failure JSON directly, without ever forwarding.
    const startupFailure = readPrismaStartupFailure();

    return Object.fromEntries(PRISMA_PROXY_ROUTES.map((route) => [
        route.pattern,
        {
            target: route.target,
            changeOrigin: true,
            bypass: (request, response) => {
                if (startupFailure) {
                    if (!response) return false;
                    const body = JSON.stringify({ error: 'prisma_runtime_unreachable', reason: startupFailure.reason, port: startupFailure.port });
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
                        proxyRequest.removeHeader('X-Prisma-Session-Capability');
                    });
                }
                // Vite's default proxy error handler (ECONNREFUSED etc.) answers a bodiless 500
                // (vite/dist/node/chunks/config.js), which the HMI client cannot distinguish
                // from any other server error. This answers a JSON 503 instead, carrying the
                // detected startup failure (T1b's PRISMA_STARTUP_FAILURE env var) when present,
                // so the pairing popover can show the actual busy port.
                proxy.on('error', (_error, _request, response) => {
                    const serverResponse = response as ServerResponse;
                    if (!serverResponse || typeof serverResponse.writeHead !== 'function' || serverResponse.headersSent) return;
                    const failure = readPrismaStartupFailure();
                    const body = failure
                        ? JSON.stringify({ error: 'prisma_runtime_unreachable', reason: failure.reason, port: failure.port })
                        : JSON.stringify({ error: 'prisma_runtime_unreachable' });
                    serverResponse.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                    serverResponse.end(body);
                });
            },
            rewrite: (path: string) => path.replace(
                new RegExp(`^${route.browserPath}(?=\\?|$)`),
                route.upstreamPath,
            ),
        },
    ]));
}
