import { describe, expect, it, vi } from 'vitest';

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

describe('createPrismaVoiceTtsAudioSource', () => {
    it('posts exact text and returns the complete WAV ArrayBuffer without a cache key', async () => {
        const response = createWavResponse({ responseType: 'audio/wav; charset=binary' });
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
        const signal = new AbortController().signal;
        const source = createPrismaVoiceTtsAudioSource({
            serviceUrl: 'https://tts.test/prisma/speak',
            text: 'Respuesta real de Leda',
        }, fetchMock);

        const encoded = await source?.load(signal);

        expect(fetchMock).toHaveBeenCalledWith('https://tts.test/prisma/speak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: 'Respuesta real de Leda' }),
            cache: 'no-store',
            signal,
        });
        expect(new Uint8Array(encoded ?? new ArrayBuffer(0))).toEqual(WAV_HEADER);
        expect(source?.cacheKey).toBeUndefined();
        expect(response.blob).toHaveBeenCalledTimes(1);
    });

    it.each(['audio/wav', 'audio/x-wav', 'audio/wave'])('accepts supported WAV MIME %s', async (type) => {
        const source = createPrismaVoiceTtsAudioSource(
            { serviceUrl: 'https://tts.test/prisma/speak', text: 'Voice text' },
            vi.fn<typeof fetch>().mockResolvedValue(createWavResponse({ responseType: type })),
        );

        await expect(source?.load(new AbortController().signal)).resolves.toBeInstanceOf(ArrayBuffer);
    });

    it('returns null for empty or invalid service URLs without fetching', () => {
        const fetchMock = vi.fn<typeof fetch>();

        expect(createPrismaVoiceTtsAudioSource({
            serviceUrl: '   ', text: 'Disabled',
        }, fetchMock)).toBeNull();
        expect(createPrismaVoiceTtsAudioSource({
            serviceUrl: '/relative', text: 'Invalid',
        }, fetchMock)).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
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
            { serviceUrl: 'https://tts.test/prisma/speak', text: 'Voice text' },
            vi.fn<typeof fetch>().mockResolvedValue(response),
        );

        await expect(source?.load(new AbortController().signal)).rejects.toThrow(expected);
    });

    it('accepts a valid RIFF/WAVE signature when MIME is absent', async () => {
        const source = createPrismaVoiceTtsAudioSource(
            { serviceUrl: 'https://tts.test/prisma/speak', text: 'Voice text' },
            vi.fn<typeof fetch>().mockResolvedValue(createWavResponse({ responseType: '', blobType: '' })),
        );

        await expect(source?.load(new AbortController().signal)).resolves.toBeInstanceOf(ArrayBuffer);
    });
});
