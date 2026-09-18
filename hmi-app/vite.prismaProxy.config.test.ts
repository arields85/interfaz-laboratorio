// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
    PRISMA_PROXY_ROUTES,
    createPrismaProxyConfig,
} from './vite.prismaProxy.config';

describe('Prisma Vite proxy configuration', () => {
    it.each([
        ['snapshot', '/api/prisma/snapshot', '/hmi/current-snapshot', 'http://127.0.0.1:5057'],
        ['events', '/api/prisma/events/latest', '/hmi/voice/latest', 'http://127.0.0.1:5057'],
        ['voice config', '/api/prisma/voice-config', '/hmi/prisma-config', 'http://127.0.0.1:5057'],
        ['live TTS', '/api/prisma/tts/live', '/prisma/speak-live', 'http://127.0.0.1:5056'],
    ])('rewrites the exact %s route and preserves encoded query bytes', (_name, browserPath, upstreamPath, target) => {
        const route = PRISMA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);
        const config = createPrismaProxyConfig();
        const proxy = route ? config[route.pattern] : undefined;

        expect(route).toBeDefined();
        expect(proxy).toMatchObject({ target, changeOrigin: true });
        expect(proxy?.rewrite(`${browserPath}?value=a%2Fb%20c&next=%252F`))
            .toBe(`${upstreamPath}?value=a%2Fb%20c&next=%252F`);
    });

    it.each([
        ['/api/prisma/admin/auth/status', '/api/prisma/admin/auth/status', ['GET']],
        ['/api/prisma/admin/auth/login', '/api/prisma/admin/auth/login', ['POST']],
        ['/api/prisma/admin/auth/session', '/api/prisma/admin/auth/session', ['GET']],
        ['/api/prisma/admin/auth/logout', '/api/prisma/admin/auth/logout', ['POST']],
        ['/api/prisma/admin/credentials', '/api/prisma/admin/credentials', ['GET']],
        ['/api/prisma/admin/credentials/gemini', '/api/prisma/admin/credentials/gemini', ['PUT', 'DELETE']],
        ['/api/prisma/admin/credentials/telegram', '/api/prisma/admin/credentials/telegram', ['PUT', 'DELETE']],
        ['/api/prisma/admin/credentials/telegram/apply', '/api/prisma/admin/credentials/telegram/apply', ['POST']],
        ['/api/prisma/health', '/health', ['GET']],
    ])('declares the exact admin route %s with its method allowlist', (browserPath, upstreamPath, methods) => {
        const route = PRISMA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);

        expect(route).toMatchObject({ upstreamPath, methods });
    });

    it.each([
        '/api/prisma/snapshot/',
        '/api/prisma/snapshot/extra',
        '/api/prisma/snapshot%2Fextra',
        '/api/prisma%2Fsnapshot',
        '/api/prisma/unknown',
    ])('rejects the path lookalike %s', (path) => {
        expect(PRISMA_PROXY_ROUTES.some(({ pattern }) => new RegExp(pattern).test(path))).toBe(false);
    });
});
