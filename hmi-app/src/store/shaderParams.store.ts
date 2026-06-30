import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// =============================================================================
// STORE: Shader Params (Zustand)
//
// Contiene los parámetros runtime del fondo WebGL EventHorizon.
// Persistido en localStorage para que los ajustes sobrevivan recargas.
//
// Los valores se consumen desde EventHorizonBackground (frame loop)
// y se editan desde GlobalSettingsDialog > BackgroundSettingsTab.
// =============================================================================

// ---------------------------------------------------------------------------
// Default parameter values (single source of truth)
// ---------------------------------------------------------------------------

export const SHADER_DEFAULTS = {
    // Nebula
    nebShow: 1,
    nebSpeed: 0.11,
    nebIntensity: 0.5,
    nebAlpha: 1.0,
    nebVariation: 0.14,
    nebHue: 0.0,
    nebContrast: 0.48,
    nebBrightness: 1.0,
    nebDensity: 0.3,
    nebSat: 0.5,
    nebColorVar: 1.0,
    nebColorShift: 1.0,
    // Stars
    starShow: 1,
    starDensity: 1.1,
    starBrightness: 0.8,
    starHue: 0.0,
    starSaturation: 1.0,
    starContrast: 1.0,
    starAlpha: 1.0,
    starTwinkle: 0.6,
    starSize: 0.95,
    starParallax: 1.0,
    // Lensing (magnifying-glass distortion)
    lensShow: 1,
    lensMass: 0.08,
    lensSize: 0.27,
    lensOpacity: 0.21,
    lensAutoOpacity: 1,
    lensAutoSpeed: 0.25,
    lensDriftSpeed: 0.45,
    // Chromatic aberration
    chromShow: 1,
    chromIntensity: 0.5,
    chromHue: 0.0,
    chromSaturation: 1.0,
    chromBrightness: 1.0,
    chromContrast: 1.0,
    chromAlpha: 1.0,
    // Mouse nebula displacement (purple cloud reacting to cursor)
    nebMouseShow: 1,
    nebMouseIntensity: 0.45,
    nebMouseLag: 0.01,
    // Cursor nebula
    cursorNebShow: 1,
    cursorNebIntensity: 0.76,
    cursorNebHue: 0.0,
    cursorNebSaturation: 1.0,
    cursorNebBrightness: 1.0,
    cursorNebContrast: 1.0,
    cursorNebAlpha: 1.0,
    cursorNebRadius: 1.2,
    cursorNebLag: 0.01,
    // Cursor halo
    haloShow: 1,
    haloIntensity: 0.11,
    haloHue: 0.0,
    haloSaturation: 1.0,
    haloBrightness: 1.0,
    haloContrast: 1.0,
    haloAlpha: 1.0,
    haloLag: 0.21,
    // Click ring
    ringShow: 1,
    ringIntensity: 0.3,
    ringAlpha: 1.0,
    ringBrightness: 1.0,
    ringContrast: 1.0,
    ringSpeed: 0.25,
    ringWidth: 0.72,
    ringLife: 1.0,
    ringHue: 0.84,
    ringSaturation: 1.0,
    // Vignette
    vigShow: 1,
} as const;

export type ShaderParams = { -readonly [K in keyof typeof SHADER_DEFAULTS]: number };

export type ShaderControlSlot =
    | 'tone'
    | 'saturation'
    | 'brightness'
    | 'contrast'
    | 'intensity'
    | 'alpha'
    | 'blend';
export type ShaderBlendMode = 'normal' | 'screen' | 'overlay' | 'soft-light' | 'multiply';
export type ShaderBlendTarget =
    | 'nebula'
    | 'stars'
    | 'chromatic'
    | 'cursorNebula'
    | 'cursorHalo'
    | 'clickRing';

export type ShaderBlendModes = Record<ShaderBlendTarget, ShaderBlendMode>;

export const SHADER_BLEND_DEFAULTS: ShaderBlendModes = {
    nebula: 'normal',
    stars: 'normal',
    chromatic: 'normal',
    cursorNebula: 'normal',
    cursorHalo: 'normal',
    clickRing: 'normal',
};

