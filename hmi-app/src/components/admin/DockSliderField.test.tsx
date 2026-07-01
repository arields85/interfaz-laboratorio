import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS } from './adminSidebarStyles';
import DockSliderField from './DockSliderField';

function ControlledDockSliderField({
    initialValue = 25,
    min = 0,
    max = 100,
    step = 5,
}: {
    initialValue?: number;
    min?: number;
    max?: number;
    step?: number;
}) {
    const [value, setValue] = useState(initialValue);

    return (
        <DockSliderField
            label="Opacity"
            ariaLabel="Opacity"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={setValue}
        />
    );
}

describe('DockSliderField', () => {
    it('keeps the numeric field in sync when the slider changes', () => {
        render(<ControlledDockSliderField />);

        fireEvent.change(screen.getByRole('slider', { name: 'Opacity' }), {
            target: { value: '40' },
        });

        expect(screen.getByRole('textbox', { name: 'Opacity value' })).toHaveValue('40');
    });

    it('shares min, max, and step constraints with the editable numeric field', async () => {
        const user = userEvent.setup();

        render(<ControlledDockSliderField initialValue={25} min={0} max={100} step={5} />);

        const slider = screen.getByRole('slider', { name: 'Opacity' });
        const input = screen.getByRole('textbox', { name: 'Opacity value' });

        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '100');
        expect(slider).toHaveAttribute('step', '5');

        await user.click(input);
        await user.keyboard('63');
        await user.tab();

        expect(input).toHaveValue('65');
        expect(slider).toHaveValue('65');
    });

    it('uses the shared canonical value-input width by default', () => {
        render(<ControlledDockSliderField />);

        expect(screen.getByRole('textbox', { name: 'Opacity value' }).parentElement).toHaveClass(ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS);
    });
});
