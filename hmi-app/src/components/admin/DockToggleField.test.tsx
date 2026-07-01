import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import DockToggleField from './DockToggleField';

function ControlledDockToggleField({ initialValue = false }: { initialValue?: boolean }) {
    const [checked, setChecked] = useState(initialValue);

    return (
        <DockToggleField
            label="Top cap"
            ariaLabel="Top cap"
            checked={checked}
            onChange={setChecked}
        />
    );
}

describe('DockToggleField', () => {
    it('toggles the checked state when clicked', async () => {
        const user = userEvent.setup();

        render(<ControlledDockToggleField />);

        const toggle = screen.getByLabelText('Top cap');
        expect(toggle).not.toBeChecked();

        await user.click(toggle);
        expect(toggle).toBeChecked();
    });

    it('keeps the control aligned to the right through the shared inline row contract', () => {
        render(<ControlledDockToggleField initialValue />);

        expect(screen.getByLabelText('Top cap').closest('div')).toHaveClass('flex', 'justify-end');
    });

    it('emits a plain boolean instead of leaking the DOM event', async () => {
        const user = userEvent.setup();
        const changes: unknown[] = [];

        render(
            <DockToggleField
                label="Top cap"
                ariaLabel="Top cap"
                checked={false}
                onChange={(checked) => changes.push(checked)}
            />,
        );

        await user.click(screen.getByLabelText('Top cap'));

        expect(changes).toEqual([true]);
        expect(typeof changes[0]).toBe('boolean');
    });
});
