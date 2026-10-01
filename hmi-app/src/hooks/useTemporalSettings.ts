import { useEffect, useMemo, useState } from 'react';

import {
    TEMPORAL_SETTINGS_CHANGED_EVENT,
    TEMPORAL_SETTINGS_STORAGE_KEY,
    normalizeTemporalSettingsConfig,
    readTemporalSettingsConfig,
    resolveTemporalSettingsTimezone,
} from '../config/temporalSettings.config';
import type { TemporalSettingsConfig } from '../domain/admin.types';
import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

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

        document.addEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, handleTemporalSettingsChanged);
        // Another browser's change reaches this one through the shared configuration.
        const unsubscribeRemote = sharedConfigStorage.subscribe(({ changedKeys }) => {
            if (changedKeys.includes(TEMPORAL_SETTINGS_STORAGE_KEY)) {
                setConfig(readTemporalSettingsConfig());
            }
        });

        return () => {
            document.removeEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, handleTemporalSettingsChanged);
            unsubscribeRemote();
        };
    }, []);

    const resolvedTimezone = useMemo(() => resolveTemporalSettingsTimezone(config), [config]);

    return {
        config,
        shifts: config.shifts,
        resolvedTimezone,
    };
}
