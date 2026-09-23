// @vitest-environment node

import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProxyOptions } from 'vite';

import {
    PRISMA_PROXY_ROUTES,
    createPrismaProxyConfig,
} from './vite.prismaProxy.config';

const CHANNEL_A_CREDENTIAL_PATH = '/api/prisma/admin/credentials/telegram_channel_a';
const CHANNEL_A_STATUS_PATH = '/api/prisma/admin/credentials/telegram_channel_a/status';
const CHANNEL_A_APPLY_PATH = '/api/prisma/admin/credentials/telegram_channel_a/apply';
const CHANNEL_A_VERIFY_PATH = '/api/prisma/admin/credentials/telegram_channel_a/verify';
const CHANNEL_A_PAIRING_BROWSER_PATH = '/api/prisma/channel-a/pairing';
const CHANNEL_A_PAIRING_UPSTREAM_PATH = '/hmi/channel-a/pairing';

type ProxyConfigure = NonNullable<ProxyOptions['configure']>;
type ProxyBypass = NonNullable<ProxyOptions['bypass']>;
type ProxyRequestHandler = (request: { removeHeader: (name: string) => void }) => void;
type ProxyErrorHandler = (error: Error, request: IncomingMessage, response: ServerResponse) => void;

function channelAProxy(browserPath: string = CHANNEL_A_CREDENTIAL_PATH) {
    const route = PRISMA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);
    return { route, proxy: route ? createPrismaProxyConfig()[route.pattern] : undefined };
}

function collectProxyHandlers(configure: ProxyOptions['configure']): {
    requestHandlers: ProxyRequestHandler[];
    errorHandlers: ProxyErrorHandler[];
} {
    const requestHandlers: ProxyRequestHandler[] = [];
    const errorHandlers: ProxyErrorHandler[] = [];
    const fakeProxy = {
        on: (event: string, handler: ProxyRequestHandler | ProxyErrorHandler) => {
            if (event === 'proxyReq') requestHandlers.push(handler as ProxyRequestHandler);
            if (event === 'error') errorHandlers.push(handler as ProxyErrorHandler);
        },
    };
    (configure as ProxyConfigure)?.(
        fakeProxy as unknown as Parameters<ProxyConfigure>[0],
        {} as Parameters<ProxyConfigure>[1],
    );
    return { requestHandlers, errorHandlers };
}

function credentialProxyRequestHandlers(configure: ProxyOptions['configure']): ProxyRequestHandler[] {
    return collectProxyHandlers(configure).requestHandlers;
}

function fakeServerResponse(): ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
    return {
        headersSent: false,
        writeHead: vi.fn(),
        end: vi.fn(),
    } as unknown as ServerResponse & { writeHead: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
}

