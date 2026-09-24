import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionClientMock } = vi.hoisted(() => ({
    sessionClientMock: {
        capability: vi.fn<() => Promise<string>>(),
        fetch: vi.fn<typeof fetch>(),
        isCurrentResponse: vi.fn(() => true),
        acceptVoiceEvent: vi.fn(() => true),
    },
}));

vi.mock('./prismaSessionClient', () => ({
    prismaSessionClient: sessionClientMock,
}));

import { startVoiceEventListener } from './voiceEventListener.service';

/** Minimal fake EventSource: records instances, lets tests drive onmessage/onerror directly. */
class FakeEventSource {
    static instances: FakeEventSource[] = [];
    url: string;
    closed = false;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }

    emit(data: string): void {
        this.onmessage?.(new MessageEvent('message', { data }));
    }

    fail(): void {
        this.onerror?.();
    }
}

const FIRST_EVENT = {
    id: 'voice-1',
    timestamp: '2026-08-06T12:00:00.000Z',
    text: 'Historical response',
    question: 'Historical question',
};

function jsonResponse(body: unknown): Response {
    return {
        ok: true,
        json: () => Promise.resolve(body),
    } as Response;
}

function deferred<Value>() {
    let resolve!: (value: Value) => void;
    const promise = new Promise<Value>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('startVoiceEventListener', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeEventSource.instances = [];
        sessionClientMock.capability.mockReset();
        sessionClientMock.fetch.mockReset();
        sessionClientMock.isCurrentResponse.mockReset().mockReturnValue(true);
        sessionClientMock.acceptVoiceEvent.mockReset().mockReturnValue(true);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('delivers the first owned payload, ignores duplicates, and emits a new id once', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT))
            .mockResolvedValueOnce(jsonResponse({ ...FIRST_EVENT, telegramChatId: 995701520 }))
            .mockResolvedValueOnce(jsonResponse({ ...FIRST_EVENT, id: 'voice-2', text: 'Current response' }));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: '/api/prisma/events/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenLastCalledWith(FIRST_EVENT);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(onEvent).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(onEvent).toHaveBeenCalledTimes(2);
        expect(onEvent).toHaveBeenLastCalledWith({ ...FIRST_EVENT, id: 'voice-2', text: 'Current response' });

        stop();
    });

    it('keeps the first legacy payload silent, deduplicates it, and emits a new legacy event once', async () => {
        const firstLegacyEvent = {
            timestamp: FIRST_EVENT.timestamp,
            text: FIRST_EVENT.text,
            question: FIRST_EVENT.question,
        };
        const nextLegacyEvent = {
            ...firstLegacyEvent,
            timestamp: '2026-08-06T12:00:01.000Z',
            text: 'Current legacy response',
        };
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(firstLegacyEvent))
            .mockResolvedValueOnce(jsonResponse(firstLegacyEvent))
            .mockResolvedValueOnce(jsonResponse(nextLegacyEvent))
            .mockResolvedValueOnce(jsonResponse(nextLegacyEvent));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(onEvent).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(onEvent).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledWith(nextLegacyEvent);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(onEvent).toHaveBeenCalledOnce();

        stop();
    });

    it('keeps tolerant legacy id behavior without a runtime-mode branch', async () => {
        const legacyBaseline = { ...FIRST_EVENT, id: undefined };
        const nextEvent = { ...FIRST_EVENT, id: 'voice-2', text: 'Current response' };
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(legacyBaseline))
            .mockResolvedValueOnce(jsonResponse(nextEvent));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: '/api/prisma/events/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(onEvent).toHaveBeenCalledExactlyOnceWith(nextEvent);
        stop();
    });

    it('normalizes and emits a valid Telegram chat id', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT))
            .mockResolvedValueOnce(jsonResponse({
                ...FIRST_EVENT,
                id: 'voice-2',
                telegramChatId: -1001234567890,
            }));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledWith({
            ...FIRST_EVENT,
            id: 'voice-2',
            telegramChatId: -1001234567890,
        });

        stop();
    });

    it('omits an invalid Telegram chat id without rejecting the event', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT))
            .mockResolvedValueOnce(jsonResponse({
                ...FIRST_EVENT,
                id: 'voice-2',
                telegramChatId: '995701520',
            }));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(onEvent).toHaveBeenCalledWith({ ...FIRST_EVENT, id: 'voice-2' });

        stop();
    });

    it('distinguishes legacy events for different chats and deduplicates the same chat', async () => {
        const legacyEvent = {
            timestamp: FIRST_EVENT.timestamp,
            text: FIRST_EVENT.text,
            question: FIRST_EVENT.question,
        };
        const secondChatEvent = { ...legacyEvent, telegramChatId: 200 };
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse({ ...legacyEvent, telegramChatId: 100 }))
            .mockResolvedValueOnce(jsonResponse(secondChatEvent))
            .mockResolvedValueOnce(jsonResponse(secondChatEvent));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(2_000);

        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledWith(secondChatEvent);

        stop();
    });

    it.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['wrong type', 42],
    ])('treats a present but %s id as a legacy event', async (_case, id) => {
        const legacyEvent = { ...FIRST_EVENT, id };
        const nextLegacyEvent = {
            ...legacyEvent,
            timestamp: '2026-08-06T12:00:01.000Z',
            text: 'Current legacy response',
        };
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(legacyEvent))
            .mockResolvedValueOnce(jsonResponse(nextLegacyEvent));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(onEvent).toHaveBeenCalledOnce();
        expect(onEvent).toHaveBeenCalledWith({
            timestamp: nextLegacyEvent.timestamp,
            text: nextLegacyEvent.text,
            question: nextLegacyEvent.question,
        });

        stop();
    });

    it('does not fetch or schedule polling when the endpoint is disabled', () => {
        const fetchMock = vi.fn<typeof fetch>();

        const stop = startVoiceEventListener({
            url: null,
            onEvent: vi.fn(),
            fetchImpl: fetchMock,
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);

        stop();
    });

    it('stops future polling and aborts an in-flight request during cleanup', () => {
        let requestSignal: AbortSignal | undefined;
        const fetchMock = vi.fn<typeof fetch>((_input, init) => {
            requestSignal = init?.signal ?? undefined;
            return new Promise<Response>(() => undefined);
        });

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent: vi.fn(),
            fetchImpl: fetchMock,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestSignal?.aborted).toBe(false);

        stop();

        expect(requestSignal?.aborted).toBe(true);
        vi.advanceTimersByTime(5_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cancels the previous listener before starting replacement polling', () => {
        const signals: AbortSignal[] = [];
        const fetchMock = vi.fn<typeof fetch>((_input, init) => {
            if (init?.signal) signals.push(init.signal);
            return new Promise<Response>(() => undefined);
        });

        const stopServer = startVoiceEventListener({
            url: '/api/prisma/events/latest',
            onEvent: vi.fn(),
            fetchImpl: fetchMock,
        });
        const stopLocal = startVoiceEventListener({
            url: '/api/prisma/events/latest',
            onEvent: vi.fn(),
            fetchImpl: fetchMock,
        });

        expect(signals).toHaveLength(2);
        expect(signals[0]?.aborted).toBe(true);
        expect(signals[1]?.aborted).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        stopServer();
        expect(signals[1]?.aborted).toBe(false);
        stopLocal();
        expect(signals[1]?.aborted).toBe(true);
    });

    it('ignores invalid responses and network failures without emitting or stopping later polls', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockRejectedValueOnce(new Error('network unavailable'))
            .mockResolvedValueOnce(jsonResponse({ id: 'invalid', text: 42 }))
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
        const onEvent = vi.fn();

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(2_000);

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(onEvent).not.toHaveBeenCalled();

        stop();
    });

    it.each([
        ['5057 outage', () => Promise.reject(new TypeError('Failed to fetch'))],
        ['CORS preflight denial', () => Promise.reject(new TypeError('CORS request rejected'))],
        ['timeout', () => Promise.reject(new DOMException('Request timed out', 'TimeoutError'))],
        ['malformed JSON', () => Promise.resolve({ ok: true, json: async () => { throw new SyntaxError('invalid'); } } as Response)],
        ['non-2xx', () => Promise.resolve({ ok: false, status: 503 } as Response)],
    ] as const)('isolates %s and retries the voice request', async (_case, failure) => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockImplementationOnce(failure)
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
        const onEvent = vi.fn();
        const stop = startVoiceEventListener({
            url: 'http://127.0.0.1:5057/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(onEvent).not.toHaveBeenCalled();
        stop();
    });

    it('rejects a stale GET completion after the listener is stopped', async () => {
        const request = deferred<Response>();
        const onEvent = vi.fn();
        const fetchMock = vi.fn<typeof fetch>().mockReturnValue(request.promise);
        const stop = startVoiceEventListener({
            url: 'http://127.0.0.1:5057/hmi/voice/latest',
            onEvent,
            fetchImpl: fetchMock,
        });

        stop();
        request.resolve(jsonResponse(FIRST_EVENT));
        await Promise.resolve();

        expect(onEvent).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for the active request to settle before scheduling the next poll', async () => {
        let resolveRequest: ((response: Response) => void) | undefined;
        const fetchMock = vi.fn<typeof fetch>()
            .mockImplementationOnce(() => new Promise<Response>((resolve) => {
                resolveRequest = resolve;
            }))
            .mockResolvedValue(jsonResponse(FIRST_EVENT));

        const stop = startVoiceEventListener({
            url: 'https://node-red.local/hmi/voice/latest',
            onEvent: vi.fn(),
            fetchImpl: fetchMock,
            intervalMs: 1_000,
        });

        await vi.advanceTimersByTimeAsync(5_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        resolveRequest?.(jsonResponse(FIRST_EVENT));
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        stop();
    });

    describe('T13 unit (c) / T10 unit 5: push voice events (SSE)', () => {
        it('connects over SSE with the capability as a query parameter and never falls back to polling', async () => {
            sessionClientMock.capability.mockResolvedValue('the-capability');
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(FakeEventSource.instances).toHaveLength(1);
            expect(FakeEventSource.instances[0]?.url).toBe('/api/prisma/events/stream?capability=the-capability');

            FakeEventSource.instances[0]?.emit(JSON.stringify(FIRST_EVENT));
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            await vi.advanceTimersByTimeAsync(5_000);
            expect(sessionClientMock.fetch).not.toHaveBeenCalled();

            stop();
            expect(FakeEventSource.instances[0]?.closed).toBe(true);
        });

        it('deduplicates a repeated SSE event through the shared cross-listener accept gate', async () => {
            sessionClientMock.capability.mockResolvedValue('the-capability');
            sessionClientMock.acceptVoiceEvent.mockReturnValueOnce(true).mockReturnValueOnce(false);
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });
            await vi.advanceTimersByTimeAsync(0);

            const source = FakeEventSource.instances[0]!;
            source.emit(JSON.stringify(FIRST_EVENT));
            source.emit(JSON.stringify(FIRST_EVENT));

            expect(onEvent).toHaveBeenCalledOnce();
            stop();
        });

        it('ignores a malformed SSE frame without falling back to polling or throwing', async () => {
            sessionClientMock.capability.mockResolvedValue('the-capability');
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(() => FakeEventSource.instances[0]?.emit('not json')).not.toThrow();
            expect(onEvent).not.toHaveBeenCalled();
            expect(sessionClientMock.fetch).not.toHaveBeenCalled();

            stop();
        });

        it('falls back to polling when the EventSource reports an error', async () => {
            sessionClientMock.capability.mockResolvedValue('the-capability');
            sessionClientMock.fetch.mockResolvedValue(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });
            await vi.advanceTimersByTimeAsync(0);

            const source = FakeEventSource.instances[0]!;
            expect(source.closed).toBe(false);

            source.fail();
            expect(source.closed).toBe(true);

            await vi.advanceTimersByTimeAsync(0);
            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(1);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling immediately when session capability() rejects', async () => {
            sessionClientMock.capability.mockRejectedValue(new Error('bootstrap failed'));
            sessionClientMock.fetch.mockResolvedValue(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(FakeEventSource.instances).toHaveLength(0);
            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(1);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling immediately when no EventSource implementation is available (real jsdom global)', async () => {
            sessionClientMock.fetch.mockResolvedValue(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            // No eventSourceImpl injected, and jsdom does not implement a
            // native EventSource -- exercises the real "unsupported" branch.
            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.capability).not.toHaveBeenCalled();
            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(1);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('never attempts SSE when fetchImpl is provided (the existing polling test seam)', async () => {
            const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(FIRST_EVENT));

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent: vi.fn(),
                fetchImpl: fetchMock,
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(FakeEventSource.instances).toHaveLength(0);
            expect(sessionClientMock.capability).not.toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            stop();
        });

        it('stop() before capability() resolves closes the EventSource instead of connecting', async () => {
            const capability = deferred<string>();
            sessionClientMock.capability.mockReturnValue(capability.promise);

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent: vi.fn(),
                eventSourceImpl: FakeEventSource as unknown as typeof EventSource,
            });

            stop();
            capability.resolve('the-capability');
            await Promise.resolve();
            await Promise.resolve();

            expect(FakeEventSource.instances[0]?.closed ?? true).toBe(true);
        });
    });
});
