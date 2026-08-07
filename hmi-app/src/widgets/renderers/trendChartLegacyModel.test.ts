import { describe, expect, it } from 'vitest';
import type { DataHistoryResponse } from '../../domain/dataContract.types';
import {
    buildTrendChartLegacyModel,
    mapTrendChartLegacyHistory,
    resolveTrendChartLegacyDomain,
    resolveTrendChartLegacyHoverIndex,
} from './trendChartLegacyModel';

const response: DataHistoryResponse = {
    contractVersion: '1.0.0',
    machineId: 101,
    variableKey: 'temperature',
    range: 'hora',
    unit: '°C',
    series: [
        { timestamp: '2026-04-22T10:00:00.000Z', value: 45 },
        { timestamp: '2026-04-22T11:00:00.000Z', value: null },
        { timestamp: '2026-04-22T12:00:00.000Z', value: 52 },
    ],
    summary: { last: 52, min: 45, max: 52, avg: 48.5 },
};

describe('trendChartLegacyModel', () => {
    it('maps finite history without bridging nulls into fake values and preserves legacy timestamp labels', () => {
        const mapped = mapTrendChartLegacyHistory(response, 'hora');

        expect(mapped).toEqual([
            { time: expect.stringMatching(/^\d{2}:\d{2}$/), value: 45 },
            { time: expect.stringMatching(/^\d{2}:\d{2}$/), value: 52 },
        ]);
        expect(resolveTrendChartLegacyDomain(mapped)).toEqual({ min: 43, max: 54 });
    });

    it('builds the complete static model with stable points, paths, labels, and layout', () => {
        const data = mapTrendChartLegacyHistory(response, 'hora');
        const model = buildTrendChartLegacyModel({
            widgetId: 'trend-1',
            width: 320,
            height: 180,
            data,
            unit: '°C',
            summary: response.summary,
            font: '400 12px monospace',
            letterSpacing: 0,
        });

        expect(model.points).toHaveLength(2);
        expect(model.linePath).not.toBe('');
        expect(model.areaPath).not.toBe('');
        expect(model.visibleLabelIndices).toEqual([0, 1]);
        expect(model.summaryLabels).toEqual({ min: '45°c', max: '52°c', avg: '49°c' });
    });

    it('resolves equidistant hover indices in O(1) with later-point ties and edge clamping', () => {
        expect(resolveTrendChartLegacyHoverIndex({ chartX: -100, x0: 10, step: 25, dataLength: 5 })).toBe(0);
        expect(resolveTrendChartLegacyHoverIndex({ chartX: 22.49, x0: 10, step: 25, dataLength: 5 })).toBe(0);
        expect(resolveTrendChartLegacyHoverIndex({ chartX: 22.5, x0: 10, step: 25, dataLength: 5 })).toBe(1);
        expect(resolveTrendChartLegacyHoverIndex({ chartX: 10_000, x0: 10, step: 25, dataLength: 5 })).toBe(4);
        expect(resolveTrendChartLegacyHoverIndex({ chartX: 10, x0: 10, step: 0, dataLength: 1 })).toBe(0);
        expect(resolveTrendChartLegacyHoverIndex({ chartX: 10, x0: 10, step: 0, dataLength: 0 })).toBeNull();
    });
});
