export const DEFAULT_ACTIVITY_ANALYTICS_TITLE = 'ACT-ANALYTICS';
export const DEFAULT_PROD_TREND_TITLE = 'PROD-TREND';

export function resolveCanonicalWidgetIdentityLabel(widgetType: string): string {
    if (widgetType === 'activity-analytics') {
        return DEFAULT_ACTIVITY_ANALYTICS_TITLE;
    }

    if (widgetType === 'prod-trend') {
        return DEFAULT_PROD_TREND_TITLE;
    }

    return widgetType.toUpperCase();
}