export const SHADER_CONFIG_SCHEMA = 'hmi-background-config';
export const SHADER_CONFIG_VERSION = 1;

export type ShaderPortableConfigFile = {
    schema: typeof SHADER_CONFIG_SCHEMA;
    version: typeof SHADER_CONFIG_VERSION;
    exportedAt: string;
    params: ShaderParams;
    blendModes: ShaderBlendModes;
};

export type ShaderGroupControlCapability =
    | { state: 'supported'; slot: Exclude<ShaderControlSlot, 'blend'>; storage: 'param'; key: keyof ShaderParams }
    | { state: 'supported'; slot: 'blend'; storage: 'blendMode'; target: ShaderBlendTarget }
    | { state: 'aliased'; slot: Exclude<ShaderControlSlot, 'blend'>; key: keyof ShaderParams }
    | { state: 'disabled'; slot: ShaderControlSlot; reason: string }
    | { state: 'omitted'; slot: ShaderControlSlot; reason: string };

export type ShaderGroupCapabilities = Record<ShaderControlSlot, ShaderGroupControlCapability>;

function createDefaultShaderParams(): ShaderParams {
    return { ...SHADER_DEFAULTS };
}

function createDefaultBlendModes(): ShaderBlendModes {
    return { ...SHADER_BLEND_DEFAULTS };
}

const SHADER_PARAM_KEYS = Object.keys(SHADER_DEFAULTS) as (keyof ShaderParams)[];
const SHADER_BLEND_TARGETS = Object.keys(SHADER_BLEND_DEFAULTS) as ShaderBlendTarget[];

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeShaderParams(value: unknown): ShaderParams {
    const nextParams = createDefaultShaderParams();

    if (typeof value !== 'object' || value === null) {
        return nextParams;
    }

    for (const key of SHADER_PARAM_KEYS) {
        const candidate = (value as Partial<Record<keyof ShaderParams, unknown>>)[key];

        if (isFiniteNumber(candidate)) {
            nextParams[key] = candidate;
        }
    }

    return nextParams;
}

function sanitizeShaderBlendModes(value: unknown): ShaderBlendModes {
    const normalizedBlendModes = createDefaultBlendModes();

    if (typeof value !== 'object' || value === null) {
        return normalizedBlendModes;
    }

    for (const target of SHADER_BLEND_TARGETS) {
        const candidate = (value as Partial<Record<ShaderBlendTarget, unknown>>)[target];

        if (candidate === SHADER_BLEND_DEFAULTS[target]) {
            normalizedBlendModes[target] = SHADER_BLEND_DEFAULTS[target];
        }
    }

    return normalizedBlendModes;
}

export function createShaderPortableConfigFile(
    state: PersistedShaderParamsState,
): ShaderPortableConfigFile {
    return {
        schema: SHADER_CONFIG_SCHEMA,
        version: SHADER_CONFIG_VERSION,
        exportedAt: new Date().toISOString(),
        params: sanitizeShaderParams(state.params),
        blendModes: sanitizeShaderBlendModes(state.blendModes),
    };
}

export function parseShaderPortableConfigFile(value: unknown): PersistedShaderParamsState | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }

    const file = value as Partial<ShaderPortableConfigFile>;

    if (file.schema !== SHADER_CONFIG_SCHEMA || file.version !== SHADER_CONFIG_VERSION) {
        return null;
    }

    return {
        params: sanitizeShaderParams(file.params),
        blendModes: sanitizeShaderBlendModes(file.blendModes),
    };
}

function createParamCapability(
    slot: Exclude<ShaderControlSlot, 'blend'>,
    key: keyof ShaderParams,
): ShaderGroupControlCapability {
    return { state: 'supported', slot, storage: 'param', key };
}

function createBlendCapability(target: ShaderBlendTarget): ShaderGroupControlCapability {
    return { state: 'supported', slot: 'blend', storage: 'blendMode', target };
}

