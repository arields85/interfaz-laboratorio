import { useLayoutEffect, type ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTRANCE_TEST_TOKENS, installEntranceClock, stubReducedMotion } from '../test/entranceClock';
import { ViewerEntranceContext, useViewerEntranceCountUp } from './useViewerEntranceCountUp';

let clock: ReturnType<typeof installEntranceClock>;

function providerFor(order: number | null) {
    return function Provider({ children }: { children: ReactNode }) {
        return <ViewerEntranceContext.Provider value={order}>{children}</ViewerEntranceContext.Provider>;
    };
}

describe('useViewerEntranceCountUp', () => {
    beforeEach(() => {
        clock = installEntranceClock();
    });

    afterEach(() => {
        clock.restore();
    });

    it('is already complete outside the viewer (no provider): builder shows values directly', () => {
        const { result } = renderHook(() => useViewerEntranceCountUp(true));

        expect(result.current).toBe(1);
        expect(clock.pendingFrames()).toBe(0);
    });

    it('waits for its item delay, then rises to exactly 1 at the end of the duration', () => {
        // order 0.5 -> delay 700 * 0.5 + 100 = 450ms, duration 1000ms.
        const { result } = renderHook(() => useViewerEntranceCountUp(true), { wrapper: providerFor(0.5) });

        expect(result.current).toBe(0);
        clock.advance(300);
        expect(result.current).toBe(0);

        clock.advance(450); // t = 750 -> 300ms into the count
        expect(result.current).toBeGreaterThan(0);
        expect(result.current).toBeLessThan(1);
        const mid = result.current;

        clock.advance(300); // t = 1050 -> 600ms into the count
        expect(result.current).toBeGreaterThan(mid);
        expect(result.current).toBeLessThan(1);

        clock.advance(2000);
        expect(result.current).toBe(1);
        expect(clock.pendingFrames()).toBe(0);
    });

    it('follows the shared entrance ease token instead of a private curve', () => {
        clock.restore();
        clock = installEntranceClock({ ...ENTRANCE_TEST_TOKENS, '--viewer-entrance-ease': 'cubic-bezier(0, 0, 1, 1)' });
        const { result } = renderHook(() => useViewerEntranceCountUp(true), { wrapper: providerFor(0) });

        clock.advance(100 + 500); // delay 100ms, then halfway through the 1000ms count
        expect(result.current).toBeCloseTo(0.5, 1);
    });

    it('counts up when the value arrives during the entrance window', () => {
        const { result, rerender } = renderHook(
            ({ hasValue }) => useViewerEntranceCountUp(hasValue),
            { wrapper: providerFor(0), initialProps: { hasValue: false } },
        );

        clock.advance(300); // still inside the window (delay 100 + 1000)
        expect(result.current).toBe(0);

        rerender({ hasValue: true });
        expect(result.current).toBe(0);
        clock.advance(400);
        expect(result.current).toBeGreaterThan(0);
        expect(result.current).toBeLessThan(1);

        clock.advance(1500);
        expect(result.current).toBe(1);
    });

    it('shows a value that arrives after the entrance window directly', () => {
        const { result, rerender } = renderHook(
            ({ hasValue }) => useViewerEntranceCountUp(hasValue),
            { wrapper: providerFor(0), initialProps: { hasValue: false } },
        );

        clock.advance(1500); // window (100 + 1000) is over
        rerender({ hasValue: true });

        expect(result.current).toBe(1);
        expect(clock.pendingFrames()).toBe(0);
    });

    it('never commits a zero for a value that arrives after the entrance window', () => {
        const committed: number[] = [];
        const { rerender } = renderHook(
            ({ hasValue }) => {
                const progress = useViewerEntranceCountUp(hasValue);
                // Layout effects run in the commit phase: only committed (paintable) progress is recorded.
                useLayoutEffect(() => {
                    committed.push(progress);
                });
                return progress;
            },
            { wrapper: providerFor(0), initialProps: { hasValue: false } },
        );

        clock.advance(1500); // window (100 + 1000) is over
        committed.length = 0;
        rerender({ hasValue: true });

        expect(committed.length).toBeGreaterThan(0);
        expect(committed.every((progress) => progress === 1)).toBe(true);
    });

    it('resumes on the original timeline when the value toggles mid-count instead of restarting', () => {
        const { result, rerender } = renderHook(
            ({ hasValue }) => useViewerEntranceCountUp(hasValue),
            { wrapper: providerFor(0), initialProps: { hasValue: true } },
        );

        clock.advance(600); // count started at 100ms -> 500ms in
        const midCount = result.current;
        expect(midCount).toBeGreaterThan(0);
        expect(midCount).toBeLessThan(1);

        rerender({ hasValue: false });
        clock.advance(200); // t = 800
        rerender({ hasValue: true });
        clock.advance(1); // first frame after the toggle

        expect(result.current).toBeGreaterThanOrEqual(midCount);

        clock.advance(300); // t = 1101 -> past the original end (1100)
        expect(result.current).toBe(1);
        expect(clock.pendingFrames()).toBe(0);
    });

    it('never replays after completing: later renders (data refreshes) stay at 1', () => {
        const { result, rerender } = renderHook(
            ({ hasValue }) => useViewerEntranceCountUp(hasValue),
            { wrapper: providerFor(0), initialProps: { hasValue: true } },
        );
        clock.advance(3000);
        expect(result.current).toBe(1);

        rerender({ hasValue: false });
        rerender({ hasValue: true });
        clock.advance(50);

        expect(result.current).toBe(1);
        expect(clock.pendingFrames()).toBe(0);
    });

    it('shows the final value immediately when the user prefers reduced motion', () => {
        stubReducedMotion();

        const { result } = renderHook(() => useViewerEntranceCountUp(true), { wrapper: providerFor(0.2) });

        expect(result.current).toBe(1);
        expect(clock.pendingFrames()).toBe(0);
    });

    it('shows the final value immediately when the timing tokens are unavailable', () => {
        document.documentElement.removeAttribute('style');

        const { result } = renderHook(() => useViewerEntranceCountUp(true), { wrapper: providerFor(0.2) });

        expect(result.current).toBe(1);
    });

    it('cancels its pending frame on unmount', () => {
        const { unmount } = renderHook(() => useViewerEntranceCountUp(true), { wrapper: providerFor(0) });
        expect(clock.pendingFrames()).toBeGreaterThan(0);

        unmount();

        expect(clock.pendingFrames()).toBe(0);
    });
});
