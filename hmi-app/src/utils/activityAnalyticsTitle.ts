import type { WidgetConfig } from '../domain/admin.types';

export const DEFAULT_ACTIVITY_ANALYTICS_TITLE = 'ACT-ANALYTICS';

const LEGACY_ACTIVITY_ANALYTICS_TITLES = new Set([
    'ACTIVITY-ANALYTICS',
    'ANÁLISIS DE ACTIVIDAD',
    'ANALISIS DE ACTIVIDAD',
]);

function normalizeLegacyTitle(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
}

export function resolveActivityAnalyticsDisplayTitle(widget: Pick<WidgetConfig, 'type' | 'title'>): string {
    const trimmedTitle = widget.title?.trim() ?? '';

    if (widget.type === 'activity-analytics') {
        if (!trimmedTitle || LEGACY_ACTIVITY_ANALYTICS_TITLES.has(normalizeLegacyTitle(trimmedTitle))) {
            return DEFAULT_ACTIVITY_ANALYTICS_TITLE;
        }
    }

    return trimmedTitle || widget.type;
}
