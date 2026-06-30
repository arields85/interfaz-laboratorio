import { beforeEach, describe, expect, it, vi } from 'vitest';

const SHADER_STORAGE_KEY = 'hmi-shader-params';

async function loadFreshShaderStore() {
    vi.resetModules();
    return import('./shaderParams.store');
}

describe('useShaderParamsStore persistence', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.resetModules();
    });

    it('merges legacy persisted params with the latest defaults and preserves tuned values', async () => {
        localStorage.setItem(
            SHADER_STORAGE_KEY,
            JSON.stringify({
                state: {
                    params: {
                        nebIntensity: 0.77,
                        starBrightness: 1.15,
                        ringHue: 0.12,
                    },
                    blendModes: {
                        nebula: 'screen',
                        stars: 'multiply',
                    },
                },
                version: 0,
            }),
        );

        const {
            SHADER_BLEND_DEFAULTS,
            SHADER_DEFAULTS,
            useShaderParamsStore,
        } = await loadFreshShaderStore();

        await useShaderParamsStore.persist.rehydrate();

        expect(useShaderParamsStore.getState().params).toMatchObject({
            ...SHADER_DEFAULTS,
            nebIntensity: 0.77,
            starBrightness: 1.15,
            ringHue: 0.12,
        });
        expect(useShaderParamsStore.getState().params.starHue).toBe(SHADER_DEFAULTS.starHue);
        expect(useShaderParamsStore.getState().params.starAlpha).toBe(SHADER_DEFAULTS.starAlpha);
        expect(useShaderParamsStore.getState().params.nebBrightness).toBe(SHADER_DEFAULTS.nebBrightness);
        expect(useShaderParamsStore.getState().params.starSaturation).toBe(SHADER_DEFAULTS.starSaturation);
        expect(useShaderParamsStore.getState().params.starContrast).toBe(SHADER_DEFAULTS.starContrast);
        expect(useShaderParamsStore.getState().params.chromSaturation).toBe(SHADER_DEFAULTS.chromSaturation);
        expect(useShaderParamsStore.getState().params.chromBrightness).toBe(SHADER_DEFAULTS.chromBrightness);
        expect(useShaderParamsStore.getState().params.chromContrast).toBe(SHADER_DEFAULTS.chromContrast);
        expect(useShaderParamsStore.getState().params.chromHue).toBe(SHADER_DEFAULTS.chromHue);
        expect(useShaderParamsStore.getState().params.chromAlpha).toBe(SHADER_DEFAULTS.chromAlpha);
        expect(useShaderParamsStore.getState().params.cursorNebSaturation).toBe(SHADER_DEFAULTS.cursorNebSaturation);
        expect(useShaderParamsStore.getState().params.cursorNebBrightness).toBe(SHADER_DEFAULTS.cursorNebBrightness);
        expect(useShaderParamsStore.getState().params.cursorNebContrast).toBe(SHADER_DEFAULTS.cursorNebContrast);
        expect(useShaderParamsStore.getState().params.cursorNebHue).toBe(SHADER_DEFAULTS.cursorNebHue);
        expect(useShaderParamsStore.getState().params.cursorNebAlpha).toBe(SHADER_DEFAULTS.cursorNebAlpha);
        expect(useShaderParamsStore.getState().params.haloSaturation).toBe(SHADER_DEFAULTS.haloSaturation);
        expect(useShaderParamsStore.getState().params.haloBrightness).toBe(SHADER_DEFAULTS.haloBrightness);
        expect(useShaderParamsStore.getState().params.haloContrast).toBe(SHADER_DEFAULTS.haloContrast);
        expect(useShaderParamsStore.getState().params.haloHue).toBe(SHADER_DEFAULTS.haloHue);
        expect(useShaderParamsStore.getState().params.haloAlpha).toBe(SHADER_DEFAULTS.haloAlpha);
        expect(useShaderParamsStore.getState().params.ringBrightness).toBe(SHADER_DEFAULTS.ringBrightness);
        expect(useShaderParamsStore.getState().params.ringContrast).toBe(SHADER_DEFAULTS.ringContrast);
        expect(useShaderParamsStore.getState().params.ringAlpha).toBe(SHADER_DEFAULTS.ringAlpha);
        expect(useShaderParamsStore.getState().blendModes).toEqual(SHADER_BLEND_DEFAULTS);
    });

    it('adds neutral defaults for new real-layer saturation, brightness, and contrast params', async () => {
        const { SHADER_DEFAULTS } = await loadFreshShaderStore();

        expect(SHADER_DEFAULTS.nebBrightness).toBe(1);
        expect(SHADER_DEFAULTS.starSaturation).toBe(1);
        expect(SHADER_DEFAULTS.starContrast).toBe(1);
        expect(SHADER_DEFAULTS.chromSaturation).toBe(1);
        expect(SHADER_DEFAULTS.chromBrightness).toBe(1);
        expect(SHADER_DEFAULTS.chromContrast).toBe(1);
        expect(SHADER_DEFAULTS.cursorNebSaturation).toBe(1);
        expect(SHADER_DEFAULTS.cursorNebBrightness).toBe(1);
        expect(SHADER_DEFAULTS.cursorNebContrast).toBe(1);
        expect(SHADER_DEFAULTS.haloSaturation).toBe(1);
        expect(SHADER_DEFAULTS.haloBrightness).toBe(1);
        expect(SHADER_DEFAULTS.haloContrast).toBe(1);
        expect(SHADER_DEFAULTS.ringBrightness).toBe(1);
        expect(SHADER_DEFAULTS.ringContrast).toBe(1);
    });

    it('resets params and blend modes back to the baseline defaults', async () => {
        const {
            SHADER_BLEND_DEFAULTS,
            SHADER_DEFAULTS,
            useShaderParamsStore,
        } = await loadFreshShaderStore();

        useShaderParamsStore.getState().updateParam('starHue', 0.42);
        useShaderParamsStore.getState().updateParam('starSaturation', 1.6);
        useShaderParamsStore.getState().updateParam('chromBrightness', 1.35);
        useShaderParamsStore.getState().updateParam('ringContrast', 1.22);
        useShaderParamsStore.getState().updateParam('ringAlpha', 0.35);
        useShaderParamsStore.getState().updateBlendMode('stars', 'screen');
        useShaderParamsStore.getState().updateBlendMode('clickRing', 'multiply');

        useShaderParamsStore.getState().resetAll();

        expect(useShaderParamsStore.getState().params).toEqual(SHADER_DEFAULTS);
        expect(useShaderParamsStore.getState().blendModes).toEqual(SHADER_BLEND_DEFAULTS);
    });

    it('exports a portable background config file with schema metadata and the full sanitized state', async () => {
        const {
            SHADER_CONFIG_SCHEMA,
            SHADER_CONFIG_VERSION,
            SHADER_BLEND_DEFAULTS,
            createShaderPortableConfigFile,
            useShaderParamsStore,
        } = await loadFreshShaderStore();

        useShaderParamsStore.getState().updateParam('starHue', 0.42);
        useShaderParamsStore.getState().updateParam('cursorNebRadius', 2.4);
        useShaderParamsStore.getState().updateBlendMode('stars', 'screen');

        const portableFile = createShaderPortableConfigFile(useShaderParamsStore.getState());

        expect(portableFile.schema).toBe(SHADER_CONFIG_SCHEMA);
        expect(portableFile.version).toBe(SHADER_CONFIG_VERSION);
        expect(portableFile.exportedAt).toEqual(expect.any(String));
        expect(portableFile.params.starHue).toBeCloseTo(0.42);
        expect(portableFile.params.cursorNebRadius).toBeCloseTo(2.4);
        expect(portableFile.blendModes).toEqual(SHADER_BLEND_DEFAULTS);
    });

    it('parses portable background config files and normalizes stale blend data', async () => {
        const {
            SHADER_BLEND_DEFAULTS,
            SHADER_CONFIG_SCHEMA,
            SHADER_CONFIG_VERSION,
            parseShaderPortableConfigFile,
            useShaderParamsStore,
        } = await loadFreshShaderStore();

        const importedState = parseShaderPortableConfigFile({
            schema: SHADER_CONFIG_SCHEMA,
            version: SHADER_CONFIG_VERSION,
            exportedAt: '2026-06-30T00:00:00.000Z',
            params: {
                starHue: 0.62,
                ringIntensity: 1.4,
                invalid: 'nope',
            },
            blendModes: {
                stars: 'multiply',
                clickRing: 'screen',
            },
        });

        expect(importedState).not.toBeNull();

        if (!importedState) {
            throw new Error('Expected imported state to be parsed');
        }

        useShaderParamsStore.getState().replaceAll(importedState);

        expect(useShaderParamsStore.getState().params.starHue).toBeCloseTo(0.62);
        expect(useShaderParamsStore.getState().params.ringIntensity).toBeCloseTo(1.4);
        expect(useShaderParamsStore.getState().blendModes).toEqual(SHADER_BLEND_DEFAULTS);
    });

    it('rejects invalid portable background config files', async () => {
        const { parseShaderPortableConfigFile } = await loadFreshShaderStore();

        expect(parseShaderPortableConfigFile(null)).toBeNull();
        expect(parseShaderPortableConfigFile({ params: {} })).toBeNull();
        expect(
            parseShaderPortableConfigFile({
                schema: 'other-schema',
                version: 1,
                params: {},
            }),
        ).toBeNull();
    });

    it('normalizes runtime blend mode updates back to the baseline defaults', async () => {
        const { SHADER_BLEND_DEFAULTS, useShaderParamsStore } = await loadFreshShaderStore();

        useShaderParamsStore.getState().updateBlendMode('nebula', 'screen');
        useShaderParamsStore.getState().updateBlendMode('clickRing', 'overlay');
        useShaderParamsStore.getState().updateBlendMode('stars', 'multiply');

        expect(useShaderParamsStore.getState().blendModes).toEqual(SHADER_BLEND_DEFAULTS);
    });

    it('uses the full capability vocabulary and does not require hydrated numeric params for disabled or omitted controls', async () => {
        localStorage.setItem(
            SHADER_STORAGE_KEY,
            JSON.stringify({
                state: {
                    params: {
                        nebIntensity: 0.62,
                    },
                },
                version: 0,
            }),
        );

        const { SHADER_SECTIONS, useShaderParamsStore } = await loadFreshShaderStore();

        await useShaderParamsStore.persist.rehydrate();

        const { blendModes, params } = useShaderParamsStore.getState();
        const capabilityStates = new Set<string>();
        let disabledControls = 0;
        let omittedControls = 0;

        for (const section of SHADER_SECTIONS) {
            expect(Object.keys(section.capabilities).sort()).toEqual([
                'alpha',
                'blend',
                'brightness',
                'contrast',
                'intensity',
                'saturation',
                'tone',
            ]);

            for (const capability of Object.values(section.capabilities)) {
                capabilityStates.add(capability.state);

                if (capability.state === 'supported' && capability.storage === 'param') {
                    expect(params[capability.key]).not.toBeUndefined();
                }

                if (capability.state === 'supported' && capability.storage === 'blendMode') {
                    expect(blendModes[capability.target]).not.toBeUndefined();
                }

                if (capability.state === 'aliased') {
                    expect(params[capability.key]).not.toBeUndefined();
                }

                if (capability.state === 'disabled' || capability.state === 'omitted') {
                    expect('key' in capability).toBe(false);
                    expect('target' in capability).toBe(false);

                    if (capability.state === 'disabled') {
                        disabledControls += 1;
                    }

                    if (capability.state === 'omitted') {
                        omittedControls += 1;
                    }
                }
            }
        }

        expect(capabilityStates).toEqual(new Set(['supported', 'aliased', 'disabled', 'omitted']));
        expect(disabledControls).toBeGreaterThan(0);
        expect(omittedControls).toBeGreaterThan(0);
    });

    it('covers saturation, brightness, and contrast capabilities with only real color layers gaining supported params', async () => {
        const { SHADER_SECTIONS } = await loadFreshShaderStore();

        const sections = Object.fromEntries(SHADER_SECTIONS.map((section) => [section.title, section]));

        expect(sections.Nebula.capabilities.saturation).toMatchObject({
            state: 'aliased',
            slot: 'saturation',
            key: 'nebSat',
        });
        expect(sections.Nebula.capabilities.brightness).toMatchObject({
            state: 'supported',
            slot: 'brightness',
            storage: 'param',
            key: 'nebBrightness',
        });
        expect(sections.Nebula.capabilities.contrast).toMatchObject({
            state: 'aliased',
            slot: 'contrast',
            key: 'nebContrast',
        });

        expect(sections.Stars.capabilities.saturation).toMatchObject({
            state: 'supported',
            slot: 'saturation',
            storage: 'param',
            key: 'starSaturation',
        });
        expect(sections.Stars.capabilities.brightness).toMatchObject({
            state: 'aliased',
            slot: 'brightness',
            key: 'starBrightness',
        });
        expect(sections.Stars.capabilities.contrast).toMatchObject({
            state: 'supported',
            slot: 'contrast',
            storage: 'param',
            key: 'starContrast',
        });
        expect(sections.Stars.capabilities.intensity).toMatchObject({
            state: 'disabled',
            slot: 'intensity',
        });

        expect(sections['Gravitational Lensing'].capabilities.saturation).toMatchObject({
            state: 'disabled',
            slot: 'saturation',
        });
        expect(sections['Gravitational Lensing'].capabilities.brightness).toMatchObject({
            state: 'disabled',
            slot: 'brightness',
        });
        expect(sections['Gravitational Lensing'].capabilities.contrast).toMatchObject({
            state: 'disabled',
            slot: 'contrast',
        });

        expect(sections['Chromatic Aberration'].capabilities.saturation).toMatchObject({
            state: 'supported',
            slot: 'saturation',
            storage: 'param',
            key: 'chromSaturation',
        });
        expect(sections['Chromatic Aberration'].capabilities.brightness).toMatchObject({
            state: 'supported',
            slot: 'brightness',
            storage: 'param',
            key: 'chromBrightness',
        });
        expect(sections['Chromatic Aberration'].capabilities.contrast).toMatchObject({
            state: 'supported',
            slot: 'contrast',
            storage: 'param',
            key: 'chromContrast',
        });

        expect(sections['Mouse Nebula'].capabilities.saturation).toMatchObject({
            state: 'disabled',
            slot: 'saturation',
        });
        expect(sections['Mouse Nebula'].capabilities.brightness).toMatchObject({
            state: 'disabled',
            slot: 'brightness',
        });
        expect(sections['Mouse Nebula'].capabilities.contrast).toMatchObject({
            state: 'disabled',
            slot: 'contrast',
        });

        expect(sections['Cursor Nebula'].capabilities.saturation).toMatchObject({
            state: 'supported',
            slot: 'saturation',
            storage: 'param',
            key: 'cursorNebSaturation',
        });
        expect(sections['Cursor Nebula'].capabilities.brightness).toMatchObject({
            state: 'supported',
            slot: 'brightness',
            storage: 'param',
            key: 'cursorNebBrightness',
        });
        expect(sections['Cursor Nebula'].capabilities.contrast).toMatchObject({
            state: 'supported',
            slot: 'contrast',
            storage: 'param',
            key: 'cursorNebContrast',
        });

        expect(sections['Cursor Halo'].capabilities.saturation).toMatchObject({
            state: 'supported',
            slot: 'saturation',
            storage: 'param',
            key: 'haloSaturation',
        });
        expect(sections['Cursor Halo'].capabilities.brightness).toMatchObject({
            state: 'supported',
            slot: 'brightness',
            storage: 'param',
            key: 'haloBrightness',
        });
        expect(sections['Cursor Halo'].capabilities.contrast).toMatchObject({
            state: 'supported',
            slot: 'contrast',
            storage: 'param',
            key: 'haloContrast',
        });

        expect(sections['Click Ring'].capabilities.saturation).toMatchObject({
            state: 'aliased',
            slot: 'saturation',
            key: 'ringSaturation',
        });
        expect(sections['Click Ring'].capabilities.brightness).toMatchObject({
            state: 'supported',
            slot: 'brightness',
            storage: 'param',
            key: 'ringBrightness',
        });
        expect(sections['Click Ring'].capabilities.contrast).toMatchObject({
            state: 'supported',
            slot: 'contrast',
            storage: 'param',
            key: 'ringContrast',
        });

        expect(sections.Vignette.capabilities.saturation).toMatchObject({
            state: 'omitted',
            slot: 'saturation',
        });
        expect(sections.Vignette.capabilities.brightness).toMatchObject({
            state: 'omitted',
            slot: 'brightness',
        });
        expect(sections.Vignette.capabilities.contrast).toMatchObject({
            state: 'omitted',
            slot: 'contrast',
        });
    });
});
