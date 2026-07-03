import type {
    ActivityAnalyticsProdTrendBandsDisplayOptions,
    ActivityAnalyticsAlphaPair,
    ActivityAnalyticsDisplayOptions,
    ActivityAnalyticsGroupBarWidths,
    ActivityAnalyticsSurfaceEffects,
    ActivityAnalyticsStateGradient,
    ActivityAnalyticsStateGradientKey,
    ActivityAnalyticsTrendBandAlphaTriple,
    ActivityAnalyticsTrendBandBlendMode,
} from '../domain/admin.types';
import { ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS } from '../domain/admin.types';
import {
    ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS,
    type ActivityAnalyticsDisplayMode,
} from '../domain/activityAnalytics.types';
import {
    resolveActivityAnalyticsDisplayRules,
} from './activityAnalyticsDisplayRules';

export const DEFAULT_ACTIVITY_ANALYTICS_RANGE = '7d' as const;
export const DEFAULT_ACTIVITY_ANALYTICS_GROUP_BY = 'shift' as const;
export const MIN_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE = 12;
export const MAX_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE = 200;
export const DEFAULT_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE = 40;
export const DEFAULT_GAUGE_VALUE_FONT_SIZE = 60;
export const DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW = 0.15;
export const DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW = 0.25;
export const DEFAULT_ACTIVITY_ANALYTICS_DISPLAY_MODE = 'kpis-and-bars' as const;
export const DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH = 1;
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUP_BAR_WIDTHS = {
    shift: 0.2,
    day: 0.3,
    week: 0.2,
    month: 0.2,
} as const;
export const MIN_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH = 0.1;
export const MAX_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH = 1.5;
export const ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS = ['shift', 'day', 'week', 'month'] as const;
export const DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR = '#94a3b8';
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENTS: Record<
    ActivityAnalyticsStateGradientKey,
    ActivityAnalyticsStateGradient
> = {
    prod: ['#ff9f65', '#e25290'],
    setup: ['#5250e2', '#d470e0'],
    stopped: ['#69a2ef', '#746be2'],
};
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENT_ALPHAS: Record<
    ActivityAnalyticsStateGradientKey,
    ActivityAnalyticsAlphaPair
> = {
    prod: [100, 100],
    setup: [100, 100],
    stopped: [100, 100],
};
export const DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS: Record<
    ActivityAnalyticsStateGradientKey,
    ActivityAnalyticsStateGradient
> = {
    prod: ['#22d3ee', '#10b981'],
    setup: ['#be7c0e', '#f59e0b'],
    stopped: ['#b03637', '#ef4444'],
};
export const DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS: Record<
    ActivityAnalyticsStateGradientKey,
    ActivityAnalyticsAlphaPair
> = {
    prod: [100, 100],
    setup: [100, 100],
    stopped: [100, 100],
};
export const DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS: ActivityAnalyticsSurfaceEffects = {
    glow: 72,
    blur: 0,
    topCap: false,
    topCapGlow: 100,
};
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUPED_BAR_EFFECTS: ActivityAnalyticsSurfaceEffects = {
    glow: 72,
    blur: 0,
    topCap: true,
    topCapGlow: 100,
};
export const DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS: ActivityAnalyticsSurfaceEffects = {
    glow: 75,
    blur: 0,
    topCap: true,
    topCapGlow: 100,
};
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_DONUT_EFFECTS: ActivityAnalyticsSurfaceEffects = {
    glow: 75,
    blur: 0,
    topCap: true,
    topCapGlow: 100,
};
export const DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS = [0, 50, 0] as const;
export const DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE = 'overlay' as const;
export const DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_COLOR_INPUT = DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR;
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_COLORS = ['#ff9f65', '#ff9f65', '#ff9f65'] as const;
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_ALPHAS = [0, 15, 0] as const;
export const DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_BLEND_MODE = 'normal' as const;

export { ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS };

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const MIN_ACTIVITY_ANALYTICS_VISUAL_EFFECT_PERCENTAGE = 0;
const MAX_ACTIVITY_ANALYTICS_VISUAL_EFFECT_PERCENTAGE = 100;
const MIN_ACTIVITY_ANALYTICS_VISUAL_EFFECT_BLUR = 0;
const MAX_ACTIVITY_ANALYTICS_VISUAL_EFFECT_BLUR = 8;

export type ResolvedActivityAnalyticsVisualEffects = {
    groupedBars: ActivityAnalyticsSurfaceEffects;
    donut: ActivityAnalyticsSurfaceEffects;
};

export type ResolvedActivityAnalyticsProdTrendBands = {
    colors: [string | undefined, string | undefined, string | undefined];
    alphas: [number, number, number];
    blendMode: ActivityAnalyticsTrendBandBlendMode;
};

