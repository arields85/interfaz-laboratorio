import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { HttpPrismaVoiceConfigWriter } from '../adapters/prismaVoiceConfig.adapter';
import { PRISMA_VOICE_CONFIG_URL } from '../config/prismaAssistant.config';
import type { PrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import { PRISMA_VOICE_CONFIG_QUERY_KEY } from './usePrismaVoiceConfig';

export function useUpdatePrismaVoiceConfig() {
    const queryClient = useQueryClient();
    const generationRef = useRef(0);
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => () => {
        generationRef.current += 1;
        controllerRef.current?.abort();
        controllerRef.current = null;
    }, []);

    return useMutation({
        retry: false,
        mutationFn: async (config: PrismaVoiceConfig) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            const generation = generationRef.current + 1;
            generationRef.current = generation;

            try {
                const result = await new HttpPrismaVoiceConfigWriter(PRISMA_VOICE_CONFIG_URL)
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
        onSuccess: (config) => {
            queryClient.setQueryData(PRISMA_VOICE_CONFIG_QUERY_KEY, config);
        },
    });
}
