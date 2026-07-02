import type { WidgetConfig } from '../domain/admin.types';

export const DEFAULT_ACTIVITY_ANALYTICS_TITLE = 'ACT-ANALYTICS';
export const DEFAULT_PROD_TREND_TITLE = 'PROD-TREND';

const LEGACY_ACTIVITY_ANALYTICS_TITLES = new Set([
    'ACTIVITY-ANALYTICS',
    'ANÁLISIS DE ACTIVIDAD',
    'ANALISIS DE ACTIVIDAD',
]);

const LEGACY_PROD_TREND_TITLES = new Set([
    'TENDENCIA % PROD',
]);

function normalizeLegacyTitle(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
}

export function resolveActivityAnalyticsDisplayTitle(widget: Pick<WidgetConfig, 'type' | 'title'>): string {
    const trimmedTitle = widget.title?.trim() ?? '';
    const normalizedTitle = normalizeLegacyTitle(trimmedTitle);

    if (widget.type === 'activity-analytics') {
        if (!trimmedTitle || LEGACY_ACTIVITY_ANALYTICS_TITLES.has(normalizedTitle)) {
            return DEFAULT_ACTIVITY_ANALYTICS_TITLE;
        }
    }

    if (widget.type === 'prod-trend') {
        if (!trimmedTitle || LEGACY_PROD_TREND_TITLES.has(normalizedTitle)) {
            return DEFAULT_PROD_TREND_TITLE;
        }
    }

    return trimmedTitle || widget.type;
}
