import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentProps, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import HeaderWidgetCanvas from './HeaderWidgetCanvas';
import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { HEADER_WIDGET_DRAG_MIME } from '../../utils/headerWidgets';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

vi.mock('./HeaderWidgetRenderer', () => ({
    default: ({ widget }: { widget: { id: string; title?: string; type?: string } }) => {
        const content = widget.type === 'status'
            ? 'Advertencia'
            : (widget.title ?? widget.id);

        return <div data-testid={`header-widget-renderer-${widget.id}`}>{content}</div>;
    },
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
    it('renders header widgets without a persistent panel, background, or border shell', () => {
        const { container } = render(
            <HeaderWidgetCanvas
                widgets={[makeWidget({ id: 'header-status', type: 'status', title: 'Status widget' })]}
                equipmentMap={new Map()}
                mode="viewer"
            />,
        );

        const canvas = container.querySelector('[data-header-widget-canvas="true"]');
        const surface = container.querySelector('[data-header-widget-surface="true"]');

        expect(canvas).not.toHaveClass('border', 'border-dashed');
        expect(surface).not.toHaveClass('glass-panel', 'border');
        expect((surface as HTMLElement).style.background).toBe('');
    });

    it('animates viewer widgets in logical left-to-right slot order without transitioning canvas width', () => {
        const leftWidget = makeWidget({ id: 'header-left', type: 'status', title: 'Left status' });
        const rightWidget = makeWidget({ id: 'header-right', type: 'status', title: 'Right status' });

        const { container } = render(
            <HeaderWidgetCanvas
                widgets={[rightWidget, leftWidget]}
                widgetColumnMap={new Map([
                    ['header-left', 0],
                    ['header-right', 2],
                ])}
                equipmentMap={new Map()}
                mode="viewer"
                viewerEntranceKey="dashboard-line-a"
            />,
        );

        const canvas = container.querySelector('[data-header-widget-canvas="true"]');
        const leftSlot = screen.getByTestId('header-widget-slot-header-left');
        const rightSlot = screen.getByTestId('header-widget-slot-header-right');

        expect(canvas).not.toHaveClass('transition-all');
        expect(leftSlot).toHaveClass('hmi-header-widget-entrance');
        expect(rightSlot).toHaveClass('hmi-header-widget-entrance');
        expect(leftSlot.style.getPropertyValue('--header-widget-entrance-delay')).toBe('0ms');
        expect(rightSlot.style.getPropertyValue('--header-widget-entrance-delay')).toBe('110ms');
    });

    it('uses the explicit viewer entrance distance, duration, and easing', () => {
        const indexCss = fs.readFileSync(path.resolve(currentDir, '../../index.css'), 'utf-8');
        const entranceKeyframes = indexCss.match(
            /@keyframes hmi-header-widget-entrance\s*{([\s\S]*?)}\s*\.hmi-header-widget-entrance/,
        );
        const entranceRule = indexCss.match(
            /\.hmi-header-widget-entrance\s*{([\s\S]*?)}/,
        );

        expect(entranceKeyframes?.[1]).toContain('opacity: 0;');
        expect(entranceKeyframes?.[1]).toContain('transform: translateX(48px);');
        expect(entranceKeyframes?.[1]).toContain('opacity: 1;');
        expect(entranceKeyframes?.[1]).toContain('transform: translateX(0);');
        expect(entranceRule?.[1]).toContain(
            'animation: hmi-header-widget-entrance 320ms cubic-bezier(0.22, 1, 0.36, 1) both;',
        );
    });

    it('restarts viewer entrance when the dashboard identity changes even if widget ids coincide', () => {
        const widget = makeWidget({ id: 'shared-header-widget', type: 'status', title: 'Shared status' });
        const { rerender } = render(
            <HeaderWidgetCanvas
                widgets={[widget]}
                equipmentMap={new Map()}
                mode="viewer"
                viewerEntranceKey="dashboard-line-a"
            />,
        );
        const firstSlot = screen.getByTestId('header-widget-slot-shared-header-widget');

        rerender(
            <HeaderWidgetCanvas
                widgets={[widget]}
                equipmentMap={new Map()}
                mode="viewer"
                viewerEntranceKey="dashboard-line-b"
            />,
        );

        expect(screen.getByTestId('header-widget-slot-shared-header-widget')).not.toBe(firstSlot);
    });

    it('does not apply viewer entrance animation to preview widgets', () => {
        renderPreviewCanvas({
            widgets: [makeWidget({ id: 'header-status', type: 'status', title: 'Status widget' })],
            widgetColumnMap: new Map([['header-status', 0]]),
        });

        const widgetSlot = screen.getByTestId('header-widget-slot-header-status');

        expect(widgetSlot).not.toHaveClass('hmi-header-widget-entrance');
        expect(widgetSlot.style.getPropertyValue('--header-widget-entrance-delay')).toBe('');
    });

    it('disables header widget entrance animation and delay for reduced motion', () => {
        const indexCss = fs.readFileSync(path.resolve(currentDir, '../../index.css'), 'utf-8');
        const reducedMotionRule = indexCss.match(
            /@media \(prefers-reduced-motion: reduce\)\s*{[\s\S]*?\.hmi-header-widget-entrance\s*{([\s\S]*?)}[\s\S]*?}/,
        );

        expect(reducedMotionRule?.[1]).toContain('animation: none;');
        expect(reducedMotionRule?.[1]).toContain('animation-delay: 0ms;');
    });

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

    it('does not render a STATUS fallback title for header status widgets with an empty title', () => {
        renderPreviewCanvas({
            widgets: [makeWidget({ id: 'header-status', type: 'status', title: '' })],
            widgetColumnMap: new Map([['header-status', 0]]),
        });

        const widgetSlot = screen.getByTestId('header-widget-slot-header-status');
        const widgetSurface = widgetSlot.querySelector('[data-header-widget-surface="true"]');

        expect(widgetSurface).not.toBeNull();
        expect(within(widgetSurface as HTMLElement).queryByText(/^status$/i)).not.toBeInTheDocument();
        expect(screen.getByText('Advertencia')).toBeInTheDocument();
    });

    it('renders the explicit title for header status widgets and keeps the status label visible', () => {
        renderPreviewCanvas({
            widgets: [makeWidget({ id: 'header-status', type: 'status', title: 'Main line status' })],
            widgetColumnMap: new Map([['header-status', 0]]),
        });

        expect(screen.getByText('Main line status')).toBeInTheDocument();
        expect(screen.getByText('Advertencia')).toBeInTheDocument();
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