function createAliasedCapability(
    slot: Exclude<ShaderControlSlot, 'blend'>,
    key: keyof ShaderParams,
): ShaderGroupControlCapability {
    return { state: 'aliased', slot, key };
}

function createDisabledCapability(
    slot: ShaderControlSlot,
    reason: string,
): ShaderGroupControlCapability {
    return { state: 'disabled', slot, reason };
}

function createOmittedCapability(
    slot: ShaderControlSlot,
    reason: string,
): ShaderGroupControlCapability {
    return { state: 'omitted', slot, reason };
}

// ---------------------------------------------------------------------------
// Uniform name mapping (param key -> GLSL uniform name)
// ---------------------------------------------------------------------------

export const UNIFORM_MAP: Partial<Record<keyof ShaderParams, string>> = {
    nebShow: 'u_nebShow',
    nebSpeed: 'u_nebSpeed',
    nebIntensity: 'u_nebIntensity',
    nebAlpha: 'u_nebAlpha',
    nebVariation: 'u_nebVariation',
    nebHue: 'u_nebHue',
    nebContrast: 'u_nebContrast',
    nebBrightness: 'u_nebBrightness',
    nebDensity: 'u_nebDensity',
    nebSat: 'u_nebSat',
    nebColorVar: 'u_nebColorVar',
    nebColorShift: 'u_nebColorShift',
    starShow: 'u_starShow',
    starDensity: 'u_starDensity',
    starBrightness: 'u_starBrightness',
    starHue: 'u_starHue',
    starSaturation: 'u_starSaturation',
    starContrast: 'u_starContrast',
    starAlpha: 'u_starAlpha',
    starTwinkle: 'u_starTwinkle',
    starSize: 'u_starSize',
    starParallax: 'u_starParallax',
    lensShow: 'u_lensShow',
    lensMass: 'u_lensMass',
    lensSize: 'u_lensSize',
    lensOpacity: 'u_lensOpacity',
    chromShow: 'u_chromShow',
    chromIntensity: 'u_chromIntensity',
    chromHue: 'u_chromHue',
    chromSaturation: 'u_chromSaturation',
    chromBrightness: 'u_chromBrightness',
    chromContrast: 'u_chromContrast',
    chromAlpha: 'u_chromAlpha',
    nebMouseShow: 'u_nebMouseShow',
    nebMouseIntensity: 'u_nebMouseIntensity',
    cursorNebShow: 'u_cursorNebShow',
    cursorNebIntensity: 'u_cursorNebIntensity',
    cursorNebHue: 'u_cursorNebHue',
    cursorNebSaturation: 'u_cursorNebSaturation',
    cursorNebBrightness: 'u_cursorNebBrightness',
    cursorNebContrast: 'u_cursorNebContrast',
    cursorNebAlpha: 'u_cursorNebAlpha',
    cursorNebRadius: 'u_cursorNebRadius',
    haloShow: 'u_haloShow',
    haloIntensity: 'u_haloIntensity',
    haloHue: 'u_haloHue',
    haloSaturation: 'u_haloSaturation',
    haloBrightness: 'u_haloBrightness',
    haloContrast: 'u_haloContrast',
    haloAlpha: 'u_haloAlpha',
    ringShow: 'u_ringShow',
    ringIntensity: 'u_ringIntensity',
    ringAlpha: 'u_ringAlpha',
    ringBrightness: 'u_ringBrightness',
    ringContrast: 'u_ringContrast',
    ringSpeed: 'u_ringSpeed',
    ringWidth: 'u_ringWidth',
    ringLife: 'u_ringLife',
    ringHue: 'u_ringHue',
    ringSaturation: 'u_ringSaturation',
    vigShow: 'u_vigShow',
};

// ---------------------------------------------------------------------------
// Panel section definitions (used by BackgroundSettingsTab)
// ---------------------------------------------------------------------------

export type ControlDef = {
    key: keyof ShaderParams;
    label: string;
    min: number;
    max: number;
    step: number;
};

