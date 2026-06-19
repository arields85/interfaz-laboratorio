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
        expect(
            resolveActivityAnalyticsDisplayOptions({
                displayMode: 'kpis-bars-and-secondary',
            }),
        ).toMatchObject({
            displayMode: 'kpis-and-bars',
        });
    });
});
