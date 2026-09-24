import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAnchoredOverlayStyle } from './anchoredOverlayStyle';

function createTrigger(rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }): HTMLElement {
    const trigger = document.createElement('button');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        ...rect,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
    });
    return trigger;
}

describe('resolveAnchoredOverlayStyle under CSS zoom (PW-007 T3b)', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.style.removeProperty('--viewport-zoom');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    });

    it('divides the real-px left/top by the effective zoom before returning CSS length values', () => {
        document.documentElement.style.setProperty('--viewport-zoom', '1.25');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

        // Real/visual rect, as getBoundingClientRect() reports under zoom.
        const trigger = createTrigger({ left: 125, top: 250, right: 275, bottom: 290, width: 150, height: 40 });

        const resolved = resolveAnchoredOverlayStyle(trigger, 100, 'trigger', 'start', 5);

        // left = rect.left (125 visual) / zoom (1.25) = 100 layout px, so the
        // browser's own zoom pre-multiplication repaints it at 125 visual px.
        expect(resolved.left).toBe(100);
        // top = (rect.bottom + gap) / zoom = (290 + 5) / 1.25 = 236.
        expect(resolved.top).toBe(236);
        // minWidth = rect.width (150 visual) / zoom = 120 layout px.
        expect(resolved.minWidth).toBe(120);
    });

    it('is a no-op at zoom 1 (matches the pre-T3b real-px values directly)', () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });

        const trigger = createTrigger({ left: 120, top: 200, right: 300, bottom: 232, width: 180, height: 32 });

        const resolved = resolveAnchoredOverlayStyle(trigger, 160, 'trigger', 'start', 4);

        expect(resolved.left).toBe(120);
        expect(resolved.top).toBe(236);
        expect(resolved.minWidth).toBe(180);
    });

    it('divides the upward-opening bottom anchor by the effective zoom too', () => {
        document.documentElement.style.setProperty('--viewport-zoom', '2');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });

        const trigger = createTrigger({ left: 100, top: 640, right: 220, bottom: 704, width: 120, height: 64 });

        const resolved = resolveAnchoredOverlayStyle(trigger, 240, 'trigger', 'start', 4);

        // spaceBelow = 800 - 704 = 96 < estimatedHeight(240)+gap(4) -> opens upward.
        // bottom = (innerHeight - rect.top + gap) / zoom = (800 - 640 + 4) / 2 = 82.
        expect(resolved).not.toHaveProperty('top');
        expect(resolved.bottom).toBe(82);
    });
});
