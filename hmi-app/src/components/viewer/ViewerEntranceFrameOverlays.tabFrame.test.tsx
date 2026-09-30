import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAB_FRAME_TITLE_HIDDEN, buildTabFramePath } from '../../utils/tabFramePath';
import ViewerEntranceFrameOverlays from './ViewerEntranceFrameOverlays';

// Viewer entrance overlays (flash + traced outline) follow the tab + chamfered body silhouette in
// the tab frame shape; the standard shape keeps the rounded rect. jsdom has no layout, so the box
// size and the computed tokens are injected.
const TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-tab-cut': '19px',
    '--tab-frame-body-cut': '50px',
};

function mockLayout({ width, height }: { width: number; height: number }) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
        getPropertyValue: (name: string) => TOKENS[name] ?? '',
        borderTopLeftRadius: '4px',
        fontSize: '16px',
    }) as unknown as CSSStyleDeclaration);
}

const GEOMETRY = { width: 300, height: 200, tabWidth: 180, tabHeight: 25, tabCut: 19, bodyCut: 50, radius: 4 };

describe('ViewerEntranceFrameOverlays', () => {
    beforeEach(() => {
        mockLayout({ width: 300, height: 200 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('standard shape (no tab)', () => {
        it('keeps the rounded flash and the traced rect', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="var(--widget-spacing)" />);

            const flash = screen.getByTestId('dashboard-viewer-entrance-flash-w');
            expect(flash).toHaveClass('hmi-viewer-entrance-flash');
            expect(flash).not.toHaveClass('hmi-viewer-entrance-flash-tab');
            expect(flash.style.clipPath).toBe('');

            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            const rect = outline.querySelector('rect');
            expect(rect).not.toBeNull();
            expect(rect?.getAttribute('pathLength')).toBe('1');
            expect(outline.querySelector('path')).toBeNull();
        });
    });

    describe('tab shape', () => {
        it('clips the flash to the same rounded path as the silhouette (inline clip-path, no polygon class)', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="var(--widget-spacing)" tabWidth={180} />);

            const flash = screen.getByTestId('dashboard-viewer-entrance-flash-w');
            expect(flash).toHaveClass('hmi-viewer-entrance-flash');
            expect(flash).not.toHaveClass('hmi-viewer-entrance-flash-tab');
            expect(flash.style.clipPath).toBe(`path('${buildTabFramePath(GEOMETRY)}')`);
            expect(flash.style.inset).toBe('var(--widget-spacing)');
        });

        it('traces the outline along the rounded path of the silhouette, normalized with pathLength=1', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={180} />);

            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            expect(outline.querySelector('rect')).toBeNull();

            const path = outline.querySelector('path');
            expect(path).not.toBeNull();
            expect(path?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY));
            expect(path?.getAttribute('pathLength')).toBe('1');
            // The animated stroke rule (dash draw + fade + reduced motion) is shared with the rect.
            expect(path).toHaveClass('hmi-viewer-entrance-outline-rect', 'hmi-viewer-entrance-outline-path');
            expect(outline.style.inset).toBe('0px');
        });

        it('clips the flash and traces the outline with the reported tab height (a taller tab)', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={180} tabHeight={47} />);

            // The slanted side keeps the standard angle: cut 19 over height 25 scales to 35.72 over 47.
            const geometry = { ...GEOMETRY, tabHeight: 47, tabCut: 35.72 };
            expect(screen.getByTestId('dashboard-viewer-entrance-flash-w').style.clipPath)
                .toBe(`path('${buildTabFramePath(geometry)}')`);
            expect(screen.getByTestId('dashboard-viewer-entrance-outline-w').querySelector('path')?.getAttribute('d'))
                .toBe(buildTabFramePath(geometry));
        });

        it('clips the flash and traces the outline without the title tab when the frame reports it hidden', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={TAB_FRAME_TITLE_HIDDEN} />);

            const geometry = { ...GEOMETRY, tabWidth: 0 };
            expect(screen.getByTestId('dashboard-viewer-entrance-flash-w').style.clipPath)
                .toBe(`path('${buildTabFramePath(geometry)}')`);
            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            expect(outline.querySelector('rect')).toBeNull();
            expect(outline.querySelector('path')?.getAttribute('d')).toBe(buildTabFramePath(geometry));
        });

        it('never draws a rectangle while the tab width is pending (frame is the tab shape, width not measured yet)', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={0} />);

            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            expect(outline.querySelector('rect')).toBeNull();
            expect(outline.querySelector('path')).toBeNull();
            expect(screen.queryByTestId('dashboard-viewer-entrance-flash-w')).toBeNull();
        });

        it('never draws a rectangle while the box has not been measured either', () => {
            vi.restoreAllMocks();
            mockLayout({ width: 0, height: 0 });

            render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={180} />);

            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            expect(outline.querySelector('rect')).toBeNull();
            expect(outline.querySelector('path')).toBeNull();
            expect(screen.queryByTestId('dashboard-viewer-entrance-flash-w')).toBeNull();
        });

        it('swaps from nothing to the rounded path (never a rect) once the width is reported', () => {
            const { rerender } = render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={0} />);
            const outline = () => screen.getByTestId('dashboard-viewer-entrance-outline-w');
            expect(outline().querySelector('rect')).toBeNull();

            rerender(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={180} />);

            expect(outline().querySelector('rect')).toBeNull();
            expect(outline().querySelector('path')?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY));
        });
    });
});
