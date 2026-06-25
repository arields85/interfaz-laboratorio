import { describe, expect, it } from 'vitest';
import {
    ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS,
    createDefaultActivityAnalyticsDisplayOptions,
    resolveActivityAnalyticsDisplayOptions,
} from './activityAnalyticsWidgetDefaults';

describe('activityAnalyticsWidgetDefaults', () => {
    it('exposes only first-release display modes', () => {
        expect(ACTIVITY_ANALYTICS_DISPLAY_MODE_OPTIONS).toEqual(['kpis-and-bars']);
    });

    it('defaults unsupported legacy display modes back to kpis-and-bars', () => {
        expect(createDefaultActivityAnalyticsDisplayOptions().displayMode).toBe('kpis-and-bars');
        expect(createDefaultActivityAnalyticsDisplayOptions().range).toBe('7d');
        expect(
            resolveActivityAnalyticsDisplayOptions({
                displayMode: 'kpis-bars-and-secondary',
            }),
        ).toMatchObject({
            displayMode: 'kpis-and-bars',
        });
    });

    it('normalizes legacy 1h, removed 24h, and invalid grouped combinations through the shared rules contract', () => {
        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '1h',
                groupBy: 'month',
            }),
        ).toMatchObject({
            range: '7d',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '24h',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: '7d',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: 'custom',
                start: '2026-06-01T10:00:00.000Z',
                end: '2026-06-01T18:00:00.000Z',
                groupBy: 'week',
            }),
        ).toMatchObject({
            range: 'custom',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: 'custom',
                start: '2026-06-01T10:00:00.000Z',
                end: '2026-06-11T10:00:00.000Z',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: 'custom',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '30d',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: '30d',
            groupBy: 'shift',
        });

        expect(
            resolveActivityAnalyticsDisplayOptions({
                range: '12m',
                groupBy: 'shift',
            }),
        ).toMatchObject({
            range: '12m',
            groupBy: 'shift',
        });
    });
});
