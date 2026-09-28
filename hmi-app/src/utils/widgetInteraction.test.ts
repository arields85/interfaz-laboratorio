import { describe, expect, it } from 'vitest';
import {
    applyPointerDeltaToPixelBounds,
    isResizeInteraction,
    layoutToPixelBounds,
    pixelBoundsToGridBounds,
    pixelBoundsToRect,
    rectToPixelBounds,
    resizeCursor,
} from './widgetInteraction';

describe('widgetInteraction', () => {
    it('maps grid layout bounds to pixel bounds from canvas metrics', () => {
        expect(
            layoutToPixelBounds(
                { x: 5, y: 2, w: 3, h: 2 },
                { cellWidth: 60, rowHeight: 75 },
            ),
        ).toEqual({ left: 300, top: 150, width: 180, height: 150 });
    });

    it('converts tentative pixel bounds back into rounded grid units', () => {
        expect(
            pixelBoundsToGridBounds(
                { left: 180, top: 225, width: 240, height: 300 },
                { cellWidth: 60, rowHeight: 75 },
            ),
        ).toEqual({ x: 3, y: 3, w: 4, h: 4 });
    });

    // G13(a): pure field-rename (no unit math) so a pixel-space rect can reuse the unit-agnostic
    // grid-space clamp helpers (e.g. groupWidget's clampGroupResizeToMembers) directly.
    it('renames pixel bounds fields into the generic x/y/w/h rect shape and back, without altering values', () => {
        const bounds = { left: 12.5, top: 40, width: 307, height: 382 };

        expect(pixelBoundsToRect(bounds)).toEqual({ x: 12.5, y: 40, w: 307, h: 382 });
        expect(rectToPixelBounds(pixelBoundsToRect(bounds))).toEqual(bounds);
    });

    it('identifies resize interaction types', () => {
        expect(isResizeInteraction('resize-se')).toBe(true);
        expect(isResizeInteraction('resize-ne')).toBe(true);
        expect(isResizeInteraction('resize-nw')).toBe(true);
        expect(isResizeInteraction('resize-sw')).toBe(true);
        expect(isResizeInteraction('move')).toBe(false);
    });

    it('returns the correct cursor for each resize direction', () => {
        expect(resizeCursor('resize-se')).toBe('se-resize');
        expect(resizeCursor('resize-ne')).toBe('ne-resize');
        expect(resizeCursor('resize-nw')).toBe('nw-resize');
        expect(resizeCursor('resize-sw')).toBe('sw-resize');
        expect(resizeCursor('move')).toBe('grabbing');
    });

    it('applies move deltas to position only', () => {
        const startBounds = { left: 120, top: 75, width: 180, height: 150 };
        expect(applyPointerDeltaToPixelBounds('move', startBounds, -180, 150)).toEqual({
            left: -60,
            top: 225,
            width: 180,
            height: 150,
        });
    });

    it('resize-se grows width/height, keeps left/top fixed', () => {
        const startBounds = { left: 120, top: 75, width: 180, height: 150 };
        expect(applyPointerDeltaToPixelBounds('resize-se', startBounds, 120, -500)).toEqual({
            left: 120,
            top: 75,
            width: 300,
            height: 1,
        });
    });

    it('resize-ne grows width and moves top, keeps left fixed', () => {
        const startBounds = { left: 100, top: 200, width: 200, height: 200 };
        expect(applyPointerDeltaToPixelBounds('resize-ne', startBounds, 50, -80)).toEqual({
            left: 100,
            top: 120,
            width: 250,
            height: 280,
        });
    });

    it('resize-nw moves left/top and shrinks width/height', () => {
        const startBounds = { left: 100, top: 200, width: 200, height: 200 };
        expect(applyPointerDeltaToPixelBounds('resize-nw', startBounds, 50, 60)).toEqual({
            left: 150,
            top: 260,
            width: 150,
            height: 140,
        });
    });

    it('resize-sw moves left and grows height, keeps top fixed', () => {
        const startBounds = { left: 100, top: 200, width: 200, height: 200 };
        expect(applyPointerDeltaToPixelBounds('resize-sw', startBounds, -30, 40)).toEqual({
            left: 70,
            top: 200,
            width: 230,
            height: 240,
        });
    });

    it('clamps width and height to minimum 1 for all resize directions', () => {
        const startBounds = { left: 100, top: 100, width: 50, height: 50 };

        expect(applyPointerDeltaToPixelBounds('resize-se', startBounds, -999, -999).width).toBe(1);
        expect(applyPointerDeltaToPixelBounds('resize-ne', startBounds, -999, 999).width).toBe(1);
        expect(applyPointerDeltaToPixelBounds('resize-nw', startBounds, 999, 999).width).toBe(1);
        expect(applyPointerDeltaToPixelBounds('resize-sw', startBounds, 999, -999).width).toBe(1);
    });
});
