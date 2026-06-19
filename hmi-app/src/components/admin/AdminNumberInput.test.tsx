import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AdminNumberInput from './AdminNumberInput';

describe('AdminNumberInput', () => {
    it('nudges from the latest external value while blurred', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();
        const { rerender } = render(
            <AdminNumberInput
                ariaLabel="Threshold"
                value={10}
                onChange={onChange}
                step={5}
            />,
        );

        rerender(
            <AdminNumberInput
                ariaLabel="Threshold"
                value={20}
                onChange={onChange}
                step={5}
            />,
        );

        expect(screen.getByRole('textbox', { name: 'Threshold' })).toHaveValue('20');

        await user.click(screen.getAllByRole('button')[0]);

        expect(onChange).toHaveBeenCalledWith('25');
    });

    it('preserves in-progress editing until blur when commitOnBlur is enabled', async () => {
        const onChange = vi.fn();
        const user = userEvent.setup();

        render(
            <AdminNumberInput
                ariaLabel="Threshold"
                value={10}
                onChange={onChange}
                commitOnBlur
            />,
        );

        const input = screen.getByRole('textbox', { name: 'Threshold' });

        await user.click(input);
        await user.keyboard('42');

        expect(input).toHaveValue('42');
        expect(onChange).not.toHaveBeenCalled();

        await user.tab();

        expect(onChange).toHaveBeenCalledWith('42');
    });
});