export type SectionDef = {
    title: string;
    toggleKey?: keyof ShaderParams;
    capabilities: ShaderGroupCapabilities;
    controls: ControlDef[];
};

export const SHADER_SECTIONS: SectionDef[] = [
    {
        title: 'Nebula',
        toggleKey: 'nebShow',
        capabilities: {
            tone: createAliasedCapability('tone', 'nebHue'),
            saturation: createAliasedCapability('saturation', 'nebSat'),
            brightness: createParamCapability('brightness', 'nebBrightness'),
            contrast: createAliasedCapability('contrast', 'nebContrast'),
            intensity: createAliasedCapability('intensity', 'nebIntensity'),
            alpha: createParamCapability('alpha', 'nebAlpha'),
            blend: createBlendCapability('nebula'),
        },
        controls: [
            { key: 'nebSpeed', label: 'Speed', min: 0, max: 0.5, step: 0.005 },
            { key: 'nebIntensity', label: 'Intensity', min: 0, max: 2, step: 0.02 },
            { key: 'nebVariation', label: 'Variation', min: 0, max: 1, step: 0.02 },
            { key: 'nebContrast', label: 'Contrast', min: 0, max: 1, step: 0.02 },
            { key: 'nebDensity', label: 'Density', min: 0, max: 1, step: 0.01 },
            { key: 'nebHue', label: 'Hue', min: 0, max: 1, step: 0.01 },
            { key: 'nebSat', label: 'Saturation', min: 0, max: 2, step: 0.02 },
            { key: 'nebColorVar', label: 'Color Variation', min: 0, max: 1, step: 0.02 },
            { key: 'nebColorShift', label: 'Color Shift', min: 0, max: 1, step: 0.01 },
        ],
    },
    {
        title: 'Stars',
        toggleKey: 'starShow',
        capabilities: {
            tone: createParamCapability('tone', 'starHue'),
            saturation: createParamCapability('saturation', 'starSaturation'),
            brightness: createAliasedCapability('brightness', 'starBrightness'),
            contrast: createParamCapability('contrast', 'starContrast'),
            intensity: createDisabledCapability('intensity', 'Stars expose brightness instead of a separate strength channel.'),
            alpha: createParamCapability('alpha', 'starAlpha'),
            blend: createBlendCapability('stars'),
        },
        controls: [
            { key: 'starDensity', label: 'Density', min: 0, max: 3, step: 0.05 },
            { key: 'starBrightness', label: 'Brightness', min: 0, max: 2.5, step: 0.05 },
            { key: 'starSize', label: 'Size', min: 0.3, max: 2.5, step: 0.05 },
            { key: 'starTwinkle', label: 'Twinkle', min: 0, max: 1, step: 0.02 },
            { key: 'starParallax', label: 'Parallax Depth', min: 0, max: 3, step: 0.05 },
        ],
    },
    {
        title: 'Gravitational Lensing',
        toggleKey: 'lensShow',
        capabilities: {
            tone: createDisabledCapability('tone', 'Lensing is distortion-only and has no tint channel.'),
            saturation: createDisabledCapability('saturation', 'Lensing distorts geometry and has no color saturation channel.'),
            brightness: createDisabledCapability('brightness', 'Lensing does not emit light that can be brightness-adjusted.'),
            contrast: createDisabledCapability('contrast', 'Lensing has no contrast layer independent from the composed frame.'),
            intensity: createAliasedCapability('intensity', 'lensMass'),
            alpha: createAliasedCapability('alpha', 'lensOpacity'),
            blend: createDisabledCapability('blend', 'Lensing distorts the composed frame instead of blending a color layer.'),
        },
        controls: [
            { key: 'lensMass', label: 'Intensity', min: 0.01, max: 0.3, step: 0.005 },
            { key: 'lensSize', label: 'Size', min: 0.05, max: 1.0, step: 0.01 },
            { key: 'lensOpacity', label: 'Max Opacity', min: 0, max: 1, step: 0.01 },
            { key: 'lensAutoOpacity', label: 'Auto Breathing (0=Off 1=On)', min: 0, max: 1, step: 1 },
            { key: 'lensAutoSpeed', label: 'Breathing Speed', min: 0.05, max: 2.0, step: 0.05 },
            { key: 'lensDriftSpeed', label: 'Drift Speed', min: 0.1, max: 3.0, step: 0.05 },
        ],
    },
    {
        title: 'Chromatic Aberration',
        toggleKey: 'chromShow',
        capabilities: {
            tone: createParamCapability('tone', 'chromHue'),
            saturation: createParamCapability('saturation', 'chromSaturation'),
            brightness: createParamCapability('brightness', 'chromBrightness'),
            contrast: createParamCapability('contrast', 'chromContrast'),
            intensity: createAliasedCapability('intensity', 'chromIntensity'),
            alpha: createParamCapability('alpha', 'chromAlpha'),
            blend: createBlendCapability('chromatic'),
        },
        controls: [
            { key: 'chromIntensity', label: 'Intensity', min: 0, max: 2, step: 0.02 },
        ],
    },
    {
        title: 'Mouse Nebula',
        toggleKey: 'nebMouseShow',
        capabilities: {
            tone: createDisabledCapability('tone', 'Mouse Nebula is a displacement field with no independent color output.'),
            saturation: createDisabledCapability('saturation', 'Mouse Nebula has no color layer to saturate.'),
            brightness: createDisabledCapability('brightness', 'Mouse Nebula has no emitted light layer to brighten.'),
            contrast: createDisabledCapability('contrast', 'Mouse Nebula has no contrast control separate from displacement.'),
            intensity: createAliasedCapability('intensity', 'nebMouseIntensity'),
            alpha: createDisabledCapability('alpha', 'Mouse Nebula affects displacement only and has no opacity channel.'),
            blend: createDisabledCapability('blend', 'Mouse Nebula does not emit a color layer to blend.'),
        },
        controls: [
            { key: 'nebMouseIntensity', label: 'Intensity', min: 0, max: 2.5, step: 0.05 },
            { key: 'nebMouseLag', label: 'Follow Delay', min: 0.003, max: 0.2, step: 0.002 },
        ],
    },
    {
        title: 'Cursor Nebula',
        toggleKey: 'cursorNebShow',
        capabilities: {
            tone: createParamCapability('tone', 'cursorNebHue'),
            saturation: createParamCapability('saturation', 'cursorNebSaturation'),
            brightness: createParamCapability('brightness', 'cursorNebBrightness'),
            contrast: createParamCapability('contrast', 'cursorNebContrast'),
            intensity: createAliasedCapability('intensity', 'cursorNebIntensity'),
            alpha: createParamCapability('alpha', 'cursorNebAlpha'),
            blend: createBlendCapability('cursorNebula'),
        },
        controls: [
            { key: 'cursorNebIntensity', label: 'Intensity', min: 0, max: 1.5, step: 0.02 },
            { key: 'cursorNebRadius', label: 'Radius', min: 0.5, max: 4.0, step: 0.1 },
            { key: 'cursorNebLag', label: 'Follow Delay', min: 0.005, max: 0.3, step: 0.005 },
        ],
    },
    {
        title: 'Cursor Halo',
        toggleKey: 'haloShow',
        capabilities: {
            tone: createParamCapability('tone', 'haloHue'),
            saturation: createParamCapability('saturation', 'haloSaturation'),
            brightness: createParamCapability('brightness', 'haloBrightness'),
            contrast: createParamCapability('contrast', 'haloContrast'),
            intensity: createAliasedCapability('intensity', 'haloIntensity'),
            alpha: createParamCapability('alpha', 'haloAlpha'),
            blend: createBlendCapability('cursorHalo'),
        },
        controls: [
            { key: 'haloIntensity', label: 'Intensity', min: 0, max: 0.5, step: 0.01 },
            { key: 'haloLag', label: 'Follow Delay', min: 0.005, max: 0.3, step: 0.005 },
        ],
    },
    {
        title: 'Click Ring',
        toggleKey: 'ringShow',
        capabilities: {
            tone: createAliasedCapability('tone', 'ringHue'),
            saturation: createAliasedCapability('saturation', 'ringSaturation'),
            brightness: createParamCapability('brightness', 'ringBrightness'),
            contrast: createParamCapability('contrast', 'ringContrast'),
            intensity: createAliasedCapability('intensity', 'ringIntensity'),
            alpha: createParamCapability('alpha', 'ringAlpha'),
            blend: createBlendCapability('clickRing'),
        },
        controls: [
            { key: 'ringIntensity', label: 'Intensity', min: 0, max: 3.0, step: 0.05 },
            { key: 'ringSpeed', label: 'Expansion Speed', min: 0.1, max: 3.5, step: 0.05 },
            { key: 'ringWidth', label: 'Width', min: 0, max: 1, step: 0.02 },
            { key: 'ringLife', label: 'Duration', min: 0.2, max: 3.0, step: 0.05 },
            { key: 'ringHue', label: 'Color Hue', min: 0, max: 1, step: 0.01 },
            { key: 'ringSaturation', label: 'Saturation', min: 0, max: 2, step: 0.02 },
        ],
    },
    {
        title: 'Vignette',
        toggleKey: 'vigShow',
        capabilities: {
            tone: createOmittedCapability('tone', 'Vignette is currently exposure-only, not a tint layer.'),
            saturation: createOmittedCapability('saturation', 'Vignette has no first-slot saturation control in this slice.'),
            brightness: createOmittedCapability('brightness', 'Vignette brightness is not exposed as a first-slot control in this slice.'),
            contrast: createOmittedCapability('contrast', 'Vignette contrast is not exposed as a first-slot control in this slice.'),
            intensity: createOmittedCapability('intensity', 'Vignette has no first-slot intensity control in this slice.'),
            alpha: createOmittedCapability('alpha', 'Vignette opacity is not exposed as a first-slot control in this slice.'),
            blend: createOmittedCapability('blend', 'Vignette does not participate in blend-mode composition.'),
        },
        controls: [],
    },
];

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ShaderParamsStore {
    params: ShaderParams;
    blendModes: ShaderBlendModes;
    updateParam: (key: keyof ShaderParams, value: number) => void;
    updateBlendMode: (target: ShaderBlendTarget, value: ShaderBlendMode) => void;
    replaceAll: (state: PersistedShaderParamsState) => void;
    resetAll: () => void;
}

