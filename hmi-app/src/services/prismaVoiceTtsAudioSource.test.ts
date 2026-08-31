import { describe, expect, it, vi } from 'vitest';

import { PrismaVoiceAudioEngine } from './prismaVoiceAudioEngine';
import { createPrismaVoiceTtsAudioSource } from './prismaVoiceTtsAudioSource';

const WAV_HEADER = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45,
]);

function createWavResponse({
    status = 200,
    responseType = 'audio/wav',
    blobType = 'audio/wav',
    bytes = WAV_HEADER,
}: {
    status?: number;
    responseType?: string;
    blobType?: string;
    bytes?: Uint8Array;
} = {}): Response {
    const blob = new Blob([bytes], { type: blobType });
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(responseType === '' ? {} : { 'Content-Type': responseType }),
        blob: vi.fn(async () => blob),
    } as unknown as Response;
}

function createLiveResponse({
    status = 200,
    body = new ReadableStream<Uint8Array>(),
    format = 'pcm_s16le',
    sampleRate = '24000',
    channels = '1',
}: {
    status?: number;
    body?: ReadableStream<Uint8Array> | null;
    format?: string;
    sampleRate?: string;
    channels?: string;
} = {}): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        body,
        headers: new Headers({
            'X-Prisma-Audio-Format': format,
            'X-Prisma-Sample-Rate': sampleRate,
            'X-Prisma-Channels': channels,
        }),
    } as Response;
}

