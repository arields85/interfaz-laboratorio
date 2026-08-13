import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import WidgetHeader, { WidgetHeaderDataMode } from './WidgetHeader';

describe('WidgetHeader data mode', () => {
    it('owns mode-only composition without requiring a fake title', () => {
        render(
            <WidgetHeaderDataMode
                dataMode="simulated"
                dataModeTestId="data-mode"
                className="border-l"
            />,
        );

        const dot = screen.getByTestId('data-mode');

        expect(dot).toHaveClass('text-admin-accent');
        expect(dot).toHaveAttribute('aria-hidden', 'true');
        expect(dot).toHaveClass('border-l');
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
            />,
        );

        const icon = screen.getByTestId('header-icon');
        const dot = screen.getByTestId('data-mode');
        const title = screen.getByText('Activity');

        expect(icon.nextElementSibling).toBe(dot);
        expect(dot.nextElementSibling).toBe(title);
        expect(dot).toHaveClass('text-admin-accent');
        expect(dot).toHaveAttribute('aria-hidden', 'true');
    });

    it('places the real-mode dot between the title and a right icon', () => {
        render(
            <WidgetHeader
                title="Metric"
                icon={Activity}
                iconTestId="header-icon"
                dataMode="real"
                dataModeTestId="data-mode"
            />,
        );

        const title = screen.getByText('Metric');
        const dot = screen.getByTestId('data-mode');
        const icon = screen.getByTestId('header-icon');

        expect(title.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(dot.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(dot).toHaveClass('text-status-normal');
    });

    it('keeps the mode dot between title and icon in centered headers', () => {
        render(
            <WidgetHeader
                title="Connection"
                icon={Activity}
                iconPosition="centered"
                iconTestId="header-icon"
                dataMode="simulated"
                dataModeTestId="data-mode"
            />,
        );

        const title = screen.getByText('Connection');
        const dot = screen.getByTestId('data-mode');
        const icon = screen.getByTestId('header-icon');

        expect(title.compareDocumentPosition(dot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(dot.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
