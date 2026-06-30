import type { ComponentProps, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import HeaderWidgetCanvas from './HeaderWidgetCanvas';
import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { HEADER_WIDGET_DRAG_MIME } from '../../utils/headerWidgets';

vi.mock('./HeaderWidgetRenderer', () => ({
    default: ({ widget }: { widget: { id: string; title?: string } }) => (
        <div data-testid={`header-widget-renderer-${widget.id}`}>{widget.title ?? widget.id}</div>
    ),
}));

vi.mock('../ui/HeaderSelectionFrame', () => ({
    default: () => null,
}));

vi.mock('../ui/WidgetHoverActions', () => ({
    default: ({ actions }: { actions: Array<{ label: string; onClick: () => void }> }) => (
        <div>
            {actions.map((action) => (
                <button key={action.label} type="button" aria-label={action.label} onClick={action.onClick}>
                    {action.label}
                </button>
            ))}
        </div>
    ),
}));

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) => (isOpen ? <>{children}</> : null),
}));

function createDataTransfer(payload?: unknown) {
    return {
        dropEffect: 'none',
        getData: vi.fn((type: string) => (type === HEADER_WIDGET_DRAG_MIME && payload !== undefined
            ? JSON.stringify(payload)
            : '')),
    };
}

function renderPreviewCanvas(overrides: Partial<ComponentProps<typeof HeaderWidgetCanvas>> = {}) {
    return render(
        <HeaderWidgetCanvas
            widgets={[]}
            equipmentMap={new Map()}
            mode="preview"
            onWidgetSelect={vi.fn()}
            {...overrides}
        />,
    );
}

