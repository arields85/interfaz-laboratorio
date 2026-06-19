import { describe, expect, it } from 'vitest';
import {
    isTrendChartV2Widget,
    type TemporalSettingsConfig,
    type TrendChartV2WidgetConfig,
} from './admin.types';

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
});
