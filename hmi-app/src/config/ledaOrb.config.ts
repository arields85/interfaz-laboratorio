import type { LedaOrbVisualConfig } from '../domain/voice.types';
import { sharedConfigStorage } from '../services/sharedConfigStorage.service';

export const LEDA_ORB_STORAGE_KEY = 'hmi:leda-orb-visual-config';
export const LEDA_ORB_CONFIG_CHANGED_EVENT = 'hmi:leda-orb-config-changed';

export const LEDA_ORB_VISUAL_LIMITS = {
    rays: { min: 0, max: 1, step: 0.01 },
    speed: { min: 0.3, max: 2, step: 0.05 },
    intensity: { min: 0.4, max: 2, step: 0.05 },
    size: { min: 160, max: 1200, step: 20 },
} as const;

export const LEDA_ORB_CORE_OPTIONS = ['#1b6ee0', '#1240c8', '#0f8fb8', '#3355ff'] as const;
export const LEDA_ORB_GLOW_OPTIONS = ['#8ff0ff', '#bfe9ff', '#5fd2ff', '#dff6ff'] as const;

export const LEDA_ORB_VISUAL_DEFAULTS: Readonly<LedaOrbVisualConfig> = {
    rays: 0.45,
    speed: 1.85,
    intensity: 0.8,
    size: 290,
    core: '#1b6ee0',
    glow: '#8ff0ff',
};

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

export function getDefaultLedaOrbVisualConfig(): LedaOrbVisualConfig {
    return { ...LEDA_ORB_VISUAL_DEFAULTS };
}

function normalizeNumber(
    value: unknown,
    fallback: number,
    limits: { min: number; max: number; step: number },
): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }

    // The approved 290px HMI default intentionally sits between 20px steps.
    if (value === fallback) {
        return fallback;
    }

    const clamped = Math.min(limits.max, Math.max(limits.min, value));
    const precision = limits.step.toString().split('.')[1]?.length ?? 0;
    const stepped = limits.min + Math.round((clamped - limits.min) / limits.step) * limits.step;

    return Number(Math.min(limits.max, Math.max(limits.min, stepped)).toFixed(precision));
}

function normalizeColor(value: unknown, fallback: string): string {
    if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value.trim())) {
        return fallback;
    }

    return value.trim().toLowerCase();
}

export function normalizeLedaOrbVisualConfig(value: unknown): LedaOrbVisualConfig {
    const candidate = typeof value === 'object' && value !== null
        ? value as Partial<Record<keyof LedaOrbVisualConfig, unknown>>
        : {};

    return {
        rays: normalizeNumber(candidate.rays, LEDA_ORB_VISUAL_DEFAULTS.rays, LEDA_ORB_VISUAL_LIMITS.rays),
        speed: normalizeNumber(candidate.speed, LEDA_ORB_VISUAL_DEFAULTS.speed, LEDA_ORB_VISUAL_LIMITS.speed),
        intensity: normalizeNumber(candidate.intensity, LEDA_ORB_VISUAL_DEFAULTS.intensity, LEDA_ORB_VISUAL_LIMITS.intensity),
        size: normalizeNumber(candidate.size, LEDA_ORB_VISUAL_DEFAULTS.size, LEDA_ORB_VISUAL_LIMITS.size),
        core: normalizeColor(candidate.core, LEDA_ORB_VISUAL_DEFAULTS.core),
        glow: normalizeColor(candidate.glow, LEDA_ORB_VISUAL_DEFAULTS.glow),
    };
}

export function readLedaOrbVisualConfig(): LedaOrbVisualConfig {
    try {
        const stored = sharedConfigStorage.getItem(LEDA_ORB_STORAGE_KEY);
        return stored === null
            ? getDefaultLedaOrbVisualConfig()
            : normalizeLedaOrbVisualConfig(JSON.parse(stored));
    } catch {
        return getDefaultLedaOrbVisualConfig();
    }
}

export function saveLedaOrbVisualConfig(config: LedaOrbVisualConfig): LedaOrbVisualConfig {
    const normalized = normalizeLedaOrbVisualConfig(config);
    sharedConfigStorage.setItem(LEDA_ORB_STORAGE_KEY, JSON.stringify(normalized));
    document.dispatchEvent(new CustomEvent<LedaOrbVisualConfig>(LEDA_ORB_CONFIG_CHANGED_EVENT, {
        detail: normalized,
    }));

    return normalized;
}
