import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ConnectionStatusWidgetConfig } from '../../domain/admin.types';
import ConnectionStatusWidget from './ConnectionStatusWidget';

function makeWidget(overrides?: Partial<ConnectionStatusWidgetConfig>): ConnectionStatusWidgetConfig {
    return {
        id: 'connection-1',
        type: 'connection-status',
        title: 'Connection',
        position: { x: 0, y: 0 },
        size: { w: 2, h: 2 },
        binding: { mode: 'real_variable' },
        displayOptions: { showLastUpdate: false },
        ...overrides,
    };
}

describe('ConnectionStatusWidget data mode', () => {
    it('uses the shared centered header indicator for configured real mode', () => {
        render(
            <ConnectionStatusWidget
                widget={makeWidget()}
                equipmentMap={new Map()}
                connection={{ globalStatus: 'online', lastSuccess: null, ageMs: 0 }}
            />,
        );

        const dot = screen.getByTestId('connection-status-widget-data-mode');
        const title = screen.getByText('Connection');

        expect(dot.nextElementSibling).toBe(title);
        expect(dot).toHaveClass('text-status-normal');
        expect(dot).toHaveAttribute('aria-hidden', 'true');
    });

    it('keeps simulated mode visible in the intentional no-title variant', () => {
        render(
            <ConnectionStatusWidget
                widget={makeWidget({
                    title: '',
                    binding: { mode: 'simulated_value', simulatedValue: 'online' },
                })}
                equipmentMap={new Map()}
            />,
        );

        const icon = screen.getByTestId('connection-status-icon-online');
        const dot = screen.getByTestId('connection-status-widget-data-mode');

        expect(icon.nextElementSibling).toBe(dot);
        expect(dot).toHaveClass('text-industrial-muted');
    });

    it('omits the source-mode indicator without a configured binding', () => {
        render(
            <ConnectionStatusWidget
                widget={makeWidget({ binding: undefined })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.queryByTestId('connection-status-widget-data-mode')).not.toBeInTheDocument();
    });
});

describe('ConnectionStatusWidget frame toggle (P2)', () => {
    it('shows the glass-panel frame by default in the grid (showFrame unset)', () => {
        render(
            <ConnectionStatusWidget widget={makeWidget()} equipmentMap={new Map()} />,
        );

        expect(screen.getByTestId('connection-status-widget-surface')).toHaveClass('glass-panel');
    });

    it('hides the glass-panel frame in the grid when showFrame is explicitly false, without changing the content layout', () => {
        render(
            <ConnectionStatusWidget
                widget={makeWidget({ displayOptions: { showLastUpdate: false, showFrame: false } })}
                equipmentMap={new Map()}
            />,
        );

        const surface = screen.getByTestId('connection-status-widget-surface');
        expect(surface).not.toHaveClass('glass-panel');
        expect(surface).toHaveClass('group', 'flex', 'h-full', 'w-full', 'flex-col', 'p-5');
    });

    it('shows the glass-panel frame in the grid when showFrame is explicitly true', () => {
        render(
            <ConnectionStatusWidget
                widget={makeWidget({ displayOptions: { showLastUpdate: false, showFrame: true } })}
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByTestId('connection-status-widget-surface')).toHaveClass('glass-panel');
    });
});
