import { useCallback, useRef, useState } from 'react';
import type { TabFrameReporter } from './tabFrameContext';

/**
 * Tab widths (px) reported by the tab frames of a dashboard grid, by widget id. A widget appears
 * here only while its frame is the tab shape, so `widths[id] != null` means "draw the tab silhouette".
 * `reporterFor(id)` returns a stable reporter per widget to hand to `GridFrameScope`.
 */
export function useTabFrameWidths() {
    const [widths, setWidths] = useState<Record<string, number>>({});
    const reporters = useRef(new Map<string, TabFrameReporter>());

    const reporterFor = useCallback((widgetId: string): TabFrameReporter => {
        const existing = reporters.current.get(widgetId);
        if (existing) {
            return existing;
        }

        const reporter: TabFrameReporter = (tabWidthPx) => {
            setWidths((current) => {
                if (tabWidthPx === null) {
                    if (!(widgetId in current)) {
                        return current;
                    }
                    const next = { ...current };
                    delete next[widgetId];

                    return next;
                }

                return current[widgetId] === tabWidthPx ? current : { ...current, [widgetId]: tabWidthPx };
            });
        };
        reporters.current.set(widgetId, reporter);

        return reporter;
    }, []);

    return { widths, reporterFor };
}
