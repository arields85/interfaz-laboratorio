// @vitest-environment node

import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { ProxyOptions } from 'vite';

import {
    PRISMA_PROXY_ROUTES,
    createPrismaProxyConfig,
} from './vite.prismaProxy.config';

const CHANNEL_A_CREDENTIAL_PATH = '/api/prisma/admin/credentials/telegram_channel_a';

type ProxyConfigure = NonNullable<ProxyOptions['configure']>;
type ProxyBypass = NonNullable<ProxyOptions['bypass']>;
type ProxyRequestHandler = (request: { removeHeader: (name: string) => void }) => void;

function channelAProxy() {
    const route = PRISMA_PROXY_ROUTES.find((candidate) => candidate.browserPath === CHANNEL_A_CREDENTIAL_PATH);
    return { route, proxy: route ? createPrismaProxyConfig()[route.pattern] : undefined };
}

function credentialProxyRequestHandlers(configure: ProxyOptions['configure']): ProxyRequestHandler[] {
    const handlers: ProxyRequestHandler[] = [];
    const fakeProxy = {
        on: (event: string, handler: ProxyRequestHandler) => {
            if (event === 'proxyReq') handlers.push(handler);
        },
    };
    (configure as ProxyConfigure)?.(
        fakeProxy as unknown as Parameters<ProxyConfigure>[0],
        {} as Parameters<ProxyConfigure>[1],
    );
    return handlers;
}

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
        ['/api/prisma/admin/credentials/telegram_channel_a', '/api/prisma/admin/credentials/telegram_channel_a', ['PUT', 'DELETE']],
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
        '/api/prisma/admin/credentials/telegram_channel_a/',
        '/api/prisma/admin/credentials/telegram_channel_a/extra',
        '/api/prisma/admin/credentials/telegram_channel_a%2Fextra',
        '/api/prisma/admin/credentials%2Ftelegram_channel_a',
        '/api/prisma/admin/credentials/telegram_channel_b',
    ])('rejects the path lookalike %s', (path) => {
        expect(PRISMA_PROXY_ROUTES.some(({ pattern }) => new RegExp(pattern).test(path))).toBe(false);
    });

    it('keeps the channel A credential lookalikes away from the B and apply routes', () => {
        const channelAPattern = new RegExp(`^${CHANNEL_A_CREDENTIAL_PATH}(?:\\?.*)?$`);

        expect(channelAPattern.test(CHANNEL_A_CREDENTIAL_PATH)).toBe(true);
        expect(channelAPattern.test(`${CHANNEL_A_CREDENTIAL_PATH}?value=a%2Fb`)).toBe(true);
        expect(channelAPattern.test('/api/prisma/admin/credentials/telegram')).toBe(false);
        expect(channelAPattern.test('/api/prisma/admin/credentials/telegram/apply')).toBe(false);
    });

    it('adds exactly one protected channel A credential route and never an A runtime or pairing route', () => {
        const { route } = channelAProxy();

        expect(route).toMatchObject({
            browserPath: CHANNEL_A_CREDENTIAL_PATH,
            pattern: `^${CHANNEL_A_CREDENTIAL_PATH}(?:\\?.*)?$`,
            upstreamPath: CHANNEL_A_CREDENTIAL_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['PUT', 'DELETE'],
            stripSessionCapability: true,
        });
        expect(PRISMA_PROXY_ROUTES.filter((candidate) => candidate.browserPath.includes('channel_a'))).toHaveLength(1);
        expect(PRISMA_PROXY_ROUTES.some((candidate) => candidate.browserPath.includes('/apply') && candidate.browserPath.includes('channel_a'))).toBe(false);
    });

    it('rewrites the channel A credential route while preserving encoded query bytes', () => {
        const { proxy } = channelAProxy();

        expect(proxy?.rewrite(`${CHANNEL_A_CREDENTIAL_PATH}?value=a%2Fb%20c&next=%252F`))
            .toBe(`${CHANNEL_A_CREDENTIAL_PATH}?value=a%2Fb%20c&next=%252F`);
    });

    it('restricts the channel A credential route to PUT and DELETE while stripping the session capability', () => {
        const { route, proxy } = channelAProxy();
        const bypass = proxy?.bypass as ProxyBypass;
        const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
        const request = (method: string) => bypass(
            { method } as unknown as IncomingMessage,
            response as unknown as ServerResponse,
            {} as Parameters<ProxyBypass>[2],
        );

        expect(bypass).toBeTypeOf('function');
        expect(request('PUT')).toBeUndefined();
        expect(response.statusCode).toBe(200);
        expect(request('DELETE')).toBeUndefined();
        expect(response.statusCode).toBe(200);
        expect(request('POST')).toBe(false);
        expect(response.statusCode).toBe(405);
        expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
        expect(response.end).toHaveBeenCalled();
        expect(request('GET')).toBe(false);

        const handlers = credentialProxyRequestHandlers(proxy?.configure);
        expect(handlers).toHaveLength(1);
        const proxyRequest = { removeHeader: vi.fn() };
        handlers.forEach((handler) => handler(proxyRequest));
        expect(proxyRequest.removeHeader).toHaveBeenCalledWith('X-Prisma-Session-Capability');
        expect(route?.stripSessionCapability).toBe(true);
    });
});
