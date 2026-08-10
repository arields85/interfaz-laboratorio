import { useQuery } from '@tanstack/react-query';

import { HttpPrismaVoiceConfigReader } from '../adapters/prismaVoiceConfig.adapter';

export const PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX = ['prisma', 'voice-config'] as const;

export function usePrismaVoiceConfig(url: string | null) {
    const query = useQuery({
        queryKey: [...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, url],
        queryFn: ({ signal }) => {
            if (!url) {
                throw new Error('Prisma voice config URL is required');
            }
            return new HttpPrismaVoiceConfigReader(url).readConfig(signal);
        },
        enabled: url !== null,
        retry: false,
        refetchOnWindowFocus: false,
    });

    return {
        data: query.data ?? null,
        error: url === null ? null : query.error,
        isEnabled: url !== null,
        isLoading: url !== null && query.isLoading,
    };
}
