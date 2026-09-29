import { act } from '@testing-library/react';
import { vi } from 'vitest';

// Test clock for the viewer entrance count-up. jsdom runs no animations, so `performance.now()`
// and the animation frames are driven by hand: `advance(ms)` moves the fake clock and flushes the
// queued frame callbacks inside `act`. Always pair `installEntranceClock()` with `restore()`.

export const ENTRANCE_TEST_TOKENS = {
    '--viewer-entrance-spread': '700ms',
    '--viewer-entrance-value-offset': '100ms',
    '--viewer-entrance-count-duration': '1000ms',
    '--viewer-entrance-ease': 'cubic-bezier(0.22, 1, 0.36, 1)',
} as const;

export function installEntranceClock(tokens: Record<string, string> = ENTRANCE_TEST_TOKENS) {
    let now = 0;
    let frames: Array<{ id: number; callback: FrameRequestCallback }> = [];
    let nextFrameId = 1;

    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.push({ id, callback });
        return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        frames = frames.filter((frame) => frame.id !== id);
    });
    for (const [name, value] of Object.entries(tokens)) {
        document.documentElement.style.setProperty(name, value);
    }

    return {
        advance(ms: number) {
            act(() => {
                now += ms;
                const pending = frames;
                frames = [];
                for (const frame of pending) {
                    frame.callback(now);
                }
            });
        },
        pendingFrames: () => frames.length,
        restore() {
            vi.restoreAllMocks();
            vi.unstubAllGlobals();
            document.documentElement.removeAttribute('style');
        },
    };
}

/** Makes `prefers-reduced-motion: reduce` match. */
export function stubReducedMotion() {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
    }));
}
