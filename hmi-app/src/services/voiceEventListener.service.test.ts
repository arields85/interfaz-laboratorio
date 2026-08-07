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
            .mockResolvedValueOnce(jsonResponse(FIRST_EVENT))
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