export type ResolvedActivityAnalyticsDisplayOptions = Required<Pick<
    ActivityAnalyticsDisplayOptions,
    'range' | 'groupBy' | 'setupThresholdKw' | 'prodThresholdKw' | 'displayMode' | 'groupBarWidth' | 'groupBarWidths' | 'coverageColor' | 'stateGradients' | 'stateGradientAlphas' | 'visualEffects'
>> & Pick<ActivityAnalyticsDisplayOptions, 'start' | 'end' | 'donutCenterValueFontSize'>;
export type ResolvedActivityAnalyticsDisplayOptionsWithTrendBands = ResolvedActivityAnalyticsDisplayOptions & {
    prodTrendBands: ResolvedActivityAnalyticsProdTrendBands;
};

function createDefaultActivityAnalyticsGroupBarWidths(): Record<typeof ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS[number], number> {
    return {
        ...DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUP_BAR_WIDTHS,
    };
}

function cloneActivityAnalyticsStateGradients(
    stateGradients: Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient>,
): Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient> {
    return {
        prod: [...stateGradients.prod],
        setup: [...stateGradients.setup],
        stopped: [...stateGradients.stopped],
    };
}

function cloneActivityAnalyticsStateGradientAlphas(
    stateGradientAlphas: Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair>,
): Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair> {
    return {
        prod: [...stateGradientAlphas.prod],
        setup: [...stateGradientAlphas.setup],
        stopped: [...stateGradientAlphas.stopped],
    };
}

function cloneActivityAnalyticsSurfaceEffects(
    surfaceEffects: ActivityAnalyticsSurfaceEffects,
): ActivityAnalyticsSurfaceEffects {
    return { ...surfaceEffects };
}

function resolveGradientSlot(
    value: unknown,
    fallback: string,
): string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())
        ? value.trim()
        : fallback;
}

function resolveOptionalHexColor(value: unknown): string | undefined {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())
        ? value.trim().toLowerCase()
        : undefined;
}

function resolveGradientTuple(
    gradient: unknown,
    fallback: ActivityAnalyticsStateGradient,
): ActivityAnalyticsStateGradient {
    if (!Array.isArray(gradient)) {
        return [...fallback];
    }

    return [
        resolveGradientSlot(gradient[0], fallback[0]),
        resolveGradientSlot(gradient[1], fallback[1]),
    ];
}

export function clampActivityAnalyticsPercentage(value: unknown, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(
        MAX_ACTIVITY_ANALYTICS_VISUAL_EFFECT_PERCENTAGE,
        Math.max(MIN_ACTIVITY_ANALYTICS_VISUAL_EFFECT_PERCENTAGE, Number(value)),
    );
}

export function clampActivityAnalyticsVisualEffectBlur(value: unknown, fallback: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(
        MAX_ACTIVITY_ANALYTICS_VISUAL_EFFECT_BLUR,
        Math.max(MIN_ACTIVITY_ANALYTICS_VISUAL_EFFECT_BLUR, Number(value)),
    );
}

export function resolveActivityAnalyticsDonutCenterValueFontSize(value: unknown): number | undefined {
    if (!Number.isFinite(value)) {
        return undefined;
    }

    return Math.min(
        MAX_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE,
        Math.max(MIN_ACTIVITY_ANALYTICS_DONUT_CENTER_VALUE_FONT_SIZE, Number(value)),
    );
}

export function resolveActivityAnalyticsAlphaPair(
    alphaPair: unknown,
    fallback: ActivityAnalyticsAlphaPair,
): ActivityAnalyticsAlphaPair {
    if (!Array.isArray(alphaPair)) {
        return [...fallback];
    }

    return [
        clampActivityAnalyticsPercentage(alphaPair[0], fallback[0]),
        clampActivityAnalyticsPercentage(alphaPair[1], fallback[1]),
    ];
}

export function resolveActivityAnalyticsTrendBandAlphaTriple(
    alphaTriple: unknown,
    fallback: readonly [number, number, number] = DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
): [number, number, number] {
    if (!Array.isArray(alphaTriple)) {
        return [...fallback];
    }

    return [
        clampActivityAnalyticsPercentage(alphaTriple[0], fallback[0]),
        clampActivityAnalyticsPercentage(alphaTriple[1], fallback[1]),
        clampActivityAnalyticsPercentage(alphaTriple[2], fallback[2]),
    ];
}

