import { describe, expect, it } from 'vitest';

import {
    LEDA_VOICE_CONFIG_DEFAULTS,
    areLedaVoiceConfigsEqual,
    createDefaultLedaVoiceConfig,
    validateLedaVoiceConfig,
} from './ledaVoiceConfig';

describe('LedaVoiceConfig', () => {
    it('defines the approved immutable Leda/Leda defaults', () => {
        expect(LEDA_VOICE_CONFIG_DEFAULTS).toEqual({
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
            playbackBuffer: {
                mode: 'automatic',
                manualSeconds: 0.2,
            },
        });
        expect(Object.isFrozen(LEDA_VOICE_CONFIG_DEFAULTS)).toBe(true);
        expect(Object.isFrozen(LEDA_VOICE_CONFIG_DEFAULTS.robotic)).toBe(true);
        expect(Object.isFrozen(LEDA_VOICE_CONFIG_DEFAULTS.playbackBuffer)).toBe(true);
    });

    it('creates independent mutable configs without sharing nested references', () => {
        const first = createDefaultLedaVoiceConfig();
        const second = createDefaultLedaVoiceConfig();

        first.robotic.baseGain = 0.5;

        expect(first).not.toBe(second);
        expect(first.robotic).not.toBe(second.robotic);
        expect(second.robotic.baseGain).toBe(0.78);
        expect(LEDA_VOICE_CONFIG_DEFAULTS.robotic.baseGain).toBe(0.78);
    });

    it.each([
        ['effectEnabled', (config: ReturnType<typeof createDefaultLedaVoiceConfig>) => {
            config.effectEnabled = !config.effectEnabled;
        }],
        ['preset', (config: ReturnType<typeof createDefaultLedaVoiceConfig>) => {
            config.preset = 'clean';
        }],
        ['effectIntensity', (config: ReturnType<typeof createDefaultLedaVoiceConfig>) => {
            config.effectIntensity -= 1;
        }],
        ['playbackBuffer.mode', (config: ReturnType<typeof createDefaultLedaVoiceConfig>) => {
            config.playbackBuffer.mode = 'manual';
        }],
        ['playbackBuffer.manualSeconds', (config: ReturnType<typeof createDefaultLedaVoiceConfig>) => {
            config.playbackBuffer.manualSeconds += 0.1;
        }],
    ])('detects a top-level %s difference', (_field, changeConfig) => {
        const left = createDefaultLedaVoiceConfig();
        const right = createDefaultLedaVoiceConfig();
        changeConfig(right);

        expect(areLedaVoiceConfigsEqual(left, right)).toBe(false);
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
        const left = createDefaultLedaVoiceConfig();
        const right = createDefaultLedaVoiceConfig();
        right.robotic[field] += 1;

        expect(areLedaVoiceConfigsEqual(left, right)).toBe(false);
    });

    it('accepts complete value equality across independent configs', () => {
        expect(areLedaVoiceConfigsEqual(
            createDefaultLedaVoiceConfig(),
            createDefaultLedaVoiceConfig(),
        )).toBe(true);
    });

    it('accepts and clones a complete valid config', () => {
        const config = createDefaultLedaVoiceConfig();
        const result = validateLedaVoiceConfig(config);

        expect(result).toEqual({ valid: true, value: config });
        if (result.valid) {
            expect(result.value).not.toBe(config);
            expect(result.value.robotic).not.toBe(config.robotic);
            expect(result.value.playbackBuffer).not.toBe(config.playbackBuffer);
        }
    });

    it('backfills a missing playbackBuffer with the default (T4 backward compatibility)', () => {
        const legacyConfig = createDefaultLedaVoiceConfig() as Partial<ReturnType<typeof createDefaultLedaVoiceConfig>>;
        delete legacyConfig.playbackBuffer;

        const result = validateLedaVoiceConfig(legacyConfig);

        expect(result).toEqual({
            valid: true,
            value: {
                ...createDefaultLedaVoiceConfig(),
                playbackBuffer: { mode: 'automatic', manualSeconds: 0.2 },
            },
        });
    });

    it.each([
        [0.1],
        [0.2],
        [1.5],
        [3.0],
    ])('accepts a manual buffer of %s seconds, on the grid and within bounds', (manualSeconds) => {
        const config = {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'manual' as const, manualSeconds },
        };

        const result = validateLedaVoiceConfig(config);

        expect(result).toEqual({ valid: true, value: config });
    });

    it.each([
        ['a non-object payload', { ...createDefaultLedaVoiceConfig(), playbackBuffer: 'automatic' }, 'playbackBuffer'],
        ['an incomplete payload', {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'automatic' },
        }, 'playbackBuffer'],
        ['an unsupported mode', {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'fixed', manualSeconds: 0.2 },
        }, 'playbackBuffer.mode'],
        ['manualSeconds below the minimum', {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'manual', manualSeconds: 0.05 },
        }, 'playbackBuffer.manualSeconds'],
        ['manualSeconds above the maximum', {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'manual', manualSeconds: 3.1 },
        }, 'playbackBuffer.manualSeconds'],
        ['manualSeconds off the 0.1 s grid', {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'manual', manualSeconds: 0.25 },
        }, 'playbackBuffer.manualSeconds'],
        ['a non-numeric manualSeconds', {
            ...createDefaultLedaVoiceConfig(),
            playbackBuffer: { mode: 'manual', manualSeconds: '0.2' },
        }, 'playbackBuffer.manualSeconds'],
    ])('rejects %s without coercion', (_case, payload, expectedPath) => {
        const result = validateLedaVoiceConfig(payload);

        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.issues.map((issue) => issue.path)).toContain(expectedPath);
        }
    });

    it.each([
        ['an incomplete payload', {}, '$'],
        ['a non-boolean effect flag', { ...createDefaultLedaVoiceConfig(), effectEnabled: 'true' }, 'effectEnabled'],
        ['an unknown preset', { ...createDefaultLedaVoiceConfig(), preset: 'robotic_heavy' }, 'preset'],
        ['NaN', { ...createDefaultLedaVoiceConfig(), effectIntensity: Number.NaN }, 'effectIntensity'],
        ['infinity', { ...createDefaultLedaVoiceConfig(), effectIntensity: Number.POSITIVE_INFINITY }, 'effectIntensity'],
        ['intensity below zero', { ...createDefaultLedaVoiceConfig(), effectIntensity: -1 }, 'effectIntensity'],
        ['intensity above 100', { ...createDefaultLedaVoiceConfig(), effectIntensity: 101 }, 'effectIntensity'],
        ['fractional quantization', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, quantizationSteps: 10.5 },
        }, 'robotic.quantizationSteps'],
        ['non-positive quantization', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, quantizationSteps: 0 },
        }, 'robotic.quantizationSteps'],
        ['a non-positive frequency', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, modulationHz: 0 },
        }, 'robotic.modulationHz'],
        ['a non-positive delay', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, echo1DelayMs: -1 },
        }, 'robotic.echo1DelayMs'],
        ['a negative gain', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, echo2Gain: -0.1 },
        }, 'robotic.echo2Gain'],
        ['a negative mix', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, metallicMix: -0.1 },
        }, 'robotic.metallicMix'],
        ['a non-positive normalization target', {
            ...createDefaultLedaVoiceConfig(),
            robotic: { ...createDefaultLedaVoiceConfig().robotic, normalizationTarget: 0 },
        }, 'robotic.normalizationTarget'],
    ])('rejects %s without coercion', (_case, payload, expectedPath) => {
        const result = validateLedaVoiceConfig(payload);

        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.issues.map((issue) => issue.path)).toContain(expectedPath);
        }
    });
});
