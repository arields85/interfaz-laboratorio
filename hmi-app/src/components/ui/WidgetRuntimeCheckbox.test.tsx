import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WidgetRuntimeCheckbox from './WidgetRuntimeCheckbox';

describe('WidgetRuntimeCheckbox', () => {
    it('renders the accepted runtime checkbox visual contract when unchecked', () => {
        render(
            <WidgetRuntimeCheckbox
                ariaLabel="Mostrar OEE (%)"
                checked={false}
                onCheckedChange={vi.fn()}
                visualTestId="runtime-checkbox-visual"
                checkTestId="runtime-checkbox-check"
            />,
        );

        const input = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });
        const visual = screen.getByTestId('runtime-checkbox-visual');

        expect(input).not.toBeChecked();
        expect(input).toHaveClass('absolute', 'opacity-0', 'cursor-pointer');
        expect(visual).toHaveClass(
            'h-3.5',
            'w-3.5',
            'border-admin-accent/30',
            'bg-admin-accent/10',
            'text-transparent',
            'group-hover/runtime-checkbox:border-admin-accent',
            'group-hover/runtime-checkbox:bg-admin-accent/20',
            'transition-colors',
        );
        expect(visual).not.toHaveClass('text-admin-accent');
        expect(screen.queryByTestId('runtime-checkbox-check')).not.toBeInTheDocument();
    });

    it('renders the accepted runtime checkbox visual contract when checked and reports real input changes', () => {
        const handleCheckedChange = vi.fn();

        render(
            <WidgetRuntimeCheckbox
                ariaLabel="Mostrar OEE (%)"
                checked
                onCheckedChange={handleCheckedChange}
                visualTestId="runtime-checkbox-visual"
                checkTestId="runtime-checkbox-check"
            />,
        );

        const input = screen.getByRole('checkbox', { name: 'Mostrar OEE (%)' });
        const visual = screen.getByTestId('runtime-checkbox-visual');

        expect(input).toBeChecked();
        expect(visual).toHaveClass(
            'border-admin-accent/30',
            'bg-admin-accent/10',
            'text-admin-accent',
            'group-hover/runtime-checkbox:border-admin-accent',
            'group-hover/runtime-checkbox:bg-admin-accent/20',
        );
        expect(visual).not.toHaveClass('text-transparent');
        expect(screen.getByTestId('runtime-checkbox-check')).toBeInTheDocument();

        fireEvent.click(input);

        expect(handleCheckedChange).toHaveBeenCalledWith(false);
    });
});
