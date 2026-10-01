/**
 * Title shared by the header and the frame of a trend chart widget, resolved once so both always agree.
 * The two charts keep the fallback rule they always had: the legacy chart only falls back when the title is
 * missing (`??`, an empty title stays empty), the v2 chart also when it is empty (`||`).
 */
export const TREND_CHART_DEFAULT_TITLE = 'Trend Chart';
export const TREND_CHART_V2_DEFAULT_TITLE = 'Trend Chart V2';

export function resolveTrendChartTitle(title: string | null | undefined): string {
    return title ?? TREND_CHART_DEFAULT_TITLE;
}

export function resolveTrendChartV2Title(title: string | null | undefined): string {
    return title || TREND_CHART_V2_DEFAULT_TITLE;
}
