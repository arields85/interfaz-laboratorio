import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogVariable } from '../../domain';
import CatalogVariableSelector from './CatalogVariableSelector';

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
}));

const VARIABLES: CatalogVariable[] = [
    { id: 'temp', name: 'Temperature', unit: '°C' },
    { id: 'pressure', name: 'Pressure', unit: 'bar' },
    { id: 'flow', name: 'Flow', unit: 'L/min' },
];

function renderSelector(props?: Partial<ComponentProps<typeof CatalogVariableSelector>>) {
    const onChange = vi.fn();
    const onCreateNew = vi.fn();
    const onDelete = vi.fn();

    const view = render(
        <CatalogVariableSelector
            variables={VARIABLES}
            usedIds={[]}
            onChange={onChange}
            onCreateNew={onCreateNew}
            onDelete={onDelete}
            {...props}
        />,
    );

    return {
        user: userEvent.setup(),
        onChange,
        onCreateNew,
        onDelete,
        ...view,
    };
}

describe('CatalogVariableSelector', () => {
    it('renders the selected variable name and unit', () => {
        renderSelector({ selectedId: 'temp' });

        expect(screen.getByRole('button', { name: /temperature/i })).toHaveTextContent('Temperature');
        expect(screen.getByRole('button', { name: /temperature/i })).toHaveTextContent('°C');
    });

    it('opens the list and selects an available variable', async () => {
        const { user, onChange } = renderSelector();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: 'Pressure' }));

        expect(onChange).toHaveBeenCalledWith('pressure');
        expect(screen.queryByRole('button', { name: 'Pressure' })).not.toBeInTheDocument();
    });

    it('disables used variables, shows En uso, and does not call onChange', async () => {
        const { user, onChange } = renderSelector({ usedIds: ['pressure'] });

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));

        const pressureButton = screen.getByRole('button', { name: /pressure.*en uso/i });
        expect(pressureButton).toBeDisabled();

        await user.click(pressureButton);

        expect(onChange).not.toHaveBeenCalled();
    });

    it('trims the create draft and confirms with Enter', async () => {
        const { user, onCreateNew } = renderSelector();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: /crear variable/i }));

        const input = screen.getByPlaceholderText('Ej. Temperatura descarga');
        await user.type(input, '  New variable  {enter}');

        expect(onCreateNew).toHaveBeenCalledWith('New variable');
        expect(screen.queryByPlaceholderText('Ej. Temperatura descarga')).not.toBeInTheDocument();
    });

    it('keeps create confirm disabled for blank drafts and does not call onCreateNew', async () => {
        const { user, onCreateNew } = renderSelector();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: /crear variable/i }));

        const confirmButton = screen.getByRole('button', { name: /confirmar/i });
        expect(confirmButton).toBeDisabled();

        await user.click(confirmButton);

        expect(onCreateNew).not.toHaveBeenCalled();
    });

    it('closes create mode with Escape or Cancel and resets the draft', async () => {
        const { user } = renderSelector();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: /crear variable/i }));

        const input = screen.getByPlaceholderText('Ej. Temperatura descarga');
        await user.type(input, 'Transient');
        await user.keyboard('{Escape}');

        expect(screen.queryByPlaceholderText('Ej. Temperatura descarga')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: /crear variable/i }));

        const reopenedInput = screen.getByPlaceholderText('Ej. Temperatura descarga');
        expect(reopenedInput).toHaveValue('');

        await user.type(reopenedInput, 'Draft to cancel');
        await user.click(screen.getByRole('button', { name: /cancelar/i }));

        expect(screen.queryByPlaceholderText('Ej. Temperatura descarga')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: /crear variable/i }));

        expect(screen.getByPlaceholderText('Ej. Temperatura descarga')).toHaveValue('');
    });

    it('calls onDelete without calling onChange', async () => {
        const { user, onDelete, onChange } = renderSelector();

        await user.click(screen.getByRole('button', { name: /seleccionar variable/i }));
        await user.click(screen.getByRole('button', { name: /eliminar variable pressure/i }));

        expect(onDelete).toHaveBeenCalledWith('pressure');
        expect(onChange).not.toHaveBeenCalled();
    });

    it('does not open or fire callbacks when disabled', async () => {
        const { user, onChange, onCreateNew, onDelete } = renderSelector({ disabled: true, selectedId: 'temp' });

        const trigger = screen.getByRole('button', { name: /temperature/i });
        expect(trigger).toBeDisabled();

        await user.click(trigger);

        expect(screen.queryByText('Pressure')).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
        expect(onCreateNew).not.toHaveBeenCalled();
        expect(onDelete).not.toHaveBeenCalled();
    });
});
