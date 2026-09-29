import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import { makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
const resizeCallbacks = new Map<Element, Set<ResizeCallback>>();

class MockResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeCallback) {}

    public observe(target: Element): void {
        const callbacks = resizeCallbacks.get(target) ?? new Set<ResizeCallback>();
        callbacks.add(this.callback);
        resizeCallbacks.set(target, callbacks);
    }

    public unobserve(): void {}

    public disconnect(): void {}
}

// The stub reads the grid scope the way `WidgetFrame` does, to assert what the viewer provides.
vi.mock('./WidgetPresentationBoundary', async () => {
    const { useContext } = await import('react');
    const { GridFrameScopeContext } = await import('../../hooks/tabFrameContext');

    function WidgetStub(props: { widget: { id: string } }) {
        const inGrid = useContext(GridFrameScopeContext);
        return <div data-testid={`widget-renderer-${props.widget.id}`} data-in-grid={String(inGrid)} />;
    }

    return { default: WidgetStub };
});

function measure(container: HTMLElement) {
    const root = container.querySelector('[data-testid="dashboard-viewer-root"]');
    if (!root) {
        throw new Error('Dashboard viewer root was not rendered.');
    }
    const entry = { target: root, contentRect: { width: 1200, height: 675 } } as ResizeObserverEntry;
    act(() => {
        for (const callback of resizeCallbacks.get(root) ?? []) {
            callback([entry], {} as ResizeObserver);
        }
    });
}

describe('DashboardViewer frame shape scope', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('marks every grid widget as rendered inside a dashboard grid', () => {
        const widgets = [makeWidget({ id: 'a' }), makeWidget({ id: 'b' })];
        const layout = [makeLayout({ widgetId: 'a', x: 0, y: 0 }), makeLayout({ widgetId: 'b', x: 4, y: 0 })];

        const { container } = render(
            <DashboardViewer widgets={widgets} layout={layout} equipmentMap={new Map()} cols={24} rows={12} />,
        );
        measure(container);

        expect(screen.getByTestId('widget-renderer-a')).toHaveAttribute('data-in-grid', 'true');
        expect(screen.getByTestId('widget-renderer-b')).toHaveAttribute('data-in-grid', 'true');
    });
});
