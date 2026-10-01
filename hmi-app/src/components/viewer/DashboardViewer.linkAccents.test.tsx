import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import { makeGroupWidget, makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
import type { WidgetConfig, WidgetLayout } from '../../domain/admin.types';
import { previewLinkCornerAccents, resetLinkCornerAccentsOnDocument } from '../../services/linkCornerAccents.service';
import { previewFrameShape, resetFrameShapeOnDocument } from '../../services/frameShape.service';
import { useThemeStylePresetStore } from '../../store/themeStylePreset.store';

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

vi.mock('./WidgetPresentationBoundary', () => ({
    default: (props: { widget: { id: string } }) => <div data-testid={`widget-renderer-${props.widget.id}`} />,
}));

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

function renderViewer(widgets: WidgetConfig[], extra: Partial<React.ComponentProps<typeof DashboardViewer>> = {}) {
    const layout: WidgetLayout[] = widgets.map((widget, index) => makeLayout({ widgetId: widget.id, x: index * 4, y: 0 }));
    const result = render(
        <DashboardViewer widgets={widgets} layout={layout} equipmentMap={new Map()} cols={24} rows={12} {...extra} />,
    );
    measure(result.container);
    return result;
}

const accents = (id: string) => screen.queryByTestId(`dashboard-viewer-link-accents-${id}`);

describe('DashboardViewer link corner accents', () => {
    beforeEach(() => {
        resizeCallbacks.clear();
        vi.stubGlobal('ResizeObserver', MockResizeObserver);
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        previewLinkCornerAccents(true);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        resetLinkCornerAccentsOnDocument();
        resetFrameShapeOnDocument();
        useThemeStylePresetStore.getState().setClassic(true);
    });

    it('draws the layer for a widget with its own navigation target, as an inert sibling of the widget', () => {
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);

        const layer = accents('a');
        expect(layer).not.toBeNull();
        expect(layer).toHaveAttribute('aria-hidden', 'true');
        expect(layer?.className).toContain('hmi-link-accents');
        const surface = screen.getByTestId('dashboard-viewer-item-surface-a');
        expect(layer?.parentElement).toBe(surface);
        expect(screen.getByTestId('widget-renderer-a').parentElement).toBe(surface);
    });

    it('marks the viewer item as the hover host of the layer', () => {
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);

        expect(screen.getByTestId('dashboard-viewer-item-a').className).toContain('hmi-link-accents-host');
    });

    it('positions the layer at the surface inset minus the offset token', () => {
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);

        const inset = accents('a')?.style.inset ?? '';
        expect(inset).toBe('calc(var(--widget-spacing) - var(--link-accent-offset))');
    });

    it('uses a zero surface inset for a group container (offset only)', () => {
        renderViewer([makeGroupWidget({ id: 'g', navigationTargetDashboardId: 'dash-2' })]);

        expect(accents('g')?.style.inset).toBe('calc(0px - var(--link-accent-offset))');
    });

    it('draws nothing for a widget without a navigation target (or a blank one)', () => {
        renderViewer([makeWidget({ id: 'a' }), makeWidget({ id: 'b', navigationTargetDashboardId: '   ' })]);

        expect(accents('a')).toBeNull();
        expect(accents('b')).toBeNull();
        expect(screen.getByTestId('dashboard-viewer-item-a').className).not.toContain('hmi-link-accents-host');
    });

    it("draws the layer for a member that inherits its locked group's target", () => {
        renderViewer([
            makeGroupWidget({ id: 'g', locked: true, memberWidgetIds: ['m'], navigationTargetDashboardId: 'dash-2' }),
            makeWidget({ id: 'm' }),
        ]);

        expect(accents('m')).not.toBeNull();
    });

    it('draws nothing for a member of an unlocked group without its own target', () => {
        renderViewer([
            makeGroupWidget({ id: 'g', locked: false, memberWidgetIds: ['m'], navigationTargetDashboardId: 'dash-2' }),
            makeWidget({ id: 'm' }),
        ]);

        expect(accents('m')).toBeNull();
    });

    it('still draws the layer, with the same inset, with the Pestana frame shape', () => {
        previewFrameShape('tab');
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);

        expect(screen.getByTestId('dashboard-viewer-item-a').className).toContain('hmi-link-accents-host');
        expect(accents('a')?.style.inset).toBe('calc(var(--widget-spacing) - var(--link-accent-offset))');
    });

    it('draws nothing when the setting is off', () => {
        previewLinkCornerAccents(false);
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);

        expect(accents('a')).toBeNull();
    });

    it('draws nothing when another preset than Clasico is active', () => {
        useThemeStylePresetStore.getState().setClassic(false);
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);

        expect(accents('a')).toBeNull();
    });

    it('draws nothing for frameless widgets (text title, "Mostrar fondo y marco" off)', () => {
        renderViewer([
            makeWidget({ id: 'title', type: 'text-title', navigationTargetDashboardId: 'dash-2' }),
            makeWidget({ id: 'bare', type: 'status', navigationTargetDashboardId: 'dash-2', displayOptions: { showFrame: false } }),
        ]);

        expect(accents('title')).toBeNull();
        expect(accents('bare')).toBeNull();
    });

    it('draws nothing for a widget promoted to the header slot (not part of the grid)', () => {
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })], { headerWidgetIds: new Set(['a']) });

        expect(accents('a')).toBeNull();
    });

    it('reacts live to the setting without remounting the grid', () => {
        renderViewer([makeWidget({ id: 'a', navigationTargetDashboardId: 'dash-2' })]);
        expect(accents('a')).not.toBeNull();

        act(() => previewLinkCornerAccents(false));
        expect(accents('a')).toBeNull();
    });
});
