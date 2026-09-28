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
});
