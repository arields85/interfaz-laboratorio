import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDoubleRafFlip } from './useDoubleRafFlip';

// `vi.useFakeTimers({ shouldAdvanceTime: true })` fakes `requestAnimationFrame` too (same
// convention as PrismaOrbOverlay.test.tsx / PrismaPairingControl.test.tsx); advancing by two
// simulated frames' worth of time flushes both rAF calls in the double-rAF flip.
function flushDoubleRaf(): void {
    act(() => {
        vi.advanceTimersByTime(32);
    });
}

describe('useDoubleRafFlip', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('stays false until the double rAF flip completes, then flips true', () => {
        const { result } = renderHook(() => useDoubleRafFlip(true));

        expect(result.current).toBe(false);

        flushDoubleRaf();

        expect(result.current).toBe(true);
    });

    it('stays false while inactive and never flips', () => {
        const { result } = renderHook(() => useDoubleRafFlip(false));

        flushDoubleRaf();

        expect(result.current).toBe(false);
    });

    it('re-arms on a false -> true -> false -> true cycle, like the modal open/close fade', () => {
        const { result, rerender } = renderHook(({ active }) => useDoubleRafFlip(active), {
            initialProps: { active: false },
        });

        rerender({ active: true });
        flushDoubleRaf();
        expect(result.current).toBe(true);

        rerender({ active: false });
        expect(result.current).toBe(false);

        rerender({ active: true });
        expect(result.current).toBe(false);
        flushDoubleRaf();
        expect(result.current).toBe(true);
    });

    it('cancels a pending flip on unmount without throwing', () => {
        const { unmount } = renderHook(() => useDoubleRafFlip(true));

        expect(() => unmount()).not.toThrow();
    });
});
