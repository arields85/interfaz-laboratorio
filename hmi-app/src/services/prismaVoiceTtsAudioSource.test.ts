import { afterEach, describe, expect, it, vi } from 'vitest';

const { sessionClientMock } = vi.hoisted(() => ({
    sessionClientMock: {
        fetch: vi.fn(),
        isCurrentResponse: vi.fn(() => true),
    },
}));

vi.mock('./prismaSessionClient', () => ({
    prismaSessionClient: sessionClientMock,
}));

import { createPrismaVoiceTtsAudioSource } from './prismaVoiceTtsAudioSource';
import { PRISMA_BROWSER_METRIC_EVENT } from './prismaVoiceMetrics';

function collectTimelineRecords(run: () => Promise<void>): Promise<{ record_type: string; payload: Record<string, unknown> }[]> {
    const records: { record_type: string; payload: Record<string, unknown> }[] = [];
    const listener = (event: Event) => {
        const detail = (event as CustomEvent<{ record_type: string; payload: Record<string, unknown> }>).detail;
        records.push({ record_type: detail.record_type, payload: detail.payload });
    };
    window.addEventListener(PRISMA_BROWSER_METRIC_EVENT, listener);
    return run().finally(() => window.removeEventListener(PRISMA_BROWSER_METRIC_EVENT, listener)).then(() => records);
}

function liveResponse(overrides: Partial<Response> = {}): Response {
    const stream = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(new Uint8Array([1, 2])) });
    return {
        ok: true,
        status: 200,
        headers: new Headers({
            'X-Prisma-Audio-Format': 'pcm_s16le',
            'X-Prisma-Sample-Rate': '24000',
            'X-Prisma-Channels': '1',
        }),
        body: stream,
        ...overrides,
    } as Response;
}

describe('createPrismaVoiceTtsAudioSource', () => {
    afterEach(() => {
        sessionClientMock.fetch.mockReset();
        sessionClientMock.isCurrentResponse.mockReset().mockReturnValue(true);
    });

    it('T16: records a speak-live request-start and response-received timeline entry', async () => {
        const fetchMock = vi.fn(async () => liveResponse());
        const source = createPrismaVoiceTtsAudioSource({ eventId: 'event-1' }, fetchMock as typeof fetch);

        const records = await collectTimelineRecords(async () => {
            await source.openLive(new AbortController().signal);
        });

        expect(records).toEqual(expect.arrayContaining([
            { record_type: 'speak-live-request-start', payload: {} },
            expect.objectContaining({ record_type: 'speak-live-response-received' }),
        ]));
        const response = records.find((record) => record.record_type === 'speak-live-response-received')!;
        expect(response.payload.http_status).toBe(200);
        expect(typeof response.payload.elapsed_ms).toBe('number');
    });

    it('T16: records a stale-response-discarded entry and never a normal response otherwise', async () => {
        sessionClientMock.fetch.mockResolvedValueOnce(liveResponse());
        sessionClientMock.isCurrentResponse.mockReturnValue(false);
        const source = createPrismaVoiceTtsAudioSource({ eventId: 'event-1' });

        const records = await collectTimelineRecords(async () => {
            await expect(source.openLive(new AbortController().signal)).rejects.toThrow('stale session');
        });

        const types = records.map((record) => record.record_type);
        expect(types).toEqual(['speak-live-request-start', 'speak-live-response-received', 'speak-live-stale-discarded']);
    });

    it('opens progressive PCM only through the fixed same-origin route', async () => {
        const fetchMock = vi.fn(async () => liveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            eventId: 'event-1',
        }, fetchMock as typeof fetch);
        const signal = new AbortController().signal;

        const live = await source.openLive(signal);

        expect(source.loadWav).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/prisma/tts/live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId: 'event-1' }),
            cache: 'no-store',
            signal,
        });
        expect(live).toMatchObject({ sampleRate: 24000, channels: 1 });
    });

    it('rejects an invalid event id before transport', async () => {
        const fetchMock = vi.fn(async () => liveResponse());
        const source = createPrismaVoiceTtsAudioSource({ eventId: '   ' }, fetchMock as typeof fetch);

        await expect(source.openLive(new AbortController().signal)).rejects.toThrow('event ID');

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        ['format', { 'X-Prisma-Audio-Format': 'wav', 'X-Prisma-Sample-Rate': '24000', 'X-Prisma-Channels': '1' }],
        ['sample rate', { 'X-Prisma-Audio-Format': 'pcm_s16le', 'X-Prisma-Sample-Rate': '16000', 'X-Prisma-Channels': '1' }],
        ['channels', { 'X-Prisma-Audio-Format': 'pcm_s16le', 'X-Prisma-Sample-Rate': '24000', 'X-Prisma-Channels': '2' }],
    ])('rejects an invalid PCM %s header', async (_case, headers) => {
        const source = createPrismaVoiceTtsAudioSource(
            { eventId: 'event-1' },
            vi.fn(async () => liveResponse({ headers: new Headers(headers) })) as typeof fetch,
        );

        await expect(source.openLive(new AbortController().signal)).rejects.toThrow(/invalid/i);
    });

    it('rejects HTTP failure and missing stream bodies', async () => {
        const failed = createPrismaVoiceTtsAudioSource(
            { eventId: 'event-1' },
            vi.fn(async () => liveResponse({ ok: false, status: 503 })) as typeof fetch,
        );
        const empty = createPrismaVoiceTtsAudioSource(
            { eventId: 'event-1' },
            vi.fn(async () => liveResponse({ body: null })) as typeof fetch,
        );

        await expect(failed.openLive(new AbortController().signal)).rejects.toThrow('status 503');
        await expect(empty.openLive(new AbortController().signal)).rejects.toThrow('no readable body');
    });
});