describe('Prisma Vite proxy configuration', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

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
        ['/api/prisma/admin/credentials/gemini/verify', '/api/prisma/admin/credentials/gemini/verify', ['POST']],
        ['/api/prisma/admin/credentials/telegram', '/api/prisma/admin/credentials/telegram', ['PUT', 'DELETE']],
        ['/api/prisma/admin/credentials/telegram_channel_a', '/api/prisma/admin/credentials/telegram_channel_a', ['PUT', 'DELETE']],
        ['/api/prisma/admin/credentials/telegram_channel_a/status', '/api/prisma/admin/credentials/telegram_channel_a/status', ['GET']],
        ['/api/prisma/admin/credentials/telegram_channel_a/apply', '/api/prisma/admin/credentials/telegram_channel_a/apply', ['POST']],
        ['/api/prisma/admin/credentials/telegram/apply', '/api/prisma/admin/credentials/telegram/apply', ['POST']],
        ['/api/prisma/admin/credentials/telegram/verify', '/api/prisma/admin/credentials/telegram/verify', ['POST']],
        ['/api/prisma/admin/credentials/telegram_channel_a/verify', '/api/prisma/admin/credentials/telegram_channel_a/verify', ['POST']],
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
        '/api/prisma/admin/credentials/telegram_channel_a/status/',
        '/api/prisma/admin/credentials/telegram_channel_a/status/extra',
        '/api/prisma/admin/credentials/telegram_channel_a/status%2Fextra',
        '/api/prisma/admin/credentials/telegram_channel_a/apply/',
        '/api/prisma/admin/credentials/telegram_channel_a/apply/extra',
        '/api/prisma/admin/credentials/telegram_channel_a/apply%2Fextra',
        '/api/prisma/admin/credentials%2Ftelegram_channel_a',
        '/api/prisma/admin/credentials/telegram_channel_b',
        '/api/prisma/admin/credentials/gemini/verify/',
        '/api/prisma/admin/credentials/gemini/verify/extra',
        '/api/prisma/admin/credentials/gemini/verify%2Fextra',
        '/api/prisma/admin/credentials/gemini%2Fverify',
        '/api/prisma/admin/credentials/telegram/verify/',
        '/api/prisma/admin/credentials/telegram/verify/extra',
        '/api/prisma/admin/credentials/telegram/verify%2Fextra',
        '/api/prisma/admin/credentials/telegram_channel_a/verify/',
        '/api/prisma/admin/credentials/telegram_channel_a/verify/extra',
        '/api/prisma/admin/credentials/telegram_channel_a/verify%2Fextra',
    ])('rejects the path lookalike %s', (path) => {
        expect(PRISMA_PROXY_ROUTES.some(({ pattern }) => new RegExp(pattern).test(path))).toBe(false);
    });

    it('keeps the channel A credential lookalikes away from the B, status and apply routes', () => {
        const channelAPattern = new RegExp(`^${CHANNEL_A_CREDENTIAL_PATH}(?:\\?.*)?$`);

        expect(channelAPattern.test(CHANNEL_A_CREDENTIAL_PATH)).toBe(true);
        expect(channelAPattern.test(`${CHANNEL_A_CREDENTIAL_PATH}?value=a%2Fb`)).toBe(true);
        expect(channelAPattern.test('/api/prisma/admin/credentials/telegram')).toBe(false);
        expect(channelAPattern.test('/api/prisma/admin/credentials/telegram/apply')).toBe(false);
        expect(channelAPattern.test(CHANNEL_A_STATUS_PATH)).toBe(false);
        expect(channelAPattern.test(CHANNEL_A_APPLY_PATH)).toBe(false);
    });

    it('adds exactly four anchored channel A admin routes with the local 5057 target and stripped session capability', () => {
        const aRoutes = PRISMA_PROXY_ROUTES.filter((candidate) => candidate.browserPath.includes('channel_a'));
        expect(aRoutes.map((candidate) => candidate.browserPath)).toEqual([
            CHANNEL_A_CREDENTIAL_PATH,
            CHANNEL_A_STATUS_PATH,
            CHANNEL_A_APPLY_PATH,
            CHANNEL_A_VERIFY_PATH,
        ]);

        const credential = aRoutes.find((candidate) => candidate.browserPath === CHANNEL_A_CREDENTIAL_PATH);
        const status = aRoutes.find((candidate) => candidate.browserPath === CHANNEL_A_STATUS_PATH);
        const apply = aRoutes.find((candidate) => candidate.browserPath === CHANNEL_A_APPLY_PATH);
        const verify = aRoutes.find((candidate) => candidate.browserPath === CHANNEL_A_VERIFY_PATH);

        expect(credential).toMatchObject({
            browserPath: CHANNEL_A_CREDENTIAL_PATH,
            pattern: `^${CHANNEL_A_CREDENTIAL_PATH}(?:\\?.*)?$`,
            upstreamPath: CHANNEL_A_CREDENTIAL_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['PUT', 'DELETE'],
            stripSessionCapability: true,
        });
        expect(status).toMatchObject({
            browserPath: CHANNEL_A_STATUS_PATH,
            upstreamPath: CHANNEL_A_STATUS_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['GET'],
            stripSessionCapability: true,
        });
        expect(apply).toMatchObject({
            browserPath: CHANNEL_A_APPLY_PATH,
            upstreamPath: CHANNEL_A_APPLY_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['POST'],
            stripSessionCapability: true,
        });
        expect(verify).toMatchObject({
            browserPath: CHANNEL_A_VERIFY_PATH,
            upstreamPath: CHANNEL_A_VERIFY_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['POST'],
            stripSessionCapability: true,
        });
    });

    it('keeps the anchored channel A status, apply and verify patterns from matching each other or the credential route', () => {
        const patternFor = (browserPath: string) =>
            PRISMA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath)?.pattern;
        const credentialPattern = patternFor(CHANNEL_A_CREDENTIAL_PATH);
        const statusPattern = patternFor(CHANNEL_A_STATUS_PATH);
        const applyPattern = patternFor(CHANNEL_A_APPLY_PATH);
        const verifyPattern = patternFor(CHANNEL_A_VERIFY_PATH);

        expect(credentialPattern).toBeDefined();
        expect(statusPattern).toBeDefined();
        expect(applyPattern).toBeDefined();
        expect(verifyPattern).toBeDefined();
        for (const pattern of [credentialPattern, statusPattern, applyPattern, verifyPattern]) {
            expect(new RegExp(pattern ?? '').test(CHANNEL_A_STATUS_PATH)).toBe(pattern === statusPattern);
            expect(new RegExp(pattern ?? '').test(CHANNEL_A_APPLY_PATH)).toBe(pattern === applyPattern);
            expect(new RegExp(pattern ?? '').test(CHANNEL_A_VERIFY_PATH)).toBe(pattern === verifyPattern);
        }
    });

    it('rewrites the channel A status and apply routes while preserving encoded query bytes', () => {
        for (const browserPath of [CHANNEL_A_STATUS_PATH, CHANNEL_A_APPLY_PATH]) {
            const { proxy } = channelAProxy(browserPath);
            expect(proxy?.rewrite(`${browserPath}?value=a%2Fb%20c&next=%252F`))
                .toBe(`${browserPath}?value=a%2Fb%20c&next=%252F`);
        }
    });

    it('restricts the channel A status and apply routes to their single method while stripping the session capability', () => {
        for (const [browserPath, allowed, denied] of [
            [CHANNEL_A_STATUS_PATH, 'GET', 'POST'],
            [CHANNEL_A_APPLY_PATH, 'POST', 'GET'],
        ] as const) {
            const { route, proxy } = channelAProxy(browserPath);
            const bypass = proxy?.bypass as ProxyBypass;
            const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
            const request = (method: string) => bypass(
                { method } as unknown as IncomingMessage,
                response as unknown as ServerResponse,
                {} as Parameters<ProxyBypass>[2],
            );

            expect(bypass).toBeTypeOf('function');
            expect(request(allowed)).toBeUndefined();
            expect(response.statusCode).toBe(200);
            expect(request(denied)).toBe(false);
            expect(response.statusCode).toBe(405);
            expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
            expect(response.end).toHaveBeenCalled();

            const handlers = credentialProxyRequestHandlers(proxy?.configure);
            expect(handlers).toHaveLength(1);
            const proxyRequest = { removeHeader: vi.fn() };
            handlers.forEach((handler) => handler(proxyRequest));
            expect(proxyRequest.removeHeader).toHaveBeenCalledWith('X-Prisma-Session-Capability');
            expect(route?.stripSessionCapability).toBe(true);
        }
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

    it('declares the exact anchored channel A pairing route with the local 5057 target and forwarded capability', () => {
        const route = PRISMA_PROXY_ROUTES.find((candidate) => candidate.browserPath === CHANNEL_A_PAIRING_BROWSER_PATH);

        expect(route).toMatchObject({
            browserPath: CHANNEL_A_PAIRING_BROWSER_PATH,
            pattern: `^${CHANNEL_A_PAIRING_BROWSER_PATH}(?:\\?.*)?$`,
            upstreamPath: CHANNEL_A_PAIRING_UPSTREAM_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['GET', 'POST'],
            stripSessionCapability: false,
        });
        expect(PRISMA_PROXY_ROUTES.filter((candidate) => candidate.browserPath === CHANNEL_A_PAIRING_BROWSER_PATH))
            .toHaveLength(1);

        const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
        expect(credentialProxyRequestHandlers(proxy?.configure)).toHaveLength(0);
    });

    it.each([
        '/api/prisma/channel-a/pairing/',
        '/api/prisma/channel-a/pairing/extra',
        '/api/prisma/channel-a/pairing%2Fextra',
        '/api/prisma/channel-a%2Fpairing',
        '/api/prisma/channel-a/pairings',
        '/api/prisma/channel-a/pair',
        '/api/prisma/channel-a',
    ])('keeps the pairing path lookalike %s away from the anchored route', (path) => {
        expect(PRISMA_PROXY_ROUTES.some(({ pattern }) => new RegExp(pattern).test(path))).toBe(false);
    });

    it('accepts exactly GET and POST on the pairing route and answers other methods with 405 no-store', () => {
        const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
        const bypass = proxy?.bypass as ProxyBypass;
        const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
        const request = (method: string) => bypass(
            { method } as unknown as IncomingMessage,
            response as unknown as ServerResponse,
            {} as Parameters<ProxyBypass>[2],
        );

        expect(bypass).toBeTypeOf('function');
        expect(request('GET')).toBeUndefined();
        expect(response.statusCode).toBe(200);
        expect(request('POST')).toBeUndefined();
        expect(response.statusCode).toBe(200);
        for (const denied of ['PUT', 'DELETE', 'PATCH']) {
            response.statusCode = 200;
            expect(request(denied)).toBe(false);
            expect(response.statusCode).toBe(405);
            expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
            expect(response.end).toHaveBeenCalled();
        }
    });

    it('rewrites the pairing route to the exact upstream path while preserving encoded query bytes', () => {
        const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);

        expect(proxy?.rewrite(CHANNEL_A_PAIRING_BROWSER_PATH)).toBe(CHANNEL_A_PAIRING_UPSTREAM_PATH);
        expect(proxy?.rewrite(`${CHANNEL_A_PAIRING_BROWSER_PATH}?value=a%2Fb%20c&next=%252F`))
            .toBe(`${CHANNEL_A_PAIRING_UPSTREAM_PATH}?value=a%2Fb%20c&next=%252F`);
    });

    describe('proxy error handling (T4b: JSON 503 instead of Vite\'s bodiless default 500)', () => {
        it.each([
            ['a stripSessionCapability route', CHANNEL_A_STATUS_PATH],
            ['a non-stripSessionCapability route', CHANNEL_A_PAIRING_BROWSER_PATH],
        ])('registers exactly one error handler on %s', (_label, browserPath) => {
            const { proxy } = channelAProxy(browserPath);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);

            expect(errorHandlers).toHaveLength(1);
        });

        it('answers a JSON 503 with only the generic marker when no startup failure was detected', () => {
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);
            const response = fakeServerResponse();

            errorHandlers[0](new Error('ECONNREFUSED'), {} as IncomingMessage, response);

            expect(response.writeHead).toHaveBeenCalledWith(503, expect.objectContaining({ 'Content-Type': 'application/json' }));
            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'prisma_runtime_unreachable' }));
        });

        it('carries the detected port_in_use reason and port from PRISMA_STARTUP_FAILURE', () => {
            vi.stubEnv('PRISMA_STARTUP_FAILURE', JSON.stringify({ reason: 'port_in_use', port: 5057 }));
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);
            const response = fakeServerResponse();

            errorHandlers[0](new Error('ECONNREFUSED'), {} as IncomingMessage, response);

            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'prisma_runtime_unreachable', reason: 'port_in_use', port: 5057 }));
        });

        it.each([
            ['malformed JSON', 'not-json'],
            ['an unknown reason', JSON.stringify({ reason: 'exploded', port: 5057 })],
            ['a non-integer port', JSON.stringify({ reason: 'port_in_use', port: 70000 })],
            ['a missing port', JSON.stringify({ reason: 'port_in_use' })],
        ])('falls back to the generic marker when PRISMA_STARTUP_FAILURE has %s', (_label, envValue) => {
            vi.stubEnv('PRISMA_STARTUP_FAILURE', envValue);
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);
            const response = fakeServerResponse();

            errorHandlers[0](new Error('ECONNREFUSED'), {} as IncomingMessage, response);

            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'prisma_runtime_unreachable' }));
        });

        it('never writes to a response whose headers were already sent', () => {
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);
            const response = fakeServerResponse();
            (response as { headersSent: boolean }).headersSent = true;

            errorHandlers[0](new Error('ECONNREFUSED'), {} as IncomingMessage, response);

            expect(response.writeHead).not.toHaveBeenCalled();
            expect(response.end).not.toHaveBeenCalled();
        });
    });

    describe('T4c: never forwards when the launcher already reported a startup failure', () => {
        // A foreign process holding 5056/5057 IS a real listener, so the proxy would
        // otherwise forward to it successfully (observed live: a plain HTTP server answered
        // 404, and the on('error') handler above never fired). When PRISMA_STARTUP_FAILURE is
        // present, bypass must short-circuit BEFORE any proxying is attempted, for every
        // route and every method — Vite's own middleware (node_modules/vite/dist/node/chunks/
        // config.js, viteProxyMiddleware) never calls proxy.web() when bypass returns false;
        // it trusts bypass to have already written the response, exactly as the pre-existing
        // 405 case above already does.
        it.each([
            ['the pairing route', CHANNEL_A_PAIRING_BROWSER_PATH, 'GET'],
            ['the pairing route on its other allowed method', CHANNEL_A_PAIRING_BROWSER_PATH, 'POST'],
            ['a stripSessionCapability admin route', CHANNEL_A_STATUS_PATH, 'GET'],
            ['the channel A credential route', CHANNEL_A_CREDENTIAL_PATH, 'PUT'],
        ])('answers 503 with the detected failure and never proxies on %s', (_label, browserPath, method) => {
            vi.stubEnv('PRISMA_STARTUP_FAILURE', JSON.stringify({ reason: 'port_in_use', port: 5057 }));
            const { proxy } = channelAProxy(browserPath);
            const bypass = proxy?.bypass as ProxyBypass;
            const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };

            const result = bypass(
                { method } as unknown as IncomingMessage,
                response as unknown as ServerResponse,
                {} as Parameters<ProxyBypass>[2],
            );

            // `false` is the exact signal that tells Vite's middleware to skip proxy.web()
            // entirely (verified against its source above); an allowed method would
            // otherwise return `undefined` here and fall through to forwarding.
            expect(result).toBe(false);
            expect(response.statusCode).toBe(503);
            expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'prisma_runtime_unreachable', reason: 'port_in_use', port: 5057 }));
        });

        it('answers 503 even for a method that route would otherwise reject with 405', () => {
            vi.stubEnv('PRISMA_STARTUP_FAILURE', JSON.stringify({ reason: 'port_in_use', port: 5057 }));
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const bypass = proxy?.bypass as ProxyBypass;
            const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };

            const result = bypass(
                { method: 'DELETE' } as unknown as IncomingMessage,
                response as unknown as ServerResponse,
                {} as Parameters<ProxyBypass>[2],
            );

            expect(result).toBe(false);
            expect(response.statusCode).toBe(503);
            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'prisma_runtime_unreachable', reason: 'port_in_use', port: 5057 }));
        });

        it('still applies the ordinary method allowlist (405) when no startup failure is present', () => {
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const bypass = proxy?.bypass as ProxyBypass;
            const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };

            const allowed = bypass({ method: 'GET' } as unknown as IncomingMessage, response as unknown as ServerResponse, {} as Parameters<ProxyBypass>[2]);
            expect(allowed).toBeUndefined();
            expect(response.statusCode).toBe(200);

            const denied = bypass({ method: 'DELETE' } as unknown as IncomingMessage, response as unknown as ServerResponse, {} as Parameters<ProxyBypass>[2]);
            expect(denied).toBe(false);
            expect(response.statusCode).toBe(405);
        });
    });
});
