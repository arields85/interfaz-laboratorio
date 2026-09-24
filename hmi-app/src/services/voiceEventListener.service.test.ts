import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sessionClientMock } = vi.hoisted(() => ({
    sessionClientMock: {
        fetch: vi.fn<typeof fetch>(),
        isCurrentResponse: vi.fn(() => true),
        acceptVoiceEvent: vi.fn(() => true),
    },
}));

vi.mock('./prismaSessionClient', () => ({
    prismaSessionClient: sessionClientMock,
}));

import { startVoiceEventListener } from './voiceEventListener.service';

/**
 * T13b: minimal fake for a fetch Response's streaming `body`
 * (ReadableStream<Uint8Array>-shaped). Tests drive it by pushing raw text
 * chunks (possibly splitting a single SSE frame across pushes), ending the
 * stream, or failing a pending/future read -- mirroring exactly what
 * `reader.read()` returns/throws for a real fetch body.
 */
class FakeSseBody {
    private queue: Array<{ done: boolean; value?: Uint8Array } | { error: unknown }> = [];
    private pendingResolve: ((chunk: { done: boolean; value?: Uint8Array }) => void) | null = null;
    private pendingReject: ((error: unknown) => void) | null = null;
    cancelled = false;

    push(text: string): void {
        this.deliver({ done: false, value: new TextEncoder().encode(text) });
    }

    end(): void {
        this.deliver({ done: true, value: undefined });
    }

    fail(error: unknown): void {
        if (this.pendingReject) {
            const reject = this.pendingReject;
            this.pendingResolve = null;
            this.pendingReject = null;
            reject(error);
            return;
        }

        this.queue.push({ error });
    }

    private deliver(chunk: { done: boolean; value?: Uint8Array }): void {
        if (this.pendingResolve) {
            const resolve = this.pendingResolve;
            this.pendingResolve = null;
            this.pendingReject = null;
            resolve(chunk);
            return;
        }

        this.queue.push(chunk);
    }

    getReader() {
        return {
            read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
                if (this.queue.length > 0) {
                    const next = this.queue.shift()!;
                    if ('error' in next) return Promise.reject(next.error);
                    return Promise.resolve(next);
                }

                return new Promise((resolve, reject) => {
                    this.pendingResolve = resolve;
                    this.pendingReject = reject;
                });
            },
            cancel: (): Promise<void> => {
                this.cancelled = true;
                return Promise.resolve();
            },
        };
    }

    cancel(): Promise<void> {
        this.cancelled = true;
        return Promise.resolve();
    }
}

