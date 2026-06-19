import { describe, expect, it } from 'vitest';

import {
    buildTrendChartV2SimulatedHistory,
    resolveTrendChartV2SimulationPointCount,
} from './trendChartV2Simulation';

describe('trendChartV2Simulation', () => {
    it('generates deterministic history for the same widget and range inputs', () => {
        const first = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        const second = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: '24h',
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        expect(second).toEqual(first);
        expect(first.series).toHaveLength(resolveTrendChartV2SimulationPointCount('24h'));
    });

    it('changes timestamps and cadence when the selected range changes', () => {
        const shortRange = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: '1h',
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        const longRange = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: '30d',
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        expect(shortRange.window?.start).toBe('2026-06-18T23:00:00.000Z');
        expect(shortRange.window?.end).toBe('2026-06-19T00:00:00.000Z');
        expect(longRange.window?.start).toBe('2026-05-20T00:00:00.000Z');
        expect(longRange.window?.end).toBe('2026-06-19T00:00:00.000Z');
        expect(shortRange.series).toHaveLength(resolveTrendChartV2SimulationPointCount('1h'));
        expect(longRange.series).toHaveLength(resolveTrendChartV2SimulationPointCount('30d'));
        expect(longRange.series[1].timestampMs - longRange.series[0].timestampMs).toBeGreaterThan(
            shortRange.series[1].timestampMs - shortRange.series[0].timestampMs,
        );
    });

    it('supports custom windows and stable seed inputs without raw randomness drift', () => {
        const custom = buildTrendChartV2SimulatedHistory({
            widgetId: 'trend-v2-simulated',
            machineId: 101,
            variableKey: 'temperature',
            range: 'custom',
            customWindow: {
                start: '2026-06-18T08:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            },
            baseValue: 50,
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
        });

        expect(custom.window).toEqual({
            start: '2026-06-18T08:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
            bucketMs: 6 * 60 * 1000,
        });
        expect(custom.series[0].timestamp).toBe('2026-06-18T08:00:00.000Z');
        expect(custom.series.at(-1)?.timestamp).toBe('2026-06-18T12:00:00.000Z');
        expect(custom.summary.last).not.toBeNull();
    });
});
