import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeWidget } from '../../test/fixtures/dashboard.fixture';
import { DashboardPresentationFrameProvider, useDashboardPresentationFrame } from '../../services/dashboardPresentationFrame.service';
import WidgetPresentationBoundary from './WidgetPresentationBoundary';

function FrameProbe({ widgetId }: { widgetId: string }) {
    const frame = useDashboardPresentationFrame();
    const entry = frame.entries.get(widgetId);
    return <output data-testid="frame-state">{entry ? `${frame.ready}:${entry === frame.entries.get(widgetId)}:${Object.isFrozen(entry)}` : 'missing'}</output>;
}

describe('WidgetPresentationBoundary', () => {
    it('registers the exact frozen entry passed to the renderer', () => {
        const widget = makeWidget({ id: 'boundary-1' });

        render(
            <DashboardPresentationFrameProvider
                dashboardId="dashboard-1"
                viewId="view-1"
                profileRevision={7}
                expectedWidgetIds={[widget.id]}
            >
                <WidgetPresentationBoundary widget={widget} equipmentMap={new Map()} />
                <FrameProbe widgetId={widget.id} />
            </DashboardPresentationFrameProvider>,
        );

        expect(screen.getByTestId('frame-state')).toHaveTextContent('true:true:true');
    });
    it('keeps an unsupported visible widget non-fatal', () => {
        render(<DashboardPresentationFrameProvider dashboardId="d" viewId="v" profileRevision={1} expectedWidgetIds={['unsupported-1']}>
            <WidgetPresentationBoundary widget={makeWidget({ id: 'unsupported-1', type: 'badge' })} equipmentMap={new Map()} />
            <FrameProbe widgetId="unsupported-1" />
        </DashboardPresentationFrameProvider>);
        expect(screen.getByTestId('frame-state')).toHaveTextContent('true:true:true');
    });
});
