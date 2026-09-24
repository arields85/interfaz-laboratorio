export type PrismaVoicePreset = 'clean' | 'robotic_medium_light';

export interface PrismaRoboticVoiceConfig {
    modulationHz: number;
    baseGain: number;
    modulationDepth: number;
    quantizationSteps: number;
    metallicHz: number;
    metallicMix: number;
    echo1DelayMs: number;
    echo1Gain: number;
    echo2DelayMs: number;
    echo2Gain: number;
    normalizationTarget: number;
    normalizationMaxGain: number;
}

export type PrismaVoicePlaybackBufferMode = 'automatic' | 'manual';

export interface PrismaVoicePlaybackBufferConfig {
    mode: PrismaVoicePlaybackBufferMode;
    manualSeconds: number;
}

export interface PrismaVoiceConfig {
    effectEnabled: boolean;
    preset: PrismaVoicePreset;
    effectIntensity: number;
    robotic: PrismaRoboticVoiceConfig;
    playbackBuffer: PrismaVoicePlaybackBufferConfig;
}

// T4 design decision (2026-09-24, user-approved 2026-09-24): manual buffer
// range 0.1-3.0 s in 0.1 s steps, default 0.2 s (the T22 proven baseline).
// Kept as named constants (not re-derived from the defaults below) so T5's
// UI control and the runtime's mirrored bounds have one documented source
// each to point back to.
export const PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN = 0.1;
export const PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX = 3.0;
export const PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP = 0.1;

// Floating-point tolerance for the 0.1 s grid check below (e.g. 0.1 + 0.2 in
// IEEE754 is 0.30000000000000004): comparing against this epsilon instead of
// exact equality accepts every intended step while still rejecting a value
// like 0.25 that is genuinely off the grid.
const PRISMA_VOICE_PLAYBACK_BUFFER_GRID_EPSILON = 1e-6;
const PRISMA_VOICE_PLAYBACK_BUFFER_BOUNDS_EPSILON = 1e-9;

function isPrismaVoicePlaybackBufferManualSecondsValid(value: number): boolean {
    if (value < PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN - PRISMA_VOICE_PLAYBACK_BUFFER_BOUNDS_EPSILON) {
        return false;
    }
    if (value > PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX + PRISMA_VOICE_PLAYBACK_BUFFER_BOUNDS_EPSILON) {
        return false;
    }

    const steps = value / PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP;
    return Math.abs(steps - Math.round(steps)) < PRISMA_VOICE_PLAYBACK_BUFFER_GRID_EPSILON;
}

export interface PrismaVoiceConfigValidationIssue {
    path: string;
    message: string;
}

export type PrismaVoiceConfigValidationResult =
    | { valid: true; value: PrismaVoiceConfig }
    | { valid: false; issues: PrismaVoiceConfigValidationIssue[] };

export const PRISMA_VOICE_CONFIG_DEFAULTS = Object.freeze({
    effectEnabled: true,
    preset: 'robotic_medium_light',
    effectIntensity: 100,
    robotic: Object.freeze({
        modulationHz: 30,
        baseGain: 0.78,
        modulationDepth: 0.22,
        quantizationSteps: 260,
        metallicHz: 410,
        metallicMix: 0.04,
        echo1DelayMs: 40,
        echo1Gain: 0.22,
        echo2DelayMs: 95,
        echo2Gain: 0.10,
        normalizationTarget: 29_500,
        normalizationMaxGain: 1.6,
    }),
    playbackBuffer: Object.freeze({
        mode: 'automatic',
        manualSeconds: 0.2,
    }),
} as const satisfies Readonly<PrismaVoiceConfig>);

export function clonePrismaVoiceConfig(config: PrismaVoiceConfig): PrismaVoiceConfig {
    return {
        ...config,
        robotic: { ...config.robotic },
        playbackBuffer: { ...config.playbackBuffer },
    };
}

export function arePrismaVoiceConfigsEqual(
    left: PrismaVoiceConfig,
    right: PrismaVoiceConfig,
): boolean {
    return left.effectEnabled === right.effectEnabled
        && left.preset === right.preset
        && left.effectIntensity === right.effectIntensity
        && left.robotic.modulationHz === right.robotic.modulationHz
        && left.robotic.baseGain === right.robotic.baseGain
        && left.robotic.modulationDepth === right.robotic.modulationDepth
        && left.robotic.quantizationSteps === right.robotic.quantizationSteps
        && left.robotic.metallicHz === right.robotic.metallicHz
        && left.robotic.metallicMix === right.robotic.metallicMix
        && left.robotic.echo1DelayMs === right.robotic.echo1DelayMs
        && left.robotic.echo1Gain === right.robotic.echo1Gain
        && left.robotic.echo2DelayMs === right.robotic.echo2DelayMs
        && left.robotic.echo2Gain === right.robotic.echo2Gain
        && left.robotic.normalizationTarget === right.robotic.normalizationTarget
        && left.robotic.normalizationMaxGain === right.robotic.normalizationMaxGain
        && left.playbackBuffer.mode === right.playbackBuffer.mode
        && left.playbackBuffer.manualSeconds === right.playbackBuffer.manualSeconds;
}

export function createDefaultPrismaVoiceConfig(): PrismaVoiceConfig {
    return {
        ...PRISMA_VOICE_CONFIG_DEFAULTS,
        robotic: { ...PRISMA_VOICE_CONFIG_DEFAULTS.robotic },
        playbackBuffer: { ...PRISMA_VOICE_CONFIG_DEFAULTS.playbackBuffer },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addFiniteNumberIssue(
    issues: PrismaVoiceConfigValidationIssue[],
    record: Record<string, unknown>,
    key: string,
    path: string,
): number | undefined {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ path, message: `${path} must be a finite number.` });
        return undefined;
    }

    return value;
}

