import { describe, expect, it, vi } from 'vitest';

import { createPrismaVoiceTtsAudioSource } from './prismaVoiceTtsAudioSource';

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
    it('opens progressive PCM only through the fixed same-origin route', async () => {
        const fetchMock = vi.fn(async () => liveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            eventId: 'event-1',
        }, fetchMock as typeof fetch);
        const signal = new AbortController().signal;

        const live = await source.openLive(signal);

        expect(source.playbackTransport).toBe('progressive');
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