describe('HeaderWidgetCanvas', () => {
    it('selects a widget by click, Enter, and Space', async () => {
        const user = userEvent.setup();
        const onWidgetSelect = vi.fn();

        renderPreviewCanvas({
            widgets: [makeWidget({ id: 'header-status', type: 'status', title: 'Status widget' })],
            widgetColumnMap: new Map([['header-status', 0]]),
            onWidgetSelect,
        });

        const surface = screen.getByRole('button', { name: 'Status widget' });

        await user.click(surface);
        surface.focus();
        fireEvent.keyDown(surface, { key: 'Enter' });
        fireEvent.keyDown(surface, { key: ' ' });

        expect(onWidgetSelect).toHaveBeenNthCalledWith(1, 'header-status');
        expect(onWidgetSelect).toHaveBeenNthCalledWith(2, 'header-status');
        expect(onWidgetSelect).toHaveBeenNthCalledWith(3, 'header-status');
    });

    it('exposes preview hover actions for move, return, and delete', async () => {
        const user = userEvent.setup();
        const onMoveWidget = vi.fn();
        const onRemoveWidget = vi.fn();
        const onDeleteWidget = vi.fn();

        renderPreviewCanvas({
            widgets: [makeWidget({ id: 'header-status', type: 'status', title: 'Status widget' })],
            widgetColumnMap: new Map([['header-status', 1]]),
            onMoveWidget,
            onRemoveWidget,
            onDeleteWidget,
        });

        await user.click(screen.getByRole('button', { name: 'Mover a la izquierda' }));
        await user.click(screen.getByRole('button', { name: 'Mover a la derecha' }));
        await user.click(screen.getByRole('button', { name: 'Devolver widget al grid' }));
        await user.click(screen.getByRole('button', { name: 'Eliminar widget' }));

        expect(onMoveWidget).toHaveBeenNthCalledWith(1, 'header-status', 0);
        expect(onMoveWidget).toHaveBeenNthCalledWith(2, 'header-status', 2);
        expect(onRemoveWidget).toHaveBeenCalledWith('header-status');
        expect(onDeleteWidget).toHaveBeenCalledWith('header-status');
    });

    it('navigates viewer header widgets only when a dashboard target is configured', async () => {
        const user = userEvent.setup();
        const onNavigateDashboard = vi.fn();

        const { rerender } = render(
            <HeaderWidgetCanvas
                widgets={[
                    makeWidget({
                        id: 'header-status',
                        type: 'status',
                        title: 'Status widget',
                        navigationTargetDashboardId: 'dashboard-linea-a',
                    }) as never,
                ]}
                equipmentMap={new Map()}
                mode="viewer"
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        const surface = screen.getByRole('button', { name: 'Status widget' });

        await user.click(surface);
        fireEvent.keyDown(surface, { key: ' ' });

        expect(onNavigateDashboard).toHaveBeenNthCalledWith(1, 'dashboard-linea-a');
        expect(onNavigateDashboard).toHaveBeenNthCalledWith(2, 'dashboard-linea-a');

        rerender(
            <HeaderWidgetCanvas
                widgets={[makeWidget({ id: 'header-status', type: 'status', title: 'Status widget' }) as never]}
                equipmentMap={new Map()}
                mode="viewer"
                onNavigateDashboard={onNavigateDashboard}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Status widget' })).not.toBeInTheDocument();
        expect(onNavigateDashboard).toHaveBeenCalledTimes(2);
    });

    it('opens the empty slot add menu and inserts the selected widget type into that slot', async () => {
        const user = userEvent.setup();
        const onAddHeaderWidget = vi.fn();

        renderPreviewCanvas({
            canDropHeaderWidget: true,
            onAddHeaderWidget,
        });

        const addButtons = screen.getAllByRole('button', { name: 'Agregar widget al header' });
        await user.click(addButtons[1]);

        expect(screen.getByText('Agregar widget de header')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /Estado de conexión/i }));

        expect(onAddHeaderWidget).toHaveBeenCalledWith('connection-status', 1);
        expect(screen.queryByText('Agregar widget de header')).not.toBeInTheDocument();
    });

    it('accepts builder-grid drops on empty slots', () => {
        const onDropWidgetAtSlot = vi.fn();

        renderPreviewCanvas({
            canDropHeaderWidget: true,
            onDropWidgetAtSlot,
        });

        const emptySlot = screen.getByTestId('header-empty-slot-2');
        const dataTransfer = createDataTransfer({
            widgetId: 'header-status',
            widgetType: 'status',
            source: 'builder-grid',
        });

        fireEvent.dragOver(emptySlot, { dataTransfer });
        expect(dataTransfer.dropEffect).toBe('move');
        expect(emptySlot).toHaveAttribute('data-drop-active', 'true');

        fireEvent.drop(emptySlot, { dataTransfer });

        expect(onDropWidgetAtSlot).toHaveBeenCalledWith('header-status', 2);
        expect(emptySlot).toHaveAttribute('data-drop-active', 'false');
    });

    it('ignores invalid payloads and header-canvas payloads on empty slots', () => {
        const onDropWidgetAtSlot = vi.fn();

        renderPreviewCanvas({
            canDropHeaderWidget: true,
            onDropWidgetAtSlot,
        });

        const invalidSlot = screen.getByTestId('header-empty-slot-0');
        const invalidDataTransfer = {
            dropEffect: 'none',
            getData: vi.fn((type: string) => (type === HEADER_WIDGET_DRAG_MIME ? '{invalid-json' : '')),
        };

        fireEvent.dragOver(invalidSlot, { dataTransfer: invalidDataTransfer });
        fireEvent.drop(invalidSlot, { dataTransfer: invalidDataTransfer });

        expect(invalidDataTransfer.dropEffect).toBe('none');
        expect(invalidSlot).toHaveAttribute('data-drop-active', 'false');
        expect(onDropWidgetAtSlot).not.toHaveBeenCalled();

        const sameCanvasSlot = screen.getByTestId('header-empty-slot-1');
        const headerCanvasDataTransfer = createDataTransfer({
            widgetId: 'header-status',
            widgetType: 'status',
            source: 'header-canvas',
        });

        fireEvent.dragOver(sameCanvasSlot, { dataTransfer: headerCanvasDataTransfer });
        fireEvent.drop(sameCanvasSlot, { dataTransfer: headerCanvasDataTransfer });

        expect(headerCanvasDataTransfer.dropEffect).toBe('none');
        expect(sameCanvasSlot).toHaveAttribute('data-drop-active', 'false');
        expect(onDropWidgetAtSlot).not.toHaveBeenCalled();
    });

    it('ignores builder-grid drops when header dropping is disabled', () => {
        const onDropWidgetAtSlot = vi.fn();

        renderPreviewCanvas({
            canDropHeaderWidget: false,
            onDropWidgetAtSlot,
        });

        const emptySlot = screen.getByTestId('header-empty-slot-2');
        const dataTransfer = createDataTransfer({
            widgetId: 'header-status',
            widgetType: 'status',
            source: 'builder-grid',
        });

        fireEvent.dragOver(emptySlot, { dataTransfer });
        fireEvent.drop(emptySlot, { dataTransfer });

        expect(dataTransfer.dropEffect).toBe('none');
        expect(emptySlot).toHaveAttribute('data-drop-active', 'false');
        expect(onDropWidgetAtSlot).not.toHaveBeenCalled();
    });
});
