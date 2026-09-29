import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
    readViewerEntranceCountUpTiming,
    resolveCountUpStartOffsetMs,
    resolveCubicBezierProgress,
    type ViewerEntranceCountUpTiming,
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
 *   arrival; after the window it is shown directly (1).
 * - Once complete it never restarts.
 */
export function useViewerEntranceCountUp(hasValue: boolean): number {
    const order = useContext(ViewerEntranceContext);
    const [progress, setProgress] = useState(() => (
        order === null || prefersReducedMotion() || readViewerEntranceCountUpTiming() === null ? 1 : 0
    ));
    const mountedAtRef = useRef(0);
    const settledRef = useRef(false);

    useEffect(() => {
        mountedAtRef.current = performance.now();
    }, []);

    /* eslint-disable react-hooks/set-state-in-effect -- the count-up settles immediately when its value arrives after the entrance window. */
    useEffect(() => {
        if (order === null || !hasValue || settledRef.current) {
            return undefined;
        }

        const timing: ViewerEntranceCountUpTiming | null = prefersReducedMotion()
            ? null
            : readViewerEntranceCountUpTiming();
        const startAt = timing ? mountedAtRef.current + resolveCountUpStartOffsetMs(order, timing) : 0;

        if (!timing || performance.now() >= startAt + timing.durationMs) {
            settledRef.current = true;
            setProgress(1);
            return undefined;
        }

        const countFrom = Math.max(startAt, performance.now());
        let frameId: number | null = null;

        const tick = () => {
            const linear = Math.min(Math.max((performance.now() - countFrom) / timing.durationMs, 0), 1);

            if (linear >= 1) {
                settledRef.current = true;
                frameId = null;
                setProgress(1);
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
    }, [hasValue, order]);
    /* eslint-enable react-hooks/set-state-in-effect */

    return progress;
}