describe('createPrismaVoiceTtsAudioSource', () => {
    it('creates a Local live-only source with no executable WAV fallback and preserves eventId exactly', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'http://127.0.0.1:5056/prisma/speak-live',
            fallbackPolicy: 'none',
            playbackTransport: 'buffer-before-playback',
            text: 'Local response',
            eventId: ' local-event-42 ',
        }, fetchMock);

        expect(source?.loadWav).toBeUndefined();
        expect(source?.playbackTransport).toBe('buffer-before-playback');
        await source?.openLive(new AbortController().signal);

        expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
            'http://127.0.0.1:5056/prisma/speak-live',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    text: 'Local response',
                    eventId: ' local-event-42 ',
                }),
            }),
        );
    });

    it('does not POST the unauthorized WAV fallback when Local live playback fails', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(createLiveResponse({ status: 503 }))
            .mockResolvedValueOnce(createWavResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'http://127.0.0.1:5056/prisma/speak-live',
            fallbackPolicy: 'none',
            playbackTransport: 'buffer-before-playback',
            text: 'Local response',
            eventId: 'local-event-43',
        }, fetchMock);
        const onError = vi.fn();
        const engine = new PrismaVoiceAudioEngine({
            createAudioContext: () => ({ state: 'running' } as AudioContext),
        });

        engine.play(source!, { level: 0, setSpeaking: vi.fn() }, { onError });
        for (let index = 0; index < 12; index += 1) await Promise.resolve();

        expect(onError).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/prisma/speak'))).toBe(false);
    });

    it('includes valid event and Telegram chat ids in the exact Live request body', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak-live',
            playbackTransport: 'progressive',
            text: 'El OEE actual es 88.6 %.',
            eventId: '1786387415998-l2tkwj',
            telegramChatId: 995701520,
        }, fetchMock);

        await source?.openLive(new AbortController().signal);

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual({
            text: 'El OEE actual es 88.6 %.',
            eventId: '1786387415998-l2tkwj',
            telegramChatId: 995701520,
        });
    });

    it('includes a valid Telegram chat id without inventing an event id', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak-live',
            playbackTransport: 'progressive',
            text: 'Telegram response',
            telegramChatId: -1001234567890,
        }, fetchMock);

        await source?.openLive(new AbortController().signal);

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual({
            text: 'Telegram response',
            telegramChatId: -1001234567890,
        });
    });

    it('includes a valid event id without a Telegram chat id', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak-live',
            playbackTransport: 'progressive',
            text: 'Event response',
            eventId: 'voice-42',
        }, fetchMock);

        await source?.openLive(new AbortController().signal);

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual({
            text: 'Event response',
            eventId: 'voice-42',
        });
    });

    it('opens the progressive Live reader with exact text and never buffers the full response', async () => {
        const stream = new ReadableStream<Uint8Array>();
        const response = createLiveResponse({ body: stream });
        const getReaderSpy = vi.spyOn(stream, 'getReader');
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
        const signal = new AbortController().signal;
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak',
            playbackTransport: 'progressive',
            text: 'Respuesta real de Leda',
        }, fetchMock);

        const live = await source?.openLive(signal);

        expect(fetchMock).toHaveBeenCalledWith('https://tts.test/prisma/speak-live', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Respuesta real de Leda' }),
            cache: 'no-store',
            signal,
        });
        expect(live).toEqual({ reader: expect.any(Object), sampleRate: 24_000, channels: 1 });
        expect(getReaderSpy).toHaveBeenCalledTimes(1);
        expect(response.blob).toBeUndefined();
        expect(response.arrayBuffer).toBeUndefined();
    });

    it.each([undefined, '', '   '])('omits unusable eventId %j from the Live body', async (eventId) => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak-live',
            playbackTransport: 'progressive',
            text: 'Legacy response',
            eventId,
        }, fetchMock);

        await source?.openLive(new AbortController().signal);

        const request = fetchMock.mock.calls[0]?.[1];
        const body = JSON.parse(String(request?.body));
        expect(body).toEqual({ text: 'Legacy response' });
        expect(body).not.toHaveProperty('eventId');
    });

    it.each([
        ['undefined', undefined],
        ['null', null],
        ['zero', 0],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['fraction', 42.5],
        ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
        ['runtime string', '995701520'],
    ])('omits an invalid Telegram chat id: %s', async (_case, telegramChatId) => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak-live',
            playbackTransport: 'progressive',
            text: 'Response without chat identity',
            eventId: 'voice-42',
            telegramChatId: telegramChatId as number,
        }, fetchMock);

        await source?.openLive(new AbortController().signal);

        const request = fetchMock.mock.calls[0]?.[1];
        expect(JSON.parse(String(request?.body))).toEqual({
            text: 'Response without chat identity',
            eventId: 'voice-42',
        });
    });

    it.each([
        ['format', { format: 'wav' }, /format/],
        ['sample rate', { sampleRate: '16000' }, /sample rate/],
        ['channels', { channels: '2' }, /channels/],
        ['missing body', { body: null }, /body/],
        ['missing headers', { format: '', sampleRate: '', channels: '' }, /format/],
        ['failed status', { status: 503 }, /503/],
    ] as const)('rejects invalid Live %s', async (_case, responseOptions, expected) => {
        const source = createPrismaVoiceTtsAudioSource(
            {
                serviceUrl: 'https://tts.test/prisma/speak',
                playbackTransport: 'progressive',
                text: 'Voice text',
            },
            vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse(responseOptions)),
        );

        await expect(source?.openLive(new AbortController().signal)).rejects.toThrow(expected);
    });

    it('rejects an unreadable Live stream without disrupting the caller', async () => {
        const source = createPrismaVoiceTtsAudioSource(
            {
                serviceUrl: 'https://tts.test/prisma/speak-live',
                playbackTransport: 'progressive',
                text: 'Voice text',
            },
            vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse({
                body: { getReader: () => { throw new Error('stream unreadable'); } } as unknown as ReadableStream<Uint8Array>,
            })),
        );

        await expect(source?.openLive(new AbortController().signal)).rejects.toThrow('unreadable');
    });

    it('returns null for empty or invalid service URLs without fetching', () => {
        const fetchMock = vi.fn<typeof fetch>();

        expect(createPrismaVoiceTtsAudioSource({
            serviceUrl: '   ', playbackTransport: 'progressive', text: 'Disabled',
        }, fetchMock)).toBeNull();
        expect(createPrismaVoiceTtsAudioSource({
            serviceUrl: '/relative', playbackTransport: 'progressive', text: 'Invalid',
        }, fetchMock)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('keeps the complete WAV fallback on the sibling endpoint', async () => {
        const response = createWavResponse({ responseType: 'audio/wav; charset=binary' });
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
        const signal = new AbortController().signal;
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak-live',
            fallbackPolicy: 'legacy-wav',
            playbackTransport: 'progressive',
            text: 'Fallback response',
            eventId: 'voice-fallback',
            telegramChatId: 995701520,
        }, fetchMock);

        const encoded = await source?.loadWav?.(signal);

        expect(fetchMock).toHaveBeenCalledWith('https://tts.test/prisma/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Fallback response' }),
            cache: 'no-store',
            signal,
        });
        expect(new Uint8Array(encoded ?? new ArrayBuffer(0))).toEqual(WAV_HEADER);
        expect(response.blob).toHaveBeenCalledTimes(1);
    });

    it('preserves an unrecognized custom URL as Live without inventing a fallback', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(createLiveResponse());
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/custom-stream',
            playbackTransport: 'progressive',
            text: 'Voice text',
        }, fetchMock);

        await source?.openLive(new AbortController().signal);

        expect(fetchMock).toHaveBeenCalledWith('https://tts.test/custom-stream', expect.any(Object));
        expect(source?.loadWav).toBeUndefined();
    });

    it.each(['audio/wav', 'audio/x-wav', 'audio/wave'])('accepts supported fallback WAV MIME %s', async (type) => {
        const source = createPrismaVoiceTtsAudioSource(
            {
                serviceUrl: 'https://tts.test/prisma/speak-live',
                playbackTransport: 'progressive',
                text: 'Voice text',
            },
            vi.fn<typeof fetch>().mockResolvedValue(createWavResponse({ responseType: type })),
        );

        await expect(source?.loadWav?.(new AbortController().signal)).resolves.toBeInstanceOf(ArrayBuffer);
    });

    it.each([
        ['failed status', createWavResponse({ status: 503 }), /503/],
        ['invalid MIME', createWavResponse({ responseType: 'audio/mpeg' }), /Content-Type/],
        ['empty response', createWavResponse({ bytes: new Uint8Array(0) }), /empty/],
        ['invalid missing-MIME payload', createWavResponse({
            responseType: '', blobType: '', bytes: Uint8Array.from([1, 2, 3]),
        }), /valid WAV/],
    ])('rejects %s', async (_case, response, expected) => {
        const source = createPrismaVoiceTtsAudioSource(
            {
                serviceUrl: 'https://tts.test/prisma/speak-live',
                playbackTransport: 'progressive',
                text: 'Voice text',
            },
            vi.fn<typeof fetch>().mockResolvedValue(response),
        );

        await expect(source?.loadWav?.(new AbortController().signal)).rejects.toThrow(expected);
    });

    it('accepts a valid RIFF/WAVE signature when MIME is absent', async () => {
        const source = createPrismaVoiceTtsAudioSource(
            {
                serviceUrl: 'https://tts.test/prisma/speak-live',
                playbackTransport: 'progressive',
                text: 'Voice text',
            },
            vi.fn<typeof fetch>().mockResolvedValue(createWavResponse({ responseType: '', blobType: '' })),
        );

        await expect(source?.loadWav?.(new AbortController().signal)).resolves.toBeInstanceOf(ArrayBuffer);
    });
});
