import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import GridSelectionFrame from './GridSelectionFrame';

// G14 (2026-09-28): the builder selection frame must take its color from the Design tab's
// "Acento Admin" token (`--color-admin-accent`), the same token that colors primary buttons via
// `.admin-accent-ghost`. It previously used `--color-admin-selection-from/-to`, which is not
// editable in the Design tab, so the frame stayed a fixed purple/blue no matter what the user set
// as their admin accent.
describe('GridSelectionFrame', () => {
    it('strokes the focus ring with the admin accent token, not the old fixed selection tokens', () => {
        const { container } = render(<GridSelectionFrame isSelected />);

        const rects = container.querySelectorAll('rect');
        const focusRect = rects[rects.length - 1];

        expect(focusRect.getAttribute('stroke')).toBe('var(--color-admin-accent)');
        expect(container.innerHTML).not.toContain('--color-admin-selection-from');
        expect(container.innerHTML).not.toContain('--color-admin-selection-to');
    });

    it('derives the selected drop-shadow glow from the admin accent token', () => {
        const { container } = render(<GridSelectionFrame isSelected />);

        const rects = container.querySelectorAll('rect');
        const focusRect = rects[rects.length - 1] as SVGRectElement;

        expect(focusRect.style.filter).toContain('var(--color-admin-accent)');
        expect(focusRect.style.filter).not.toContain('--color-admin-selection');
    });

    it('tints the highlighted hover fill with the admin accent token', () => {
        const { container } = render(<GridSelectionFrame isSelected={false} isHighlighted />);

        const hoverRect = container.querySelectorAll('rect')[0];

        expect(hoverRect.getAttribute('fill')).toContain('var(--color-admin-accent)');
        expect(hoverRect.getAttribute('fill')).not.toContain('--color-admin-selection');
    });

    // TH6 (2026-09-28): the frame previously hardcoded the widget radius (`radius = '1.5rem'`,
    // `radiusToPx`), so with the "Contorno" theme (frame radius 0) the ring stayed rounded around
    // square widgets. It must derive its geometry from the live theme frame radius token instead.
    describe('theme radius', () => {
        it('derives the outer radius from the theme frame radius token, not a hardcoded rem/px value', () => {
            const { container } = render(<GridSelectionFrame isSelected />);

            const outer = container.querySelector('[data-testid="grid-selection-frame"]') as HTMLElement;

            expect(outer.style.borderRadius).toContain('var(--frame-radius-rest)');
            expect(container.innerHTML).not.toContain('1.5rem');
            expect(container.innerHTML).not.toContain('24px');
        });

        it('keeps the Clásico geometry pixel-identical in computed calc terms (1.5rem = 24px today)', () => {
            const { container } = render(<GridSelectionFrame isSelected />);

            const outer = container.querySelector('[data-testid="grid-selection-frame"]') as HTMLElement;
            const rects = container.querySelectorAll('rect');
            const hoverRect = rects[0] as SVGRectElement;
            const focusRect = rects[1] as SVGRectElement;

            // GRID_RADIUS_DELTA_PX = 0, GRID_BORDER_WIDTH_PX = 2: with --frame-radius-rest
            // resolved to 24px, this reproduces the previous outerRadiusPx = 24,
            // rectRxPx = 23 (focus) and 23.5 (hover) exactly.
            expect(outer.style.borderRadius).toBe('calc(var(--frame-radius-rest) + 0px)');
            expect(hoverRect.style.getPropertyValue('rx')).toBe('max(0px, calc(var(--frame-radius-rest) + 0px - 0.5px))');
            expect(focusRect.style.getPropertyValue('rx')).toBe('max(0px, calc(var(--frame-radius-rest) + 0px - 1px))');
        });

        it('clamps the stroke-center radius to 0 instead of going negative for a frameless widget', () => {
            const { container } = render(<GridSelectionFrame isSelected radius="0px" />);

            const rects = container.querySelectorAll('rect');
            const focusRect = rects[1] as SVGRectElement;

            // Without max(0px, ...) this would resolve to -1px (0 - GRID_BORDER_WIDTH_PX / 2),
            // an invalid negative SVG radius. jsdom evaluates this fully-literal (no var())
            // max()/calc() eagerly, so the clamp shows up as a resolved non-negative length.
            expect(focusRect.style.getPropertyValue('rx')).toBe('calc(0px)');
        });
    });
});
