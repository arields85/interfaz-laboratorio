import { useQuery } from '@tanstack/react-query';

import { HttpPrismaVoiceConfigReader } from '../adapters/prismaVoiceConfig.adapter';
import { PRISMA_VOICE_CONFIG_URL } from '../config/prismaAssistant.config';

export const PRISMA_VOICE_CONFIG_QUERY_KEY = ['prisma', 'voice-config', PRISMA_VOICE_CONFIG_URL] as const;

export function usePrismaVoiceConfig() {
    const query = useQuery({
        queryKey: PRISMA_VOICE_CONFIG_QUERY_KEY,
        queryFn: ({ signal }) => new HttpPrismaVoiceConfigReader(PRISMA_VOICE_CONFIG_URL).readConfig(signal),
        retry: false,
        refetchOnWindowFocus: false,
    });

    return {
        data: query.data ?? null,
        error: query.error,
        isEnabled: true,
        isLoading: query.isLoading,
    };
}
