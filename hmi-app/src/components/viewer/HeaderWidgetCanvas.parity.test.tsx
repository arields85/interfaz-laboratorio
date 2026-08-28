import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import HeaderWidgetCanvas from './HeaderWidgetCanvas';
import { makeWidget } from '../../test/fixtures/dashboard.fixture';
const headerRendererMock = vi.fn();
vi.mock('./WidgetPresentationBoundary', () => ({ default: (props: { widget: { id: string }; renderEntry?: (entry: never) => React.ReactNode }) => props.renderEntry?.({ widgetId: props.widget.id, widgetType: 'status', capability: 'status', revisionKey: 'header-test', widget: props.widget, payload: { status: 'warning' } } as never) ?? null }));
vi.mock('./HeaderWidgetRenderer', () => ({ default: (props: { widget: { id: string; displayOptions?: unknown }; presentationData?: unknown }) => {
    headerRendererMock(props);
    return <output data-testid={`canonical-header-${props.widget.id}`}>{JSON.stringify(props.widget.displayOptions)}</output>;
} }));
describe('HeaderWidgetCanvas canonical parity', () => {
    it('materializes compact widgets through the canonical boundary and renderer', () => {
        const widget = makeWidget({ id: 'header-status', type: 'status', title: 'Header status', displayOptions: { variant: 'compact', showLabel: true } } as never);
        render(<HeaderWidgetCanvas widgets={[widget]} widgetColumnMap={new Map([[widget.id, 0]])} equipmentMap={new Map()} mode="viewer" />);
        expect(screen.getByTestId(`canonical-header-${widget.id}`)).toHaveTextContent(JSON.stringify(widget.displayOptions));
        expect(headerRendererMock).toHaveBeenCalledWith(expect.objectContaining({ widget, presentationData: { status: 'warning' } }));
    });
});
