import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import HeaderWidgetCanvas from './HeaderWidgetCanvas';
import { makeDashboard, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import type { ContractMachine } from '../../domain/dataContract.types';

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeCallbacks = new Map<Element, Set<ResizeObserverCallback>>();

class MockResizeObserver implements ResizeObserver {
    public readonly boxOptions = '';
    private readonly observedElements = new Set<Element>();
    private readonly callback: ResizeObserverCallback;

    public constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
    }

    public observe(target: Element): void {
        this.observedElements.add(target);
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeObserverCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(target: Element): void {
        this.observedElements.delete(target);
        const callbacks = resizeCallbacks.get(target);
        callbacks?.delete(this.callback);
        if (callbacks?.size === 0) {
            resizeCallbacks.delete(target);
        }
    }

    public disconnect(): void {
        for (const element of this.observedElements) {
            this.unobserve(element);
        }
    }
}

function emitResize(target: Element, width: number, height: number) {
    const callbacks = resizeCallbacks.get(target);

    if (!callbacks || callbacks.size === 0) {
        throw new Error('No ResizeObserver registered for the target element.');
    }

    const entry = {
        target,
        contentRect: { width, height },
    } as ResizeObserverEntry;

    for (const callback of callbacks) {
        callback([entry], {} as ResizeObserver);
    }
}

const widgetRendererMock = vi.fn();

vi.mock('../../widgets', () => ({
    WidgetRenderer: (props: { widget: { id: string; title?: string } }) => {
        widgetRendererMock(props);
        return <div data-testid={`widget-renderer-${props.widget.id}`}>{props.widget.title ?? props.widget.id}</div>;
    },
}));

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
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe('DashboardViewer', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            value: vi.fn(),
        });
    });

    afterEach(() => {
        resizeCallbacks.clear();
        widgetRendererMock.mockClear();
        vi.unstubAllGlobals();
    });

    it('renders widgets by persisted x/y coordinates instead of layout array order', async () => {
        const dashboard = makeDashboard({
            aspect: '16:9',
            cols: 20,
            rows: 12,
            widgets: [
                makeWidget({ id: 'widget-near-origin', title: 'Origin' }),
                makeWidget({ id: 'widget-lower-right', title: 'Lower Right' }),
            ],
            layout: [
                makeLayout({ widgetId: 'widget-lower-right', x: 10, y: 4, w: 3, h: 2 }),
                makeLayout({ widgetId: 'widget-near-origin', x: 0, y: 0, w: 4, h: 3 }),
            ],
        });

        const { container } = render(
            <div style={{ width: '1200px', height: '675px' }}>
                <DashboardViewer
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        const observedContainer = container.querySelector('[data-testid="dashboard-viewer-root"]');
        if (!observedContainer) {
            throw new Error('Dashboard viewer root was not rendered.');
        }

        expect(screen.queryByTestId('dashboard-viewer-frame')).not.toBeInTheDocument();

        emitResize(observedContainer, 1200, 675);

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-item-widget-near-origin').style.gridColumnStart).toBe('1');
            expect(screen.getByTestId('dashboard-viewer-item-widget-near-origin').style.gridRowStart).toBe('1');
            expect(screen.getByTestId('dashboard-viewer-item-widget-near-origin').style.gridColumnEnd).toBe('span 4');
            expect(screen.getByTestId('dashboard-viewer-item-widget-near-origin').style.gridRowEnd).toBe('span 3');

            expect(screen.getByTestId('dashboard-viewer-item-widget-lower-right').style.gridColumnStart).toBe('11');
            expect(screen.getByTestId('dashboard-viewer-item-widget-lower-right').style.gridRowStart).toBe('5');
            expect(screen.getByTestId('dashboard-viewer-item-widget-lower-right').style.gridColumnEnd).toBe('span 3');
            expect(screen.getByTestId('dashboard-viewer-item-widget-lower-right').style.gridRowEnd).toBe('span 2');
        });
    });

    it('fills the measured container and keeps the centering flex shell ready for future letterboxing', async () => {
        const dashboard = makeDashboard({
            cols: 24,
            rows: 12,
            widgets: [makeWidget({ id: 'widget-1', title: 'Origin' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
        });

        const { container } = render(
            <div style={{ width: '1200px', height: '800px' }}>
                <DashboardViewer
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        const observedContainer = container.querySelector('[data-testid="dashboard-viewer-root"]');
        if (!observedContainer) {
            throw new Error('Dashboard viewer root was not rendered.');
        }

        expect(screen.queryByTestId('dashboard-viewer-frame')).not.toBeInTheDocument();

        emitResize(observedContainer, 1200, 800);

        await waitFor(() => {
            const canvasFrame = observedContainer.firstElementChild as HTMLElement | null;

            expect(observedContainer.className).toContain('items-center');
            expect(observedContainer.className).toContain('justify-center');
            expect(Number.parseFloat(canvasFrame?.style.width ?? '0')).toBe(1200);
            expect(Number.parseFloat(canvasFrame?.style.height ?? '0')).toBe(800);
            expect(canvasFrame?.style.gridTemplateRows).toBe('repeat(12, 66.66666666666667px)');
        });
    });

    it('passes contract machines to widget renderers', async () => {
        const machines: ContractMachine[] = [{
            unitId: 101,
            name: 'Extrusora 101',
            status: 'online',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 0,
            values: {
                temperature: { value: 88, unit: '°C', timestamp: '2026-04-21T13:00:00.000Z' },
            },
        }];
        const dashboard = makeDashboard({
            widgets: [makeWidget({ id: 'widget-1', title: 'Origin' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
        });

        const { container } = render(
            <div style={{ width: '1200px', height: '800px' }}>
                <DashboardViewer
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    machines={machines}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        const observedContainer = container.querySelector('[data-testid="dashboard-viewer-root"]');
        if (!observedContainer) {
            throw new Error('Dashboard viewer root was not rendered.');
        }

        expect(screen.queryByTestId('dashboard-viewer-frame')).not.toBeInTheDocument();

        emitResize(observedContainer, 1200, 800);

        await waitFor(() => {
            expect(screen.getByTestId('widget-renderer-widget-1')).toBeInTheDocument();
        });

        expect(widgetRendererMock).toHaveBeenCalledWith(
            expect.objectContaining({
                machines,
            }),
        );
    });

    it('keeps the viewer root as a neutral shell until the first valid canvas measurement arrives', () => {
        const dashboard = makeDashboard({
            widgets: [makeWidget({ id: 'widget-1', title: 'Origin' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
        });

        render(
            <div style={{ width: '1200px', height: '800px' }}>
                <DashboardViewer
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        expect(screen.queryByTestId('dashboard-viewer-frame')).not.toBeInTheDocument();
        expect(screen.queryByTestId('widget-renderer-widget-1')).not.toBeInTheDocument();
    });

    it('keeps viewer header widgets in their persisted slot columns', () => {
        render(
            <HeaderWidgetCanvas
                widgets={[
                    makeWidget({ id: 'header-status', type: 'status', title: 'Estado equipo' }),
                ]}
                widgetColumnMap={new Map([['header-status', 2]])}
                equipmentMap={new Map()}
                mode="viewer"
            />,
        );

        const widgetContainer = screen.getByTestId('header-widget-slot-header-status');
        expect(widgetContainer).toHaveStyle({ order: '2' });
    });

    it('keeps empty preview slots at a fixed width even when widgets are wider', () => {
        render(
            <HeaderWidgetCanvas
                widgets={[
                    makeWidget({ id: 'header-status', type: 'status', title: 'Estado equipo con etiqueta más larga' }),
                ]}
                widgetColumnMap={new Map([['header-status', 0]])}
                equipmentMap={new Map()}
                mode="preview"
                onWidgetSelect={vi.fn()}
            />,
        );

        const widgetContainer = screen.getByTestId('header-widget-slot-header-status');
        const emptySlot = screen.getByTestId('header-empty-slot-1');

        expect(widgetContainer).toHaveStyle({ order: '0' });
        expect(emptySlot).toHaveStyle({ width: '72px', minWidth: '72px', order: '1' });
    });

    it('does not render the fallback title for connection-status header widgets without a title', () => {
        render(
            <HeaderWidgetCanvas
                widgets={[
                    makeWidget({ id: 'header-connection', type: 'connection-status', title: '' }),
                ]}
                widgetColumnMap={new Map([['header-connection', 0]])}
                equipmentMap={new Map()}
                mode="viewer"
            />,
        );

        expect(screen.queryByText('connection-status')).not.toBeInTheDocument();
        expect(screen.getByTestId('header-widget-renderer-header-connection')).toBeInTheDocument();
    });

    it('offers arrow actions and moves header widgets with explicit target columns', async () => {
        const user = userEvent.setup();
        const onMoveWidget = vi.fn();

        render(
            <HeaderWidgetCanvas
                widgets={[
                    makeWidget({ id: 'header-status', type: 'status', title: 'Estado equipo' }),
                ]}
                widgetColumnMap={new Map([['header-status', 1]])}
                equipmentMap={new Map()}
                mode="preview"
                onWidgetSelect={vi.fn()}
                onMoveWidget={onMoveWidget}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Mover a la izquierda' }));
        await user.click(screen.getByRole('button', { name: 'Mover a la derecha' }));

        expect(onMoveWidget).toHaveBeenNthCalledWith(1, 'header-status', 0);
        expect(onMoveWidget).toHaveBeenNthCalledWith(2, 'header-status', 2);
    });

    it('keeps grid-to-header empty slot drops working', () => {
        const onDropWidgetAtSlot = vi.fn();

        render(
            <HeaderWidgetCanvas
                widgets={[]}
                equipmentMap={new Map()}
                mode="preview"
                onWidgetSelect={vi.fn()}
                canDropHeaderWidget
                onDropWidgetAtSlot={onDropWidgetAtSlot}
            />,
        );

        const emptySlot = screen.getByTestId('header-empty-slot-2');
        const dataTransfer = {
            dropEffect: 'move',
            getData: vi.fn((type: string) => (
                type === 'application/x-interfaz-laboratorio-header-widget'
                    ? JSON.stringify({ widgetId: 'header-status', widgetType: 'status', source: 'builder-grid' })
                    : ''
            )),
        };

        fireEvent.dragOver(emptySlot, { dataTransfer });
        fireEvent.drop(emptySlot, { dataTransfer });

        expect(onDropWidgetAtSlot).toHaveBeenCalledWith('header-status', 2);
    });
});
