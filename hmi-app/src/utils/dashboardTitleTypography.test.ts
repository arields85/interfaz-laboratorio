import { describe, expect, it } from 'vitest';
import {
    DASHBOARD_TITLE_LINE_HEIGHT,
    DEFAULT_TEXT_TITLE_FONT_SIZE,
    MAX_TEXT_TITLE_FONT_SIZE,
    MIN_TEXT_TITLE_FONT_SIZE,
    buildDashboardTitleTypography,
    normalizeTitleFontSize,
} from './dashboardTitleTypography';

describe('buildDashboardTitleTypography', () => {
    it('is the typography of the text-title widget: title font, weight, tracking, size in px and line height', () => {
        expect(buildDashboardTitleTypography(35)).toEqual({
            fontFamily: 'var(--font-dashboard-title)',
            fontWeight: 'var(--font-weight-dashboard-title)',
            letterSpacing: 'var(--tracking-dashboard-title)',
            fontSize: '35px',
            lineHeight: DASHBOARD_TITLE_LINE_HEIGHT,
        });
    });

    it('carries neither a color nor an alignment (those stay with the caller)', () => {
        const typography = buildDashboardTitleTypography(20);

        expect(typography).not.toHaveProperty('color');
        expect(typography).not.toHaveProperty('textAlign');
        expect(typography.fontSize).toBe('20px');
    });

    it('keeps the line height of the text-title widget', () => {
        expect(DASHBOARD_TITLE_LINE_HEIGHT).toBe(1.1);
    });
});

describe('normalizeTitleFontSize', () => {
    it('shares the 12-200 range of the property panel as named constants', () => {
        expect(MIN_TEXT_TITLE_FONT_SIZE).toBe(12);
        expect(MAX_TEXT_TITLE_FONT_SIZE).toBe(200);
    });

    it('keeps a valid size untouched', () => {
        expect(normalizeTitleFontSize(35)).toBe(35);
        expect(normalizeTitleFontSize(12)).toBe(12);
        expect(normalizeTitleFontSize(200)).toBe(200);
        expect(normalizeTitleFontSize(47.5)).toBe(47.5);
    });

    it('falls back to the default for anything that is not a finite number', () => {
        for (const stored of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '48', {}, true]) {
            expect(normalizeTitleFontSize(stored)).toBe(DEFAULT_TEXT_TITLE_FONT_SIZE);
        }
    });

    it('clamps a finite size into the allowed range', () => {
        expect(normalizeTitleFontSize(0)).toBe(MIN_TEXT_TITLE_FONT_SIZE);
        expect(normalizeTitleFontSize(-30)).toBe(MIN_TEXT_TITLE_FONT_SIZE);
        expect(normalizeTitleFontSize(11.9)).toBe(MIN_TEXT_TITLE_FONT_SIZE);
        expect(normalizeTitleFontSize(201)).toBe(MAX_TEXT_TITLE_FONT_SIZE);
        expect(normalizeTitleFontSize(5000)).toBe(MAX_TEXT_TITLE_FONT_SIZE);
    });
});
