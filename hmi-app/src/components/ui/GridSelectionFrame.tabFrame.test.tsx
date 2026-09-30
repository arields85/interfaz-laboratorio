import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTabFramePath } from '../../utils/tabFramePath';
import GridSelectionFrame from './GridSelectionFrame';

// Builder selection ring in the tab frame shape: it traces the tab + chamfered body silhouette
// (a path) instead of the standard rounded rect. jsdom has no layout, so the box size and the
// computed tokens are injected.
const TOKENS: Record<string, string> = {
    '--tab-frame-height': '25px',
    '--tab-frame-tab-cut': '19px',
    '--tab-frame-body-cut': '50px',
};

function mockLayout({ width, height, radius = '4px' }: { width: number; height: number; radius?: string }) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
        getPropertyValue: (name: string) => TOKENS[name] ?? '',
        borderTopLeftRadius: radius,
        fontSize: '16px',
    }) as unknown as CSSStyleDeclaration);
}

const GEOMETRY = { width: 300, height: 200, tabWidth: 180, tabHeight: 25, tabCut: 19, bodyCut: 50, radius: 4 };

describe('GridSelectionFrame in the tab frame shape', () => {
    beforeEach(() => {
        mockLayout({ width: 300, height: 200 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps the rounded rects when the widget has no tab (standard frame)', () => {
        const { container } = render(<GridSelectionFrame isSelected />);

        expect(container.querySelectorAll('rect')).toHaveLength(2);
        expect(container.querySelector('path')).toBeNull();
    });

    it('traces the tab silhouette with a hover path and a focus path, and no rects', () => {
        const { container } = render(<GridSelectionFrame isSelected tabWidth={180} />);

        expect(container.querySelector('[data-testid="grid-selection-frame"]')).not.toBeNull();
        expect(container.querySelectorAll('rect')).toHaveLength(0);

        const hover = container.querySelector('path[data-ring="hover"]');
        const focus = container.querySelector('path[data-ring="focus"]');
        expect(hover?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY, 0.5));
        expect(focus?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY, 1));
    });

    // The slanted side keeps the angle of the standard tab: cut 19 over height 25 scales to 35.72 over 47.
    it('traces the rings with the reported tab height (a taller tab) and its scaled cut, not with the token, which it cannot see per widget', () => {
        const { container } = render(<GridSelectionFrame isSelected tabWidth={180} tabHeight={47} />);

        expect(container.querySelector('path[data-ring="hover"]')?.getAttribute('d'))
            .toBe(buildTabFramePath({ ...GEOMETRY, tabHeight: 47, tabCut: 35.72 }, 0.5));
        expect(container.querySelector('path[data-ring="focus"]')?.getAttribute('d'))
            .toBe(buildTabFramePath({ ...GEOMETRY, tabHeight: 47, tabCut: 35.72 }, 1));
    });

    it('keeps the token cut for the standard tab height', () => {
        const { container } = render(<GridSelectionFrame isSelected tabWidth={180} tabHeight={25} />);

        expect(container.querySelector('path[data-ring="focus"]')?.getAttribute('d')).toBe(buildTabFramePath(GEOMETRY, 1));
    });

    it('follows the reported tab height live', () => {
        const { container, rerender } = render(<GridSelectionFrame isSelected tabWidth={180} tabHeight={47} />);

        rerender(<GridSelectionFrame isSelected tabWidth={180} tabHeight={74.5} />);

        expect(container.querySelector('path[data-ring="focus"]')?.getAttribute('d'))
            .toBe(buildTabFramePath({ ...GEOMETRY, tabHeight: 74.5, tabCut: 56.62 }, 1));
    });

    it('strokes the focus path with the admin accent token and shows it only when selected', () => {
        const { container, rerender } = render(<GridSelectionFrame isSelected tabWidth={180} />);
        const focus = () => container.querySelector('path[data-ring="focus"]') as SVGPathElement;

        expect(focus().getAttribute('stroke')).toBe('var(--color-admin-accent)');
        expect(focus().getAttribute('stroke-width')).toBe('2');
        expect(focus().getAttribute('stroke-opacity')).toBe('1');
        expect(focus().getAttribute('fill')).toBe('none');
        expect(focus().style.filter).toContain('var(--color-admin-accent)');

        rerender(<GridSelectionFrame isSelected={false} tabWidth={180} />);
        expect(focus().getAttribute('stroke-opacity')).toBe('0');
        expect(focus().style.filter).toBe('none');
    });

    it('tints the highlighted hover path with the admin accent token', () => {
        const { container } = render(<GridSelectionFrame isSelected={false} isHighlighted tabWidth={180} />);

        const hover = container.querySelector('path[data-ring="hover"]') as SVGPathElement;
        expect(hover.getAttribute('fill')).toContain('var(--color-admin-accent)');
        expect(hover.getAttribute('stroke-opacity')).toBe('0.18');
    });

    it('draws no rectangle for a tab-shape widget until its silhouette is measured (box or tab width pending)', () => {
        vi.restoreAllMocks();
        mockLayout({ width: 0, height: 0 });

        const unmeasuredBox = render(<GridSelectionFrame isSelected tabWidth={180} />);
        expect(unmeasuredBox.container.querySelectorAll('rect')).toHaveLength(0);
        expect(unmeasuredBox.container.querySelector('path')).toBeNull();
        unmeasuredBox.unmount();

        vi.restoreAllMocks();
        mockLayout({ width: 300, height: 200 });

        const pendingTab = render(<GridSelectionFrame isSelected tabWidth={0} />);
        expect(pendingTab.container.querySelectorAll('rect')).toHaveLength(0);
        expect(pendingTab.container.querySelector('path')).toBeNull();
    });

    it('resolves the bottom-corner radius from the frame radius of the widget (no radius = square corners)', () => {
        vi.restoreAllMocks();
        mockLayout({ width: 300, height: 200, radius: '0px' });

        const { container } = render(<GridSelectionFrame isSelected tabWidth={180} radius="0px" />);

        const focus = container.querySelector('path[data-ring="focus"]');
        expect(focus?.getAttribute('d')).toBe(buildTabFramePath({ ...GEOMETRY, radius: 0 }, 1));
    });
});
