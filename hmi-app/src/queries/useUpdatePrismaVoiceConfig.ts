import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { HttpPrismaVoiceConfigWriter } from '../adapters/prismaVoiceConfig.adapter';
import { resolvePrismaConfigUrl } from '../config/prismaAssistant.config';
import type { PrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import { usePrismaRuntimeProfile } from '../hooks/usePrismaRuntimeProfile';
import { PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX } from './usePrismaVoiceConfig';

interface UpdatePrismaVoiceConfigVariables {
    url: string;
    config: PrismaVoiceConfig;
}

export function useUpdatePrismaVoiceConfig() {
    const queryClient = useQueryClient();
    const runtimeProfile = usePrismaRuntimeProfile();
    const generationRef = useRef(0);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => () => {
        generationRef.current += 1;
        controllerRef.current?.abort();
        controllerRef.current = null;
    }, [runtimeProfile.revision]);

    return useMutation({
        retry: false,
        mutationFn: async ({ url, config }: UpdatePrismaVoiceConfigVariables) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            const generation = generationRef.current + 1;
            generationRef.current = generation;
            const effectiveUrl = resolvePrismaConfigUrl(runtimeProfile.mode, url);
            if (!effectiveUrl) {
                throw new Error('Prisma voice config URL is required');
            }

            try {
                const result = await new HttpPrismaVoiceConfigWriter(effectiveUrl)
                    .updateConfig(config, controller.signal);
                if (generationRef.current !== generation || controller.signal.aborted) {
                    throw new DOMException('Stale Prisma voice config update', 'AbortError');
                }
                return result;
            } finally {
                if (controllerRef.current === controller) {
                    controllerRef.current = null;
                }
            }
        },
        onSuccess: (config, { url }) => {
            const effectiveUrl = resolvePrismaConfigUrl(runtimeProfile.mode, url);
            if (!effectiveUrl) return;
            queryClient.setQueryData(
                [...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, effectiveUrl],
                config,
            );
        },
    });
}
