import type { AnalyticsDataMode } from '../domain/analyticsDataMode.types';
import type { WidgetConfig } from '../domain/admin.types';
import { resolveAnalyticsDataMode } from './analyticsDataMode';
import { resolveProdTrendConfiguredMode } from './prodTrendDataMode';

const BINDING_MODE_WIDGET_TYPES = new Set<WidgetConfig['type']>([
    'metric-card',
    'kpi',
    'machine-activity',
    'trend-chart',
    'trend-chart-v2',
    'status',
    'connection-status',
]);

export function resolveWidgetDataMode(widget: WidgetConfig): AnalyticsDataMode | null {
    if (widget.type === 'activity-analytics') {
        return resolveAnalyticsDataMode(widget.displayOptions?.dataMode);
    }

    if (widget.type === 'prod-trend') {
        return resolveProdTrendConfiguredMode(widget.displayOptions?.dataMode);
    }

    if (!BINDING_MODE_WIDGET_TYPES.has(widget.type) || widget.hierarchyMode || !widget.binding) {
        return null;
    }

    return widget.binding.mode === 'simulated_value' ? 'simulated' : 'real';
}
