import { useEffect, useState } from 'react';

import {
    PRISMA_ORB_CONFIG_CHANGED_EVENT,
    PRISMA_ORB_STORAGE_KEY,
    getDefaultPrismaOrbVisualConfig,
    normalizePrismaOrbVisualConfig,
    readPrismaOrbVisualConfig,
} from '../config/prismaOrb.config';
import type { PrismaOrbVisualConfig } from '../domain/voice.types';

function parseStoredConfig(value: string | null): PrismaOrbVisualConfig {
    if (value === null) {
        return getDefaultPrismaOrbVisualConfig();
    }

    try {
        return normalizePrismaOrbVisualConfig(JSON.parse(value));
    } catch {
        return getDefaultPrismaOrbVisualConfig();
    }
}

export function usePrismaOrbVisualConfig(): PrismaOrbVisualConfig {
    const [config, setConfig] = useState(readPrismaOrbVisualConfig);

    useEffect(() => {
        const handleConfigChanged = (event: Event) => {
            const changedEvent = event as CustomEvent<unknown>;
            setConfig(normalizePrismaOrbVisualConfig(changedEvent.detail));
        };
        const handleStorage = (event: StorageEvent) => {
            if (event.key !== null && event.key !== PRISMA_ORB_STORAGE_KEY) {
                return;
            }

            setConfig(parseStoredConfig(event.newValue));
        };

        document.addEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, handleConfigChanged);
        window.addEventListener('storage', handleStorage);

        return () => {
            document.removeEventListener(PRISMA_ORB_CONFIG_CHANGED_EVENT, handleConfigChanged);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    return config;
}
