import { describe, expect, it } from 'vitest';
import {
    isActivityAnalyticsWidget,
    isProdTrendWidget,
    type ActivityAnalyticsWidgetConfig,
    type ProdTrendWidgetConfig,
    isTrendChartV2Widget,
    type TemporalSettingsConfig,
    type TrendChartV2WidgetConfig,
} from './admin.types';
import { ACTIVITY_ANALYTICS_RANGE_OPTIONS, type ActivityAnalyticsResponse } from './activityAnalytics.types';

describe('admin.types trend-chart-v2 contracts', () => {
    it('narrows trend-chart-v2 widgets and carries temporal settings types', () => {
        const widget: TrendChartV2WidgetConfig = {
            id: 'trend-v2-1',
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 9 },
            binding: { mode: 'simulated_value', simulatedValue: 50 },
            displayOptions: {
                historicalDensity: 'high',
                shiftDisplayMode: 'lines',
                showShifts: true,
            },
        };
        const temporalSettings: TemporalSettingsConfig = {
            plantTimezone: 'America/Argentina/Buenos_Aires',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' }],
        };

        expect(isTrendChartV2Widget(widget)).toBe(true);
        expect(widget.displayOptions?.historicalDensity).toBe('high');
        expect(widget.displayOptions?.shiftDisplayMode).toBe('lines');
        expect(widget.displayOptions?.showShifts).toBe(true);
        expect(temporalSettings.plantTimezone).toBe('America/Argentina/Buenos_Aires');
        expect(temporalSettings.shifts[0]?.end).toBe('14:00');
    });

    it('narrows activity-analytics widgets and exposes preset range contracts', () => {
        const widget: ActivityAnalyticsWidgetConfig = {
            id: 'activity-1',
            type: 'activity-analytics',
            title: 'Activity Analytics',
            position: { x: 0, y: 0 },
            size: { w: 8, h: 6 },
            binding: { mode: 'real_variable', bindingVersion: 'node-red-v1', machineId: 101 },
            displayOptions: {
                range: '24h',
                groupBy: 'day',
                setupThresholdKw: 5,
                prodThresholdKw: 15,
            },
        };

        const response: ActivityAnalyticsResponse = {
            contractVersion: '1.0.0',
            machineId: 101,
            variableKey: 'Total kW',
            range: '24h',
            unit: 'kW',
            purpose: 'activity-analytics',
            window: {
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-19T10:00:00.000Z',
                bucket: '5m',
                bucketMs: 300000,
            },
            series: [],
            summary: null,
        };

        expect(isActivityAnalyticsWidget(widget)).toBe(true);
        expect(widget.displayOptions?.prodThresholdKw).toBe(15);
        expect(ACTIVITY_ANALYTICS_RANGE_OPTIONS).toEqual(['1h', '24h', '7d', '30d', '12m', 'custom']);
        expect(response.purpose).toBe('activity-analytics');
    });

    it('narrows prod-trend widgets and reuses activity analytics range contracts', () => {
        const widget: ProdTrendWidgetConfig = {
            id: 'prod-trend-1',
            type: 'prod-trend',
            title: 'PROD-TREND',
            position: { x: 0, y: 0 },
            size: { w: 11, h: 4 },
            binding: { mode: 'real_variable', bindingVersion: 'node-red-v1', machineId: 101 },
            displayOptions: {
                range: '30d',
                groupBy: 'week',
                setupThresholdKw: 5,
                prodThresholdKw: 15,
                trendLineColors: ['#22d3ee', '#10b981'],
            },
        };

        expect(isProdTrendWidget(widget)).toBe(true);
        expect(widget.displayOptions?.groupBy).toBe('week');
        expect(widget.displayOptions?.trendLineColors?.[0]).toBe('#22d3ee');
    });
});
