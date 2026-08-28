import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DashboardViewer from './DashboardViewer';
import { makeLayout, makeWidget } from '../../test/fixtures/dashboard.fixture';
const boundaryMock = vi.fn();
const rendererMock = vi.fn();
vi.mock('./WidgetPresentationBoundary', () => ({ default: (props: { widget: { id: string; displayOptions?: unknown } }) => {
    boundaryMock(props);
    return <output data-testid={`canonical-boundary-${props.widget.id}`}>{JSON.stringify(props.widget.displayOptions)}</output>;
} }));
vi.mock('../../widgets', () => ({ WidgetRenderer: (props: { widget: { id: string } }) => {
    rendererMock(props);
    return <output data-testid={`generic-renderer-${props.widget.id}`} />;
} }));
class ImmediateResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}
    public observe(target: Element): void { this.callback([{ target, contentRect: { width: 800, height: 480 } } as ResizeObserverEntry], this); }
    public disconnect(): void {}
    public unobserve(): void {}
}
describe('DashboardViewer canonical parity', () => {
    it('routes persisted displayOptions through the canonical boundary instead of the generic renderer', async () => {
        boundaryMock.mockClear();
        rendererMock.mockClear();
        vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
        const widget = makeWidget({ id: 'viewer-kpi', type: 'kpi', title: 'Viewer KPI', displayOptions: { variant: 'circular', showTrend: false } } as never);
        render(<div style={{ width: 800, height: 480 }}><DashboardViewer widgets={[widget]} layout={[makeLayout({ widgetId: widget.id })]} equipmentMap={new Map()} /></div>);
        await waitFor(() => expect(screen.getByTestId(`canonical-boundary-${widget.id}`)).toBeInTheDocument());
        expect(screen.getByTestId(`canonical-boundary-${widget.id}`)).toHaveTextContent(JSON.stringify(widget.displayOptions));
        expect(boundaryMock).toHaveBeenCalledWith(expect.objectContaining({ widget }));
        expect(rendererMock).not.toHaveBeenCalled();
    });
});
