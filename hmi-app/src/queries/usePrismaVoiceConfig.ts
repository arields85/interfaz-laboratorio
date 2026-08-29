import { useQuery } from '@tanstack/react-query';

import { resolvePrismaConfigUrl } from '../config/prismaAssistant.config';
import {
    HttpPrismaVoiceConfigReader,
    type PrismaVoiceConfigResponseContract,
} from '../adapters/prismaVoiceConfig.adapter';
import type { PrismaRuntimeMode } from '../domain/prismaRuntime.types';
import { usePrismaRuntimeProfile } from '../hooks/usePrismaRuntimeProfile';

export const PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX = ['prisma', 'voice-config'] as const;

export function createPrismaVoiceConfigQueryKey(
    runtimeMode: PrismaRuntimeMode,
    effectiveUrl: string | null,
    responseContract: PrismaVoiceConfigResponseContract,
) {
    return [
        ...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX,
        runtimeMode,
        effectiveUrl,
        responseContract,
    ] as const;
}

export function usePrismaVoiceConfig(url: string | null) {
    const runtimeProfile = usePrismaRuntimeProfile();
    const effectiveUrl = resolvePrismaConfigUrl(runtimeProfile.mode, url);
    const responseContract = runtimeProfile.mode === 'local' ? 'local-envelope' : 'legacy-flat';
    const query = useQuery({
        queryKey: createPrismaVoiceConfigQueryKey(
            runtimeProfile.mode,
            effectiveUrl,
            responseContract,
        ),
        queryFn: ({ signal }) => {
            if (!effectiveUrl) {
                throw new Error('Prisma voice config URL is required');
            }
            return new HttpPrismaVoiceConfigReader(effectiveUrl, responseContract).readConfig(signal);
        },
        enabled: effectiveUrl !== null,
        retry: false,
        refetchOnWindowFocus: false,
    });

    return {
        data: query.data ?? null,
        error: effectiveUrl === null ? null : query.error,
        isEnabled: effectiveUrl !== null,
        isLoading: effectiveUrl !== null && query.isLoading,
    };
}
