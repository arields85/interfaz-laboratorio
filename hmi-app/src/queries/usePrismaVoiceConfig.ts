import { useQuery } from '@tanstack/react-query';

import { resolvePrismaConfigUrl } from '../config/prismaAssistant.config';
import { HttpPrismaVoiceConfigReader } from '../adapters/prismaVoiceConfig.adapter';
import { usePrismaRuntimeProfile } from '../hooks/usePrismaRuntimeProfile';

export const PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX = ['prisma', 'voice-config'] as const;

export function usePrismaVoiceConfig(url: string | null) {
    const runtimeProfile = usePrismaRuntimeProfile();
    const effectiveUrl = resolvePrismaConfigUrl(runtimeProfile.mode, url);
    const query = useQuery({
        queryKey: [...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, effectiveUrl],
        queryFn: ({ signal }) => {
            if (!effectiveUrl) {
                throw new Error('Prisma voice config URL is required');
            }
            return new HttpPrismaVoiceConfigReader(effectiveUrl).readConfig(signal);
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