export function resolveActivityAnalyticsSurfaceEffects(
    surfaceEffects: Partial<ActivityAnalyticsSurfaceEffects> | undefined,
    fallback: ActivityAnalyticsSurfaceEffects,
): ActivityAnalyticsSurfaceEffects {
    return {
        glow: clampActivityAnalyticsPercentage(surfaceEffects?.glow, fallback.glow),
        blur: clampActivityAnalyticsVisualEffectBlur(surfaceEffects?.blur, fallback.blur),
        topCap: typeof surfaceEffects?.topCap === 'boolean' ? surfaceEffects.topCap : fallback.topCap,
        topCapGlow: clampActivityAnalyticsPercentage(surfaceEffects?.topCapGlow, fallback.topCapGlow),
    };
}

export function resolveActivityAnalyticsStateGradients(
    rawStateGradients?: ActivityAnalyticsDisplayOptions['stateGradients'],
): Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsStateGradient> {
    return {
        prod: resolveGradientTuple(rawStateGradients?.prod, DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.prod),
        setup: resolveGradientTuple(rawStateGradients?.setup, DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.setup),
        stopped: resolveGradientTuple(rawStateGradients?.stopped, DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.stopped),
    };
}

export function resolveActivityAnalyticsCoverageColor(
    rawCoverageColor?: ActivityAnalyticsDisplayOptions['coverageColor'],
): string {
    return resolveGradientSlot(rawCoverageColor, DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR);
}

export function resolveActivityAnalyticsStateGradientAlphas(
    rawStateGradientAlphas?: ActivityAnalyticsDisplayOptions['stateGradientAlphas'],
): Record<ActivityAnalyticsStateGradientKey, ActivityAnalyticsAlphaPair> {
    return {
        prod: resolveActivityAnalyticsAlphaPair(rawStateGradientAlphas?.prod, DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.prod),
        setup: resolveActivityAnalyticsAlphaPair(rawStateGradientAlphas?.setup, DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.setup),
        stopped: resolveActivityAnalyticsAlphaPair(rawStateGradientAlphas?.stopped, DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.stopped),
    };
}

export function resolveActivityAnalyticsVisualEffects(
    rawVisualEffects?: ActivityAnalyticsDisplayOptions['visualEffects'],
): ResolvedActivityAnalyticsVisualEffects {
    return {
        groupedBars: resolveActivityAnalyticsSurfaceEffects(
            rawVisualEffects?.groupedBars,
            DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
        ),
        donut: resolveActivityAnalyticsSurfaceEffects(
            rawVisualEffects?.donut,
            DEFAULT_ACTIVITY_ANALYTICS_DONUT_EFFECTS,
        ),
    };
}

export function resolveActivityAnalyticsProdTrendBandColors(
    rawColors?: ActivityAnalyticsProdTrendBandsDisplayOptions['colors'],
): [string | undefined, string | undefined, string | undefined] {
    if (!Array.isArray(rawColors)) {
        return [undefined, undefined, undefined];
    }

    return [
        resolveOptionalHexColor(rawColors[0]),
        resolveOptionalHexColor(rawColors[1]),
        resolveOptionalHexColor(rawColors[2]),
    ];
}

export function resolveActivityAnalyticsProdTrendBandBlendMode(
    rawBlendMode?: string,
): ActivityAnalyticsTrendBandBlendMode {
    return ACTIVITY_ANALYTICS_TREND_BAND_BLEND_MODE_OPTIONS.includes(rawBlendMode as ActivityAnalyticsTrendBandBlendMode)
        ? rawBlendMode as ActivityAnalyticsTrendBandBlendMode
        : DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE;
}

export function resolveActivityAnalyticsProdTrendBands(
    rawProdTrendBands?: ActivityAnalyticsDisplayOptions['prodTrendBands'],
): ResolvedActivityAnalyticsProdTrendBands {
    return {
        colors: resolveActivityAnalyticsProdTrendBandColors(rawProdTrendBands?.colors),
        alphas: resolveActivityAnalyticsTrendBandAlphaTriple(rawProdTrendBands?.alphas),
        blendMode: resolveActivityAnalyticsProdTrendBandBlendMode(rawProdTrendBands?.blendMode),
    };
}

function normalizeActivityAnalyticsDisplayMode(
    displayMode?: string,
): ActivityAnalyticsDisplayMode {
    return ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS.includes(displayMode as ActivityAnalyticsDisplayMode)
        ? displayMode as ActivityAnalyticsDisplayMode
        : DEFAULT_ACTIVITY_ANALYTICS_DISPLAY_MODE;
}

export function clampActivityAnalyticsGroupBarWidth(groupBarWidth?: number): number {
    if (!Number.isFinite(groupBarWidth)) {
        return DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH;
    }

    const finiteGroupBarWidth = Number(groupBarWidth);

    return Math.min(
        MAX_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH,
        Math.max(MIN_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH, finiteGroupBarWidth),
    );
}

