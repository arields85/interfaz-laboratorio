import { useEffect, useState } from 'react';

import {
    PRISMA_ORB_CONFIG_CHANGED_EVENT,
    PRISMA_ORB_STORAGE_KEY,
    normalizePrismaOrbVisualConfig,
    readPrismaOrbVisualConfig,
} from '../config/prismaOrb.config';
import type { PrismaOrbVisualConfig } from '../domain/voice.types';
import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

export function usePrismaOrbVisualConfig(): PrismaOrbVisualConfig {
    const [config, setConfig] = useState(readPrismaOrbVisualConfig);

    useEffect(() => {
        const handleConfigChanged = (event: Event) => {
            const changedEvent = event as CustomEvent<unknown>;
            setConfig(normalizePrismaOrbVisualConfig(changedEvent.detail));
        };
        document.addEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, handleConfigChanged);
        // Another browser's change reaches this one through the shared configuration.
        const unsubscribeRemote = sharedConfigStorage.subscribe(({ changedKeys }) => {
            if (changedKeys.includes(PRISMA_ORB_STORAGE_KEY)) {
                setConfig(readPrismaOrbVisualConfig());
            }
        });

        return () => {
            document.removeEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, handleConfigChanged);
            unsubscribeRemote();
        };
    }, []);

    return config;
}
