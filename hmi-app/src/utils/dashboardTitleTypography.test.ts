import { describe, expect, it } from 'vitest';
import { DASHBOARD_TITLE_LINE_HEIGHT, buildDashboardTitleTypography } from './dashboardTitleTypography';

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
