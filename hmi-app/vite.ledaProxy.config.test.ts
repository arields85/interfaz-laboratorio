// @vitest-environment node

import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProxyOptions } from 'vite';

import {
    LEDA_PROXY_ROUTES,
    createLedaProxyConfig,
} from './vite.ledaProxy.config';

const CHANNEL_A_CREDENTIAL_PATH = '/api/leda/admin/credentials/telegram_channel_a';
const CHANNEL_A_STATUS_PATH = '/api/leda/admin/credentials/telegram_channel_a/status';
const CHANNEL_A_APPLY_PATH = '/api/leda/admin/credentials/telegram_channel_a/apply';
const CHANNEL_A_VERIFY_PATH = '/api/leda/admin/credentials/telegram_channel_a/verify';
const CHANNEL_A_PAIRING_BROWSER_PATH = '/api/leda/channel-a/pairing';
const CHANNEL_A_PAIRING_UPSTREAM_PATH = '/hmi/channel-a/pairing';

type ProxyConfigure = NonNullable<ProxyOptions['configure']>;
type ProxyBypass = NonNullable<ProxyOptions['bypass']>;
type ProxyRequestHandler = (request: { removeHeader: (name: string) => void }) => void;
type ProxyErrorHandler = (error: Error, request: IncomingMessage, response: ServerResponse) => void;

function channelAProxy(browserPath: string = CHANNEL_A_CREDENTIAL_PATH) {
    const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);
    return { route, proxy: route ? createLedaProxyConfig()[route.pattern] : undefined };
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

