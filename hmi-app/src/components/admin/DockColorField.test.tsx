import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
