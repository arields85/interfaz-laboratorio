import { useCallback, useRef, useState } from 'react';
import type { TabFrameReporter } from './tabFrameContext';

interface TabFrameMetrics {
    widths: Record<string, number>;
    heights: Record<string, number>;
}

function withoutKey(record: Record<string, number>, key: string): Record<string, number> {
    if (!(key in record)) {
        return record;
    }
    const next = { ...record };
    delete next[key];

    return next;
}

function withKey(record: Record<string, number>, key: string, value: number): Record<string, number> {
    return record[key] === value ? record : { ...record, [key]: value };
}

/**
 * Tab widths (px) reported by the tab frames of a dashboard grid, by widget id. A widget appears
 * here only while its frame is the tab shape, so `widths[id] != null` means "draw the tab silhouette".
 * `heights` holds the effective tab height (px) of the frames whose tab is taller than the standard
 * one (a title with its own size, the `group` widget); a widget without an entry there uses the
 * `--tab-frame-height` token. `reporterFor(id)` returns a stable reporter per widget to hand to
 * `GridFrameScope`.
 */
export function useTabFrameWidths() {
    const [metrics, setMetrics] = useState<TabFrameMetrics>({ widths: {}, heights: {} });
    const reporters = useRef(new Map<string, TabFrameReporter>());

    const reporterFor = useCallback((widgetId: string): TabFrameReporter => {
        const existing = reporters.current.get(widgetId);
        if (existing) {
            return existing;
        }

        const reporter: TabFrameReporter = (tabWidthPx, tabHeightPx) => {
            setMetrics((current) => {
                const widths = tabWidthPx === null
                    ? withoutKey(current.widths, widgetId)
                    : withKey(current.widths, widgetId, tabWidthPx);
                const heights = tabWidthPx === null || tabHeightPx === undefined
                    ? withoutKey(current.heights, widgetId)
                    : withKey(current.heights, widgetId, tabHeightPx);

                return widths === current.widths && heights === current.heights ? current : { widths, heights };
            });
        };
        reporters.current.set(widgetId, reporter);

        return reporter;
    }, []);

    return { widths: metrics.widths, heights: metrics.heights, reporterFor };
}
