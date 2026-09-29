import { createContext, useContext, useEffect, useState } from 'react';
import {
    readViewerEntranceCountUpTiming,
    resolveCountUpStartOffsetMs,
    resolveCubicBezierProgress,
} from '../utils/viewerEntrance';

// =============================================================================
// Viewer entrance count-up
// `DashboardViewer` provides each item's stagger order (0..1) through
// `ViewerEntranceContext`; outside the viewer (builder, tests) the context is
// `null` and nothing counts. A widget asks `useViewerEntranceCountUp(hasValue)`
// for a 0..1 progress and scales its MAIN value with it
// (`resolveViewerCountUpValue`). The progress is a one-shot per mount: the grid
// remounts on every dashboard/view entry, while a data refresh keeps the mount
// and therefore never replays it. Timing and curve come from the same `--viewer-entrance-*`
// CSS tokens as the frame and gauge animations (see `viewerEntrance.ts`).
// =============================================================================

/** Stagger order of the enclosing viewer item; `null` outside the viewer entrance. */
export const ViewerEntranceContext = createContext<number | null>(null);

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Progress (0..1) of the entrance count-up of a widget's main value.
 * - Outside the viewer, with reduced motion or without timing tokens: always 1.
 * - `hasValue` false: stays 0 until the first value arrives.
 * - The value arrives inside the entrance window: counts from the later of the item start and the
 *   arrival; after the window it is shown directly (1), already in the render that first sees the
 *   value, so no zero frame is ever committed.
 * - The count has ONE origin: a `hasValue` toggle mid-count resumes on that timeline, never restarts.
 * - Once complete it never restarts.
 */
export function useViewerEntranceCountUp(hasValue: boolean): number {
    const order = useContext(ViewerEntranceContext);
    const [progress, setProgress] = useState(0);
    const [settled, setSettled] = useState(() => (
        order === null || prefersReducedMotion() || readViewerEntranceCountUpTiming() === null
    ));
    const [mountedAt] = useState(() => performance.now());
    const [countFrom, setCountFrom] = useState<number | null>(null);
    let isSettled = settled;
    let origin = countFrom;

    // The first value decides, during render (sanctioned render-phase state adjustment), whether the
    // count still runs or is already over: an effect would commit one frame of the value scaled by 0.
    if (!isSettled && origin === null && order !== null && hasValue) {
        const timing = readViewerEntranceCountUpTiming();
        const startAt = timing ? mountedAt + resolveCountUpStartOffsetMs(order, timing) : 0;
        // eslint-disable-next-line react-hooks/purity -- one-shot read of the clock to place the first value on the entrance timeline; the outcome is stored in state.
        const now = performance.now();

        if (!timing || now >= startAt + timing.durationMs) {
            isSettled = true;
            setSettled(true);
        } else {
            origin = Math.max(startAt, now);
            setCountFrom(origin);
        }
    }

    useEffect(() => {
        if (isSettled || origin === null || !hasValue) {
            return undefined;
        }

        const timing = readViewerEntranceCountUpTiming();
        if (!timing) {
            return undefined;
        }

        let frameId: number | null = null;

        const tick = () => {
            const linear = Math.min(Math.max((performance.now() - origin) / timing.durationMs, 0), 1);

            if (linear >= 1) {
                frameId = null;
                setSettled(true);
                return;
            }

            setProgress(resolveCubicBezierProgress(timing.ease, linear));
            frameId = requestAnimationFrame(tick);
        };

        frameId = requestAnimationFrame(tick);

        return () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId);
            }
        };
    }, [hasValue, isSettled, origin]);

    return isSettled ? 1 : progress;
}
