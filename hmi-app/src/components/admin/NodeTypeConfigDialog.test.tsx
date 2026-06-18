import '@testing-library/jest-dom/vitest';
import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NodeTypeDefinition } from '../../services/NodeTypeStorageService';
import NodeTypeConfigDialog from './NodeTypeConfigDialog';

const BASE_NODE_TYPES: NodeTypeDefinition[] = [
    { key: 'plant', label: 'Planta', icon: 'factory', color: 'text-accent-cyan' },
    { key: 'area', label: 'Área', icon: 'layers', color: 'text-accent-blue' },
];

function renderDialog(props?: Partial<ComponentProps<typeof NodeTypeConfigDialog>>) {
    const onClose = vi.fn();
    const onSave = vi.fn();

    const view = render(
        <NodeTypeConfigDialog
            open
            onClose={onClose}
            nodeTypes={BASE_NODE_TYPES}
            onSave={onSave}
            nodeCountByType={{}}
            {...props}
        />,
    );

    return {
        user: userEvent.setup(),
        onClose,
        onSave,
        ...view,
    };
}

function getSaveButton() {
    return screen.getByRole('button', { name: /guardar cambios/i });
}

describe('NodeTypeConfigDialog', () => {
    it('renders nothing while the dialog is closed', () => {
        renderDialog({ open: false });

        expect(screen.queryByRole('dialog', { name: /configurar tipos de nodo/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /guardar cambios/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/agregar tipo/i)).not.toBeInTheDocument();
    });

    it('initializes rows from props when the dialog opens', () => {
        const onClose = vi.fn();
        const onSave = vi.fn();
        const { rerender } = render(
            <NodeTypeConfigDialog
                open={false}
                onClose={onClose}
                nodeTypes={[BASE_NODE_TYPES[0]]}
                onSave={onSave}
                nodeCountByType={{}}
            />,
        );

        rerender(
            <NodeTypeConfigDialog
                open
                onClose={onClose}
                nodeTypes={BASE_NODE_TYPES}
                onSave={onSave}
                nodeCountByType={{}}
            />,
        );

        expect(screen.getByRole('dialog', { name: /configurar tipos de nodo/i })).toBeInTheDocument();
        expect(screen.getByDisplayValue('Planta')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Área')).toBeInTheDocument();
    });

    it('disables save for a blank new row until a label is entered', async () => {
        const { user } = renderDialog();

        expect(getSaveButton()).toBeEnabled();

        await user.click(screen.getByRole('button', { name: /agregar tipo/i }));

        expect(getSaveButton()).toBeDisabled();
        expect(screen.getByText(/revisá los tipos antes de guardar/i)).toBeInTheDocument();

        const labelInputs = screen.getAllByRole('textbox');
        await user.type(labelInputs[labelInputs.length - 1], 'Bomba');

        expect(getSaveButton()).toBeEnabled();
        expect(screen.queryByText(/revisá los tipos antes de guardar/i)).not.toBeInTheDocument();
    });

    it('generates a derived key on label blur when possible', async () => {
        const { user } = renderDialog({ nodeTypes: [BASE_NODE_TYPES[0]] });

        await user.click(screen.getByRole('button', { name: /agregar tipo/i }));

        const labelInputs = screen.getAllByRole('textbox');
        await user.type(labelInputs[labelInputs.length - 1], 'Planta');
        await user.tab();

        expect(screen.getAllByText(/key:\s*plant-1/i).length).toBeGreaterThan(0);
    });

    it('emits sanitized node types on save', async () => {
        const { user, onSave } = renderDialog({ nodeTypes: [BASE_NODE_TYPES[0]] });

        await user.click(screen.getByRole('button', { name: /agregar tipo/i }));

        const labelInputs = screen.getAllByRole('textbox');
        await user.type(labelInputs[labelInputs.length - 1], '  Bomba  ');
        await user.tab();
        await user.click(getSaveButton());

        expect(onSave).toHaveBeenCalledWith([
            BASE_NODE_TYPES[0],
            {
                key: 'pump',
                label: 'Bomba',
                icon: 'square',
                color: 'text-accent-purple',
            },
        ]);
    });

    it('removes an unused type immediately', async () => {
        const { user } = renderDialog();

        await user.click(screen.getAllByRole('button', { name: /^eliminar$/i })[1]);

        expect(screen.queryByDisplayValue('Área')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /tipo de nodo en uso/i })).not.toBeInTheDocument();
    });

    it('asks for confirmation before deleting a used type', async () => {
        const { user } = renderDialog({ nodeCountByType: { plant: 2 } });

        await user.click(screen.getAllByRole('button', { name: /^eliminar$/i })[0]);

        expect(screen.getByRole('dialog', { name: /tipo de nodo en uso/i })).toBeInTheDocument();
        expect(screen.getByText(/planta · 2 nodo\(s\)/i)).toBeInTheDocument();
        expect(screen.getByDisplayValue('Planta')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /eliminar igual/i }));

        expect(screen.queryByDisplayValue('Planta')).not.toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /tipo de nodo en uso/i })).not.toBeInTheDocument();
    });

    it('disables save and shows the warning when duplicate keys are present', () => {
        renderDialog({
            nodeTypes: [
                BASE_NODE_TYPES[0],
                { key: 'plant', label: 'Planta duplicada', icon: 'layers', color: 'text-accent-blue' },
            ],
        });

        expect(getSaveButton()).toBeDisabled();
        expect(screen.getByText(/revisá los tipos antes de guardar/i)).toBeInTheDocument();
    });
});
