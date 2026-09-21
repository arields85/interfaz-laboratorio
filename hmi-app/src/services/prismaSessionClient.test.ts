import { describe, expect, it, vi } from 'vitest';

import { PrismaSessionClient, PrismaStaleSessionResponse } from './prismaSessionClient';

function canonicalCapability(seed = 0): string {
    const bytes = Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function sessionResponse(
    capability = canonicalCapability(),
    metadata: unknown = { ok: true, idleExpiresAt: 1, absoluteExpiresAt: 2 },
): Response {
    return new Response(JSON.stringify(metadata), {
        status: 201,
        headers: { 'X-Prisma-Session-Capability': capability, 'Content-Type': 'application/json' },
    });
}

function deferred<Value>() {
    let resolve!: (value: Value) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('PrismaSessionClient', () => {
    it('allocates command order at intent creation, not publication completion', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockImplementation(async () => new Response(null, { status: 202 }));
        const client = new PrismaSessionClient(fetchMock);
        const oldIntent = client.createContextIntent();
        const newIntent = client.createContextIntent();

        await client.invalidateContext(newIntent);
        await client.publishContext(oldIntent, { widgets: [] });

        const bodies = fetchMock.mock.calls
            .filter(([path]) => path === '/api/prisma/snapshot')
            .map(([, init]) => JSON.parse(String(init?.body)));
        expect(bodies).toEqual([
            { version: 1, command: 'invalidate', order: 2 },
            { version: 1, command: 'publish', order: 1, snapshot: { widgets: [] } },
        ]);
        expect(client.snapshot).toEqual({ epoch: 0 });
    });

    it('drops captured intents after reset without bootstrapping a new capability', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse());
        const client = new PrismaSessionClient(fetchMock);
        const oldIntent = client.createContextIntent();
        client.reset({ close: false });

        await expect(client.publishContext(oldIntent, { widgets: [] }))
            .rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        await expect(client.invalidateContext(oldIntent))
            .rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('drops an ordered intent waiting for bootstrap when the epoch resets', async () => {
        const bootstrap = deferred<Response>();
        const bootstrapStarted = deferred<void>();
        const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() => {
            bootstrapStarted.resolve();
            return bootstrap.promise;
        });
        const client = new PrismaSessionClient(fetchMock);
        const pending = client.publishContext(client.createContextIntent(), { widgets: [] });
        const rejected = expect(pending).rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        await bootstrapStarted.promise;
        client.reset({ close: false });
        bootstrap.resolve(sessionResponse());

        await rejected;
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/prisma/session');
    });

    it('does not replay an ordered body after a current authorization refusal', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(sessionResponse(canonicalCapability(2)));
        const client = new PrismaSessionClient(fetchMock);
        const intent = client.createContextIntent();
        await client.publishContext(intent, { widgets: [] });
        await client.bootstrap();

        await expect(client.publishContext(intent, { widgets: [] }))
            .rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        expect(fetchMock.mock.calls.filter(([path]) => path === '/api/prisma/snapshot')).toHaveLength(1);
    });

    it('uses a fresh invalidation signal independent from an aborted publication', async () => {
        const started = deferred<void>();
        const signals: AbortSignal[] = [];
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockImplementation(async (_path, init) => {
                signals.push(init!.signal!);
                if (signals.length === 1) {
                    started.resolve();
                    return new Promise<Response>((_resolve, reject) => {
                        init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
                    });
                }
                return new Response(null, { status: 202 });
            });
        const client = new PrismaSessionClient(fetchMock);
        const publication = new AbortController();
        const pending = client.publishContext(client.createContextIntent(), { widgets: [] }, publication.signal);
        const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await started.promise;
        publication.abort();
        await rejected;
        await client.invalidateContext(client.createContextIntent(), new AbortController().signal);

        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        expect(signals[1]).not.toBe(signals[0]);
    });

    it('single-flights bootstrap and keeps the capability private', async () => {
        const capability = canonicalCapability();
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(sessionResponse(capability));
        const client = new PrismaSessionClient(fetchMock);

        const [first, second] = await Promise.all([client.bootstrap(), client.bootstrap()]);

        expect(first).toEqual(second);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(client.snapshot).toEqual({ epoch: 0 });
        expect(JSON.stringify(client)).not.toContain(capability);
    });

    it('rejects non-Prisma and absolute URLs before bootstrapping', async () => {
        const fetchMock = vi.fn<typeof fetch>();
        const client = new PrismaSessionClient(fetchMock);

        await expect(client.fetch('https://example.test/api/prisma/snapshot')).rejects.toThrow();
        await expect(client.fetch('//example.test/api/prisma/snapshot')).rejects.toThrow();
        await expect(client.fetch('/api/prisma/voice-config')).rejects.toThrow();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('adds the capability only to an exact authorized route with redirects disabled', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const client = new PrismaSessionClient(fetchMock);

        await client.fetch('/api/prisma/events/latest');

        const [, request] = fetchMock.mock.calls[1];
        expect(new Headers(request?.headers).get('X-Prisma-Session-Capability')).toBe(canonicalCapability());
        expect(request?.redirect).toBe('error');
    });

    it('fences a stale completion after reset and never replays the old operation', async () => {
        let resolveRequest!: (response: Response) => void;
        const request = new Promise<Response>((resolve) => { resolveRequest = resolve; });
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockReturnValueOnce(request)
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        const client = new PrismaSessionClient(fetchMock);
        const pending = client.fetch('/api/prisma/snapshot', { method: 'POST' });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        client.reset({ close: false });
        resolveRequest(new Response(null, { status: 202 }));

        await expect(pending).rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('renews after a current 401 without replaying the rejected operation', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse(canonicalCapability(1)))
            .mockResolvedValueOnce(new Response(null, { status: 401 }))
            .mockResolvedValueOnce(sessionResponse(canonicalCapability(2)));
        const client = new PrismaSessionClient(fetchMock);

        const response = await client.fetch('/api/prisma/snapshot', { method: 'POST' });

        expect(response.status).toBe(401);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls.filter(([path]) => path === '/api/prisma/snapshot')).toHaveLength(1);
        expect(client.snapshot).toEqual({ epoch: 1 });
    });

    it('closes with the capability only in the dedicated header', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockResolvedValueOnce(new Response(null, { status: 200 }));
        const client = new PrismaSessionClient(fetchMock);
        await client.bootstrap();

        client.reset({ keepalive: true });
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const [path, request] = fetchMock.mock.calls[1];
        expect(path).toBe('/api/prisma/session');
        expect(request?.method).toBe('DELETE');
        expect(request?.body).toBeUndefined();
        expect(new Headers(request?.headers).get('X-Prisma-Session-Capability')).toBe(canonicalCapability());
        expect(request?.keepalive).toBe(true);
    });

    it('rejects an already-aborted caller before bootstrap', async () => {
        const fetchMock = vi.fn<typeof fetch>();
        const client = new PrismaSessionClient(fetchMock);
        const controller = new AbortController();
        controller.abort();

        await expect(client.fetch('/api/prisma/snapshot', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects one aborted bootstrap waiter promptly without cancelling the shared bootstrap', async () => {
        const bootstrap = deferred<Response>();
        let authorizedSignal: AbortSignal | null = null;
        const fetchMock = vi.fn<typeof fetch>()
            .mockReturnValueOnce(bootstrap.promise)
            .mockImplementationOnce(async (_path, init) => {
                authorizedSignal = init?.signal ?? null;
                return new Response(null, { status: 204 });
            });
        const client = new PrismaSessionClient(fetchMock);
        const cancelled = new AbortController();
        const abortedWaiter = client.fetch('/api/prisma/snapshot', { method: 'POST', signal: cancelled.signal });
        const validWaiter = client.fetch('/api/prisma/events/latest');

        cancelled.abort();
        await expect(abortedWaiter).rejects.toMatchObject({ name: 'AbortError' });
        expect(fetchMock).toHaveBeenCalledOnce();

        bootstrap.resolve(sessionResponse());
        await expect(validWaiter).resolves.toMatchObject({ status: 204 });
        expect(fetchMock.mock.calls.filter(([path]) => path === '/api/prisma/snapshot')).toHaveLength(0);
        expect(authorizedSignal?.aborted).toBe(false);
    });

    it('refuses caller work whose initiating epoch became stale during bootstrap', async () => {
        const bootstrap = deferred<Response>();
        const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(bootstrap.promise);
        const client = new PrismaSessionClient(fetchMock);
        const request = client.fetch('/api/prisma/snapshot', { method: 'POST' });

        client.reset({ close: false });
        bootstrap.resolve(sessionResponse());

        await expect(request).rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        expect(fetchMock.mock.calls.filter(([path]) => path === '/api/prisma/snapshot')).toHaveLength(0);
    });

    it('prevents a late old bootstrap from replacing or clearing a newer bootstrap', async () => {
        const oldBootstrap = deferred<Response>();
        const newBootstrap = deferred<Response>();
        const fetchMock = vi.fn<typeof fetch>()
            .mockReturnValueOnce(oldBootstrap.promise)
            .mockReturnValueOnce(newBootstrap.promise)
            .mockResolvedValueOnce(new Response(null, { status: 204 }));
        const client = new PrismaSessionClient(fetchMock);
        const oldResult = client.bootstrap();
        client.reset({ close: false });
        const newResult = client.bootstrap();

        oldBootstrap.resolve(sessionResponse(canonicalCapability(1)));
        await expect(oldResult).rejects.toBeInstanceOf(PrismaStaleSessionResponse);
        newBootstrap.resolve(sessionResponse(canonicalCapability(2)));
        await expect(newResult).resolves.toMatchObject({ ok: true });

        await client.fetch('/api/prisma/events/latest');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get('X-Prisma-Session-Capability')).toBe(canonicalCapability(2));
    });

    it('rejects malformed bootstrap capability and metadata without installing authority', async () => {
        const invalidResponses = [
            sessionResponse('x'),
            sessionResponse(canonicalCapability(), { unexpected: true }),
            sessionResponse(canonicalCapability(), { ok: true, idleExpiresAt: Number.NaN, absoluteExpiresAt: 2 }),
            sessionResponse(canonicalCapability(), { ok: true, idleExpiresAt: 3, absoluteExpiresAt: 2 }),
            new Response('{', { status: 201, headers: { 'X-Prisma-Session-Capability': canonicalCapability() } }),
        ];

        for (const invalidResponse of invalidResponses) {
            const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(invalidResponse);
            const client = new PrismaSessionClient(fetchMock);
            await expect(client.fetch('/api/prisma/events/latest')).rejects.toThrow('Prisma session bootstrap failed');
            expect(fetchMock).toHaveBeenCalledOnce();
        }
    });

    it('keeps caller and session abort wiring until a TTS stream terminates', async () => {
        const stream = deferred<void>();
        let requestSignal: AbortSignal | null = null;
        const source = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2]));
                void stream.promise.then(() => controller.close());
            },
        });
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockImplementationOnce(async (_path, init) => {
                requestSignal = init?.signal ?? null;
                return new Response(source, { status: 200 });
            });
        const client = new PrismaSessionClient(fetchMock);
        const caller = new AbortController();
        const response = await client.fetch('/api/prisma/tts/live', { signal: caller.signal });
        const reader = response.body!.getReader();

        await expect(reader.read()).resolves.toMatchObject({ done: false });
        caller.abort();

        expect(requestSignal?.aborted).toBe(true);
        await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('aborts an open TTS transport when the document session resets', async () => {
        let requestSignal: AbortSignal | null = null;
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(sessionResponse())
            .mockImplementationOnce(async (_path, init) => {
                requestSignal = init?.signal ?? null;
                return new Response(new ReadableStream<Uint8Array>({}), { status: 200 });
            });
        const client = new PrismaSessionClient(fetchMock);
        const response = await client.fetch('/api/prisma/tts/live');
        const reader = response.body!.getReader();

        client.reset({ close: false });

        expect(requestSignal?.aborted).toBe(true);
        await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('cleans stream abort listeners on EOF, source error, and reader cancel', async () => {
        for (const terminal of ['eof', 'error', 'cancel'] as const) {
            const caller = new AbortController();
            const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
            const source = new ReadableStream<Uint8Array>({
                start(controller) {
                    if (terminal === 'error') controller.error(new Error('source failed'));
                    else if (terminal === 'eof') controller.close();
                },
            });
            const fetchMock = vi.fn<typeof fetch>()
                .mockResolvedValueOnce(sessionResponse())
                .mockResolvedValueOnce(new Response(source, { status: 200 }));
            const client = new PrismaSessionClient(fetchMock);
            const response = await client.fetch('/api/prisma/tts/live', { signal: caller.signal });
            const reader = response.body!.getReader();

            if (terminal === 'error') await expect(reader.read()).rejects.toThrow('source failed');
            else if (terminal === 'eof') await expect(reader.read()).resolves.toEqual({ done: true, value: undefined });
            else await reader.cancel('cancelled');

            expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
        }
    });
});
