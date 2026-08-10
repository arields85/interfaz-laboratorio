import { resolvePrismaVoiceTtsServiceUrls } from '../config/prismaVoiceTts.config';
import { normalizeTelegramChatId } from '../domain/voice';
import type { PrismaVoiceAudioSource } from './prismaVoiceAudioEngine';

export interface PrismaVoiceTtsAudioRequest {
    serviceUrl: string;
    text: string;
    eventId?: string;
    telegramChatId?: number;
}

export type PrismaVoiceAudioSourceFactory = (
    request: PrismaVoiceTtsAudioRequest,
) => PrismaVoiceAudioSource | null;

const WAV_CONTENT_TYPES = new Set(['audio/wav', 'audio/x-wav', 'audio/wave']);
const LIVE_AUDIO_FORMAT = 'pcm_s16le';
const LIVE_SAMPLE_RATE = 24_000;
const LIVE_CHANNELS = 1;

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
    const serviceUrls = resolvePrismaVoiceTtsServiceUrls(request.serviceUrl);
    if (!serviceUrls?.liveUrl) {
        return null;
    }

    const source: PrismaVoiceAudioSource = {
        async openLive(signal) {
            const telegramChatId = normalizeTelegramChatId(request.telegramChatId);
            const body = {
                text: request.text,
                ...(request.eventId?.trim() ? { eventId: request.eventId } : {}),
                ...(telegramChatId === undefined ? {} : { telegramChatId }),
            };
            const response = await fetchImpl(serviceUrls.liveUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                cache: 'no-store',
                signal,
            });
            if (!response.ok) {
                throw new Error(`Prisma Live request failed with status ${response.status}`);
            }
            if (response.headers.get('X-Prisma-Audio-Format')?.toLowerCase() !== LIVE_AUDIO_FORMAT) {
                throw new Error('Prisma Live response has invalid audio format');
            }
            if (Number(response.headers.get('X-Prisma-Sample-Rate')) !== LIVE_SAMPLE_RATE) {
                throw new Error('Prisma Live response has invalid sample rate');
            }
            if (Number(response.headers.get('X-Prisma-Channels')) !== LIVE_CHANNELS) {
                throw new Error('Prisma Live response has invalid channels');
            }
            if (!response.body) {
                throw new Error('Prisma Live response has no readable body');
            }

            return {
                reader: response.body.getReader(),
                sampleRate: LIVE_SAMPLE_RATE,
                channels: LIVE_CHANNELS,
            };
        },
    };

    if (serviceUrls.fallbackUrl) {
        source.loadWav = async (signal) => {
            const response = await fetchImpl(serviceUrls.fallbackUrl as string, {
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
        };
    }

    return source;
}
