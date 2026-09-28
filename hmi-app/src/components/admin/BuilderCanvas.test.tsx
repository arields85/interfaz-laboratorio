import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import BuilderCanvas from './BuilderCanvas';
import DashboardViewer from '../viewer/DashboardViewer';
import { makeDashboard, makeGroupWidget, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import { useUIStore } from '../../store/ui.store';
import { isGroupWidget, type WidgetConfig, type WidgetLayout } from '../../domain/admin.types';
import { collectWidgetIdsInOtherLockedGroups, computeGroupMembers, duplicateLockedGroup } from '../../utils/groupWidget';
import { useHistoryState } from '../../hooks/useHistoryState';
import { generateWidgetId } from '../../utils/idGenerator';

type ResizeObserverCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const resizeCallbacks = new Map<Element, Set<ResizeObserverCallback>>();
const currentDir = path.dirname(fileURLToPath(import.meta.url));

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
    widgets?: WidgetConfig[];
    selectedWidgetId?: string;
    onWidgetSelect?: (widgetId: string) => void;
    onLayoutCommit?: (layout: { widgetId: string; x: number; y: number; w: number; h: number }) => void;
    onToggleGroupLock?: (widgetId: string) => void;
    onGroupLayoutCommit?: (layouts: WidgetLayout[]) => void;
    headerWidgetIds?: Set<string>;
    resizeWidth?: number;
    resizeHeight?: number;
    editingGroupId?: string;
    onToggleGroupEditMode?: (widgetId: string) => void;
    onExitGroupEditMode?: () => void;
}) {
    const widgets = overrides?.widgets ?? [makeWidget({ id: 'widget-1', title: 'Widget 1' })];
    const dashboard = makeDashboard({
        cols: overrides?.cols ?? 20,
        rows: overrides?.rows ?? 12,
        widgets,
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
                onToggleGroupLock={overrides?.onToggleGroupLock}
                onGroupLayoutCommit={overrides?.onGroupLayoutCommit}
                headerWidgetIds={overrides?.headerWidgetIds}
                editingGroupId={overrides?.editingGroupId}
                onToggleGroupEditMode={overrides?.onToggleGroupEditMode}
                onExitGroupEditMode={overrides?.onExitGroupEditMode}
            />
        </div>,
    );

    const builderRoot = view.container.querySelector('[data-testid="builder-canvas-root"]');

    if (!builderRoot) {
        throw new Error('Builder root was not rendered.');
    }

    await syncCanvasMetrics(builderRoot, overrides?.resizeWidth ?? 1200, overrides?.resizeHeight ?? 675);

    // Only assert the item exists (fail fast with a clear error) when the rendered widgets
    // actually include 'widget-1' — the default and most callers' case. A caller that overrides
    // `widgets` without 'widget-1' (e.g. the group-widget suites) still gets `null` instead of a
    // thrown error, since it never reads `item`.
    const hasWidgetOne = widgets.some((widget) => widget.id === 'widget-1');

    return {
        ...view,
        builderRoot,
        item: (hasWidgetOne
            ? screen.getByTestId('builder-canvas-item-widget-1')
            : screen.queryByTestId('builder-canvas-item-widget-1')) as HTMLElement,
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

vi.mock('../viewer/WidgetPresentationBoundary', () => ({
    default: ({
        widget,
        renderContext,
    }: {
        widget: { id: string; title?: string };
        renderContext?: { surface?: string; isTransientResizeActive?: boolean };
    }) => (
        widget.title === 'Editable Input'
            ? <input data-testid={`widget-renderer-input-${widget.id}`} defaultValue="editable" />
            : (
                <div
                    data-testid={`widget-renderer-${widget.id}`}
                    data-render-surface={renderContext?.surface ?? 'none'}
                    data-resize-active={renderContext?.isTransientResizeActive === true ? 'true' : 'false'}
                >
                    {widget.title ?? widget.id}
                </div>
            )
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

    function makeTrendChartV2BuilderWidget(): WidgetConfig {
        return {
            id: 'widget-1',
            type: 'trend-chart-v2',
            title: 'Trend Chart V2',
            position: { x: 0, y: 0 },
            size: { w: 3, h: 2 },
            binding: {
                mode: 'real_variable',
                bindingVersion: 'node-red-v1',
                machineId: 101,
                variableKey: 'temperature',
            },
            displayOptions: { historicalDensity: 'normal' },
        };
    }

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

        const indexCss = fs.readFileSync(path.resolve(currentDir, '../../index.css'), 'utf-8');
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
            widgets: [makeTrendChartV2BuilderWidget()],
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

    it('forwards active builder resize context only while the selected widget is being resized', async () => {
        const user = userEvent.setup();

        await renderInteractiveCanvas({
            widgets: [makeTrendChartV2BuilderWidget()],
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        const renderer = screen.getByTestId('widget-renderer-widget-1');
        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        expect(renderer).toHaveAttribute('data-render-surface', 'none');
        expect(renderer).toHaveAttribute('data-resize-active', 'false');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });

        expect(renderer).toHaveAttribute('data-render-surface', 'builder');
        expect(renderer).toHaveAttribute('data-resize-active', 'true');

        await releasePointer(user, document.body, { clientX: 300, clientY: 150 });

        expect(renderer).toHaveAttribute('data-render-surface', 'none');
        expect(renderer).toHaveAttribute('data-resize-active', 'false');
    });

    it('clears builder resize context when the resize interaction is cancelled', async () => {
        const user = userEvent.setup();

        await renderInteractiveCanvas({
            widgets: [makeTrendChartV2BuilderWidget()],
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        const renderer = screen.getByTestId('widget-renderer-widget-1');
        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });

        expect(renderer).toHaveAttribute('data-render-surface', 'builder');
        expect(renderer).toHaveAttribute('data-resize-active', 'true');

        fireEvent.pointerCancel(window, { pointerId: 1 });

        expect(renderer).toHaveAttribute('data-render-surface', 'none');
        expect(renderer).toHaveAttribute('data-resize-active', 'false');
    });

    it('clears builder resize context when the canvas unmounts mid-resize', async () => {
        const user = userEvent.setup();

        const { unmount } = await renderInteractiveCanvas({
            widgets: [makeTrendChartV2BuilderWidget()],
            selectedWidgetId: 'widget-1',
            layout: [makeLayout({ widgetId: 'widget-1', x: 2, y: 1, w: 3, h: 2 })],
            cols: 16,
            resizeWidth: 1200,
            resizeHeight: 900,
        });

        const renderer = screen.getByTestId('widget-renderer-widget-1');
        const handle = screen.getByTestId('builder-canvas-resize-handle-se-widget-1');

        await pressPointer(user, handle, { clientX: 300, clientY: 150 });

        expect(renderer).toHaveAttribute('data-render-surface', 'builder');
        expect(renderer).toHaveAttribute('data-resize-active', 'true');

        unmount();

        expect(screen.queryByTestId('widget-renderer-widget-1')).not.toBeInTheDocument();
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

    it('converts pointer coordinates to layout px under CSS zoom so drag/resize tracks the pointer (PW-007 T3b)', async () => {
        document.documentElement.style.setProperty('--viewport-zoom', '2');

        try {
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

            // Same real-space pointer delta as the zoom-1 move test above
            // (clientX 120 -> -300, delta -420), but at zoom 2 the tentative
            // pixel bounds (layout space, matching cellWidth from
            // ResizeObserver) must move by -420/2 = -210 from the
            // startBounds.left of 150 (x=2 * cellWidth=75) — not the full
            // -420, which would overshoot the actual pointer movement.
            await pressPointer(user, item, { clientX: 120, clientY: 75 });
            await movePointer(user, document.body, { clientX: -300, clientY: 75 });

            expect(Number.parseFloat(screen.getByTestId('builder-canvas-item-widget-1').style.left)).toBeCloseTo(-60, 4);

            await releasePointer(user, document.body, { clientX: -300, clientY: 75 });
        } finally {
            document.documentElement.style.removeProperty('--viewport-zoom');
        }
    });

    it('divides the resize tooltip cursor position by the effective zoom (PW-007 T3b)', async () => {
        document.documentElement.style.setProperty('--viewport-zoom', '2');

        try {
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
            await movePointer(user, document.body, { clientX: 420, clientY: 225 });

            const tooltip = screen.getByTestId('builder-canvas-resize-tooltip');
            expect(tooltip.style.left).toBe(`${420 / 2}px`);
            expect(tooltip.style.top).toBe(`${225 / 2}px`);

            await releasePointer(user, document.body, { clientX: 420, clientY: 225 });
        } finally {
            document.documentElement.style.removeProperty('--viewport-zoom');
        }
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

    describe('group widget lock', () => {
        it('shows a lock action for an unlocked group widget and calls onToggleGroupLock on click', async () => {
            const onToggleGroupLock = vi.fn();

            await renderInteractiveCanvas({
                widgets: [makeGroupWidget({ id: 'group-1', locked: false })],
                layout: [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })],
                cols: 16,
                onToggleGroupLock,
            });

            const lockButton = screen.getByRole('button', { name: 'Agrupar widgets' });
            await userEvent.setup().click(lockButton);

            expect(onToggleGroupLock).toHaveBeenCalledWith('group-1');
        });

        it('shows an unlock action for a locked group widget', async () => {
            await renderInteractiveCanvas({
                widgets: [makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: [] })],
                layout: [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })],
                cols: 16,
            });

            expect(screen.getByRole('button', { name: 'Desagrupar widgets' })).toBeInTheDocument();
        });

        it('does not show a lock action for a non-group widget', async () => {
            await renderInteractiveCanvas({
                layout: [makeLayout({ widgetId: 'widget-1', x: 0, y: 0, w: 4, h: 3 })],
            });

            expect(screen.queryByRole('button', { name: 'Agrupar widgets' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Desagrupar widgets' })).not.toBeInTheDocument();
        });

        // G7(a): the icon must show the STATE, not the action to perform — an unlocked
        // container (click = lock it) shows the OPEN lock; a locked one (click = unlock it)
        // shows the CLOSED lock. The previous code had these two icons swapped.
        it('shows the OPEN lock icon (LockOpen) for an unlocked group container', async () => {
            await renderInteractiveCanvas({
                widgets: [makeGroupWidget({ id: 'group-1', locked: false })],
                layout: [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })],
                cols: 16,
            });

            const lockButton = screen.getByRole('button', { name: 'Agrupar widgets' });
            expect(lockButton.querySelector('.lucide-lock-open')).toBeInTheDocument();
            expect(lockButton.querySelector('.lucide-lock')).not.toBeInTheDocument();
        });

        it('shows the CLOSED lock icon (Lock) for a locked group container', async () => {
            await renderInteractiveCanvas({
                widgets: [makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: [] })],
                layout: [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })],
                cols: 16,
            });

            const lockButton = screen.getByRole('button', { name: 'Desagrupar widgets' });
            expect(lockButton.querySelector('.lucide-lock')).toBeInTheDocument();
            expect(lockButton.querySelector('.lucide-lock-open')).not.toBeInTheDocument();
        });
    });

    describe('group container render order (G7b)', () => {
        it('always renders the group container before every other widget, regardless of layout array order', async () => {
            // The container's layout entry is authored LAST — reproduces the exact shape that
            // hid the "container always on top" bug (stacking used to follow `layout` order
            // untouched, with no group-first rule at all).
            await renderInteractiveCanvas({
                widgets: [
                    makeWidget({ id: 'widget-1', title: 'Widget 1' }),
                    makeWidget({ id: 'widget-2', title: 'Widget 2' }),
                    makeGroupWidget({ id: 'group-1', locked: false }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-1', x: 1, y: 1, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'widget-2', x: 4, y: 1, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                ],
                cols: 16,
            });

            const itemIds = screen.getAllByTestId(/^builder-canvas-item-(?!surface-)/).map((el) => el.getAttribute('data-testid'));
            expect(itemIds).toEqual([
                'builder-canvas-item-group-1',
                'builder-canvas-item-widget-1',
                'builder-canvas-item-widget-2',
            ]);
        });

        it('keeps the container beneath every widget even while LOCKED', async () => {
            await renderInteractiveCanvas({
                widgets: [
                    makeWidget({ id: 'widget-1', title: 'Widget 1' }),
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['widget-1'] }),
                ],
                layout: [
                    makeLayout({ widgetId: 'widget-1', x: 1, y: 1, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                ],
                cols: 16,
            });

            const itemIds = screen.getAllByTestId(/^builder-canvas-item-(?!surface-)/).map((el) => el.getAttribute('data-testid'));
            expect(itemIds).toEqual(['builder-canvas-item-group-1', 'builder-canvas-item-widget-1']);
        });
    });

    describe('locked group members', () => {
        function renderLockedGroupCanvas(overrides?: { onLayoutCommit?: (layout: WidgetLayout) => void; onWidgetSelect?: (id: string) => void }) {
            return renderInteractiveCanvas({
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
                ],
                selectedWidgetId: 'member-1',
                cols: 16,
                resizeWidth: 1200,
                resizeHeight: 900,
                ...overrides,
            });
        }

        it('does not render resize handles for a locked member even while selected', async () => {
            await renderLockedGroupCanvas();

            expect(screen.queryByTestId('builder-canvas-resize-handle-se-member-1')).not.toBeInTheDocument();
        });

        // D6 (supersedes the D4 "select-only" behavior): outside edit mode, a locked group acts
        // as ONE widget — a plain click on a member selects the CONTAINER, not the member.
        it('selects the CONTAINER, not the member, on a plain click on a locked member', async () => {
            const user = userEvent.setup();
            const onLayoutCommit = vi.fn();
            const onWidgetSelect = vi.fn();

            await renderLockedGroupCanvas({ onLayoutCommit, onWidgetSelect });

            const memberItem = screen.getByTestId('builder-canvas-item-member-1');

            await pressPointer(user, memberItem, { clientX: 100, clientY: 100 });
            await releasePointer(user, memberItem, { clientX: 100, clientY: 100 });

            expect(onLayoutCommit).not.toHaveBeenCalled();
            expect(onWidgetSelect).toHaveBeenCalledWith('group-1');
        });

        // D6: a drag started on a member moves the WHOLE group, exactly like dragging the
        // container (the member's own layout never moves independently).
        it('moves the whole group when a drag starts on a locked member', async () => {
            const user = userEvent.setup();
            const onGroupLayoutCommit = vi.fn();

            await renderLockedGroupCanvas({ onGroupLayoutCommit });

            const memberItem = screen.getByTestId('builder-canvas-item-member-1');
            const containerItem = screen.getByTestId('builder-canvas-item-group-1');

            // cellWidth = 1200/16 = 75px; a 150px rightward drag is exactly 2 cells.
            await pressPointer(user, memberItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 250, clientY: 100 });

            // The CONTAINER previews the drag (its own tentative bounds go absolute)...
            expect(containerItem.style.position).toBe('absolute');
            // ...and the member follows live via the group-move preview.
            expect(memberItem.style.position).toBe('absolute');

            await releasePointer(user, document.body, { clientX: 250, clientY: 100 });

            expect(onGroupLayoutCommit).toHaveBeenCalledTimes(1);
            expect(onGroupLayoutCommit).toHaveBeenCalledWith([
                { widgetId: 'group-1', x: 2, y: 0, w: 10, h: 10 },
                { widgetId: 'member-1', x: 3, y: 1, w: 2, h: 2 },
            ]);
        });
    });

    describe('locked group container move (G3)', () => {
        function renderGroupMoveCanvas(overrides?: {
            onGroupLayoutCommit?: (layouts: WidgetLayout[]) => void;
            widgets?: WidgetConfig[];
            layout?: WidgetLayout[];
            headerWidgetIds?: Set<string>;
        }) {
            return renderInteractiveCanvas({
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 2, y: 2, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 3, y: 3, w: 2, h: 2 }),
                ],
                cols: 40,
                rows: 24,
                resizeWidth: 1200,
                resizeHeight: 900,
                ...overrides,
            });
        }

        it('moves the member with the container live during drag, and commits both in one array', async () => {
            const user = userEvent.setup();
            const onGroupLayoutCommit = vi.fn();

            await renderGroupMoveCanvas({ onGroupLayoutCommit });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');
            const memberItem = screen.getByTestId('builder-canvas-item-member-1');
            const memberLeftBefore = memberItem.style.left;

            // cellWidth = 1200/40 = 30px, rowHeight = 900/24 = 37.5px.
            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 160, clientY: 100 });

            expect(memberItem.style.position).toBe('absolute');
            expect(memberItem.style.left).not.toBe(memberLeftBefore);

            await releasePointer(user, document.body, { clientX: 160, clientY: 100 });

            expect(onGroupLayoutCommit).toHaveBeenCalledTimes(1);
            expect(onGroupLayoutCommit).toHaveBeenCalledWith([
                { widgetId: 'group-1', x: 4, y: 2, w: 10, h: 10 },
                { widgetId: 'member-1', x: 5, y: 3, w: 2, h: 2 },
            ]);
        });

        it('clamps the whole-group move delta so no member crosses the grid edge', async () => {
            const user = userEvent.setup();
            const onGroupLayoutCommit = vi.fn();

            await renderGroupMoveCanvas({ onGroupLayoutCommit });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');

            // A huge rightward drag: container right edge (x=2,w=10) would overshoot cols=40.
            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 3100, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 3100, clientY: 100 });

            expect(onGroupLayoutCommit).toHaveBeenCalledWith([
                { widgetId: 'group-1', x: 30, y: 2, w: 10, h: 10 },
                { widgetId: 'member-1', x: 31, y: 3, w: 2, h: 2 },
            ]);
        });

        it('excludes a header-promoted member from the group move (G4: it never lives on the canvas)', async () => {
            const user = userEvent.setup();
            const onGroupLayoutCommit = vi.fn();

            await renderGroupMoveCanvas({
                onGroupLayoutCommit,
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'header-widget'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                    makeWidget({ id: 'header-widget', title: 'Header widget' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 2, y: 2, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 3, y: 3, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'header-widget', x: 4, y: 4, w: 2, h: 2 }),
                ],
                headerWidgetIds: new Set(['header-widget']),
            });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');

            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 160, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 160, clientY: 100 });

            expect(onGroupLayoutCommit).toHaveBeenCalledWith([
                { widgetId: 'group-1', x: 4, y: 2, w: 10, h: 10 },
                { widgetId: 'member-1', x: 5, y: 3, w: 2, h: 2 },
            ]);
        });

        it('skips a member id without a resolvable layout entry instead of moving a {w:0,h:0} placeholder', async () => {
            const user = userEvent.setup();
            const onGroupLayoutCommit = vi.fn();

            await renderGroupMoveCanvas({
                onGroupLayoutCommit,
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'ghost-member'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 2, y: 2, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 3, y: 3, w: 2, h: 2 }),
                ],
            });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');

            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 160, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 160, clientY: 100 });

            expect(onGroupLayoutCommit).toHaveBeenCalledWith([
                { widgetId: 'group-1', x: 4, y: 2, w: 10, h: 10 },
                { widgetId: 'member-1', x: 5, y: 3, w: 2, h: 2 },
            ]);
        });
    });

    describe('locked group container resize (G3)', () => {
        it('clamps a shrink resize so the container stays a superset of its members bounding box', async () => {
            const user = userEvent.setup();
            const onLayoutCommit = vi.fn();

            await renderInteractiveCanvas({
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 6, y: 6, w: 3, h: 3 }),
                ],
                selectedWidgetId: 'group-1',
                onLayoutCommit,
                cols: 40,
                rows: 24,
                resizeWidth: 1200,
                resizeHeight: 900,
            });

            const handle = screen.getByTestId('builder-canvas-resize-handle-se-group-1');

            // Shrink drastically toward the origin; member-1's bounding box (x6..9, y6..9)
            // must still be fully contained in the committed container rect.
            await pressPointer(user, handle, { clientX: 300, clientY: 375 });
            await movePointer(user, document.body, { clientX: 0, clientY: 0 });
            await releasePointer(user, document.body, { clientX: 0, clientY: 0 });

            expect(onLayoutCommit).toHaveBeenCalledTimes(1);
            const [committed] = onLayoutCommit.mock.calls[0] as [WidgetLayout];
            expect(committed.widgetId).toBe('group-1');
            expect(committed.x).toBeLessThanOrEqual(6);
            expect(committed.y).toBeLessThanOrEqual(6);
            expect(committed.x + committed.w).toBeGreaterThanOrEqual(9);
            expect(committed.y + committed.h).toBeGreaterThanOrEqual(9);
        });

        it('previews a shrink resize with the same members-bounding-box clamp as the commit (R3-resize-preview-commit-mismatch)', async () => {
            const user = userEvent.setup();

            await renderInteractiveCanvas({
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 6, y: 6, w: 3, h: 3 }),
                ],
                selectedWidgetId: 'group-1',
                cols: 40,
                rows: 24,
                resizeWidth: 1200,
                resizeHeight: 900,
            });

            const handle = screen.getByTestId('builder-canvas-resize-handle-se-group-1');
            const containerItem = screen.getByTestId('builder-canvas-item-group-1');

            // cellWidth = 1200/40 = 30px, rowHeight = 900/24 = 37.5px. member-1's bounding box
            // (x6..9, y6..9) is left>=180px/top>=225px, right<=270px/bottom<=337.5px in grid px.
            await pressPointer(user, handle, { clientX: 300, clientY: 375 });
            await movePointer(user, document.body, { clientX: 0, clientY: 0 });

            const previewLeft = Number.parseFloat(containerItem.style.left);
            const previewTop = Number.parseFloat(containerItem.style.top);
            const previewRight = previewLeft + Number.parseFloat(containerItem.style.width);
            const previewBottom = previewTop + Number.parseFloat(containerItem.style.height);

            // The LIVE preview (before release) must already respect the members clamp, exactly
            // like the eventual commit — it must never render smaller than the members bounding
            // box and then snap back on release.
            expect(previewLeft).toBeLessThanOrEqual(180);
            expect(previewTop).toBeLessThanOrEqual(225);
            expect(previewRight).toBeGreaterThanOrEqual(270);
            expect(previewBottom).toBeGreaterThanOrEqual(337.5);

            await releasePointer(user, document.body, { clientX: 0, clientY: 0 });
        });

        it('resizes an unlocked group container like any normal widget, without a members clamp', async () => {
            const user = userEvent.setup();
            const onLayoutCommit = vi.fn();

            await renderInteractiveCanvas({
                widgets: [makeGroupWidget({ id: 'group-1', locked: false, memberWidgetIds: [] })],
                layout: [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })],
                selectedWidgetId: 'group-1',
                onLayoutCommit,
                cols: 40,
                rows: 24,
                resizeWidth: 1200,
                resizeHeight: 900,
            });

            const handle = screen.getByTestId('builder-canvas-resize-handle-se-group-1');

            await pressPointer(user, handle, { clientX: 300, clientY: 375 });
            await movePointer(user, document.body, { clientX: 0, clientY: 0 });
            await releasePointer(user, document.body, { clientX: 0, clientY: 0 });

            expect(onLayoutCommit).toHaveBeenCalledWith({ widgetId: 'group-1', x: 0, y: 0, w: 1, h: 1 });
        });
    });

    // G7(d): the page tests mock BuilderCanvas entirely, which hid the lock-icon inversion, the
    // stacking bug and the title fallback from the user's first live check. This harness renders
    // the REAL BuilderCanvas and wires its callbacks through the SAME pure lock/move logic
    // DashboardBuilderPage uses in production (`computeGroupMembers`,
    // `collectWidgetIdsInOtherLockedGroups`) instead of a mock, so membership, stacking and drag
    // behavior are all proven against real DOM output.
    function GroupWorkflowHarness({
        initialWidgets,
        initialLayout,
        cols,
        rows,
    }: {
        initialWidgets: WidgetConfig[];
        initialLayout: WidgetLayout[];
        cols: number;
        rows: number;
    }) {
        const [widgets, setWidgets] = useState<WidgetConfig[]>(initialWidgets);
        const [layout, setLayout] = useState<WidgetLayout[]>(initialLayout);

        const handleToggleGroupLock = (widgetId: string) => {
            setWidgets((prevWidgets) => {
                const widget = prevWidgets.find((item) => item.id === widgetId);
                if (!widget || !isGroupWidget(widget)) {
                    return prevWidgets;
                }

                if (widget.locked) {
                    return prevWidgets.map((item) => (
                        item.id === widgetId ? { ...item, locked: false, memberWidgetIds: [] } : item
                    ));
                }

                const containerLayout = layout.find((item) => item.widgetId === widgetId);
                if (!containerLayout) {
                    return prevWidgets;
                }

                const otherLockedGroupMemberIds = collectWidgetIdsInOtherLockedGroups(prevWidgets, widgetId);
                const memberWidgetIds = computeGroupMembers(widgetId, containerLayout, prevWidgets, layout, otherLockedGroupMemberIds);

                return prevWidgets.map((item) => (
                    item.id === widgetId ? { ...item, locked: true, memberWidgetIds } : item
                ));
            });
        };

        const handleLayoutCommit = (updated: WidgetLayout) => {
            setLayout((prev) => prev.map((item) => (item.widgetId === updated.widgetId ? updated : item)));
        };

        const handleGroupLayoutCommit = (updates: WidgetLayout[]) => {
            setLayout((prev) => prev.map((item) => updates.find((update) => update.widgetId === item.widgetId) ?? item));
        };

        return (
            <div style={{ width: '1200px', height: '900px' }}>
                <BuilderCanvas
                    widgets={widgets}
                    layout={layout}
                    equipmentMap={new Map()}
                    cols={cols}
                    rows={rows}
                    onLayoutCommit={handleLayoutCommit}
                    onToggleGroupLock={handleToggleGroupLock}
                    onGroupLayoutCommit={handleGroupLayoutCommit}
                />
            </div>
        );
    }

    describe('real group workflow: lock, drag, stacking, unlock (G7d)', () => {
        async function renderGroupWorkflowHarness() {
            const widgets: WidgetConfig[] = [
                makeGroupWidget({ id: 'group-1', locked: false, memberWidgetIds: [] }),
                makeWidget({ id: 'member-1', title: 'Member 1' }),
                makeWidget({ id: 'member-2', title: 'Member 2' }),
                makeWidget({ id: 'partial-1', title: 'Partial' }),
            ];
            const layout: WidgetLayout[] = [
                makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
                makeLayout({ widgetId: 'member-2', x: 5, y: 5, w: 2, h: 2 }),
                // Right edge (8+5=13) overshoots the container (10): partially inside, not a
                // membership candidate (D1).
                makeLayout({ widgetId: 'partial-1', x: 8, y: 8, w: 5, h: 5 }),
            ];

            const view = render(
                <GroupWorkflowHarness initialWidgets={widgets} initialLayout={layout} cols={40} rows={24} />,
            );

            const builderRoot = view.container.querySelector('[data-testid="builder-canvas-root"]');
            if (!builderRoot) {
                throw new Error('Builder root was not rendered.');
            }

            await syncCanvasMetrics(builderRoot, 1200, 900);

            return view;
        }

        it('locks only the fully-inside widgets, keeps stacking, moves members with the container, then releases them on unlock', async () => {
            const user = userEvent.setup();
            await renderGroupWorkflowHarness();

            // Stacking (G7b) already holds before lock: the container never paints on top.
            expect(screen.getAllByTestId(/^builder-canvas-item-(?!surface-)/).map((el) => el.getAttribute('data-testid'))).toEqual([
                'builder-canvas-item-group-1',
                'builder-canvas-item-member-1',
                'builder-canvas-item-member-2',
                'builder-canvas-item-partial-1',
            ]);

            // Lock via the hover action, by its accessible name (G7a).
            const lockButton = screen.getByRole('button', { name: 'Agrupar widgets' });
            expect(lockButton.querySelector('.lucide-lock-open')).toBeInTheDocument();
            await user.click(lockButton);

            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Desagrupar widgets' })).toBeInTheDocument();
            });
            expect(screen.getByRole('button', { name: 'Desagrupar widgets' }).querySelector('.lucide-lock')).toBeInTheDocument();

            // Drag the container. cellWidth = 1200/40 = 30px, rowHeight = 900/24 = 37.5px;
            // a 90px rightward drag is exactly 3 cells.
            const containerItem = screen.getByTestId('builder-canvas-item-group-1');
            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 190, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 190, clientY: 100 });

            await waitFor(() => {
                expect(screen.getByTestId('builder-canvas-item-group-1').style.gridColumnStart).toBe('4');
            });
            // The two fully-inside widgets moved by the same delta as the container...
            expect(screen.getByTestId('builder-canvas-item-member-1').style.gridColumnStart).toBe('5');
            expect(screen.getByTestId('builder-canvas-item-member-2').style.gridColumnStart).toBe('9');
            // ...but the partially-overlapping widget was never a member, so it never moved.
            expect(screen.getByTestId('builder-canvas-item-partial-1').style.gridColumnStart).toBe('9');

            // Stacking still holds after the move.
            expect(screen.getAllByTestId(/^builder-canvas-item-(?!surface-)/).map((el) => el.getAttribute('data-testid'))).toEqual([
                'builder-canvas-item-group-1',
                'builder-canvas-item-member-1',
                'builder-canvas-item-member-2',
                'builder-canvas-item-partial-1',
            ]);

            // Unlock: members move independently again.
            await user.click(screen.getByRole('button', { name: 'Desagrupar widgets' }));
            await waitFor(() => {
                expect(screen.getByRole('button', { name: 'Agrupar widgets' })).toBeInTheDocument();
            });

            const memberItem = screen.getByTestId('builder-canvas-item-member-1');
            await pressPointer(user, memberItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 190, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 190, clientY: 100 });

            await waitFor(() => {
                expect(screen.getByTestId('builder-canvas-item-member-1').style.gridColumnStart).toBe('8');
            });
            // The container and the other member did NOT ride along this time.
            expect(screen.getByTestId('builder-canvas-item-group-1').style.gridColumnStart).toBe('4');
            expect(screen.getByTestId('builder-canvas-item-member-2').style.gridColumnStart).toBe('9');
        });
    });

    // G8: DashboardBuilderPage wires the canvas's "Duplicar widget" action through
    // `useHistoryState` + `duplicateLockedGroup` (the SAME production helpers, not a bare
    // `useState`), and the dev server the user tests against runs `StrictMode`. This harness
    // reproduces that exact wiring under `StrictMode` to prove/fix the live-check-2 bug:
    // copying a locked group duplicated its inner widgets several times.
    describe('real group workflow: duplicate a locked group under StrictMode (G8)', () => {
        interface DuplicateWorkflowDraft {
            widgets: WidgetConfig[];
            layout: WidgetLayout[];
        }

        function DuplicateWorkflowHarness({
            initialWidgets,
            initialLayout,
            cols,
            rows,
        }: {
            initialWidgets: WidgetConfig[];
            initialLayout: WidgetLayout[];
            cols: number;
            rows: number;
        }) {
            const draftHistory = useHistoryState<DuplicateWorkflowDraft>({
                widgets: initialWidgets,
                layout: initialLayout,
            });
            const draft = draftHistory.value;
            const setDraft = draftHistory.set;

            // Mirrors `DashboardBuilderPage.handleDuplicateWidget`'s locked-group branch exactly:
            // `duplicateLockedGroup` (id generation included) runs once, OUTSIDE the `setDraft`
            // updater, and the updater only assigns the already-computed result.
            const handleDuplicateWidget = (widgetId: string) => {
                const selectedWidget = draft.widgets.find((widget) => widget.id === widgetId);
                if (!selectedWidget || !isGroupWidget(selectedWidget) || selectedWidget.locked !== true) {
                    return;
                }

                const groupDuplication = duplicateLockedGroup(
                    widgetId,
                    draft.widgets,
                    draft.layout,
                    cols,
                    rows,
                    generateWidgetId,
                );

                if (!groupDuplication) {
                    return;
                }

                setDraft((prev) => ({
                    ...prev,
                    widgets: groupDuplication.widgets,
                    layout: groupDuplication.layout,
                }), { coalesce: false });
            };

            const handleToggleGroupLock = (widgetId: string) => {
                setDraft((prev) => {
                    const widget = prev.widgets.find((item) => item.id === widgetId);
                    if (!widget || !isGroupWidget(widget)) {
                        return prev;
                    }

                    if (widget.locked) {
                        return {
                            ...prev,
                            widgets: prev.widgets.map((item) => (
                                item.id === widgetId ? { ...item, locked: false, memberWidgetIds: [] } : item
                            )),
                        };
                    }

                    const containerLayout = prev.layout.find((item) => item.widgetId === widgetId);
                    if (!containerLayout) {
                        return prev;
                    }

                    const otherLockedGroupMemberIds = collectWidgetIdsInOtherLockedGroups(prev.widgets, widgetId);
                    const memberWidgetIds = computeGroupMembers(widgetId, containerLayout, prev.widgets, prev.layout, otherLockedGroupMemberIds);

                    return {
                        ...prev,
                        widgets: prev.widgets.map((item) => (
                            item.id === widgetId ? { ...item, locked: true, memberWidgetIds } : item
                        )),
                    };
                }, { coalesce: false });
            };

            const handleLayoutCommit = (updated: WidgetLayout) => {
                setDraft((prev) => ({
                    ...prev,
                    layout: prev.layout.map((item) => (item.widgetId === updated.widgetId ? updated : item)),
                }));
            };

            return (
                <div style={{ width: '1200px', height: '900px' }}>
                    <BuilderCanvas
                        widgets={draft.widgets}
                        layout={draft.layout}
                        equipmentMap={new Map()}
                        cols={cols}
                        rows={rows}
                        onLayoutCommit={handleLayoutCommit}
                        onToggleGroupLock={handleToggleGroupLock}
                        onDuplicate={handleDuplicateWidget}
                    />
                </div>
            );
        }

        it('duplicates a locked group and each of its members exactly once from a single click', async () => {
            const user = userEvent.setup();
            const widgets: WidgetConfig[] = [
                makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'member-2'] }),
                makeWidget({ id: 'member-1', title: 'Member 1' }),
                makeWidget({ id: 'member-2', title: 'Member 2' }),
            ];
            const layout: WidgetLayout[] = [
                makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
                makeLayout({ widgetId: 'member-2', x: 5, y: 5, w: 2, h: 2 }),
            ];

            const view = render(
                <StrictMode>
                    <DuplicateWorkflowHarness initialWidgets={widgets} initialLayout={layout} cols={40} rows={24} />
                </StrictMode>,
            );

            const builderRoot = view.container.querySelector('[data-testid="builder-canvas-root"]');
            if (!builderRoot) {
                throw new Error('Builder root was not rendered.');
            }
            await syncCanvasMetrics(builderRoot, 1200, 900);

            const groupItem = screen.getByTestId('builder-canvas-item-group-1');
            const duplicateButton = within(groupItem).getByRole('button', { name: 'Duplicar widget' });
            await user.click(duplicateButton);

            await waitFor(() => {
                expect(screen.getAllByTestId(/^builder-canvas-item-(?!surface-)/)).toHaveLength(6);
            });

            // One original + one copy of each member — matched by prefix since the copy's title
            // carries the "(Copia)" suffix.
            const memberOneCopies = screen.getAllByText(/^Member 1/);
            const memberTwoCopies = screen.getAllByText(/^Member 2/);

            expect(memberOneCopies).toHaveLength(2);
            expect(memberTwoCopies).toHaveLength(2);
        });

        // G8 (copy bug, live check 2): a group whose `memberWidgetIds` already lists the same
        // member id twice — the shape a malformed/imported dashboard, or one propagated through
        // view duplication, could carry — must still yield exactly one copy of that member from a
        // single click on the REAL canvas, never "several times".
        it('duplicates a member exactly once even when the group already lists its id twice', async () => {
            const user = userEvent.setup();
            const widgets: WidgetConfig[] = [
                makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1', 'member-1', 'member-2'] }),
                makeWidget({ id: 'member-1', title: 'Member 1' }),
                makeWidget({ id: 'member-2', title: 'Member 2' }),
            ];
            const layout: WidgetLayout[] = [
                makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
                makeLayout({ widgetId: 'member-2', x: 5, y: 5, w: 2, h: 2 }),
            ];

            const view = render(
                <StrictMode>
                    <DuplicateWorkflowHarness initialWidgets={widgets} initialLayout={layout} cols={40} rows={24} />
                </StrictMode>,
            );

            const builderRoot = view.container.querySelector('[data-testid="builder-canvas-root"]');
            if (!builderRoot) {
                throw new Error('Builder root was not rendered.');
            }
            await syncCanvasMetrics(builderRoot, 1200, 900);

            const groupItem = screen.getByTestId('builder-canvas-item-group-1');
            const duplicateButton = within(groupItem).getByRole('button', { name: 'Duplicar widget' });
            await user.click(duplicateButton);

            await waitFor(() => {
                expect(screen.getAllByTestId(/^builder-canvas-item-(?!surface-)/)).toHaveLength(6);
            });

            expect(screen.getAllByText(/^Member 1/)).toHaveLength(2);
            expect(screen.getAllByText(/^Member 2/)).toHaveLength(2);
        });
    });

    describe('pencil edit mode (D6, G8)', () => {
        function renderLockedGroupWithMembers(overrides?: {
            editingGroupId?: string;
            onToggleGroupEditMode?: (widgetId: string) => void;
            onExitGroupEditMode?: () => void;
            onLayoutCommit?: (layout: WidgetLayout) => void;
            selectedWidgetId?: string;
            onWidgetSelect?: (widgetId: string) => void;
        }) {
            return renderInteractiveCanvas({
                widgets: [
                    makeGroupWidget({ id: 'group-1', locked: true, memberWidgetIds: ['member-1'] }),
                    makeWidget({ id: 'member-1', title: 'Member 1' }),
                    makeWidget({ id: 'widget-2', title: 'Widget 2' }),
                ],
                layout: [
                    makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 }),
                    makeLayout({ widgetId: 'member-1', x: 1, y: 1, w: 2, h: 2 }),
                    makeLayout({ widgetId: 'widget-2', x: 12, y: 0, w: 2, h: 2 }),
                ],
                cols: 16,
                rows: 12,
                resizeWidth: 1200,
                resizeHeight: 900,
                ...overrides,
            });
        }

        it('offers the pencil action only on a LOCKED container, not on an unlocked one', async () => {
            await renderInteractiveCanvas({
                widgets: [makeGroupWidget({ id: 'group-1', locked: false, memberWidgetIds: [] })],
                layout: [makeLayout({ widgetId: 'group-1', x: 0, y: 0, w: 10, h: 10 })],
            });

            expect(screen.queryByRole('button', { name: 'Editar contenido' })).not.toBeInTheDocument();
        });

        it('toggles edit mode via the pencil action and shows it pressed while active', async () => {
            const user = userEvent.setup();
            const onToggleGroupEditMode = vi.fn();

            await renderLockedGroupWithMembers({ onToggleGroupEditMode });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');
            const pencilButton = within(containerItem).getByRole('button', { name: 'Editar contenido' });
            expect(pencilButton).toHaveAttribute('aria-pressed', 'false');

            await user.click(pencilButton);
            expect(onToggleGroupEditMode).toHaveBeenCalledWith('group-1');
        });

        it('shows the pencil action as pressed when this group is the one being edited', async () => {
            await renderLockedGroupWithMembers({ editingGroupId: 'group-1' });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');
            const pencilButton = within(containerItem).getByRole('button', { name: 'Editar contenido' });
            expect(pencilButton).toHaveAttribute('aria-pressed', 'true');
        });

        it('lets a member show its own hover actions and be selected individually while its group is being edited', async () => {
            const user = userEvent.setup();
            const onWidgetSelect = vi.fn();

            await renderLockedGroupWithMembers({ editingGroupId: 'group-1', onWidgetSelect });

            const memberItem = screen.getByTestId('builder-canvas-item-member-1');
            expect(within(memberItem).getByRole('button', { name: 'Eliminar widget' })).toBeInTheDocument();

            await pressPointer(user, memberItem, { clientX: 100, clientY: 100 });
            await releasePointer(user, memberItem, { clientX: 100, clientY: 100 });

            expect(onWidgetSelect).toHaveBeenCalledWith('member-1');
        });

        it('renders resize handles for a member selected while its group is being edited', async () => {
            await renderLockedGroupWithMembers({ editingGroupId: 'group-1', selectedWidgetId: 'member-1' });

            expect(screen.getByTestId('builder-canvas-resize-handle-se-member-1')).toBeInTheDocument();
        });

        it('clamps a member move so it never leaves the container while editing', async () => {
            const user = userEvent.setup();
            const onLayoutCommit = vi.fn();

            await renderLockedGroupWithMembers({ editingGroupId: 'group-1', onLayoutCommit });

            const memberItem = screen.getByTestId('builder-canvas-item-member-1');

            // cellWidth = 1200/16 = 75px; a huge rightward drag would push member-1 (w=2) far
            // past the container's right edge (x=0..10) if it were not clamped.
            await pressPointer(user, memberItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 2000, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 2000, clientY: 100 });

            expect(onLayoutCommit).toHaveBeenCalledTimes(1);
            const committed = onLayoutCommit.mock.calls[0][0] as WidgetLayout;
            expect(committed.x + committed.w).toBeLessThanOrEqual(10);
        });

        it('still moves the whole group when the container itself is dragged while editing', async () => {
            const user = userEvent.setup();
            const onGroupLayoutCommit = vi.fn();

            await renderLockedGroupWithMembers({ editingGroupId: 'group-1', onGroupLayoutCommit });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');

            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await movePointer(user, document.body, { clientX: 250, clientY: 100 });
            await releasePointer(user, document.body, { clientX: 250, clientY: 100 });

            expect(onGroupLayoutCommit).toHaveBeenCalledTimes(1);
        });

        it('exits edit mode when clicking a widget outside the group', async () => {
            const user = userEvent.setup();
            const onExitGroupEditMode = vi.fn();

            await renderLockedGroupWithMembers({ editingGroupId: 'group-1', onExitGroupEditMode });

            const outsideWidget = screen.getByTestId('builder-canvas-item-widget-2');
            await pressPointer(user, outsideWidget, { clientX: 500, clientY: 500 });
            await releasePointer(user, outsideWidget, { clientX: 500, clientY: 500 });

            expect(onExitGroupEditMode).toHaveBeenCalledTimes(1);
        });

        it('exits edit mode when clicking empty canvas space', async () => {
            const user = userEvent.setup();
            const onExitGroupEditMode = vi.fn();

            const { builderRoot } = await renderLockedGroupWithMembers({ editingGroupId: 'group-1', onExitGroupEditMode });

            await user.click(builderRoot);

            expect(onExitGroupEditMode).toHaveBeenCalledTimes(1);
        });

        it('does not exit edit mode when clicking the container or a member of the group being edited', async () => {
            const user = userEvent.setup();
            const onExitGroupEditMode = vi.fn();

            await renderLockedGroupWithMembers({ editingGroupId: 'group-1', onExitGroupEditMode });

            const containerItem = screen.getByTestId('builder-canvas-item-group-1');
            await pressPointer(user, containerItem, { clientX: 100, clientY: 100 });
            await releasePointer(user, containerItem, { clientX: 100, clientY: 100 });

            const memberItem = screen.getByTestId('builder-canvas-item-member-1');
            await pressPointer(user, memberItem, { clientX: 100, clientY: 100 });
            await releasePointer(user, memberItem, { clientX: 100, clientY: 100 });

            expect(onExitGroupEditMode).not.toHaveBeenCalled();
        });
    });
});
