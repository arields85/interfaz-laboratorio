import type {
    ActivityAnalyticsAlphaPair,
    ActivityAnalyticsStateGradient,
    ProdTrendDisplayOptions,
} from '../domain/admin.types';
import {
    DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH,
    DEFAULT_ACTIVITY_ANALYTICS_GROUPED_BAR_EFFECTS,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS,
    DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
    DEFAULT_ACTIVITY_ANALYTICS_RANGE,
    DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
    DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS,
    DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS,
    resolveActivityAnalyticsDisplayOptions,
    resolveActivityAnalyticsGroupBarWidths,
    resolveActivityAnalyticsProdTrendBands,
} from './activityAnalyticsWidgetDefaults';

export const DEFAULT_PROD_TREND_GROUP_BY = 'shift' as const;
export const DEFAULT_PROD_TREND_LINE_COLORS: ActivityAnalyticsStateGradient = [
    ...DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENTS.prod,
];
export const DEFAULT_PROD_TREND_LINE_COLOR_ALPHAS: ActivityAnalyticsAlphaPair = [
    ...DEFAULT_ACTIVITY_ANALYTICS_STATE_GRADIENT_ALPHAS.prod,
];

export type ResolvedProdTrendDisplayOptions = Required<Pick<
    ProdTrendDisplayOptions,
    'range' | 'groupBy' | 'setupThresholdKw' | 'prodThresholdKw' | 'groupBarWidth' | 'groupBarWidths' | 'trendLineColors' | 'trendLineColorAlphas'
>> & Pick<ProdTrendDisplayOptions, 'start' | 'end'> & {
    prodTrendBands: ReturnType<typeof resolveActivityAnalyticsProdTrendBands>;
};

export function createDefaultProdTrendDisplayOptions(): ProdTrendDisplayOptions {
    return {
        range: DEFAULT_ACTIVITY_ANALYTICS_RANGE,
        groupBy: DEFAULT_PROD_TREND_GROUP_BY,
        setupThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_SETUP_THRESHOLD_KW,
        prodThresholdKw: DEFAULT_ACTIVITY_ANALYTICS_PROD_THRESHOLD_KW,
        groupBarWidth: DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH,
        groupBarWidths: resolveActivityAnalyticsGroupBarWidths(undefined, DEFAULT_ACTIVITY_ANALYTICS_GROUP_BAR_WIDTH),
        trendLineColors: [...DEFAULT_PROD_TREND_LINE_COLORS],
        trendLineColorAlphas: [...DEFAULT_PROD_TREND_LINE_COLOR_ALPHAS],
        prodTrendBands: {
            alphas: [...DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_ALPHAS],
            blendMode: DEFAULT_ACTIVITY_ANALYTICS_PROD_TREND_BAND_BLEND_MODE,
        },
    };
}

export function resolveProdTrendDisplayOptions(
    displayOptions?: ProdTrendDisplayOptions,
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
        range: resolvedActivityAnalytics.range,
        start: resolvedActivityAnalytics.start,
        end: resolvedActivityAnalytics.end,
        groupBy: resolvedActivityAnalytics.groupBy,
        setupThresholdKw: resolvedActivityAnalytics.setupThresholdKw,
        prodThresholdKw: resolvedActivityAnalytics.prodThresholdKw,
        groupBarWidth: resolvedActivityAnalytics.groupBarWidth,
        groupBarWidths: resolvedActivityAnalytics.groupBarWidths,
        trendLineColors: [...(resolvedActivityAnalytics.stateGradients.prod ?? DEFAULT_PROD_TREND_LINE_COLORS)],
        trendLineColorAlphas: [...(resolvedActivityAnalytics.stateGradientAlphas.prod ?? DEFAULT_PROD_TREND_LINE_COLOR_ALPHAS)],
        prodTrendBands: resolvedActivityAnalytics.prodTrendBands,
    };
}
