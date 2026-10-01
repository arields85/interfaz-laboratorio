import { useQuery } from '@tanstack/react-query';

import { HttpLedaVoiceConfigReader } from '../adapters/ledaVoiceConfig.adapter';
import { LEDA_VOICE_CONFIG_URL } from '../config/ledaAssistant.config';

export const LEDA_VOICE_CONFIG_QUERY_KEY = ['leda', 'voice-config', LEDA_VOICE_CONFIG_URL] as const;

export function useLedaVoiceConfig() {
    const query = useQuery({
        queryKey: LEDA_VOICE_CONFIG_QUERY_KEY,
        queryFn: ({ signal }) => new HttpLedaVoiceConfigReader(LEDA_VOICE_CONFIG_URL).readConfig(signal),
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
