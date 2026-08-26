import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import RuntimeField from './RuntimeField';

describe('RuntimeField', () => {
    it('renders token-based runtime input and textarea variants', () => {
        const { rerender } = render(
            <RuntimeField label="Fecha/Hora" type="datetime-local" defaultValue="2026-08-24T10:55" />,
        );

        expect(screen.getByLabelText('Fecha/Hora')).toHaveValue('2026-08-24T10:55');
        expect(screen.getByLabelText('Fecha/Hora')).toHaveClass('font-system', 'bg-industrial-hover');

        rerender(<RuntimeField label="Observaciones" multiline defaultValue="Producto en campaña" />);
        expect(screen.getByLabelText('Observaciones')).toHaveValue('Producto en campaña');
        expect(screen.getByLabelText('Observaciones').tagName).toBe('TEXTAREA');
        expect(screen.getByLabelText('Observaciones')).toHaveClass('hmi-scrollbar');
    });
});
