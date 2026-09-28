import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GroupWidgetConfig } from '../../domain/admin.types';
import GroupWidget from './GroupWidget';

function makeWidget(overrides?: Partial<GroupWidgetConfig>): GroupWidgetConfig {
    return {
        id: 'group-1',
        type: 'group',
        title: 'Compresión 01',
        position: { x: 0, y: 0 },
        size: { w: 10, h: 10 },
        memberWidgetIds: [],
        locked: false,
        displayOptions: { icon: 'Group' },
        ...overrides,
    };
}

describe('GroupWidget', () => {
    it('renders the shared glass-panel shell with the header text and configured icon', () => {
        const { container } = render(<GroupWidget widget={makeWidget()} className="custom-group" />);

        expect(screen.getByText('Compresión 01')).toBeInTheDocument();
        expect(screen.getByTestId('group-header-icon')).toBeInTheDocument();
        expect(container.firstElementChild).toHaveClass('glass-panel');
        expect(container.firstElementChild).toHaveClass('group');
        expect(container.firstElementChild).toHaveClass('custom-group');
    });

    it('renders an empty body so members placed over the container stay visible', () => {
        render(<GroupWidget widget={makeWidget()} />);

        const header = screen.getByText('Compresión 01');
        const panel = header.closest('.glass-panel');

        expect(panel?.children).toHaveLength(1);
    });

    it('shows a pending placeholder icon when the icon setting is undefined', () => {
        render(<GroupWidget widget={makeWidget({ displayOptions: {} })} />);

        const icon = screen.getByTestId('group-header-icon');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveStyle({ color: 'var(--color-industrial-muted)' });
    });

    it('renders without an icon when the icon setting is explicitly null', () => {
        render(<GroupWidget widget={makeWidget({ displayOptions: { icon: null } })} />);

        expect(screen.queryByTestId('group-header-icon')).not.toBeInTheDocument();
    });

    it('falls back to a placeholder icon color when the configured icon key is unknown', () => {
        render(<GroupWidget widget={makeWidget({ displayOptions: { icon: 'NotARealIcon' } })} />);

        const icon = screen.getByTestId('group-header-icon');
        expect(icon).toHaveStyle({ color: 'var(--color-industrial-muted)' });
    });

    it('falls back to a default title when the widget has no title configured', () => {
        render(<GroupWidget widget={makeWidget({ title: undefined })} />);

        expect(screen.getByText('Contenedor')).toBeInTheDocument();
    });

    it('renders at any given grid size without overflowing its own frame', () => {
        const { container } = render(
            <GroupWidget widget={makeWidget({ size: { w: 1, h: 1 } })} className="h-full w-full" />,
        );

        expect(container.firstElementChild).toHaveClass('h-full');
        expect(container.firstElementChild).toHaveClass('w-full');
    });
});