export type PersistedShaderParamsState = Pick<ShaderParamsStore, 'params' | 'blendModes'>;

function mergeShaderPersistedState(
    persistedState: unknown,
    currentState: ShaderParamsStore,
): ShaderParamsStore {
    const persistedValue =
        typeof persistedState === 'object' && persistedState !== null
            ? (persistedState as Partial<PersistedShaderParamsState>)
            : {};

    return {
        ...currentState,
        params: sanitizeShaderParams(persistedValue.params),
        blendModes: sanitizeShaderBlendModes(persistedValue.blendModes),
    };
}

export const useShaderParamsStore = create<ShaderParamsStore>()(
    persist(
        (set) => ({
            params: createDefaultShaderParams(),
            blendModes: createDefaultBlendModes(),

            updateParam: (key, value) =>
                set((s) => ({
                    params: { ...s.params, [key]: value },
                })),

            updateBlendMode: (target, value) => {
                void value;

                set((s) => ({
                    blendModes: { ...s.blendModes, [target]: SHADER_BLEND_DEFAULTS[target] },
                }));
            },

            replaceAll: (state) =>
                set({
                    params: sanitizeShaderParams(state.params),
                    blendModes: sanitizeShaderBlendModes(state.blendModes),
                }),

            resetAll: () =>
                set({
                    params: createDefaultShaderParams(),
                    blendModes: createDefaultBlendModes(),
                }),
        }),
        {
            name: 'hmi-shader-params',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ params: state.params }),
            merge: mergeShaderPersistedState,
        },
    ),
);
