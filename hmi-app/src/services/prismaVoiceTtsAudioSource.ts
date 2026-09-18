import { PRISMA_TTS_LIVE_URL } from '../config/prismaAssistant.config';
import type { PrismaVoiceAudioSource } from './prismaVoiceAudioEngine';
import { PRISMA_PCM_AUDIO_FORMAT } from './prismaPcmAudioFormat';
import { prismaSessionClient } from './prismaSessionClient';

export interface PrismaVoiceTtsAudioRequest {
    eventId: string;
}

export type PrismaVoiceAudioSourceFactory = (
    request: PrismaVoiceTtsAudioRequest,
) => PrismaVoiceAudioSource;

const LIVE_AUDIO_FORMAT = PRISMA_PCM_AUDIO_FORMAT.encoding;
const LIVE_SAMPLE_RATE = PRISMA_PCM_AUDIO_FORMAT.sampleRate;
const LIVE_CHANNELS = PRISMA_PCM_AUDIO_FORMAT.channels;

export function createPrismaVoiceTtsAudioSource(
    request: PrismaVoiceTtsAudioRequest,
    fetchImpl?: typeof fetch,
): PrismaVoiceAudioSource {
    return {
        playbackTransport: 'progressive',
        async openLive(signal) {
            const eventId = request.eventId.trim();
            if (!eventId) {
                throw new Error('Prisma voice event ID is required');
            }
            const response = await (fetchImpl ?? prismaSessionClient.fetch.bind(prismaSessionClient))(PRISMA_TTS_LIVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ eventId }),
                cache: 'no-store',
                signal,
            });
            if (!response.ok) {
                throw new Error(`Prisma Live request failed with status ${response.status}`);
            }
            if (fetchImpl === undefined && !prismaSessionClient.isCurrentResponse(response)) {
                throw new Error('Prisma Live response belongs to a stale session');
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
