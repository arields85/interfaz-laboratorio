import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import HmiButton from './HmiButton';

describe('HmiButton', () => {
    it('renders the primary admin accent variant with full width by default button type', () => {
        render(
            <HmiButton variant="primary" fullWidth>
                Guardar
            </HmiButton>,
        );

        const button = screen.getByRole('button', { name: 'Guardar' });

        expect(button).toHaveAttribute('type', 'button');
        expect(button).toHaveClass('theme-button', 'admin-accent-ghost', 'w-full');
        expect(button).not.toHaveClass('rounded-md');
    });

    it('renders the secondary variant with disabled styling', () => {
        render(
            <HmiButton variant="secondary" size="sm" disabled>
                Cerrar
            </HmiButton>,
        );

        const button = screen.getByRole('button', { name: 'Cerrar' });

        expect(button).toBeDisabled();
        expect(button).toHaveClass('theme-button', 'theme-button-hmi-secondary', 'text-industrial-muted', 'px-3', 'py-1');
        expect(button).not.toHaveClass('border-industrial-border', 'bg-industrial-hover');
    });

    it('supports the danger variant and custom submit type', () => {
        render(
            <HmiButton variant="danger" type="submit">
                Eliminar
            </HmiButton>,
        );

        const button = screen.getByRole('button', { name: 'Eliminar' });

        expect(button).toHaveAttribute('type', 'submit');
        expect(button).toHaveClass('theme-button', 'theme-button-critical', 'text-status-critical');
        expect(button).not.toHaveClass('bg-status-critical/10');
    });
});
