import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import BuilderCanvas from './BuilderCanvas';
import DashboardViewer from '../viewer/DashboardViewer';
import { makeDashboard, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import { useUIStore } from '../../store/ui.store';
import type { WidgetConfig } from '../../domain/admin.types';

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeCallbacks = new Map<Element, Set<ResizeObserverCallback>>();

class MockResizeObserver implements ResizeObserver {
    public readonly boxOptions = '';
    private readonly observedElements = new Set<Element>();

    public constructor(private readonly callback: ResizeObserverCallback) {}

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

async function syncCanvasMetrics(target: Element, width: number, height: number) {
    if ((resizeCallbacks.get(target)?.size ?? 0) === 0) {
        await act(async () => {
            window.dispatchEvent(new Event('resize'));
        });
        return;
    }

    await act(async () => {
        emitResize(target, width, height);
    });
}

async function pressPointer(
    user: ReturnType<typeof userEvent.setup>,
    target: Element,
    coords: { clientX: number; clientY: number },
) {
    await user.pointer([{ target, keys: '[MouseLeft>]', coords }]);
}

async function movePointer(
    user: ReturnType<typeof userEvent.setup>,
    target: Element,
    coords: { clientX: number; clientY: number },
) {
    await user.pointer([{ target, coords }]);
}

async function releasePointer(
    user: ReturnType<typeof userEvent.setup>,
    target: Element,
    coords: { clientX: number; clientY: number },
) {
    await user.pointer([{ target, keys: '[/MouseLeft]', coords }]);
}

async function renderInteractiveCanvas(overrides?: {
    cols?: number;
    rows?: number;
    layout?: ReturnType<typeof makeLayout>[];
    selectedWidgetId?: string;
    onWidgetSelect?: (widgetId: string) => void;
    onLayoutCommit?: (layout: { widgetId: string; x: number; y: number; w: number; h: number }) => void;
    resizeWidth?: number;
    resizeHeight?: number;
}) {
    const dashboard = makeDashboard({
        cols: overrides?.cols ?? 20,
        rows: overrides?.rows ?? 12,
        widgets: [makeWidget({ id: 'widget-1', title: 'Widget 1' })],
        layout: overrides?.layout ?? [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
    });

    const view = render(
        <div style={{ width: `${overrides?.resizeWidth ?? 1200}px`, height: `${overrides?.resizeHeight ?? 675}px` }}>
                <BuilderCanvas
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                    selectedWidgetId={overrides?.selectedWidgetId}
                    onWidgetSelect={overrides?.onWidgetSelect}
                onLayoutCommit={overrides?.onLayoutCommit}
            />
        </div>,
    );

    const builderRoot = view.container.querySelector('[data-testid="builder-canvas-root"]');

    if (!builderRoot) {
        throw new Error('Builder root was not rendered.');
    }

    await syncCanvasMetrics(builderRoot, overrides?.resizeWidth ?? 1200, overrides?.resizeHeight ?? 675);

    return {
        ...view,
        builderRoot,
        item: screen.getByTestId('builder-canvas-item-widget-1'),
    };
}

function renderBuilderCanvasWithoutMeasurement(overrides?: {
    cols?: number;
    rows?: number;
    layout?: ReturnType<typeof makeLayout>[];
    widgets?: WidgetConfig[];
}) {
    const dashboard = makeDashboard({
        cols: overrides?.cols ?? 20,
        rows: overrides?.rows ?? 12,
        widgets: overrides?.widgets ?? [makeWidget({ id: 'widget-1', title: 'Widget 1' })],
        layout: overrides?.layout ?? [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
    });

    const view = render(
        <div style={{ width: '1200px', height: '675px' }}>
            <BuilderCanvas
                widgets={dashboard.widgets}
                layout={dashboard.layout}
                equipmentMap={new Map()}
                cols={dashboard.cols}
                rows={dashboard.rows}
            />
        </div>,
    );

    const builderRoot = view.container.querySelector('[data-testid="builder-canvas-root"]');

    if (!builderRoot) {
        throw new Error('Builder root was not rendered.');
    }

    return {
        ...view,
        builderRoot,
        dashboard,
    };
}

vi.mock('../../widgets', () => ({
    WidgetRenderer: ({ widget }: { widget: { id: string; title?: string } }) => (
        widget.title === 'Editable Input'
            ? <input data-testid={`widget-renderer-input-${widget.id}`} defaultValue="editable" />
            : <div data-testid={`widget-renderer-${widget.id}`}>{widget.title ?? widget.id}</div>
    ),
}));

describe('BuilderCanvas', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        localStorage.clear();
        useUIStore.setState(useUIStore.getInitialState());
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440, writable: true });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900, writable: true });
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        resizeCallbacks.clear();
        useUIStore.setState(useUIStore.getInitialState());
        vi.unstubAllGlobals();
    });

    it('keeps the builder root as a neutral shell until the first valid canvas measurement arrives', () => {
        const { builderRoot } = renderBuilderCanvasWithoutMeasurement();

        expect(builderRoot).toBeInTheDocument();
        expect(screen.queryByTestId('builder-canvas-frame')).toBeNull();
        expect(screen.queryByTestId('builder-canvas-item-widget-1')).toBeNull();
    });

    it('renders the builder frame and widget layout after the first valid canvas measurement arrives', async () => {
        const { builderRoot } = renderBuilderCanvasWithoutMeasurement();

        expect(screen.queryByTestId('builder-canvas-frame')).toBeNull();

        await syncCanvasMetrics(builderRoot, 1200, 675);

        await waitFor(() => {
            expect(screen.getByTestId('builder-canvas-frame')).toBeInTheDocument();
            expect(screen.getByTestId('builder-canvas-item-widget-1')).toBeInTheDocument();
        });
    });

    it('positions widgets by persisted x/y coordinates, toggles the grid overlay, and matches viewer placement', async () => {
        const dashboard = makeDashboard({
            cols: 20,
            rows: 12,
            widgets: [
                makeWidget({ id: 'widget-origin', title: 'Origin' }),
                makeWidget({ id: 'widget-lower-right', title: 'Lower Right' }),
            ],
            layout: [
                makeLayout({ widgetId: 'widget-lower-right', x: 8, y: 5, w: 5, h: 2 }),
                makeLayout({ widgetId: 'widget-origin', x: 0, y: 0, w: 4, h: 3 }),
            ],
        });

        useUIStore.setState({ ...useUIStore.getInitialState(), isGridVisible: true });

        const { container } = render(
            <>
                <div style={{ width: '1200px', height: '675px' }}>
                    <BuilderCanvas
                        widgets={dashboard.widgets}
                        layout={dashboard.layout}
                        equipmentMap={new Map()}
                        cols={dashboard.cols}
                        rows={dashboard.rows}
                    />
                </div>
                <div style={{ width: '1200px', height: '675px' }}>
                    <DashboardViewer
                        widgets={dashboard.widgets}
                        layout={dashboard.layout}
                        equipmentMap={new Map()}
                        cols={dashboard.cols}
                        rows={dashboard.rows}
                    />
                </div>
            </>,
        );

        const builderRoot = container.querySelector('[data-testid="builder-canvas-root"]');
        const viewerRoot = container.querySelector('[data-testid="dashboard-viewer-root"]');

        if (!builderRoot || !viewerRoot) {
            throw new Error('Builder or viewer root was not rendered.');
        }

        await syncCanvasMetrics(builderRoot, 1200, 675);
        await syncCanvasMetrics(viewerRoot, 1200, 675);

        const builderFrame = screen.getByTestId('builder-canvas-frame');
        const viewerFrame = screen.getByTestId('dashboard-viewer-frame');

        await waitFor(() => {
            expect(screen.getByTestId('builder-canvas-item-widget-origin').style.gridColumnStart).toBe('1');
            expect(screen.getByTestId('builder-canvas-item-widget-origin').style.gridRowStart).toBe('1');
            expect(screen.getByTestId('builder-canvas-item-widget-lower-right').style.gridColumnStart).toBe('9');
            expect(screen.getByTestId('builder-canvas-item-widget-lower-right').style.gridRowStart).toBe('6');
            expect(builderFrame.style.width).toBe(viewerFrame.style.width);
            expect(builderFrame.style.height).toBe(viewerFrame.style.height);
        });

        expect(builderRoot.className).toContain('w-full');
        expect(builderRoot.className).toContain('items-start');
        expect(builderRoot.className).toContain('justify-start');
        expect(viewerRoot.className).toContain('items-center');
        expect(viewerRoot.className).toContain('justify-center');

        const overlay = screen.getByTestId('builder-canvas-grid-overlay');
        const majorOverlay = screen.getByTestId('builder-canvas-grid-major-overlay');
        const majorVerticalOverlay = screen.getByTestId('builder-canvas-grid-major-vertical-overlay');
        const majorHorizontalOverlay = screen.getByTestId('builder-canvas-grid-major-horizontal-overlay');
        const minorOverlay = screen.getByTestId('builder-canvas-grid-minor-overlay');
        expect(overlay.style.backgroundImage).toBe('');
        expect(majorOverlay.style.backgroundImage).toBe('');
        expect(majorVerticalOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(majorHorizontalOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(minorOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(overlay.style.opacity).toBe('1');

        expect(screen.getByTestId('builder-canvas-item-widget-origin').style.gridColumnStart).toBe(
            screen.getByTestId('dashboard-viewer-item-widget-origin').style.gridColumnStart,
        );
        expect(screen.getByTestId('builder-canvas-item-widget-origin').style.gridRowStart).toBe(
            screen.getByTestId('dashboard-viewer-item-widget-origin').style.gridRowStart,
        );
        expect(screen.getByTestId('builder-canvas-item-widget-lower-right').style.gridColumnStart).toBe(
            screen.getByTestId('dashboard-viewer-item-widget-lower-right').style.gridColumnStart,
        );
        expect(screen.getByTestId('builder-canvas-item-widget-lower-right').style.gridRowStart).toBe(
            screen.getByTestId('dashboard-viewer-item-widget-lower-right').style.gridRowStart,
        );
        expect(builderFrame.style.width).toBe('1200px');
        expect(builderFrame.style.height).toBe('675px');
        expect(viewerFrame.style.width).toBe('1200px');
        expect(viewerFrame.style.height).toBe('675px');

        useUIStore.setState({ ...useUIStore.getState(), isGridVisible: false });

        await waitFor(() => {
            expect(screen.getByTestId('builder-canvas-grid-overlay').style.opacity).toBe('0');
        });
    });

    it('keeps canvas focus behavior while explicitly suppressing the focus outline and rendering dashed major grid lines without a solid major-line base', async () => {
        useUIStore.setState({ ...useUIStore.getInitialState(), isGridVisible: true });

        const { builderRoot } = await renderInteractiveCanvas();
        const overlay = screen.getByTestId('builder-canvas-grid-overlay');
        const majorOverlay = screen.getByTestId('builder-canvas-grid-major-overlay');
        const majorEraserOverlay = screen.getByTestId('builder-canvas-grid-major-eraser-overlay');
        const majorEraserVerticalOverlay = screen.getByTestId('builder-canvas-grid-major-eraser-vertical-overlay');
        const majorEraserHorizontalOverlay = screen.getByTestId('builder-canvas-grid-major-eraser-horizontal-overlay');
        const majorVerticalOverlay = screen.getByTestId('builder-canvas-grid-major-vertical-overlay');
        const majorHorizontalOverlay = screen.getByTestId('builder-canvas-grid-major-horizontal-overlay');
        const minorOverlay = screen.getByTestId('builder-canvas-grid-minor-overlay');

        expect(builderRoot).toHaveAttribute('tabindex', '0');
        expect(builderRoot.style.outline).toBe('none');

        fireEvent.pointerDown(builderRoot, { button: 0, clientX: 10, clientY: 10 });

        expect(document.activeElement).toBe(builderRoot);
        expect(overlay.style.backgroundImage).toBe('');
        expect(majorOverlay.style.backgroundImage).toBe('');
        expect(majorEraserOverlay.style.backgroundImage).toBe('');
        expect(majorOverlay.style.backgroundImage).not.toContain('radial-gradient');
        expect(majorEraserVerticalOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(majorEraserVerticalOverlay.style.backgroundImage).toContain('var(--color-canvas-bg)');
        expect(majorEraserVerticalOverlay.style.webkitMaskImage).toBe('');
        expect(majorEraserHorizontalOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(majorEraserHorizontalOverlay.style.backgroundImage).toContain('var(--color-canvas-bg)');
        expect(majorEraserHorizontalOverlay.style.webkitMaskImage).toBe('');
        expect(majorVerticalOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(majorVerticalOverlay.style.backgroundImage).toContain('var(--color-canvas-grid-major)');
        expect(majorVerticalOverlay.style.webkitMaskImage).toContain('repeating-linear-gradient');
        expect(majorHorizontalOverlay.style.backgroundImage).toContain('repeating-linear-gradient');
        expect(majorHorizontalOverlay.style.backgroundImage).toContain('var(--color-canvas-grid-major)');
        expect(majorHorizontalOverlay.style.webkitMaskImage).toContain('repeating-linear-gradient');
        expect(minorOverlay.style.backgroundImage).toContain('var(--color-canvas-grid-minor)');
        expect(minorOverlay.style.backgroundImage).not.toContain('var(--color-canvas-grid-major)');
    });

    it('hides the composed major and minor grid overlays when the grid toggle is off', async () => {
        useUIStore.setState({ ...useUIStore.getInitialState(), isGridVisible: false });

        await renderInteractiveCanvas();

        const overlay = screen.getByTestId('builder-canvas-grid-overlay');
        const majorOverlay = screen.getByTestId('builder-canvas-grid-major-overlay');
        const minorOverlay = screen.getByTestId('builder-canvas-grid-minor-overlay');

        await waitFor(() => {
            expect(overlay.style.opacity).toBe('0');
            expect(majorOverlay.style.opacity).toBe('0');
            expect(minorOverlay.style.opacity).toBe('0');
        });
    });

    it('keeps selected widget affordances visible above the canvas edge', async () => {
        await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
        });

        const builderRoot = screen.getByTestId('builder-canvas-root');
        const duplicateButton = screen.getByRole('button', { name: 'Duplicar widget' });
        const deleteButton = screen.getByRole('button', { name: 'Eliminar widget' });

        expect(builderRoot.className).toContain('overflow-visible');
        expect(builderRoot.className).not.toContain('overflow-hidden');
        expect(builderRoot.className).not.toContain('overflow-clip');
        expect(duplicateButton).toBeInTheDocument();
        expect(deleteButton).toBeInTheDocument();
        expect(duplicateButton).not.toHaveAttribute('title');
        expect(deleteButton).not.toHaveAttribute('title');

        fireEvent.mouseEnter(duplicateButton);
        fireEvent.mouseEnter(deleteButton);
        expect(duplicateButton).toBeVisible();
        expect(deleteButton).toBeVisible();
    });

    it('adds token-based internal spacing to each widget surface without changing grid placement', async () => {
        const dashboard = makeDashboard({
            cols: 20,
            rows: 12,
            widgets: [
                makeWidget({ id: 'widget-left', title: 'Left' }),
                makeWidget({ id: 'widget-right', title: 'Right' }),
            ],
            layout: [
                makeLayout({ widgetId: 'widget-left', x: 0, y: 0, w: 2, h: 2 }),
                makeLayout({ widgetId: 'widget-right', x: 2, y: 0, w: 2, h: 2 }),
            ],
        });

        const { container } = render(
            <div style={{ width: '1200px', height: '675px' }}>
                <BuilderCanvas
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        const builderRoot = container.querySelector('[data-testid="builder-canvas-root"]');

        if (!builderRoot) {
            throw new Error('Builder root was not rendered.');
        }

        await syncCanvasMetrics(builderRoot, 1200, 675);

        await waitFor(() => {
            expect(screen.getByTestId('builder-canvas-item-widget-left').style.gridColumnStart).toBe('1');
            expect(screen.getByTestId('builder-canvas-item-widget-right').style.gridColumnStart).toBe('3');
        });

        const leftSurface = screen.getByTestId('builder-canvas-item-surface-widget-left');
        const rightSurface = screen.getByTestId('builder-canvas-item-surface-widget-right');

        expect(leftSurface.getAttribute('style')).toContain('padding: var(--widget-spacing);');
        expect(rightSurface.getAttribute('style')).toContain('padding: var(--widget-spacing);');

        const indexCss = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf-8');
        expect(indexCss).toContain('--widget-spacing: 0.5rem;');
    });

    it('fills the measured builder pane even when the local builder pane is narrower', async () => {
        const dashboard = makeDashboard({
            cols: 20,
            rows: 12,
            widgets: [makeWidget({ id: 'widget-1', title: 'Widget 1' })],
            layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
        });

        const { container } = render(
            <div style={{ width: '900px', height: '620px', overflow: 'auto' }}>
                <BuilderCanvas
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        const builderRoot = container.querySelector('[data-testid="builder-canvas-root"]');

        if (!builderRoot) {
            throw new Error('Builder root was not rendered.');
        }

        await syncCanvasMetrics(builderRoot, 900, 620);

        await waitFor(() => {
            const canvasFrame = builderRoot.firstElementChild as HTMLElement | null;
            const gridOverlay = screen.getByTestId('builder-canvas-grid-overlay');

            expect(builderRoot.className).toContain('w-full');
            expect(builderRoot.style.minWidth).toBe('');
            expect(canvasFrame).not.toBeNull();
            expect(Number.parseFloat(canvasFrame?.style.width ?? '0')).toBeCloseTo(900, 4);
            expect(Number.parseFloat(canvasFrame?.style.height ?? '0')).toBeCloseTo(620, 4);
            expect(gridOverlay.style.width).toBe('');
            expect(gridOverlay.style.height).toBe('');
        });
    });

    it('clamps resize commits on release after visual overflow', async () => {
        const user = userEvent.setup();
        const onLayoutCommit = vi.fn();

        await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            onLayoutCommit,
            layout: [makeLayout({ widgetId: 'widget-1', x: 5, y: 2, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        await waitFor(() => {
            expect(screen.getByTestId('builder-canvas-item-widget-1').style.gridColumnStart).toBe('6');
        });

        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 0, clientY: 0 });
        await movePointer(user, document.body, { clientX: 1320, clientY: 0 });

        expect(Number.parseFloat(screen.getByTestId('builder-canvas-item-widget-1').style.width)).toBeCloseTo(1545, 4);

        await releasePointer(user, document.body, { clientX: 1320, clientY: 0 });

        expect(onLayoutCommit).toHaveBeenCalledWith({ widgetId: 'widget-1', x: 5, y: 2, w: 11, h: 2 });
    });

    it('applies the resize cursor to the document body during resize interactions and clears it on release', async () => {
        const user = userEvent.setup();

        await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });

        expect(document.body.style.cursor).toBe('se-resize');

        await releasePointer(user, document.body, { clientX: 300, clientY: 150 });

        expect(document.body.style.cursor).toBe('');
    });

    it('clears the document body resize cursor when the canvas unmounts mid-interaction', async () => {
        const user = userEvent.setup();

        const { unmount } = await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });

        expect(document.body.style.cursor).toBe('se-resize');

        unmount();

        expect(document.body.style.cursor).toBe('');
    });

    it('clamps drag-to-move commits on release and allows visual overflow while dragging', async () => {
        const user = userEvent.setup();
        const onLayoutCommit = vi.fn();

        const { item } = await renderInteractiveCanvas({
            onLayoutCommit,
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 4, h: 3 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        await waitFor(() => {
            expect(item.style.gridColumnStart).toBe('3');
        });

        await pressPointer(user, item, { clientX: 120, clientY: 75 });
        await movePointer(user, document.body, { clientX: -300, clientY: 75 });

        expect(Number.parseFloat(screen.getByTestId('builder-canvas-item-widget-1').style.left)).toBeCloseTo(-270, 4);

        await releasePointer(user, document.body, { clientX: -300, clientY: 75 });

        expect(onLayoutCommit).toHaveBeenCalledWith({ widgetId: 'widget-1', x: 0, y: 1, w: 4, h: 3 });
    });

    it('treats sub-threshold movement as click selection instead of drag', async () => {
        const user = userEvent.setup();
        const onWidgetSelect = vi.fn();
        const onLayoutCommit = vi.fn();

        const { item } = await renderInteractiveCanvas({ onWidgetSelect, onLayoutCommit });

        await pressPointer(user, item, { clientX: 120, clientY: 75 });
        await movePointer(user, document.body, { clientX: 122, clientY: 76 });
        await releasePointer(user, document.body, { clientX: 122, clientY: 76 });

        expect(onWidgetSelect).toHaveBeenCalledWith('widget-1');
        expect(onLayoutCommit).not.toHaveBeenCalled();
    });

    it('uses the resize handle exclusively without triggering move selection', async () => {
        const user = userEvent.setup();
        const onWidgetSelect = vi.fn();
        const onLayoutCommit = vi.fn();

        await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            onWidgetSelect,
            onLayoutCommit,
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 0, clientY: 0 });
        await movePointer(user, document.body, { clientX: 120, clientY: 75 });
        await releasePointer(user, document.body, { clientX: 120, clientY: 75 });

        expect(onWidgetSelect).not.toHaveBeenCalled();
        expect(onLayoutCommit).toHaveBeenCalledWith({ widgetId: 'widget-1', x: 2, y: 1, w: 5, h: 3 });
    });

    it('shows a floating resize tooltip with tentative grid dimensions and hides it on release', async () => {
        const user = userEvent.setup();

        await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        expect(screen.queryByTestId('builder-canvas-resize-tooltip')).not.toBeInTheDocument();

        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });
        await movePointer(user, document.body, { clientX: 420, clientY: 225 });

        const tooltip = screen.getByTestId('builder-canvas-resize-tooltip');
        expect(tooltip).toHaveTextContent('5 × 3');
        expect(tooltip).toHaveClass('fixed');
        expect(tooltip.style.left).toBe('420px');
        expect(tooltip.style.top).toBe('225px');
        expect(tooltip.style.transform).toBe('translate(12px, 12px)');

        await releasePointer(user, document.body, { clientX: 420, clientY: 225 });

        expect(screen.queryByTestId('builder-canvas-resize-tooltip')).not.toBeInTheDocument();
    });

    it('shows the resize tooltip only for resize interactions, not during widget move drags', async () => {
        const user = userEvent.setup();

        const { item } = await renderInteractiveCanvas({
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        await pressPointer(user, item, { clientX: 120, clientY: 75 });
        await movePointer(user, document.body, { clientX: 240, clientY: 150 });

        expect(screen.queryByTestId('builder-canvas-resize-tooltip')).not.toBeInTheDocument();

        await releasePointer(user, document.body, { clientX: 240, clientY: 150 });

        const handle = screen.getByTestId('builder-canvas-resize-handle-ne-widget-1');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });
        await movePointer(user, document.body, { clientX: 375, clientY: 75 });

        expect(screen.getByTestId('builder-canvas-resize-tooltip')).toHaveTextContent('4 × 3');
    });

    it('converts pointer deltas with useCanvasReference cell metrics', async () => {
        const user = userEvent.setup();
        const onLayoutCommit = vi.fn();

        const { item } = await renderInteractiveCanvas({
            onLayoutCommit,
            layout: [makeLayout({ widgetId: 'widget-1', x: 1, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        await pressPointer(user, item, { clientX: 60, clientY: 75 });
        await movePointer(user, document.body, { clientX: 180, clientY: 225 });
        await releasePointer(user, document.body, { clientX: 180, clientY: 225 });

        expect(onLayoutCommit).toHaveBeenCalledWith({ widgetId: 'widget-1', x: 3, y: 3, w: 3, h: 2 });
    });

    it('uses a square selection frame for text-title while keeping rounded widgets unchanged', async () => {
        const widgets: WidgetConfig[] = [
            {
                id: 'text-title-1',
                type: 'text-title',
                title: 'Sector A',
                position: { x: 0, y: 0 },
                size: { w: 4, h: 2 },
                displayOptions: { fontSize: 48 },
            },
            {
                id: 'metric-card-1',
                type: 'metric-card',
                title: 'Métrica',
                position: { x: 0, y: 0 },
                size: { w: 4, h: 2 },
                displayOptions: {},
            },
        ];

        const dashboard = makeDashboard({
            widgets,
            layout: [
                makeLayout({ widgetId: 'text-title-1', x: 0, y: 0, w: 4, h: 2 }),
                makeLayout({ widgetId: 'metric-card-1', x: 4, y: 0, w: 4, h: 2 }),
            ],
        });

        const { container } = render(
            <div style={{ width: '1200px', height: '675px' }}>
                <BuilderCanvas
                    widgets={dashboard.widgets}
                    layout={dashboard.layout}
                    equipmentMap={new Map()}
                    cols={dashboard.cols}
                    rows={dashboard.rows}
                />
            </div>,
        );

        const builderRoot = container.querySelector('[data-testid="builder-canvas-root"]');

        if (!builderRoot) {
            throw new Error('Builder root was not rendered.');
        }

        await syncCanvasMetrics(builderRoot, 1200, 675);

        const dashboardTitleItem = screen.getByTestId('builder-canvas-item-text-title-1');
        const metricCardItem = screen.getByTestId('builder-canvas-item-metric-card-1');
        const dashboardTitleFrame = dashboardTitleItem.firstElementChild as HTMLElement | null;
        const metricCardFrame = metricCardItem.firstElementChild as HTMLElement | null;

        expect(dashboardTitleItem).toHaveClass('rounded-none');
        expect(metricCardItem).toHaveClass('rounded-xl');
        expect(dashboardTitleFrame?.style.borderRadius).toBe('0px');
        expect(metricCardFrame?.style.borderRadius).toBe('24px');
    });
});
