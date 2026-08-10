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

export interface PrismaVoiceConfig {
    effectEnabled: boolean;
    preset: PrismaVoicePreset;
    effectIntensity: number;
    robotic: PrismaRoboticVoiceConfig;
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
} as const satisfies Readonly<PrismaVoiceConfig>);

export function clonePrismaVoiceConfig(config: PrismaVoiceConfig): PrismaVoiceConfig {
    return {
        ...config,
        robotic: { ...config.robotic },
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
        && left.robotic.normalizationMaxGain === right.robotic.normalizationMaxGain;
}

export function createDefaultPrismaVoiceConfig(): PrismaVoiceConfig {
    return {
        ...PRISMA_VOICE_CONFIG_DEFAULTS,
        robotic: { ...PRISMA_VOICE_CONFIG_DEFAULTS.robotic },
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

    if (issues.length > 0) {
        return { valid: false, issues };
    }

    return {
        valid: true,
        value: clonePrismaVoiceConfig(value as unknown as PrismaVoiceConfig),
    };
}
