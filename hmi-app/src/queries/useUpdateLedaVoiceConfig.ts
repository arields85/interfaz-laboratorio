import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { HttpLedaVoiceConfigWriter } from '../adapters/ledaVoiceConfig.adapter';
import { LEDA_VOICE_CONFIG_URL } from '../config/ledaAssistant.config';
import type { LedaVoiceConfig } from '../domain/ledaVoiceConfig';
import { LEDA_VOICE_CONFIG_QUERY_KEY } from './useLedaVoiceConfig';

export function useUpdateLedaVoiceConfig() {
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
        mutationFn: async (config: LedaVoiceConfig) => {
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;
            const generation = generationRef.current + 1;
            generationRef.current = generation;

            try {
                const result = await new HttpLedaVoiceConfigWriter(LEDA_VOICE_CONFIG_URL)
                    .updateConfig(config, controller.signal);
                if (generationRef.current !== generation || controller.signal.aborted) {
                    throw new DOMException('Stale Leda voice config update', 'AbortError');
                }
                return result;
            } finally {
                if (controllerRef.current === controller) {
                    controllerRef.current = null;
                }
            }
        },
        onSuccess: (config) => {
            queryClient.setQueryData(LEDA_VOICE_CONFIG_QUERY_KEY, config);
        },
    });
}
