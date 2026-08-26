import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RuntimeDialog from './RuntimeDialog';

describe('RuntimeDialog', () => {
    it('provides the shared runtime modal shell with guarded scroll and close interactions', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        render(
            <RuntimeDialog open title="Captured dialog" onClose={onClose}>
                <p>Captured content</p>
            </RuntimeDialog>,
        );

        const dialog = screen.getByRole('dialog', { name: 'Captured dialog' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog.querySelector('.hmi-scrollbar')).toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: 'Captured dialog', level: 2 })).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
