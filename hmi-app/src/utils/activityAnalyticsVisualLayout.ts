import type { ActivityAnalyticsGroupBy, ActivityAnalyticsRange } from '../domain/activityAnalytics.types';

export type ActivityAnalyticsDensityMode = 'fit' | 'compress' | 'scroll' | 'text-fallback';

export interface ActivityAnalyticsVisualLayoutInput {
    width: number;
    height: number;
    groupCount: number;
    groupBy: ActivityAnalyticsGroupBy;
    range: ActivityAnalyticsRange;
    turnoMode?: 'summary' | 'detail';
}

export interface ActivityAnalyticsVisualLayout {
    summary: {
        mode: 'axis-bars' | 'compact-axis-bars' | 'text-fallback';
        density: 'fit' | 'compress';
    };
    groups: {
        mode: 'axis-stacked' | 'text-fallback';
        density: ActivityAnalyticsDensityMode;
        minSlotWidthPx: number;
        sampleLabels: boolean;
    };
    turnoDetailEligible: boolean;
}

export type ActivityAnalyticsSummaryLayout = ActivityAnalyticsVisualLayout['summary'];
export type ActivityAnalyticsGroupsLayout = ActivityAnalyticsVisualLayout['groups'];

const TEXT_FALLBACK_MIN_HEIGHT = 240;
const TEXT_FALLBACK_MIN_WIDTH = 320;
const GROUPS_TEXT_FALLBACK_MIN_HEIGHT = 300;
const SUMMARY_FULL_MIN_HEIGHT = 380;
const SUMMARY_FIT_MIN_SLOT_WIDTH = 110;
const GROUPS_FIT_MIN_SLOT_WIDTH = 76;
const GROUPS_COMPRESS_MIN_SLOT_WIDTH = 42;
const TURNO_DETAIL_COMPRESS_MIN_SLOT_WIDTH = 28;
const SUMMARY_HORIZONTAL_MARGIN = 76;
const GROUPS_HORIZONTAL_MARGIN = 76;

export function resolveActivityAnalyticsVisualLayout({
    width,
    height,
    groupCount,
    groupBy,
    range,
    turnoMode = 'summary',
}: ActivityAnalyticsVisualLayoutInput): ActivityAnalyticsVisualLayout {
    const turnoDetailEligible = groupBy === 'shift' && (range === '24h' || range === '7d');
    const effectiveGroupCount = turnoDetailEligible && turnoMode === 'summary'
        ? Math.min(Math.max(groupCount, 1), 3)
        : groupCount;
    const groupsMinSlotWidthPx = turnoDetailEligible && turnoMode === 'detail'
        ? TURNO_DETAIL_COMPRESS_MIN_SLOT_WIDTH
        : GROUPS_COMPRESS_MIN_SLOT_WIDTH;

    if (width < TEXT_FALLBACK_MIN_WIDTH || height < TEXT_FALLBACK_MIN_HEIGHT) {
        return {
            summary: { mode: 'text-fallback', density: 'compress' },
            groups: {
                mode: 'text-fallback',
                density: 'text-fallback',
                minSlotWidthPx: groupsMinSlotWidthPx,
                sampleLabels: true,
            },
            turnoDetailEligible,
        };
    }

    const summaryPlotWidth = Math.max(width - SUMMARY_HORIZONTAL_MARGIN, 1);
    const summarySlotWidth = summaryPlotWidth / 3;
    const summaryDensity = summarySlotWidth >= SUMMARY_FIT_MIN_SLOT_WIDTH && height >= SUMMARY_FULL_MIN_HEIGHT ? 'fit' : 'compress';
    const summaryMode = summaryDensity === 'fit' ? 'axis-bars' : 'compact-axis-bars';

    if (height < GROUPS_TEXT_FALLBACK_MIN_HEIGHT) {
        return {
            summary: { mode: summaryMode, density: summaryDensity },
            groups: {
                mode: 'text-fallback',
                density: 'text-fallback',
                minSlotWidthPx: groupsMinSlotWidthPx,
                sampleLabels: true,
            },
            turnoDetailEligible,
        };
    }

    const safeGroupCount = Math.max(effectiveGroupCount, 1);
    const groupsPlotWidth = Math.max(width - GROUPS_HORIZONTAL_MARGIN, 1);
    const slotWidth = groupsPlotWidth / safeGroupCount;
    const groupsDensity: ActivityAnalyticsDensityMode = slotWidth >= GROUPS_FIT_MIN_SLOT_WIDTH
        ? 'fit'
        : slotWidth >= groupsMinSlotWidthPx
            ? 'compress'
            : 'scroll';

    return {
        summary: { mode: summaryMode, density: summaryDensity },
        groups: {
            mode: 'axis-stacked',
            density: groupsDensity,
            minSlotWidthPx: groupsMinSlotWidthPx,
            sampleLabels: groupsDensity !== 'fit',
        },
        turnoDetailEligible,
    };
}
