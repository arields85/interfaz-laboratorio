import type { PrismaRuntimeMode } from '../domain/prismaRuntime.types';

export const PRISMA_LOCAL_VOICE_URL = 'http://127.0.0.1:5057/hmi/voice/latest';
export const PRISMA_LOCAL_SNAPSHOT_URL = 'http://127.0.0.1:5057/hmi/current-snapshot';
export const PRISMA_LOCAL_CONFIG_URL = 'http://127.0.0.1:5057/hmi/prisma-config';
export const PRISMA_LOCAL_TTS_URL = 'http://127.0.0.1:5056/prisma/speak-live';

export type PrismaLocalDestinationKind = 'snapshot' | 'voice-events' | 'config' | 'tts';

const PRISMA_LOCAL_DESTINATIONS: Readonly<Record<PrismaLocalDestinationKind, string>> = {
    snapshot: PRISMA_LOCAL_SNAPSHOT_URL,
    'voice-events': PRISMA_LOCAL_VOICE_URL,
    config: PRISMA_LOCAL_CONFIG_URL,
    tts: PRISMA_LOCAL_TTS_URL,
};

export function assertPrismaLocalDestination(
    kind: PrismaLocalDestinationKind,
    destination: string,
): string {
    const authorizedDestination = PRISMA_LOCAL_DESTINATIONS[kind];
    if (destination !== authorizedDestination) {
        throw new Error(`Unauthorized Prisma Local destination for ${kind}`);
    }

    return authorizedDestination;
}

export function getPrismaLocalDestination(kind: PrismaLocalDestinationKind): string {
    return assertPrismaLocalDestination(kind, PRISMA_LOCAL_DESTINATIONS[kind]);
}

export function resolvePrismaVoiceUrl(
    mode: PrismaRuntimeMode,
    centralUrl: string | null,
): string | null {
    return mode === 'local' ? getPrismaLocalDestination('voice-events') : centralUrl;
}

export function resolvePrismaConfigUrl(
    mode: PrismaRuntimeMode,
    centralUrl: string | null,
): string | null {
    return mode === 'local' ? getPrismaLocalDestination('config') : centralUrl;
}

export function resolvePrismaTtsUrl(
    mode: PrismaRuntimeMode,
    centralUrl: string,
): string {
    return mode === 'local' ? getPrismaLocalDestination('tts') : centralUrl;
}
