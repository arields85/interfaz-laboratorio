import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startVoiceEventListener } from './voiceEventListener.service';

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
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('keeps the first valid payload silent, ignores duplicates, and emits a new id once', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT))
            .mockResolvedValueOnce(jsonResponse({ ...FIRST_EVENT, telegramChatId: 995701520 }))
            .mockResolvedValueOnce(jsonResponse({ ...FIRST_EVENT, id: 'voice-2', text: 'Current response' }));
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
        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith({ ...FIRST_EVENT, id: 'voice-2', text: 'Current response' });

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
});
