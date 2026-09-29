import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTabFramePath } from '../../utils/tabFramePath';
import ViewerEntranceFrameOverlays from './ViewerEntranceFrameOverlays';

// Viewer entrance overlays (flash + traced outline) follow the tab + chamfered body silhouette in
// the tab frame shape; the standard shape keeps the rounded rect. jsdom has no layout, so the box
// size and the computed tokens are injected.
const TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-tab-cut': '25px',
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

const GEOMETRY = { width: 300, height: 200, tabWidth: 180, tabHeight: 25, tabCut: 25, bodyCut: 50, radius: 4 };

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
            expect(flash.style.getPropertyValue('--tab-frame-tab-width')).toBe('');

            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            const rect = outline.querySelector('rect');
            expect(rect).not.toBeNull();
            expect(rect?.getAttribute('pathLength')).toBe('1');
            expect(outline.querySelector('path')).toBeNull();
        });
    });

    describe('tab shape', () => {
        it('clips the flash to the silhouette using the reported tab width', () => {
            render(<ViewerEntranceFrameOverlays widgetId="w" inset="var(--widget-spacing)" tabWidth={180} />);

            const flash = screen.getByTestId('dashboard-viewer-entrance-flash-w');
            expect(flash).toHaveClass('hmi-viewer-entrance-flash', 'hmi-viewer-entrance-flash-tab');
            expect(flash.style.getPropertyValue('--tab-frame-tab-width')).toBe('180px');
            expect(flash.style.inset).toBe('var(--widget-spacing)');
        });

        it('traces the outline along a path of the silhouette, normalized with pathLength=1', () => {
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

        it('keeps the traced rect until the box has been measured', () => {
            vi.restoreAllMocks();
            mockLayout({ width: 0, height: 0 });

            render(<ViewerEntranceFrameOverlays widgetId="w" inset="0px" tabWidth={180} />);

            const outline = screen.getByTestId('dashboard-viewer-entrance-outline-w');
            expect(outline.querySelector('rect')).not.toBeNull();
            expect(outline.querySelector('path')).toBeNull();
        });
    });
});
