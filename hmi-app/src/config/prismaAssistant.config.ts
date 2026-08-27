import type { PrismaRuntimeMode } from '../domain/prismaRuntime.types';

export const PRISMA_LOCAL_VOICE_URL = 'http://127.0.0.1:5057/hmi/voice/latest';
export const PRISMA_LOCAL_CONFIG_URL = 'http://127.0.0.1:5057/hmi/prisma-config';
export const PRISMA_LOCAL_TTS_URL = 'http://127.0.0.1:5056/prisma/speak-live';

export function resolvePrismaVoiceUrl(
    mode: PrismaRuntimeMode,
    centralUrl: string | null,
): string | null {
    return mode === 'local' ? PRISMA_LOCAL_VOICE_URL : centralUrl;
}

export function resolvePrismaConfigUrl(
    mode: PrismaRuntimeMode,
    centralUrl: string | null,
): string | null {
    return mode === 'local' ? PRISMA_LOCAL_CONFIG_URL : centralUrl;
}

export function resolvePrismaTtsUrl(
    mode: PrismaRuntimeMode,
    centralUrl: string,
): string {
    return mode === 'local' ? PRISMA_LOCAL_TTS_URL : centralUrl;
}
