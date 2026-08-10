import { describe, expect, it } from 'vitest';

import {
    PRISMA_VOICE_CONFIG_DEFAULTS,
    arePrismaVoiceConfigsEqual,
    createDefaultPrismaVoiceConfig,
    validatePrismaVoiceConfig,
} from './prismaVoiceConfig';

describe('PrismaVoiceConfig', () => {
    it('defines the approved immutable Prisma/Leda defaults', () => {
        expect(PRISMA_VOICE_CONFIG_DEFAULTS).toEqual({
            effectEnabled: true,
            preset: 'robotic_medium_light',
            effectIntensity: 100,
            robotic: {
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
            },
        });
        expect(Object.isFrozen(PRISMA_VOICE_CONFIG_DEFAULTS)).toBe(true);
        expect(Object.isFrozen(PRISMA_VOICE_CONFIG_DEFAULTS.robotic)).toBe(true);
    });

    it('creates independent mutable configs without sharing nested references', () => {
        const first = createDefaultPrismaVoiceConfig();
        const second = createDefaultPrismaVoiceConfig();

        first.robotic.baseGain = 0.5;

        expect(first).not.toBe(second);
        expect(first.robotic).not.toBe(second.robotic);
        expect(second.robotic.baseGain).toBe(0.78);
        expect(PRISMA_VOICE_CONFIG_DEFAULTS.robotic.baseGain).toBe(0.78);
    });

    it.each([
        ['effectEnabled', (config: ReturnType<typeof createDefaultPrismaVoiceConfig>) => {
            config.effectEnabled = !config.effectEnabled;
        }],
        ['preset', (config: ReturnType<typeof createDefaultPrismaVoiceConfig>) => {
            config.preset = 'clean';
        }],
        ['effectIntensity', (config: ReturnType<typeof createDefaultPrismaVoiceConfig>) => {
            config.effectIntensity -= 1;
        }],
    ])('detects a top-level %s difference', (_field, changeConfig) => {
        const left = createDefaultPrismaVoiceConfig();
        const right = createDefaultPrismaVoiceConfig();
        changeConfig(right);

        expect(arePrismaVoiceConfigsEqual(left, right)).toBe(false);
    });

    it.each([
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
    ] as const)('detects a robotic.%s difference', (field) => {
        const left = createDefaultPrismaVoiceConfig();
        const right = createDefaultPrismaVoiceConfig();
        right.robotic[field] += 1;

        expect(arePrismaVoiceConfigsEqual(left, right)).toBe(false);
    });

    it('accepts complete value equality across independent configs', () => {
        expect(arePrismaVoiceConfigsEqual(
            createDefaultPrismaVoiceConfig(),
            createDefaultPrismaVoiceConfig(),
        )).toBe(true);
    });

    it('accepts and clones a complete valid config', () => {
        const config = createDefaultPrismaVoiceConfig();
        const result = validatePrismaVoiceConfig(config);

        expect(result).toEqual({ valid: true, value: config });
        if (result.valid) {
            expect(result.value).not.toBe(config);
            expect(result.value.robotic).not.toBe(config.robotic);
        }
    });

    it.each([
        ['an incomplete payload', {}, '$'],
        ['a non-boolean effect flag', { ...createDefaultPrismaVoiceConfig(), effectEnabled: 'true' }, 'effectEnabled'],
        ['an unknown preset', { ...createDefaultPrismaVoiceConfig(), preset: 'robotic_heavy' }, 'preset'],
        ['NaN', { ...createDefaultPrismaVoiceConfig(), effectIntensity: Number.NaN }, 'effectIntensity'],
        ['infinity', { ...createDefaultPrismaVoiceConfig(), effectIntensity: Number.POSITIVE_INFINITY }, 'effectIntensity'],
        ['intensity below zero', { ...createDefaultPrismaVoiceConfig(), effectIntensity: -1 }, 'effectIntensity'],
        ['intensity above 100', { ...createDefaultPrismaVoiceConfig(), effectIntensity: 101 }, 'effectIntensity'],
        ['fractional quantization', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, quantizationSteps: 10.5 },
        }, 'robotic.quantizationSteps'],
        ['non-positive quantization', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, quantizationSteps: 0 },
        }, 'robotic.quantizationSteps'],
        ['a non-positive frequency', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, modulationHz: 0 },
        }, 'robotic.modulationHz'],
        ['a non-positive delay', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, echo1DelayMs: -1 },
        }, 'robotic.echo1DelayMs'],
        ['a negative gain', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, echo2Gain: -0.1 },
        }, 'robotic.echo2Gain'],
        ['a negative mix', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, metallicMix: -0.1 },
        }, 'robotic.metallicMix'],
        ['a non-positive normalization target', {
            ...createDefaultPrismaVoiceConfig(),
            robotic: { ...createDefaultPrismaVoiceConfig().robotic, normalizationTarget: 0 },
        }, 'robotic.normalizationTarget'],
    ])('rejects %s without coercion', (_case, payload, expectedPath) => {
        const result = validatePrismaVoiceConfig(payload);

        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.issues.map((issue) => issue.path)).toContain(expectedPath);
        }
    });
});
