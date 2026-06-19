import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AdminSelect from './AdminSelect';

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

const OPTIONS = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
];

function Harness() {
    const [disabled, setDisabled] = useState(false);

    return (
        <>
            <button type="button" onClick={() => setDisabled((current) => !current)}>
                Toggle disabled
            </button>
            <AdminSelect
                value=""
                options={OPTIONS}
                onChange={vi.fn()}
                placeholder="Choose option"
                disabled={disabled}
            />
        </>
    );
}

describe('AdminSelect', () => {
    it('closes when disabled and stays closed after re-enabling', async () => {
        const user = userEvent.setup();

        render(<Harness />);

        const trigger = screen.getByRole('button', { name: /choose option/i });
        const toggleDisabled = screen.getByRole('button', { name: /toggle disabled/i });

        await user.click(trigger);
        expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();

        await user.click(toggleDisabled);
        expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();

        await user.click(toggleDisabled);
        expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument();

        await user.click(trigger);
        expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    });
});
