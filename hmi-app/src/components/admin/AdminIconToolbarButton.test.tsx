import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChevronLeft, Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import AdminIconToolbarButton from './AdminIconToolbarButton';

describe('AdminIconToolbarButton', () => {
    it('renders an icon-only button with an accessible label and tooltip', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();

        render(
            <AdminIconToolbarButton
                label="Nueva vista"
                icon={Plus}
                onClick={onClick}
            />,
        );

        const button = screen.getByRole('button', { name: 'Nueva vista' });

        expect(button).toBeInTheDocument();
        expect(button).not.toHaveTextContent('Nueva vista');
        expect(button.querySelector('.lucide-plus')).toHaveAttribute('width', '18');
        expect(button.querySelector('.lucide-plus')).toHaveAttribute('height', '18');

        await user.hover(button);
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Nueva vista');

        await user.click(button);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('keeps tooltip copy independent from the directional aria-label and preserves disabled semantics', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();

        render(
            <AdminIconToolbarButton
                label="Reordenar vista a la izquierda"
                tooltipLabel="Reordenar"
                icon={ChevronLeft}
                disabled
                onClick={onClick}
                iconProps={{ size: 16, strokeWidth: 2.25 }}
            />,
        );

        const button = screen.getByRole('button', { name: 'Reordenar vista a la izquierda' });

        expect(button).toBeDisabled();
        expect(button.querySelector('.lucide-chevron-left')).toHaveAttribute('width', '16');
        expect(button.querySelector('.lucide-chevron-left')).toHaveAttribute('height', '16');

        await user.hover(button);
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Reordenar');

        await user.click(button);
        expect(onClick).not.toHaveBeenCalled();
    });
});
