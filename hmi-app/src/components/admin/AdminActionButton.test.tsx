import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminActionButton from './AdminActionButton';

describe('AdminActionButton', () => {
    it('drives the primary variant shape from the theme-button engine, keeping its accent color', () => {
        render(<AdminActionButton variant="primary">Guardar</AdminActionButton>);

        const button = screen.getByRole('button', { name: 'Guardar' });

        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveClass('theme-button', 'admin-accent-ghost');
        expect(button).not.toHaveClass('rounded-md');
    });

    it('drives the secondary variant shape and neutral color from the theme-button engine', () => {
        render(<AdminActionButton variant="secondary">Cancelar</AdminActionButton>);

        const button = screen.getByRole('button', { name: 'Cancelar' });

        expect(button).toHaveClass('theme-button', 'theme-button-neutral', 'text-industrial-muted');
        expect(button).not.toHaveClass('border', 'bg-white/5');
    });

    it('drives the critical variant shape and semantic color from the theme-button engine', () => {
        render(<AdminActionButton variant="critical">Eliminar</AdminActionButton>);

        const button = screen.getByRole('button', { name: 'Eliminar' });

        expect(button).toHaveClass('theme-button', 'theme-button-critical', 'uppercase', 'text-status-critical');
        expect(button).not.toHaveClass('bg-status-critical/10');
    });

    it('keeps disabled styling and a custom className on every variant', () => {
        render(
            <AdminActionButton variant="secondary" disabled className="custom-cls">
                Cerrar
            </AdminActionButton>,
        );

        const button = screen.getByRole('button', { name: 'Cerrar' });

        expect(button).toBeDisabled();
        expect(button).toHaveClass('custom-cls', 'disabled:cursor-not-allowed', 'disabled:opacity-50');
    });
});
