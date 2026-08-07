import { normalizePrismaVoiceTtsServiceUrl } from '../config/prismaVoiceTts.config';
import type { PrismaVoiceAudioSource } from './prismaVoiceAudioEngine';

export interface PrismaVoiceTtsAudioRequest {
    serviceUrl: string;
    text: string;
}

export type PrismaVoiceAudioSourceFactory = (
    request: PrismaVoiceTtsAudioRequest,
) => PrismaVoiceAudioSource | null;

const WAV_CONTENT_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);

function normalizeContentType(value: string | null): string {
    return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function hasWavSignature(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength < 12) {
        return false;
    }

    const bytes = new Uint8Array(buffer);
    return bytes[0] === 0x52
        && bytes[1] === 0x49
        && bytes[2] === 0x46
        && bytes[3] === 0x46
        && bytes[8] === 0x57
        && bytes[9] === 0x41
        && bytes[10] === 0x56
        && bytes[11] === 0x45;
}

export function createPrismaVoiceTtsAudioSource(
    request: PrismaVoiceTtsAudioRequest,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
): PrismaVoiceAudioSource | null {
    const serviceUrl = normalizePrismaVoiceTtsServiceUrl(request.serviceUrl);
    if (!serviceUrl) {
        return null;
    }

    return {
        async load(signal) {
            const response = await fetchImpl(serviceUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: request.text }),
                cache: 'no-store',
                signal,
            });
            if (!response.ok) {
                throw new Error(`Prisma voice TTS request failed with status ${response.status}`);
            }

            const responseContentType = normalizeContentType(response.headers.get('Content-Type'));
            if (responseContentType !== '' && !WAV_CONTENT_TYPES.has(responseContentType)) {
                throw new Error(`Prisma voice TTS response has invalid Content-Type: ${responseContentType}`);
            }

            const audioBlob = await response.blob();
            if (audioBlob.size === 0) {
                throw new Error('Prisma voice TTS response is empty');
            }

            const blobContentType = normalizeContentType(audioBlob.type);
            if (responseContentType === '' && blobContentType !== '' && !WAV_CONTENT_TYPES.has(blobContentType)) {
                throw new Error(`Prisma voice TTS Blob has invalid Content-Type: ${blobContentType}`);
            }

            const encodedAudio = await audioBlob.arrayBuffer();
            if (encodedAudio.byteLength === 0) {
                throw new Error('Prisma voice TTS response is empty');
            }
            if (responseContentType === '' && !hasWavSignature(encodedAudio)) {
                throw new Error('Prisma voice TTS response without Content-Type is not a valid WAV Blob');
            }

            return encodedAudio;
        },
    };
}
