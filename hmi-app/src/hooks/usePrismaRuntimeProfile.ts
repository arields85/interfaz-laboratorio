import { useEffect, useState } from 'react';

import {
    PRISMA_RUNTIME_MODE_CHANGED_EVENT,
    PRISMA_RUNTIME_MODE_STORAGE_KEY,
    getPrismaRuntimeProfile,
} from '../config/prismaRuntime.config';
import type { PrismaRuntimeProfile } from '../domain/prismaRuntime.types';
export function usePrismaRuntimeProfile(search?: string): PrismaRuntimeProfile {
    const [profile, setProfile] = useState(() => getPrismaRuntimeProfile(search));

    useEffect(() => {
        const refreshProfile = () => {
            setProfile(getPrismaRuntimeProfile(search));
        };
        const handleRuntimeModeChanged = (event: Event) => {
            const detail = (event as CustomEvent<PrismaRuntimeProfile>).detail;
            setProfile(detail ?? getPrismaRuntimeProfile(search));
        };
        const handleStorage = (event: StorageEvent) => {
            if (event.key !== null && event.key !== PRISMA_RUNTIME_MODE_STORAGE_KEY) {
                return;
            }

            refreshProfile();
        };

        window.addEventListener(PRISMA_RUNTIME_MODE_CHANGED_EVENT, handleRuntimeModeChanged);
        window.addEventListener('storage', handleStorage);
        window.addEventListener('popstate', refreshProfile);
        refreshProfile();

        return () => {
            window.removeEventListener(PRISMA_RUNTIME_MODE_CHANGED_EVENT, handleRuntimeModeChanged);
            window.removeEventListener('storage', handleStorage);
            window.removeEventListener('popstate', refreshProfile);
        };
    }, [search]);

    return profile;
}
