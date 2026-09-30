import type { CSSProperties } from 'react';

/** Line height of the dashboard title (the `text-title` widget and the tab title of a group). */
export const DASHBOARD_TITLE_LINE_HEIGHT = 1.1;

/**
 * Typography of the dashboard title: the exact type styles of the `text-title` widget (title font,
 * weight, tracking, size in px, line height). Color and alignment are the caller's business.
 */
export function buildDashboardTitleTypography(fontSizePx: number): CSSProperties {
    return {
        fontFamily: 'var(--font-dashboard-title)',
        fontWeight: 'var(--font-weight-dashboard-title)',
        letterSpacing: 'var(--tracking-dashboard-title)',
        fontSize: `${fontSizePx}px`,
        lineHeight: DASHBOARD_TITLE_LINE_HEIGHT,
    };
}