export function validatePrismaVoiceConfig(value: unknown): PrismaVoiceConfigValidationResult {
    if (!isRecord(value)) {
        return { valid: false, issues: [{ path: '$', message: 'Prisma voice config must be an object.' }] };
    }

    const requiredTopLevelKeys = ['effectEnabled', 'preset', 'effectIntensity', 'robotic'];
    if (requiredTopLevelKeys.some((key) => !(key in value))) {
        return { valid: false, issues: [{ path: '$', message: 'Prisma voice config is incomplete.' }] };
    }

    const issues: PrismaVoiceConfigValidationIssue[] = [];

    if (typeof value.effectEnabled !== 'boolean') {
        issues.push({ path: 'effectEnabled', message: 'effectEnabled must be a boolean.' });
    }
    if (value.preset !== 'clean' && value.preset !== 'robotic_medium_light') {
        issues.push({ path: 'preset', message: 'preset is not supported.' });
    }

    const effectIntensity = addFiniteNumberIssue(issues, value, 'effectIntensity', 'effectIntensity');
    if (effectIntensity !== undefined && (effectIntensity < 0 || effectIntensity > 100)) {
        issues.push({ path: 'effectIntensity', message: 'effectIntensity must be between 0 and 100.' });
    }

    if (!isRecord(value.robotic)) {
        issues.push({ path: 'robotic', message: 'robotic must be an object.' });
    } else {
        const robotic = value.robotic;
        const requiredRoboticKeys: Array<keyof PrismaRoboticVoiceConfig> = [
            'modulationHz',
            'baseGain',
            'modulationDepth',
            'quantizationSteps',
            'metallicHz',
            'metallicMix',
            'echo1DelayMs',
            'echo1Gain',
            'echo2DelayMs',
            'echo2Gain',
            'normalizationTarget',
            'normalizationMaxGain',
        ];

        if (requiredRoboticKeys.some((key) => !(key in robotic))) {
            issues.push({ path: 'robotic', message: 'robotic config is incomplete.' });
        }

        for (const key of requiredRoboticKeys) {
            const path = `robotic.${key}`;
            const numericValue = addFiniteNumberIssue(issues, robotic, key, path);
            if (numericValue === undefined) {
                continue;
            }

            if (key === 'quantizationSteps') {
                if (!Number.isInteger(numericValue) || numericValue <= 0) {
                    issues.push({ path, message: `${path} must be a positive integer.` });
                }
                continue;
            }

            const requiresPositiveValue = key === 'modulationHz'
                || key === 'metallicHz'
                || key === 'echo1DelayMs'
                || key === 'echo2DelayMs'
                || key === 'normalizationTarget'
                || key === 'normalizationMaxGain';

            if (requiresPositiveValue ? numericValue <= 0 : numericValue < 0) {
                issues.push({
                    path,
                    message: `${path} must be ${requiresPositiveValue ? 'positive' : 'non-negative'}.`,
                });
            }
        }
    }

    // T4 backward compatibility: a config persisted before this field existed
    // has no `playbackBuffer` at all -- default it here instead of rejecting
    // the whole (otherwise valid) config, so an old stored/served config
    // loads as Automatic with no error. A `playbackBuffer` that IS present
    // is validated strictly, same as every other field.
    let resolvedPlaybackBuffer: PrismaVoicePlaybackBufferConfig = {
        ...PRISMA_VOICE_CONFIG_DEFAULTS.playbackBuffer,
    };
    if ('playbackBuffer' in value) {
        const playbackBuffer = value.playbackBuffer;
        if (!isRecord(playbackBuffer)) {
            issues.push({ path: 'playbackBuffer', message: 'playbackBuffer must be an object.' });
        } else if (!('mode' in playbackBuffer) || !('manualSeconds' in playbackBuffer)) {
            issues.push({ path: 'playbackBuffer', message: 'playbackBuffer is incomplete.' });
        } else {
            const mode = playbackBuffer.mode;
            if (mode !== 'automatic' && mode !== 'manual') {
                issues.push({ path: 'playbackBuffer.mode', message: 'playbackBuffer.mode must be "automatic" or "manual".' });
            }

            const manualSeconds = playbackBuffer.manualSeconds;
            if (typeof manualSeconds !== 'number' || !Number.isFinite(manualSeconds)) {
                issues.push({ path: 'playbackBuffer.manualSeconds', message: 'playbackBuffer.manualSeconds must be a finite number.' });
            } else if (!isPrismaVoicePlaybackBufferManualSecondsValid(manualSeconds)) {
                issues.push({
                    path: 'playbackBuffer.manualSeconds',
                    message: `playbackBuffer.manualSeconds must be between ${PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN} and `
                        + `${PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX} in ${PRISMA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP} s steps.`,
                });
            } else if (mode === 'automatic' || mode === 'manual') {
                resolvedPlaybackBuffer = { mode, manualSeconds };
            }
        }
    }

    if (issues.length > 0) {
        return { valid: false, issues };
    }

    return {
        valid: true,
        value: {
            ...clonePrismaVoiceConfig(value as unknown as PrismaVoiceConfig),
            playbackBuffer: resolvedPlaybackBuffer,
        },
    };
}
