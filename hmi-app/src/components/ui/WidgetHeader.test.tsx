import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import WidgetHeader, { WidgetHeaderDataMode } from './WidgetHeader';

describe('WidgetHeader data mode', () => {
    it('owns separated mode-only composition without deforming the physical dot', () => {
        render(
            <WidgetHeaderDataMode
                dataMode="simulated"
                dataModeTestId="data-mode"
                withLeadingSeparator
            />,
        );

        const dot = screen.getByTestId('data-mode');
        const separator = dot.parentElement;

        expect(dot).toHaveClass('text-industrial-muted');
        expect(dot).toHaveAttribute('aria-hidden', 'true');
        expect(dot).toHaveClass('h-1.5', 'w-1.5', 'shrink-0', 'rounded-full');
        expect(dot).not.toHaveClass('border-l', 'pl-2');
        expect(separator).toHaveClass('border-l', 'border-industrial-muted/25', 'pl-2');
        expect(screen.queryByText(/simulated/i)).not.toBeInTheDocument();
    });

    it('places the decorative mode dot between a left icon and the title', () => {
        render(
            <WidgetHeader
                title="Activity"
                icon={Activity}
                iconPosition="left"
                iconTestId="header-icon"
                dataMode="simulated"
                dataModeTestId="data-mode"
                titleLeading={<span data-testid="title-leading" />}
            />,
        );

        const icon = screen.getByTestId('header-icon');
        const titleLeading = screen.getByTestId('title-leading');
        const dot = screen.getByTestId('data-mode');
        const title = screen.getByText('Activity');

        expect(icon.nextElementSibling).toBe(titleLeading);
        expect(titleLeading.nextElementSibling).toBe(dot);
        expect(dot.nextElementSibling).toBe(title);
        expect(dot).toHaveClass('h-1.5', 'w-1.5', 'shrink-0', 'rounded-full');
        expect(dot).toHaveClass('text-industrial-muted');
        expect(dot).toHaveAttribute('aria-hidden', 'true');
    });

    it('places title-leading content and the real-mode dot immediately before the title with a right icon', () => {
        render(
            <WidgetHeader
                title="Metric"
                icon={Activity}
                iconTestId="header-icon"
                dataMode="real"
                dataModeTestId="data-mode"
                titleLeading={<span data-testid="title-leading" />}
            />,
        );

        const titleLeading = screen.getByTestId('title-leading');
        const title = screen.getByText('Metric');
        const dot = screen.getByTestId('data-mode');
        const icon = screen.getByTestId('header-icon');

        expect(titleLeading.nextElementSibling).toBe(dot);
        expect(dot.nextElementSibling).toBe(title);
        expect(icon.parentElement).not.toBe(title.parentElement);
        expect(dot).toHaveClass('h-1.5', 'w-1.5', 'shrink-0', 'rounded-full');
        expect(dot).toHaveClass('text-status-normal');
    });

    it('places title-leading content and the mode dot immediately before the centered title with the icon below', () => {
        render(
            <WidgetHeader
                title="Connection"
                icon={Activity}
                iconPosition="centered"
                iconTestId="header-icon"
                dataMode="simulated"
                dataModeTestId="data-mode"
                titleLeading={<span data-testid="title-leading" />}
            />,
        );

        const titleLeading = screen.getByTestId('title-leading');
        const title = screen.getByText('Connection');
        const dot = screen.getByTestId('data-mode');
        const icon = screen.getByTestId('header-icon');

        expect(titleLeading.nextElementSibling).toBe(dot);
        expect(dot.nextElementSibling).toBe(title);
        expect(title.parentElement?.nextElementSibling).toBe(icon);
        expect(dot).toHaveClass('h-1.5', 'w-1.5', 'shrink-0', 'rounded-full');
    });
});
