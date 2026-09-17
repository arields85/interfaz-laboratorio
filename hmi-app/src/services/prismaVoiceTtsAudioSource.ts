import { PRISMA_TTS_LIVE_URL } from '../config/prismaAssistant.config';
import { normalizeTelegramChatId } from '../domain/voice';
import type { PrismaVoiceAudioSource } from './prismaVoiceAudioEngine';
import { PRISMA_PCM_AUDIO_FORMAT } from './prismaPcmAudioFormat';

export interface PrismaVoiceTtsAudioRequest {
    text: string;
    eventId?: string;
    telegramChatId?: number;
}

export type PrismaVoiceAudioSourceFactory = (
    request: PrismaVoiceTtsAudioRequest,
) => PrismaVoiceAudioSource;

const LIVE_AUDIO_FORMAT = PRISMA_PCM_AUDIO_FORMAT.encoding;
const LIVE_SAMPLE_RATE = PRISMA_PCM_AUDIO_FORMAT.sampleRate;
const LIVE_CHANNELS = PRISMA_PCM_AUDIO_FORMAT.channels;

export function createPrismaVoiceTtsAudioSource(
    request: PrismaVoiceTtsAudioRequest,
    fetchImpl: typeof fetch = (...args) => fetch(...args),
): PrismaVoiceAudioSource {
    return {
        playbackTransport: 'progressive',
        async openLive(signal) {
            const telegramChatId = normalizeTelegramChatId(request.telegramChatId);
            const body = {
                text: request.text,
                ...(request.eventId?.trim() ? { eventId: request.eventId } : {}),
                ...(telegramChatId === undefined ? {} : { telegramChatId }),
            };
            const response = await fetchImpl(PRISMA_TTS_LIVE_URL, {
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
}