describe('Leda Vite proxy configuration', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ['snapshot', '/api/leda/snapshot', '/hmi/current-snapshot', 'http://127.0.0.1:5057'],
        ['events', '/api/leda/events/latest', '/hmi/voice/latest', 'http://127.0.0.1:5057'],
        ['events stream', '/api/leda/events/stream', '/hmi/voice/events', 'http://127.0.0.1:5057'],
        ['voice config', '/api/leda/voice-config', '/hmi/leda-config', 'http://127.0.0.1:5057'],
        ['live TTS', '/api/leda/tts/live', '/leda/speak-live', 'http://127.0.0.1:5056'],
    ])('rewrites the exact %s route and preserves encoded query bytes', (_name, browserPath, upstreamPath, target) => {
        const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);
        const config = createLedaProxyConfig();
        const proxy = route ? config[route.pattern] : undefined;

        expect(route).toBeDefined();
        expect(proxy).toMatchObject({ target, changeOrigin: true });
        expect(proxy?.rewrite(`${browserPath}?value=a%2Fb%20c&next=%252F`))
            .toBe(`${upstreamPath}?value=a%2Fb%20c&next=%252F`);
    });

    it.each([
        ['/api/leda/admin/auth/status', '/api/leda/admin/auth/status', ['GET']],
        ['/api/leda/admin/auth/login', '/api/leda/admin/auth/login', ['POST']],
        ['/api/leda/admin/auth/session', '/api/leda/admin/auth/session', ['GET']],
        ['/api/leda/admin/auth/logout', '/api/leda/admin/auth/logout', ['POST']],
        ['/api/leda/admin/auth/password', '/api/leda/admin/auth/password', ['POST']],
        ['/api/leda/admin/credentials', '/api/leda/admin/credentials', ['GET']],
        ['/api/leda/admin/credentials/gemini', '/api/leda/admin/credentials/gemini', ['PUT', 'DELETE']],
        ['/api/leda/admin/credentials/gemini/verify', '/api/leda/admin/credentials/gemini/verify', ['POST']],
        ['/api/leda/admin/credentials/telegram', '/api/leda/admin/credentials/telegram', ['PUT', 'DELETE']],
        ['/api/leda/admin/credentials/telegram_channel_a', '/api/leda/admin/credentials/telegram_channel_a', ['PUT', 'DELETE']],
        ['/api/leda/admin/credentials/telegram_channel_a/status', '/api/leda/admin/credentials/telegram_channel_a/status', ['GET']],
        ['/api/leda/admin/credentials/telegram_channel_a/apply', '/api/leda/admin/credentials/telegram_channel_a/apply', ['POST']],
        ['/api/leda/admin/credentials/telegram/apply', '/api/leda/admin/credentials/telegram/apply', ['POST']],
        ['/api/leda/admin/credentials/telegram/verify', '/api/leda/admin/credentials/telegram/verify', ['POST']],
        ['/api/leda/admin/credentials/telegram_channel_a/verify', '/api/leda/admin/credentials/telegram_channel_a/verify', ['POST']],
        ['/api/leda/hmi-config', '/api/leda/hmi-config', ['GET']],
        ['/api/leda/hmi-config/revision', '/api/leda/hmi-config/revision', ['GET']],
        ['/api/leda/admin/hmi-config', '/api/leda/admin/hmi-config', ['PUT']],
        ['/api/leda/health', '/health', ['GET']],
    ])('declares the exact admin route %s with its method allowlist', (browserPath, upstreamPath, methods) => {
        const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);

        expect(route).toMatchObject({ upstreamPath, methods });
    });

    it.each([
        '/api/leda/snapshot/',
        '/api/leda/snapshot/extra',
        '/api/leda/snapshot%2Fextra',
        '/api/leda%2Fsnapshot',
        '/api/leda/unknown',
        '/api/leda/hmi-config/',
        '/api/leda/hmi-config/revision/',
        '/api/leda/hmi-config/extra',
        '/api/leda/hmi-config%2Frevision',
        '/api/leda/admin/hmi-config/',
        '/api/leda/admin/hmi-config/extra',
        '/api/leda/admin/credentials/telegram_channel_a/',
        '/api/leda/admin/credentials/telegram_channel_a/extra',
        '/api/leda/admin/credentials/telegram_channel_a%2Fextra',
        '/api/leda/admin/credentials/telegram_channel_a/status/',
        '/api/leda/admin/credentials/telegram_channel_a/status/extra',
        '/api/leda/admin/credentials/telegram_channel_a/status%2Fextra',
        '/api/leda/admin/credentials/telegram_channel_a/apply/',
        '/api/leda/admin/credentials/telegram_channel_a/apply/extra',
        '/api/leda/admin/credentials/telegram_channel_a/apply%2Fextra',
        '/api/leda/admin/credentials%2Ftelegram_channel_a',
        '/api/leda/admin/credentials/telegram_channel_b',
        '/api/leda/admin/credentials/gemini/verify/',
        '/api/leda/admin/credentials/gemini/verify/extra',
        '/api/leda/admin/credentials/gemini/verify%2Fextra',
        '/api/leda/admin/credentials/gemini%2Fverify',
        '/api/leda/admin/credentials/telegram/verify/',
        '/api/leda/admin/credentials/telegram/verify/extra',
        '/api/leda/admin/credentials/telegram/verify%2Fextra',
        '/api/leda/admin/credentials/telegram_channel_a/verify/',
        '/api/leda/admin/credentials/telegram_channel_a/verify/extra',
        '/api/leda/admin/credentials/telegram_channel_a/verify%2Fextra',
    ])('rejects the path lookalike %s', (path) => {
        expect(LEDA_PROXY_ROUTES.some(({ pattern }) => new RegExp(pattern).test(path))).toBe(false);
    });

    it('keeps the channel A credential lookalikes away from the B, status and apply routes', () => {
        const channelAPattern = new RegExp(`^${CHANNEL_A_CREDENTIAL_PATH}(?:\\?.*)?$`);

        expect(channelAPattern.test(CHANNEL_A_CREDENTIAL_PATH)).toBe(true);
        expect(channelAPattern.test(`${CHANNEL_A_CREDENTIAL_PATH}?value=a%2Fb`)).toBe(true);
        expect(channelAPattern.test('/api/leda/admin/credentials/telegram')).toBe(false);
        expect(channelAPattern.test('/api/leda/admin/credentials/telegram/apply')).toBe(false);
        expect(channelAPattern.test(CHANNEL_A_STATUS_PATH)).toBe(false);
        expect(channelAPattern.test(CHANNEL_A_APPLY_PATH)).toBe(false);
    });

    it('adds exactly four anchored channel A admin routes with the local 5057 target and stripped session capability', () => {
        const aRoutes = LEDA_PROXY_ROUTES.filter((candidate) => candidate.browserPath.includes('channel_a'));
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
            LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath)?.pattern;
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
            expect(proxyRequest.removeHeader).toHaveBeenCalledWith('X-Leda-Session-Capability');
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
        expect(proxyRequest.removeHeader).toHaveBeenCalledWith('X-Leda-Session-Capability');
        expect(route?.stripSessionCapability).toBe(true);
    });

    it('declares the exact anchored channel A pairing route with the local 5057 target and forwarded capability', () => {
        const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === CHANNEL_A_PAIRING_BROWSER_PATH);

        expect(route).toMatchObject({
            browserPath: CHANNEL_A_PAIRING_BROWSER_PATH,
            pattern: `^${CHANNEL_A_PAIRING_BROWSER_PATH}(?:\\?.*)?$`,
            upstreamPath: CHANNEL_A_PAIRING_UPSTREAM_PATH,
            target: 'http://127.0.0.1:5057',
            methods: ['GET', 'POST'],
            stripSessionCapability: false,
        });
        expect(LEDA_PROXY_ROUTES.filter((candidate) => candidate.browserPath === CHANNEL_A_PAIRING_BROWSER_PATH))
            .toHaveLength(1);

        const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
        expect(credentialProxyRequestHandlers(proxy?.configure)).toHaveLength(0);
    });

    it.each([
        '/api/leda/channel-a/pairing/',
        '/api/leda/channel-a/pairing/extra',
        '/api/leda/channel-a/pairing%2Fextra',
        '/api/leda/channel-a%2Fpairing',
        '/api/leda/channel-a/pairings',
        '/api/leda/channel-a/pair',
        '/api/leda/channel-a',
    ])('keeps the pairing path lookalike %s away from the anchored route', (path) => {
        expect(LEDA_PROXY_ROUTES.some(({ pattern }) => new RegExp(pattern).test(path))).toBe(false);
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

    describe('Channel B access admin routes', () => {
        const ACCESS_LIST_PATH = '/api/leda/admin/channel-b/access';
        const DECISION_ROUTE_PATH = '/api/leda/admin/channel-b/access/:chatId/:decision';
        const decisionPaths = (chatId: string) =>
            ['approve', 'reject', 'revoke'].map((action) => `${ACCESS_LIST_PATH}/${chatId}/${action}`);
        const matchingRoutes = (path: string) =>
            LEDA_PROXY_ROUTES.filter(({ pattern }) => new RegExp(pattern).test(path));
        const bypassFor = (route: (typeof LEDA_PROXY_ROUTES)[number]) =>
            createLedaProxyConfig()[route.pattern].bypass as ProxyBypass;
        const callBypass = (bypass: ProxyBypass, method: string) => {
            const response = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };
            const result = bypass(
                { method } as unknown as IncomingMessage,
                response as unknown as ServerResponse,
                {} as Parameters<ProxyBypass>[2],
            );
            return { result, response };
        };

        it('declares the access list as an exact GET admin route with the capability stripped', () => {
            const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === ACCESS_LIST_PATH);

            expect(route).toMatchObject({
                upstreamPath: ACCESS_LIST_PATH,
                target: 'http://127.0.0.1:5057',
                methods: ['GET'],
                stripSessionCapability: true,
            });
        });

        it('declares one POST decision route on 5057 with the capability stripped', () => {
            const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === DECISION_ROUTE_PATH);

            expect(route).toMatchObject({
                target: 'http://127.0.0.1:5057',
                methods: ['POST'],
                stripSessionCapability: true,
            });
        });

        it.each(['123456789', '0', '-1001234567890'])('matches exactly the three decisions for chat id %s', (chatId) => {
            for (const path of decisionPaths(chatId)) {
                const routes = matchingRoutes(path);
                expect(routes).toHaveLength(1);
                expect(routes[0].browserPath).toBe(DECISION_ROUTE_PATH);
                expect(matchingRoutes(`${path}?value=a%2Fb`)).toHaveLength(1);
            }
        });

        it('matches the access list on its exact path only', () => {
            expect(matchingRoutes(ACCESS_LIST_PATH).map(({ browserPath }) => browserPath)).toEqual([ACCESS_LIST_PATH]);
            expect(matchingRoutes(`${ACCESS_LIST_PATH}?x=1`)).toHaveLength(1);
        });

        it.each([
            '/api/leda/admin/channel-b/access/',
            '/api/leda/admin/channel-b/access/123',
            '/api/leda/admin/channel-b/access/123/',
            '/api/leda/admin/channel-b/access/abc/approve',
            '/api/leda/admin/channel-b/access/12a/approve',
            '/api/leda/admin/channel-b/access/1.5/approve',
            '/api/leda/admin/channel-b/access/--1/approve',
            '/api/leda/admin/channel-b/access/+1/approve',
            '/api/leda/admin/channel-b/access//approve',
            '/api/leda/admin/channel-b/access/123/delete',
            '/api/leda/admin/channel-b/access/123/approvex',
            '/api/leda/admin/channel-b/access/123/approve/',
            '/api/leda/admin/channel-b/access/123/approve/extra',
            '/api/leda/admin/channel-b/access/123/approve%2Fextra',
            '/api/leda/admin/channel-b/access/123%2Fapprove',
            '/api/leda/admin/channel-b/access/1/2/approve',
            '/api/leda/admin/channel-b/access/123456789012345678901/approve',
            '/api/leda/admin/channel-b/accesss',
            '/api/leda/admin/channel-b',
            '/api/leda/channel-b/access',
            '/api/leda/admin/channel-b/access/123/approve' + String.fromCharCode(10),
        ])('rejects the Channel B access lookalike %s', (path) => {
            expect(matchingRoutes(path)).toHaveLength(0);
        });

        it('rewrites each decision to the identical upstream path preserving encoded query bytes', () => {
            const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === DECISION_ROUTE_PATH);
            const proxy = route ? createLedaProxyConfig()[route.pattern] : undefined;

            for (const path of [...decisionPaths('42'), ...decisionPaths('-100500')]) {
                expect(proxy?.rewrite(path)).toBe(path);
                expect(proxy?.rewrite(`${path}?value=a%2Fb%20c&next=%252F`)).toBe(`${path}?value=a%2Fb%20c&next=%252F`);
            }
        });

        it('rewrites the access list to the identical upstream path', () => {
            const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === ACCESS_LIST_PATH);
            const proxy = route ? createLedaProxyConfig()[route.pattern] : undefined;

            expect(proxy?.rewrite(`${ACCESS_LIST_PATH}?a=1`)).toBe(`${ACCESS_LIST_PATH}?a=1`);
        });

        it('allows GET on the list and POST on the decisions, answering 405 otherwise', () => {
            for (const [browserPath, allowed, denied] of [
                [ACCESS_LIST_PATH, 'GET', ['POST', 'PUT', 'DELETE']],
                [DECISION_ROUTE_PATH, 'POST', ['GET', 'PUT', 'DELETE']],
            ] as const) {
                const route = LEDA_PROXY_ROUTES.find((candidate) => candidate.browserPath === browserPath);
                const bypass = bypassFor(route as NonNullable<typeof route>);

                expect(callBypass(bypass, allowed).result).toBeUndefined();
                for (const method of denied) {
                    const { result, response } = callBypass(bypass, method);
                    expect(result).toBe(false);
                    expect(response.statusCode).toBe(405);
                }
            }
        });

        it('strips the session capability header on both route kinds', () => {
            for (const browserPath of [ACCESS_LIST_PATH, DECISION_ROUTE_PATH]) {
                const { proxy } = channelAProxy(browserPath);
                const handlers = credentialProxyRequestHandlers(proxy?.configure);
                const proxyRequest = { removeHeader: vi.fn() };

                expect(handlers).toHaveLength(1);
                handlers.forEach((handler) => handler(proxyRequest));
                expect(proxyRequest.removeHeader).toHaveBeenCalledWith('X-Leda-Session-Capability');
            }
        });
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
            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'leda_runtime_unreachable' }));
        });

        it('carries the detected port_in_use reason and port from LEDA_STARTUP_FAILURE', () => {
            vi.stubEnv('LEDA_STARTUP_FAILURE', JSON.stringify({ reason: 'port_in_use', port: 5057 }));
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);
            const response = fakeServerResponse();

            errorHandlers[0](new Error('ECONNREFUSED'), {} as IncomingMessage, response);

            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'leda_runtime_unreachable', reason: 'port_in_use', port: 5057 }));
        });

        it.each([
            ['malformed JSON', 'not-json'],
            ['an unknown reason', JSON.stringify({ reason: 'exploded', port: 5057 })],
            ['a non-integer port', JSON.stringify({ reason: 'port_in_use', port: 70000 })],
            ['a missing port', JSON.stringify({ reason: 'port_in_use' })],
        ])('falls back to the generic marker when LEDA_STARTUP_FAILURE has %s', (_label, envValue) => {
            vi.stubEnv('LEDA_STARTUP_FAILURE', envValue);
            const { proxy } = channelAProxy(CHANNEL_A_PAIRING_BROWSER_PATH);
            const { errorHandlers } = collectProxyHandlers(proxy?.configure);
            const response = fakeServerResponse();

            errorHandlers[0](new Error('ECONNREFUSED'), {} as IncomingMessage, response);

            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'leda_runtime_unreachable' }));
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
        // 404, and the on('error') handler above never fired). When LEDA_STARTUP_FAILURE is
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
            vi.stubEnv('LEDA_STARTUP_FAILURE', JSON.stringify({ reason: 'port_in_use', port: 5057 }));
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
            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'leda_runtime_unreachable', reason: 'port_in_use', port: 5057 }));
        });

        it('answers 503 even for a method that route would otherwise reject with 405', () => {
            vi.stubEnv('LEDA_STARTUP_FAILURE', JSON.stringify({ reason: 'port_in_use', port: 5057 }));
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
            expect(response.end).toHaveBeenCalledWith(JSON.stringify({ error: 'leda_runtime_unreachable', reason: 'port_in_use', port: 5057 }));
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
