import { useMutation, useQueryClient } from '@tanstack/react-query';

import { HttpPrismaVoiceConfigWriter } from '../adapters/prismaVoiceConfig.adapter';
import type { PrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import { PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX } from './usePrismaVoiceConfig';

interface UpdatePrismaVoiceConfigVariables {
    url: string;
    config: PrismaVoiceConfig;
}

export function useUpdatePrismaVoiceConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        retry: false,
        mutationFn: ({ url, config }: UpdatePrismaVoiceConfigVariables) => (
            new HttpPrismaVoiceConfigWriter(url).updateConfig(config)
        ),
        onSuccess: (config, { url }) => {
            queryClient.setQueryData(
                [...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, url],
                config,
            );
        },
    });
}
