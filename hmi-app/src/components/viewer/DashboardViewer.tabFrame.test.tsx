import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import { makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import { buildTabFramePath } from '../../utils/tabFramePath';

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;
const resizeCallbacks = new Map<Element, Set<ResizeCallback>>();
let pendingWidth = false;

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
    const { useContext, useEffect } = await import('react');
    const { GridFrameScopeContext, TabFrameReporterContext } = await import('../../hooks/tabFrameContext');

    // Widget "a" behaves like a tab-frame widget: it reports a tab width like `WidgetFrame` does.
    function WidgetStub(props: { widget: { id: string } }) {
        const inGrid = useContext(GridFrameScopeContext);
        const reportTabWidth = useContext(TabFrameReporterContext);

        useEffect(() => {
            if (props.widget.id === 't') {
                // A taller tab (title with its own size) reports its height next to the width.
                reportTabWidth?.(180, 47);

                return () => reportTabWidth?.(null);
            }
            if (props.widget.id !== 'a') {
                return undefined;
            }
            reportTabWidth?.(pendingWidth ? 0 : 180);

            return () => reportTabWidth?.(null);
        }, [props.widget.id, reportTabWidth]);

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
        pendingWidth = false;
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
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

    it('draws no rectangle for a tab-frame widget (its overlays wait for the silhouette), only for the standard ones', () => {
        const widgets = [makeWidget({ id: 'a' }), makeWidget({ id: 'b' })];
        const layout = [makeLayout({ widgetId: 'a', x: 0, y: 0 }), makeLayout({ widgetId: 'b', x: 4, y: 0 })];

        const { container } = render(
            <DashboardViewer
                widgets={widgets}
                layout={layout}
                equipmentMap={new Map()}
                cols={24}
                rows={12}
                entranceKey="dash:view"
            />,
        );
        measure(container);

        // Widget "a" reported a tab width: jsdom has no layout, so the silhouette is not measurable and
        // its overlays draw nothing (a rect would be the wrong shape).
        expect(screen.queryByTestId('dashboard-viewer-entrance-flash-a')).toBeNull();
        expect(screen.getByTestId('dashboard-viewer-entrance-outline-a').querySelector('rect')).toBeNull();
        expect(screen.getByTestId('dashboard-viewer-entrance-outline-a').querySelector('path')).toBeNull();

        // Widget "b" is a standard frame: flash and traced rect as always.
        expect(screen.getByTestId('dashboard-viewer-entrance-flash-b')).toBeInTheDocument();
        expect(screen.getByTestId('dashboard-viewer-entrance-outline-b').querySelector('rect')).not.toBeNull();
    });

    it('hands the reported tab height to the entrance overlays: flash and outline follow the taller tab', () => {
        const tokens: Record<string, string> = { '--tab-frame-height': '25px', '--tab-frame-tab-cut': '19px', '--tab-frame-body-cut': '0px' };
        vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
        vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
            getPropertyValue: (name: string) => tokens[name] ?? '',
            borderTopLeftRadius: '4px',
            fontSize: '16px',
        }) as unknown as CSSStyleDeclaration);
        const widgets = [makeWidget({ id: 't' })];
        const layout = [makeLayout({ widgetId: 't', x: 0, y: 0 })];

        const { container } = render(
            <DashboardViewer
                widgets={widgets}
                layout={layout}
                equipmentMap={new Map()}
                cols={24}
                rows={12}
                entranceKey="dash:view"
            />,
        );
        measure(container);

        const geometry = { width: 300, height: 200, tabWidth: 180, tabHeight: 47, tabCut: 35.72, bodyCut: 0, radius: 4 };
        expect(screen.getByTestId('dashboard-viewer-entrance-outline-t').querySelector('path')?.getAttribute('d'))
            .toBe(buildTabFramePath(geometry));
        expect(screen.getByTestId('dashboard-viewer-entrance-flash-t').style.clipPath)
            .toBe(`path('${buildTabFramePath(geometry)}')`);
    });

    it('treats a tab that reported width 0 (pending) as tab shape: no rectangle in the meantime', () => {
        const widgets = [makeWidget({ id: 'a' })];
        const layout = [makeLayout({ widgetId: 'a', x: 0, y: 0 })];
        pendingWidth = true;

        const { container } = render(
            <DashboardViewer
                widgets={widgets}
                layout={layout}
                equipmentMap={new Map()}
                cols={24}
                rows={12}
                entranceKey="dash:view"
            />,
        );
        measure(container);

        expect(screen.getByTestId('dashboard-viewer-entrance-outline-a').querySelector('rect')).toBeNull();
        expect(screen.queryByTestId('dashboard-viewer-entrance-flash-a')).toBeNull();
    });
});
