import { useEffect, useMemo, useState } from 'react';

import {
    TEMPORAL_SETTINGS_CHANGED_EVENT,
    TEMPORAL_SETTINGS_STORAGE_KEY,
    normalizeTemporalSettingsConfig,
    readTemporalSettingsConfig,
    resolveTemporalSettingsTimezone,
} from '../config/temporalSettings.config';
import type { TemporalSettingsConfig } from '../domain/admin.types';

export interface UseTemporalSettingsResult {
    config: TemporalSettingsConfig;
    shifts: TemporalSettingsConfig['shifts'];
    resolvedTimezone: string;
}

export function useTemporalSettings(): UseTemporalSettingsResult {
    const [config, setConfig] = useState<TemporalSettingsConfig>(() => readTemporalSettingsConfig());

    useEffect(() => {
        const handleTemporalSettingsChanged = (event: Event) => {
            const detail = (event as CustomEvent<TemporalSettingsConfig>).detail;
            setConfig(detail ? normalizeTemporalSettingsConfig(detail) : readTemporalSettingsConfig());
        };

        const handleStorage = (event: StorageEvent) => {
            if (event.key !== null && event.key !== TEMPORAL_SETTINGS_STORAGE_KEY) {
                return;
            }

            setConfig(readTemporalSettingsConfig());
        };

        document.addEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, handleTemporalSettingsChanged);
        window.addEventListener('storage', handleStorage);

        return () => {
            document.removeEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, handleTemporalSettingsChanged);
            window.removeEventListener('storage', handleStorage);
        };
    }, []);

    const resolvedTimezone = useMemo(() => resolveTemporalSettingsTimezone(config), [config]);

    return {
        config,
        shifts: config.shifts,
        resolvedTimezone,
    };
}
