import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import WidgetHeaderTemporalControls from './WidgetHeaderTemporalControls';

describe('WidgetHeaderTemporalControls', () => {
    it('supports a single temporal scale without rendering a separator', async () => {
        const user = userEvent.setup();
        const handleSelect = vi.fn();

        render(
            <WidgetHeaderTemporalControls
                variant="pill"
                testId="temporal-controls"
                separatorTestId="temporal-separator"
                groups={[
                    {
                        testId: 'single-scale-group',
                        selectedValue: '10s',
                        onSelect: handleSelect,
                        options: [
                            { value: '1s', label: '1s' },
                            { value: '10s', label: '10s' },
                            { value: '30s', label: '30s' },
                        ],
                    },
                ]}
            />,
        );

        expect(screen.getByTestId('temporal-controls')).toHaveClass('flex', 'items-center', 'gap-2.5');
        expect(screen.getByTestId('single-scale-group')).toBeInTheDocument();
        expect(screen.queryByTestId('temporal-separator')).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: '30s' }));

        expect(handleSelect).toHaveBeenCalledWith('30s');
    });

    it('renders two temporal groups in order with the shared separator contract', () => {
        render(
            <WidgetHeaderTemporalControls
                variant="underline"
                testId="temporal-controls"
                separatorTestId="temporal-separator"
                groups={[
                    {
                        testId: 'range-group',
                        selectedValue: '5m',
                        onSelect: vi.fn(),
                        options: [
                            { value: '1m', label: '1m' },
                            { value: '5m', label: '5m' },
                        ],
                    },
                    {
                        testId: 'bucket-group',
                        selectedValue: '10m',
                        onSelect: vi.fn(),
                        options: [
                            { value: '10m', label: '10m' },
                            { value: '20m', label: '20m' },
                        ],
                    },
                ]}
            />,
        );

        const runtimeControls = screen.getByTestId('temporal-controls');
        const rangeGroup = screen.getByTestId('range-group');
        const bucketGroup = screen.getByTestId('bucket-group');

        expect(runtimeControls.children[0]).toBe(rangeGroup);
        expect(runtimeControls.children[1]).toBe(bucketGroup);
        expect(bucketGroup).toHaveClass('border-l', 'border-industrial-muted/25', 'pl-2.5');
        expect(within(rangeGroup).getAllByRole('button').map((button) => button.textContent)).toEqual(['1m', '5m']);
        expect(within(bucketGroup).getAllByRole('button').map((button) => button.textContent)).toEqual(['10m', '20m']);
        expect(screen.getByTestId('temporal-separator')).toBeInTheDocument();
    });

    it('applies the pill selected visual contract', () => {
        render(
            <WidgetHeaderTemporalControls
                variant="pill"
                indicatorTestId="temporal-indicator"
                groups={[
                    {
                        selectedValue: '10s',
                        onSelect: vi.fn(),
                        options: [
                            { value: '1s', label: '1s' },
                            { value: '10s', label: '10s' },
                        ],
                    },
                ]}
            />,
        );

        const activeButton = screen.getByRole('button', { name: '10s' });
        const activeLabel = within(activeButton).getByText('10s');
        const activeIndicator = within(activeButton).getByTestId('temporal-indicator');

        expect(activeButton).toHaveClass('group/control', 'rounded-md', 'border-admin-accent/30', 'bg-admin-accent/10', 'px-2', 'py-1', 'text-admin-accent');
        expect(activeLabel).toHaveClass('translate-y-[1.5px]');
        expect(activeIndicator).toHaveClass('h-[1.5px]', 'w-1/4', 'min-w-[0.45rem]', 'bg-transparent');
        expect(activeIndicator).not.toHaveClass('bg-current', 'group-hover/control:bg-current', 'group-focus-visible/control:bg-current');
    });

    it('applies the underline selected visual contract with local hover group classes and indicator geometry', () => {
        render(
            <WidgetHeaderTemporalControls
                variant="underline"
                indicatorTestId="temporal-indicator"
                groups={[
                    {
                        selectedValue: '5m',
                        onSelect: vi.fn(),
                        options: [
                            { value: '1m', label: '1m' },
                            { value: '5m', label: '5m' },
                        ],
                    },
                ]}
            />,
        );

        const activeButton = screen.getByRole('button', { name: '5m' });
        const inactiveButton = screen.getByRole('button', { name: '1m' });
        const activeIndicator = within(activeButton).getByTestId('temporal-indicator');
        const inactiveIndicator = within(inactiveButton).getByTestId('temporal-indicator');

        expect(activeButton).toHaveClass('group/control', 'px-2', 'py-1', 'text-industrial-text');
        expect(activeButton).not.toHaveClass('rounded-md', 'bg-admin-accent/10', 'border-admin-accent/30', 'text-admin-accent');
        expect(activeIndicator).toHaveClass('h-[1.5px]', 'w-1/4', 'min-w-[0.45rem]', 'bg-current', 'group-hover/control:bg-current', 'group-focus-visible/control:bg-current');
        expect(inactiveIndicator).toHaveClass('bg-transparent', 'group-hover/control:bg-current', 'group-focus-visible/control:bg-current');
    });

    it('keeps disabled options disabled with cursor-default', async () => {
        const user = userEvent.setup();
        const handleSelect = vi.fn();

        render(
            <WidgetHeaderTemporalControls
                variant="underline"
                indicatorTestId="temporal-indicator"
                groups={[
                    {
                        selectedValue: '5m',
                        onSelect: handleSelect,
                        options: [
                            { value: '5m', label: '5m' },
                            { value: '10m', label: '10m', disabled: true },
                        ],
                    },
                ]}
            />,
        );

        const disabledButton = screen.getByRole('button', { name: '10m' });
        const disabledIndicator = within(disabledButton).getByTestId('temporal-indicator');

        expect(disabledButton).toBeDisabled();
        expect(disabledButton).toHaveClass('cursor-default', 'text-industrial-muted/50');
        expect(disabledButton).not.toHaveClass('disabled:cursor-not-allowed');
        expect(disabledIndicator).toHaveClass('bg-transparent');
        expect(disabledIndicator).not.toHaveClass('bg-current', 'group-hover/control:bg-current', 'group-focus-visible/control:bg-current');

        await user.click(disabledButton);

        expect(handleSelect).not.toHaveBeenCalled();
    });
});
