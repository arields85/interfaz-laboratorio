import { useEffect, useState } from 'react';

import {
    LEDA_ORB_CONFIG_CHANGED_EVENT,
    LEDA_ORB_STORAGE_KEY,
    normalizeLedaOrbVisualConfig,
    readLedaOrbVisualConfig,
} from '../config/ledaOrb.config';
import type { LedaOrbVisualConfig } from '../domain/voice.types';
import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

export function useLedaOrbVisualConfig(): LedaOrbVisualConfig {
    const [config, setConfig] = useState(readLedaOrbVisualConfig);

    useEffect(() => {
        const handleConfigChanged = (event: Event) => {
            const changedEvent = event as CustomEvent<unknown>;
            setConfig(normalizeLedaOrbVisualConfig(changedEvent.detail));
        };
        document.addEventListener(LEDA_ORB_CONFIG_CHANGED_EVENT, handleConfigChanged);
        // Another browser's change reaches this one through the shared configuration.
        const unsubscribeRemote = sharedConfigStorage.subscribe(({ changedKeys }) => {
            if (changedKeys.includes(LEDA_ORB_STORAGE_KEY)) {
                setConfig(readLedaOrbVisualConfig());
            }
        });

        return () => {
            document.removeEventListener(LEDA_ORB_CONFIG_CHANGED_EVENT, handleConfigChanged);
            unsubscribeRemote();
        };
    }, []);

    return config;
}
