import type { ProxyOptions } from 'vite';

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
    createRoute('/api/prisma/ask', 'http://127.0.0.1:5057', '/local/ask', ['POST']),
    createRoute('/api/prisma/voice-config', 'http://127.0.0.1:5057', '/hmi/prisma-config', ['GET', 'PUT']),
    createRoute('/api/prisma/tts/live', 'http://127.0.0.1:5056', '/prisma/speak-live', ['POST']),
    createRoute('/api/prisma/admin/auth/status', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/status', ['GET'], true),
    createRoute('/api/prisma/admin/auth/login', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/login', ['POST'], true),
    createRoute('/api/prisma/admin/auth/session', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/session', ['GET'], true),
    createRoute('/api/prisma/admin/auth/logout', 'http://127.0.0.1:5057', '/api/prisma/admin/auth/logout', ['POST'], true),
    createRoute('/api/prisma/admin/credentials', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials', ['GET'], true),
    createRoute('/api/prisma/admin/credentials/gemini', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/gemini', ['PUT', 'DELETE'], true),
    createRoute('/api/prisma/admin/credentials/telegram', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram', ['PUT', 'DELETE'], true),
    createRoute('/api/prisma/admin/credentials/telegram/apply', 'http://127.0.0.1:5057', '/api/prisma/admin/credentials/telegram/apply', ['POST'], true),
    createRoute('/api/prisma/health', 'http://127.0.0.1:5057', '/health', ['GET'], true),
]);

export function createPrismaProxyConfig(): Record<string, ProxyOptions> {
    return Object.fromEntries(PRISMA_PROXY_ROUTES.map((route) => [
        route.pattern,
        {
            target: route.target,
            changeOrigin: true,
            bypass: (request, response) => {
                if (route.methods.includes(request.method ?? 'GET')) return;
                if (!response) return false;
                response.statusCode = 405;
                response.setHeader('Cache-Control', 'no-store');
                response.end();
                return false;
            },
            configure: route.stripSessionCapability
                ? (proxy) => {
                    proxy.on('proxyReq', (proxyRequest) => {
                        proxyRequest.removeHeader('X-Prisma-Session-Capability');
                    });
                }
                : undefined,
            rewrite: (path: string) => path.replace(
                new RegExp(`^${route.browserPath}(?=\\?|$)`),
                route.upstreamPath,
            ),
        },
    ]));
}
