import { describe, expect, it } from 'vitest';
import { resolveActivityAnalyticsVisualLayout } from './activityAnalyticsVisualLayout';

describe('resolveActivityAnalyticsVisualLayout', () => {
    it('keeps a roomy widget in fit mode for summary and grouped charts', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 640, height: 420, groupCount: 4, groupBy: 'day', range: '24h' })).toEqual({
            summary: { mode: 'axis-bars', density: 'fit' },
            groups: { mode: 'axis-stacked', density: 'fit', minSlotWidthPx: 70, sampleLabels: false },
            turnoDetailEligible: false,
        });
    });

    it('compresses grouped charts before allowing horizontal scroll', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 500, height: 360, groupCount: 7, groupBy: 'shift', range: '7d' })).toEqual({
            summary: { mode: 'compact-axis-bars', density: 'compress' },
            groups: { mode: 'axis-stacked', density: 'fit', minSlotWidthPx: 70, sampleLabels: false },
            turnoDetailEligible: true,
        });
    });

    it('uses scroll only after compression can no longer keep grouped bars readable', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 420, height: 360, groupCount: 8, groupBy: 'shift', range: '7d' })).toEqual({
            summary: { mode: 'compact-axis-bars', density: 'compress' },
            groups: { mode: 'axis-stacked', density: 'fit', minSlotWidthPx: 70, sampleLabels: false },
            turnoDetailEligible: true,
        });
    });

    it('keeps low-range Turno detail in compress mode before falling back to scroll', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 640, height: 360, groupCount: 14, groupBy: 'shift', range: '7d', turnoMode: 'detail' })).toEqual({
            summary: { mode: 'compact-axis-bars', density: 'compress' },
            groups: { mode: 'axis-stacked', density: 'compress', minSlotWidthPx: 36, sampleLabels: true },
            turnoDetailEligible: true,
        });
    });

    it('keeps Turno Resumen non-scroll by definition even when the incoming grouped count is chronological', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 420, height: 360, groupCount: 8, groupBy: 'shift', range: '7d', turnoMode: 'summary' })).toEqual({
            summary: { mode: 'compact-axis-bars', density: 'compress' },
            groups: { mode: 'axis-stacked', density: 'fit', minSlotWidthPx: 70, sampleLabels: false },
            turnoDetailEligible: true,
        });
    });

    it('falls back to truthful text when the widget is too short for readable axes', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 360, height: 210, groupCount: 4, groupBy: 'shift', range: '30d' })).toEqual({
            summary: { mode: 'text-fallback', density: 'compress' },
            groups: { mode: 'text-fallback', density: 'text-fallback', minSlotWidthPx: 70, sampleLabels: true },
            turnoDetailEligible: false,
        });
    });

    it('keeps grouped buckets compact at 520px and scrolls only once a narrower 480px width exhausts compression', () => {
        expect(resolveActivityAnalyticsVisualLayout({ width: 520, height: 360, groupCount: 6, groupBy: 'day', range: '24h' })).toEqual({
            summary: { mode: 'compact-axis-bars', density: 'compress' },
            groups: { mode: 'axis-stacked', density: 'compress', minSlotWidthPx: 70, sampleLabels: true },
            turnoDetailEligible: false,
        });

        expect(resolveActivityAnalyticsVisualLayout({ width: 480, height: 360, groupCount: 6, groupBy: 'day', range: '24h' })).toEqual({
            summary: { mode: 'compact-axis-bars', density: 'compress' },
            groups: { mode: 'axis-stacked', density: 'scroll', minSlotWidthPx: 70, sampleLabels: true },
            turnoDetailEligible: false,
        });
    });
});
