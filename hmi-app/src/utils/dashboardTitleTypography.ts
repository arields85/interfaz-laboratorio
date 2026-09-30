import type { CSSProperties } from 'react';

export const DEFAULT_TEXT_TITLE_FONT_SIZE = 35;
/** Default size (px) of the tab title of the `group` widget; the `text-title` widget keeps its own default. */
export const DEFAULT_GROUP_TITLE_FONT_SIZE = 30;
/** Allowed range (px) of a title size: the bounds of the property panel input, enforced when rendering. */
export const MIN_TEXT_TITLE_FONT_SIZE = 12;
export const MAX_TEXT_TITLE_FONT_SIZE = 200;

/**
 * Title font size (px) to render from a stored value: anything that is not a finite number (a
 * missing value, or a hand-edited or corrupted persisted layout) becomes `fallback` (the default of
 * the caller: the `text-title` widget by default, `DEFAULT_GROUP_TITLE_FONT_SIZE` for the tab title
 * of the `group` widget), a finite number is clamped into the allowed range.
 */
export function normalizeTitleFontSize(stored: unknown, fallback: number = DEFAULT_TEXT_TITLE_FONT_SIZE): number {
    if (typeof stored !== 'number' || !Number.isFinite(stored)) {
        return fallback;
    }

    return Math.min(MAX_TEXT_TITLE_FONT_SIZE, Math.max(MIN_TEXT_TITLE_FONT_SIZE, stored));
}

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
