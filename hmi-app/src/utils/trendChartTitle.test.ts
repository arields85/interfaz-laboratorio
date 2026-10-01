import { describe, expect, it } from 'vitest';
import { resolveTrendChartTitle, resolveTrendChartV2Title } from './trendChartTitle';

describe('resolveTrendChartTitle (legacy trend chart)', () => {
    it('uses the widget title as is', () => {
        expect(resolveTrendChartTitle('Producción')).toBe('Producción');
    });

    it('falls back to the default only when the title is missing', () => {
        expect(resolveTrendChartTitle(undefined)).toBe('Trend Chart');
        expect(resolveTrendChartTitle(null)).toBe('Trend Chart');
    });

    it('keeps an empty title empty (the legacy chart never replaced it)', () => {
        expect(resolveTrendChartTitle('')).toBe('');
    });
});

describe('resolveTrendChartV2Title (trend chart v2)', () => {
    it('uses the widget title as is', () => {
        expect(resolveTrendChartV2Title('Producción')).toBe('Producción');
    });

    it('falls back to the default when the title is missing or empty', () => {
        expect(resolveTrendChartV2Title(undefined)).toBe('Trend Chart V2');
        expect(resolveTrendChartV2Title(null)).toBe('Trend Chart V2');
        expect(resolveTrendChartV2Title('')).toBe('Trend Chart V2');
    });
});
