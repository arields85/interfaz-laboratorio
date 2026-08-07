import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS } from './adminSidebarStyles';
import DockColorField from './DockColorField';

describe('DockColorField', () => {
    it('keeps the hex field width aligned with the alpha numeric field width', () => {
        render(
            <DockColorField
                label="Color inicial"
                color="#22d3ee"
                hexCode="22d3ee"
                alpha={75}
                onColorChange={() => undefined}
                onHexCodeChange={() => undefined}
                onAlphaChange={() => undefined}
                hexInputAriaLabel="Producción hex inicial"
                alphaInputAriaLabel="Producción alfa inicial"
            />,
        );

        expect(screen.getByLabelText('Producción hex inicial').parentElement).toHaveClass(ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS);
        expect(screen.getByLabelText('Producción hex inicial').parentElement).toHaveClass('ml-auto');
        expect(screen.getByLabelText('Producción hex inicial')).not.toHaveClass(ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS);
        expect(screen.getByRole('textbox', { name: 'Producción alfa inicial' }).parentElement).toHaveClass(ADMIN_SIDEBAR_VALUE_INPUT_WIDTH_CLS);
    });

    it('preserves hex editing without the hash prefix in the text field', () => {
        render(
            <DockColorField
                label="Color inicial"
                color="#22d3ee"
                hexCode="22d3ee"
                alpha={75}
                onColorChange={() => undefined}
                onHexCodeChange={() => undefined}
                onAlphaChange={() => undefined}
                hexInputAriaLabel="Producción hex inicial"
                alphaInputAriaLabel="Producción alfa inicial"
            />,
        );

        expect(screen.getByLabelText('Producción hex inicial')).toHaveValue('22d3ee');
    });

    it('owns optional preset color controls and reports the selected color', async () => {
        const user = userEvent.setup();
        const onColorChange = vi.fn();

        render(
            <DockColorField
                label="Color del núcleo"
                color="#1b6ee0"
                hexCode="1b6ee0"
                alpha={100}
                showAlpha={false}
                options={['#1b6ee0', '#1240c8']}
                optionsAriaLabel="Colores de núcleo sugeridos"
                optionAriaLabel={(color) => `Usar color de núcleo ${color}`}
                onColorChange={onColorChange}
                onHexCodeChange={() => undefined}
                onAlphaChange={() => undefined}
            />,
        );

        expect(screen.queryByRole('slider', { name: /alfa/i })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Usar color de núcleo #1240c8' }));

        expect(onColorChange).toHaveBeenCalledWith('#1240c8');
    });
});
