import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import DockCheckboxField from './DockCheckboxField';

function ControlledDockCheckboxField({ initialValue = false }: { initialValue?: boolean }) {
    const [checked, setChecked] = useState(initialValue);

    return (
        <DockCheckboxField
            label="Include"
            ariaLabel="Include"
            checked={checked}
            onChange={setChecked}
        />
    );
}

describe('DockCheckboxField', () => {
    it('toggles the checked state when clicked', async () => {
        const user = userEvent.setup();

        render(<ControlledDockCheckboxField />);

        const checkbox = screen.getByLabelText('Include');
        expect(checkbox).not.toBeChecked();

        await user.click(checkbox);
        expect(checkbox).toBeChecked();
    });

    it('keeps the control aligned to the right through the shared inline row contract', () => {
        render(<ControlledDockCheckboxField initialValue />);

        expect(screen.getByLabelText('Include').closest('div')).toHaveClass('flex', 'justify-end');
    });

    it('emits a plain boolean instead of leaking the DOM event', async () => {
        const user = userEvent.setup();
        const changes: unknown[] = [];

        render(
            <DockCheckboxField
                label="Include"
                ariaLabel="Include"
                checked={false}
                onChange={(checked) => changes.push(checked)}
            />,
        );

        await user.click(screen.getByLabelText('Include'));

        expect(changes).toEqual([true]);
        expect(typeof changes[0]).toBe('boolean');
    });
});
