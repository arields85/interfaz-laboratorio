import type {
    ActivityAnalyticsAlphaPair,
    ActivityAnalyticsStateGradient,
    ProdTrendDisplayOptions,
} from '../domain/admin.types';
import type { ProdTrendConfiguredMode } from '../domain/prodTrendDataMode.types';
import {
    DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH,
    DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
    DEFAULT_ACTIVITY_ANALYTICS_RANGE,
    DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
    DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS,
    resolveActivityAnalyticsDisplayOptions,
    resolveActivityAnalyticsGroupBarWidths,
    resolveActivityAnalyticsProdTrendBands,
} from './activityAnalyticsWidgetDefaults';

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const PROD_TREND_THEME_DEFAULT_LINE_COLOR_TOKENS = [
    'var(--color-widget-gradient-to)',
    'var(--color-widget-gradient-from)',
] as const satisfies ActivityAnalyticsStateGradient;
const PROD_TREND_THEME_DEFAULT_LINE_COLOR_KEYS = [
    '--color-widget-gradient-to',
    '--color-widget-gradient-from',
] as const;

export const DEFAULT_PROD_TREND_GROUP_BY = 'shift' as const;
export const DEFAULT_PROD_TREND_DATA_MODE: ProdTrendConfiguredMode = 'real';
export const DEFAULT_PROD_TREND_LINE_COLORS: ActivityAnalyticsStateGradient = [
    '#3b82f6',
    '#a855f7',
];
export const DEFAULT_PROD_TREND_LINE_COLOR_ALPHAS: ActivityAnalyticsAlphaPair = [
    ...DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.prod,
];

export type ResolvedProdTrendDisplayOptions = Required<Pick<
    ProdTrendDisplayOptions,
    'dataMode' | 'range' | 'groupBy' | 'setupThresholdKw' | 'prodThresholdKw' | 'groupBarWidth' | 'groupBarWidths' | 'trendLineColors' | 'trendLineColorAlphas' | 'lineStrokeWidth' | 'lineGlowBlur'
>> & Pick<ProdTrendDisplayOptions, 'start' | 'end'> & {
    prodTrendBands: ReturnType<typeof resolveActivityAnalyticsProdTrendBands>;
};

const DEFAULT_PROD_TREND_LINE_STROKE_WIDTH = 2.5;
const DEFAULT_PROD_TREND_LINE_GLOW_BLUR = 3;

function resolveProdTrendLineColorSlot(value: unknown, fallback: string): string {
    return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())
        ? value.trim().toLowerCase()
        : fallback;
}

function resolveProdTrendLineColors(
    trendLineColors: unknown,
    fallback: ActivityAnalyticsStateGradient,
): ActivityAnalyticsStateGradient {
    if (!Array.isArray(trendLineColors)) {
        return [...fallback];
    }

    return [
        resolveProdTrendLineColorSlot(trendLineColors[0], fallback[0]),
        resolveProdTrendLineColorSlot(trendLineColors[1], fallback[1]),
    ];
}

export function resolveProdTrendThemeDefaultLineColors(): ActivityAnalyticsStateGradient {
    if (typeof document === 'undefined') {
        return [...DEFAULT_PROD_TREND_LINE_COLORS];
    }

    const rootStyle = getComputedStyle(document.documentElement);

    return PROD_TREND_THEME_DEFAULT_LINE_COLOR_KEYS.map((key, index) => {
        const resolvedValue = rootStyle.getPropertyValue(key).trim();
        return HEX_COLOR_PATTERN.test(resolvedValue) ? resolvedValue.toLowerCase() : DEFAULT_PROD_TREND_LINE_COLORS[index];
    }) as ActivityAnalyticsStateGradient;
}

export function createDefaultProdTrendDisplayOptions(): ProdTrendDisplayOptions {
    return {
        dataMode: DEFAULT_PROD_TREND_DATA_MODE,
        range: DEFAULT_ACTIVITY_ANALYTICS_RANGE,
        groupBy: DEFAULT_PROD_TREND_GROUP_BY,
        setupThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
        prodThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
        groupBarWidth: DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH,
        groupBarWidths: resolveActivityAnalyticsGroupBarWidths(undefined, DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH),
        trendLineColorAlphas: [...DEFAULT_PROD_TREND_LINE_COLOR_ALPHAS],
        prodTrendBands: {
            alphas: [...DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS],
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
        },
    };
}

function resolveProdTrendDataMode(value: unknown): ProdTrendConfiguredMode {
    return value === 'simulated' || value === 'automatic' || value === 'real'
        ? value
        : DEFAULT_PROD_TREND_DATA_MODE;
}

export function resolveProdTrendDisplayOptions(
    displayOptions?: ProdTrendDisplayOptions,
    trendLineColorFallback: ActivityAnalyticsStateGradient = PROD_TREND_THEME_DEFAULT_LINE_COLOR_TOKENS,
): ResolvedProdTrendDisplayOptions {
    const resolvedActivityAnalytics = resolveActivityAnalyticsDisplayOptions({
        range: displayOptions?.range,
        start: displayOptions?.start,
        end: displayOptions?.end,
        groupBy: displayOptions?.groupBy,
        setupThresholdKw: displayOptions?.setupThresholdKw,
        prodThresholdKw: displayOptions?.prodThresholdKw,
        groupBarWidth: displayOptions?.groupBarWidth,
        groupBarWidths: displayOptions?.groupBarWidths,
        prodTrendBands: displayOptions?.prodTrendBands,
        stateGradients: {
            prod: displayOptions?.trendLineColors,
        },
        stateGradientAlphas: {
            prod: displayOptions?.trendLineColorAlphas,
        },
        visualEffects: {
            groupedBars: DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
        },
    });

    return {
        dataMode: resolveProdTrendDataMode(displayOptions?.dataMode),
        range: resolvedActivityAnalytics.range,
        start: resolvedActivityAnalytics.start,
        end: resolvedActivityAnalytics.end,
        groupBy: resolvedActivityAnalytics.groupBy,
        setupThresholdKw: resolvedActivityAnalytics.setupThresholdKw,
        prodThresholdKw: resolvedActivityAnalytics.prodThresholdKw,
        groupBarWidth: resolvedActivityAnalytics.groupBarWidth,
        groupBarWidths: resolvedActivityAnalytics.groupBarWidths,
        trendLineColors: resolveProdTrendLineColors(displayOptions?.trendLineColors, trendLineColorFallback),
        trendLineColorAlphas: [...(resolvedActivityAnalytics.stateGradientAlphas.prod ?? DEFAULT_PROD_TREND_LINE_COLOR_ALPHAS)],
        prodTrendBands: resolvedActivityAnalytics.prodTrendBands,
        lineStrokeWidth: typeof displayOptions?.lineStrokeWidth === 'number'
            ? displayOptions.lineStrokeWidth
            : DEFAULT_PROD_TREND_LINE_STROKE_WIDTH,
        lineGlowBlur: typeof displayOptions?.lineGlowBlur === 'number'
            ? displayOptions.lineGlowBlur
            : DEFAULT_PROD_TREND_LINE_GLOW_BLUR,
    };
}
