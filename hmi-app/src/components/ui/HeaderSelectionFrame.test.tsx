import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HeaderSelectionFrame from './HeaderSelectionFrame';

describe('HeaderSelectionFrame', () => {
    it('draws the selection ring with the Design tab admin accent, like the grid selection frame', () => {
        const { container } = render(<HeaderSelectionFrame isSelected />);

        const ring = container.querySelector('rect');
        expect(ring).not.toBeNull();
        expect(ring).toHaveAttribute('stroke', 'var(--color-admin-accent)');
        expect(ring?.getAttribute('style') ?? '').toContain('var(--color-admin-accent)');
    });

    it('no longer depends on the non-editable admin selection gradient tokens', () => {
        const { container } = render(<HeaderSelectionFrame isSelected />);

        expect(container.innerHTML).not.toContain('--color-admin-selection-');
    });

    it('hides the ring when the widget is not selected', () => {
        const { container } = render(<HeaderSelectionFrame isSelected={false} />);

        expect(container.querySelector('rect')).toHaveAttribute('stroke-opacity', '0');
    });

    // TH6 (2026-09-28): the frame previously hardcoded the widget radius (`radius = '1.5rem'`,
    // `radiusToPx`), so with the "Contorno" theme (frame radius 0) the ring stayed rounded around
    // square widgets. It must derive its geometry from the live theme frame radius token instead.
    describe('theme radius', () => {
        it('derives the outer radius from the theme frame radius token, not a hardcoded rem/px value', () => {
            const { container } = render(<HeaderSelectionFrame isSelected />);

            const outer = container.firstElementChild as HTMLElement;

            expect(outer.style.borderRadius).toContain('var(--frame-radius-rest)');
            expect(container.innerHTML).not.toContain('1.5rem');
            expect(container.innerHTML).not.toContain('24px');
        });

        it('keeps the Clásico geometry pixel-identical in computed calc terms (1.5rem = 24px today)', () => {
            const { container } = render(<HeaderSelectionFrame isSelected />);

            const outer = container.firstElementChild as HTMLElement;
            const focusRect = container.querySelector('rect') as SVGRectElement;

            // HEADER_RADIUS_DELTA_PX = 1.5, HEADER_BORDER_WIDTH_PX = 2: with
            // --frame-radius-rest resolved to 24px, this reproduces the previous
            // outerRadiusPx = 25.5, rectRxPx = 24.5 exactly.
            expect(outer.style.borderRadius).toBe('calc(var(--frame-radius-rest) + 1.5px)');
            expect(focusRect.style.getPropertyValue('rx')).toBe('max(0px, calc(var(--frame-radius-rest) + 1.5px - 1px))');
        });
    });
});
