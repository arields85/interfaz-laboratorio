import { LOADER_OPTIONS_DEFAULTS, toLoaderDurationMs } from '../config/loaderOptions.config';

export type ShieldProfileId = 'long' | 'short';

export interface ShieldProfile {
    id: ShieldProfileId;
    message: string;
    minVisibleMs: number;
    typingDurationMs: number;
    typingDelayMs: number;
    caretBlinkDelayMs: number;
    shellWidthCh: number;
}

export const SHIELD_PROFILES: Record<ShieldProfileId, ShieldProfile> = {
    long: {
        id: 'long',
        message: 'ACTUALIZANDO DATOS',
        minVisibleMs: toLoaderDurationMs(LOADER_OPTIONS_DEFAULTS.long.durationSeconds),
        typingDurationMs: 800,
        typingDelayMs: 300,
        caretBlinkDelayMs: 1100,
        shellWidthCh: 18,
    },
    short: {
        id: 'short',
        message: 'CARGANDO',
        minVisibleMs: toLoaderDurationMs(LOADER_OPTIONS_DEFAULTS.short.durationSeconds),
        typingDurationMs: 180,
        typingDelayMs: 80,
        caretBlinkDelayMs: 260,
        shellWidthCh: 8,
    },
};

export const DEFAULT_PROFILE: ShieldProfileId = 'long';
