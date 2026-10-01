export type LedaVoicePreset = 'clean' | 'robotic_medium_light';

export interface LedaRoboticVoiceConfig {
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

export type LedaVoicePlaybackBufferMode = 'automatic' | 'manual';

export interface LedaVoicePlaybackBufferConfig {
    mode: LedaVoicePlaybackBufferMode;
    manualSeconds: number;
}

export interface LedaVoiceConfig {
    effectEnabled: boolean;
    preset: LedaVoicePreset;
    effectIntensity: number;
    robotic: LedaRoboticVoiceConfig;
    playbackBuffer: LedaVoicePlaybackBufferConfig;
}

// T4 design decision (2026-09-24, user-approved 2026-09-24): manual buffer
// range 0.1-3.0 s in 0.1 s steps, default 0.2 s (the T22 proven baseline).
// Kept as named constants (not re-derived from the defaults below) so T5's
// UI control and the runtime's mirrored bounds have one documented source
// each to point back to.
export const LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN = 0.1;
export const LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX = 3.0;
export const LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP = 0.1;

// Floating-point tolerance for the 0.1 s grid check below (e.g. 0.1 + 0.2 in
// IEEE754 is 0.30000000000000004): comparing against this epsilon instead of
// exact equality accepts every intended step while still rejecting a value
// like 0.25 that is genuinely off the grid.
const LEDA_VOICE_PLAYBACK_BUFFER_GRID_EPSILON = 1e-6;
const LEDA_VOICE_PLAYBACK_BUFFER_BOUNDS_EPSILON = 1e-9;

function isLedaVoicePlaybackBufferManualSecondsValid(value: number): boolean {
    if (value < LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN - LEDA_VOICE_PLAYBACK_BUFFER_BOUNDS_EPSILON) {
        return false;
    }
    if (value > LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX + LEDA_VOICE_PLAYBACK_BUFFER_BOUNDS_EPSILON) {
        return false;
    }

    const steps = value / LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP;
    return Math.abs(steps - Math.round(steps)) < LEDA_VOICE_PLAYBACK_BUFFER_GRID_EPSILON;
}

export interface LedaVoiceConfigValidationIssue {
    path: string;
    message: string;
}

export type LedaVoiceConfigValidationResult =
    | { valid: true; value: LedaVoiceConfig }
    | { valid: false; issues: LedaVoiceConfigValidationIssue[] };

export const LEDA_VOICE_CONFIG_DEFAULTS = Object.freeze({
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
} as const satisfies Readonly<LedaVoiceConfig>);

export function cloneLedaVoiceConfig(config: LedaVoiceConfig): LedaVoiceConfig {
    return {
        ...config,
        robotic: { ...config.robotic },
        playbackBuffer: { ...config.playbackBuffer },
    };
}

export function areLedaVoiceConfigsEqual(
    left: LedaVoiceConfig,
    right: LedaVoiceConfig,
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

export function createDefaultLedaVoiceConfig(): LedaVoiceConfig {
    return {
        ...LEDA_VOICE_CONFIG_DEFAULTS,
        robotic: { ...LEDA_VOICE_CONFIG_DEFAULTS.robotic },
        playbackBuffer: { ...LEDA_VOICE_CONFIG_DEFAULTS.playbackBuffer },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function addFiniteNumberIssue(
    issues: LedaVoiceConfigValidationIssue[],
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

export function validateLedaVoiceConfig(value: unknown): LedaVoiceConfigValidationResult {
    if (!isRecord(value)) {
        return { valid: false, issues: [{ path: '$', message: 'Leda voice config must be an object.' }] };
    }

    const requiredTopLevelKeys = ['effectEnabled', 'preset', 'effectIntensity', 'robotic'];
    if (requiredTopLevelKeys.some((key) => !(key in value))) {
        return { valid: false, issues: [{ path: '$', message: 'Leda voice config is incomplete.' }] };
    }

    const issues: LedaVoiceConfigValidationIssue[] = [];

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
        const requiredRoboticKeys: Array<keyof LedaRoboticVoiceConfig> = [
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
    let resolvedPlaybackBuffer: LedaVoicePlaybackBufferConfig = {
        ...LEDA_VOICE_CONFIG_DEFAULTS.playbackBuffer,
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
            } else if (!isLedaVoicePlaybackBufferManualSecondsValid(manualSeconds)) {
                issues.push({
                    path: 'playbackBuffer.manualSeconds',
                    message: `playbackBuffer.manualSeconds must be between ${LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MIN} and `
                        + `${LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_MAX} in ${LEDA_VOICE_PLAYBACK_BUFFER_MANUAL_SECONDS_STEP} s steps.`,
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
            ...cloneLedaVoiceConfig(value as unknown as LedaVoiceConfig),
            playbackBuffer: resolvedPlaybackBuffer,
        },
    };
}