export function resolveActivityAnalyticsGroupBarWidths(
    groupBarWidths: ActivityAnalyticsGroupBarWidths | undefined,
    legacyGroupBarWidth?: number,
): Record<typeof ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS[number], number> {
    const fallbackWidth = clampActivityAnalyticsGroupBarWidth(legacyGroupBarWidth);

    return ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS.reduce<Record<typeof ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS[number], number>>((resolved, groupBy) => {
        resolved[groupBy] = clampActivityAnalyticsGroupBarWidth(groupBarWidths?.[groupBy] ?? fallbackWidth);
        return resolved;
    }, createDefaultActivityAnalyticsGroupBarWidths());
}

export function resolveActivityAnalyticsGroupBarWidthForGroup(
    groupBy: typeof ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH_GROUPS[number],
    groupBarWidths: ActivityAnalyticsGroupBarWidths | undefined,
    legacyGroupBarWidth?: number,
): number {
    return resolveActivityAnalyticsGroupBarWidths(groupBarWidths, legacyGroupBarWidth)[groupBy];
}

export function createDefaultActivityAnalyticsDisplayOptions(): ActivityAnalyticsDisplayOptions {
    const groupBarWidths = createDefaultActivityAnalyticsGroupBarWidths();

    return {
        range: DEFAULT_ACTIVITY_ANALYTICS_RANGE,
        groupBy: DEFAULT_ACTIVITY_ANALYTICS_GROUP_BY,
        setupThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
        prodThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
        displayMode: normalizeActivityAnalyticsDisplayMode(),
        groupBarWidth: groupBarWidths[DEFAULT_ACTIVITY_ANALYTICS_GROUP_BY],
        groupBarWidths,
        coverageColor: DEFAULT_ACTIVITY_ANALYTICS_COVERAGE_COLOR,
        stateGradients: cloneActivityAnalyticsStateGradients(DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENTS),
        stateGradientAlphas: cloneActivityAnalyticsStateGradientAlphas(DEFAULT_ACTIVITY_ANALYTICS_INITIAL_STATE_GRADIENT_ALPHAS),
        prodTrendBands: {
            colors: [...DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_COLORS] as ActivityAnalyticsProdTrendBandsDisplayOptions['colors'],
            alphas: [...DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_ALPHAS] as ActivityAnalyticsTrendBandAlphaTriple,
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_INITIAL_PROD_TREND_BAND_BLEND_MODE,
        },
        visualEffects: {
            groupedBars: cloneActivityAnalyticsSurfaceEffects(DEFAULT_ACTIVITY_ANALYTICS_INITIAL_GROUPED_BAR_EFFECTS),
            donut: cloneActivityAnalyticsSurfaceEffects(DEFAULT_ACTIVITY_ANALYTICS_INITIAL_DONUT_EFFECTS),
        },
    };
}

export function resolveActivityAnalyticsDisplayOptions(
    displayOptions?: ActivityAnalyticsDisplayOptions,
): ResolvedActivityAnalyticsDisplayOptionsWithTrendBands {
    const displayRules = resolveActivityAnalyticsDisplayRules({
        range: displayOptions?.range,
        start: displayOptions?.start,
        end: displayOptions?.end,
        groupBy: displayOptions?.groupBy,
    });

    const resolvedGroupBarWidths = resolveActivityAnalyticsGroupBarWidths(
        displayOptions?.groupBarWidths,
        displayOptions?.groupBarWidth,
    );

    return {
        range: displayRules.range,
        start: displayOptions?.start,
        end: displayOptions?.end,
        groupBy: displayRules.groupBy,
        donutCenterValueFontSize: resolveActivityAnalyticsDonutCenterValueFontSize(displayOptions?.donutCenterValueFontSize),
        setupThresholdKw: displayOptions?.setupThresholdKw ?? DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
        prodThresholdKw: displayOptions?.prodThresholdKw ?? DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
        displayMode: normalizeActivityAnalyticsDisplayMode(displayOptions?.displayMode),
        groupBarWidth: resolvedGroupBarWidths[displayRules.groupBy],
        groupBarWidths: resolvedGroupBarWidths,
        coverageColor: resolveActivityAnalyticsCoverageColor(displayOptions?.coverageColor),
        stateGradients: resolveActivityAnalyticsStateGradients(displayOptions?.stateGradients),
        stateGradientAlphas: resolveActivityAnalyticsStateGradientAlphas(displayOptions?.stateGradientAlphas),
        prodTrendBands: resolveActivityAnalyticsProdTrendBands(displayOptions?.prodTrendBands),
        visualEffects: resolveActivityAnalyticsVisualEffects(displayOptions?.visualEffects),
    };
}
