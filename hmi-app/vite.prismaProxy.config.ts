import type { ProxyOptions } from 'vite';

interface PrismaProxyRoute {
    browserPath: string;
    pattern: string;
    target: string;
    upstreamPath: string;
}

function createRoute(
    browserPath: string,
    target: string,
    upstreamPath: string,
): PrismaProxyRoute {
    return {
        browserPath,
        pattern: `^${browserPath}(?:\\?.*)?$`,
        target,
        upstreamPath,
    };
}

export const PRISMA_PROXY_ROUTES: readonly PrismaProxyRoute[] = Object.freeze([
    createRoute('/api/prisma/snapshot', 'http://127.0.0.1:5057', '/hmi/current-snapshot'),
    createRoute('/api/prisma/events/latest', 'http://127.0.0.1:5057', '/hmi/voice/latest'),
    createRoute('/api/prisma/voice-config', 'http://127.0.0.1:5057', '/hmi/prisma-config'),
    createRoute('/api/prisma/tts/live', 'http://127.0.0.1:5056', '/prisma/speak-live'),
]);

export function createPrismaProxyConfig(): Record<string, ProxyOptions> {
    return Object.fromEntries(PRISMA_PROXY_ROUTES.map((route) => [
        route.pattern,
        {
            target: route.target,
            changeOrigin: true,
            rewrite: (path: string) => path.replace(
                new RegExp(`^${route.browserPath}(?=\\?|$)`),
                route.upstreamPath,
            ),
        },
    ]));
}