function sseResponse(body: FakeSseBody, init: { ok?: boolean; status?: number } = {}): Response {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        body,
    } as unknown as Response;
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

    describe('T13b: push voice events over a header-based fetch SSE reader (capability never in the URL)', () => {
        it('connects via prismaSessionClient.fetch with no query string, delivers an event, and never falls back to polling', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch.mockResolvedValueOnce(sseResponse(body));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledOnce();
            const [calledUrl] = sessionClientMock.fetch.mock.calls[0]!;
            expect(calledUrl).toBe('/api/prisma/events/stream');
            expect(String(calledUrl)).not.toContain('capability=');

            body.push(`data: ${JSON.stringify(FIRST_EVENT)}\n\n`);
            await vi.advanceTimersByTimeAsync(0);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            await vi.advanceTimersByTimeAsync(5_000);
            expect(sessionClientMock.fetch).toHaveBeenCalledOnce();

            stop();
            await vi.advanceTimersByTimeAsync(0);
            expect(body.cancelled).toBe(true);
        });

        it('reassembles a single SSE frame split across multiple stream chunks', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch.mockResolvedValueOnce(sseResponse(body));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
            });
            await vi.advanceTimersByTimeAsync(0);

            const raw = `data: ${JSON.stringify(FIRST_EVENT)}\n\n`;
            const midpoint = Math.floor(raw.length / 2);
            body.push(raw.slice(0, midpoint));
            await vi.advanceTimersByTimeAsync(0);
            expect(onEvent).not.toHaveBeenCalled();

            body.push(raw.slice(midpoint));
            await vi.advanceTimersByTimeAsync(0);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('delivers a complete frame even when it alone exceeds the unterminated-frame overflow guard', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch.mockResolvedValueOnce(sseResponse(body));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
            });
            await vi.advanceTimersByTimeAsync(0);

            // A single, complete, well-terminated frame larger than the
            // overflow guard must still be delivered -- the guard exists
            // for an unterminated frame that never completes, not for a
            // legitimately large one. Arrives as one chunk carrying the
            // full frame including its closing `\n\n`.
            const oversizedEvent = { ...FIRST_EVENT, text: 'x'.repeat(80 * 1024) };
            body.push(`data: ${JSON.stringify(oversizedEvent)}\n\n`);
            await vi.advanceTimersByTimeAsync(0);

            expect(onEvent).toHaveBeenCalledExactlyOnceWith(oversizedEvent);

            stop();
        });

        it('ignores heartbeat/comment frames and keeps reading for the next real event', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch.mockResolvedValueOnce(sseResponse(body));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
            });
            await vi.advanceTimersByTimeAsync(0);

            body.push(': keep-alive\n\n');
            await vi.advanceTimersByTimeAsync(0);
            expect(onEvent).not.toHaveBeenCalled();
            expect(sessionClientMock.fetch).toHaveBeenCalledOnce();

            body.push(`data: ${JSON.stringify(FIRST_EVENT)}\n\n`);
            await vi.advanceTimersByTimeAsync(0);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('deduplicates a repeated SSE event through the shared cross-listener accept gate', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch.mockResolvedValueOnce(sseResponse(body));
            sessionClientMock.acceptVoiceEvent.mockReturnValueOnce(true).mockReturnValueOnce(false);
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
            });
            await vi.advanceTimersByTimeAsync(0);

            body.push(`data: ${JSON.stringify(FIRST_EVENT)}\n\n`);
            body.push(`data: ${JSON.stringify(FIRST_EVENT)}\n\n`);
            await vi.advanceTimersByTimeAsync(0);

            expect(onEvent).toHaveBeenCalledOnce();
            stop();
        });

        it('ignores a malformed (non-JSON) data frame without falling back to polling or throwing', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch.mockResolvedValueOnce(sseResponse(body));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
            });
            await vi.advanceTimersByTimeAsync(0);

            body.push('data: not json\n\n');
            await vi.advanceTimersByTimeAsync(0);
            expect(onEvent).not.toHaveBeenCalled();
            expect(sessionClientMock.fetch).toHaveBeenCalledOnce();

            stop();
        });

        it('falls back to polling when a stream read rejects', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch
                .mockResolvedValueOnce(sseResponse(body))
                .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            body.fail(new TypeError('network error mid-stream'));
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(2);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling when the stream ends unexpectedly', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch
                .mockResolvedValueOnce(sseResponse(body))
                .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            body.end();
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(2);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling when the SSE fetch itself rejects', async () => {
            sessionClientMock.fetch
                .mockRejectedValueOnce(new TypeError('Failed to fetch'))
                .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(2);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling on a non-ok SSE response (e.g. the stream capacity limit)', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch
                .mockResolvedValueOnce(sseResponse(body, { ok: false, status: 429 }))
                .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(2);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling when the SSE response body is unsupported (no streaming body)', async () => {
            sessionClientMock.fetch
                .mockResolvedValueOnce({ ok: true, status: 200, body: null } as unknown as Response)
                .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(2);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);

            stop();
        });

        it('falls back to polling when the SSE response is stale after a mid-connect session reset', async () => {
            const body = new FakeSseBody();
            sessionClientMock.fetch
                .mockResolvedValueOnce(sseResponse(body))
                .mockResolvedValueOnce(jsonResponse(FIRST_EVENT));
            sessionClientMock.isCurrentResponse.mockReturnValueOnce(false);
            const onEvent = vi.fn();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent,
                intervalMs: 1_000,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).toHaveBeenCalledTimes(2);
            expect(onEvent).toHaveBeenCalledExactlyOnceWith(FIRST_EVENT);
            expect(body.cancelled).toBe(true);

            stop();
        });

        it('never attempts SSE when fetchImpl is provided (the existing polling test seam)', async () => {
            const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(FIRST_EVENT));

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent: vi.fn(),
                fetchImpl: fetchMock,
            });
            await vi.advanceTimersByTimeAsync(0);

            expect(sessionClientMock.fetch).not.toHaveBeenCalled();
            expect(fetchMock).toHaveBeenCalledTimes(1);

            stop();
        });

        it('stop() before the SSE fetch resolves cancels the stream instead of connecting or polling', async () => {
            const request = deferred<Response>();
            sessionClientMock.fetch.mockReturnValueOnce(request.promise);
            const body = new FakeSseBody();

            const stop = startVoiceEventListener({
                url: '/api/prisma/events/latest',
                streamUrl: '/api/prisma/events/stream',
                onEvent: vi.fn(),
            });

            stop();
            request.resolve(sseResponse(body));
            await Promise.resolve();
            await Promise.resolve();

            expect(body.cancelled).toBe(true);
            expect(sessionClientMock.fetch).toHaveBeenCalledOnce();
        });
    });
});
