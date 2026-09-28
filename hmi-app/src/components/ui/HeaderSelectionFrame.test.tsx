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
});
