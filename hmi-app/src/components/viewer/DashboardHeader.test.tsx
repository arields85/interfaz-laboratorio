import { within } from '@testing-library/react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DashboardHeader from './DashboardHeader';
import { makeDashboard, makeWidget } from '../../test/fixtures/dashboard.fixture';
import type { DashboardView } from '../../domain/admin.types';
import { HEADER_VIEW_ICON_BUTTON_ACTIVE_CLS, HEADER_VIEW_ICON_BUTTON_CLS } from '../layout/topbarIconButtonStyles';

vi.mock('lucide-react', async () => {
    const actual = await vi.importActual<typeof import('lucide-react')>('lucide-react');

    const makeIcon = (label: string) => function MockIcon({ size, className }: { size?: number; className?: string }) {
        return <svg aria-hidden="true" data-testid={`icon-${label}`} width={size} height={size} className={className} />;
    };

    return {
        ...actual,
        Edit2: makeIcon('Edit2'),
        Factory: makeIcon('Factory'),
        LayoutDashboard: makeIcon('LayoutDashboard'),
        Wrench: makeIcon('Wrench'),
    };
});

vi.mock('./HeaderWidgetCanvas', () => ({
    default: ({
        widgets,
        widgetColumnMap,
    }: {
        widgets: Array<{ id: string; title?: string }>;
        widgetColumnMap?: Map<string, number>;
    }) => (
        <div data-testid="header-widget-canvas">
            {widgets.map((widget) => (
                <div
                    key={widget.id}
                    data-testid={`header-widget-${widget.id}`}
                    data-column={widgetColumnMap?.get(widget.id)}
                >
                    {widget.title ?? widget.id}
                </div>
            ))}
            <div data-testid="header-widget-slot-0" />
            <div data-testid="header-widget-slot-1" />
            <div data-testid="header-widget-slot-2" />
        </div>
    ),
}));

function makeView(id: string, name: string): DashboardView {
    return {
        id,
        name,
        order: 0,
        widgets: [],
        layout: [],
    };
}

function renderViewerHeader(overrides: Parameters<typeof makeDashboard>[0] = {}, onSelectView?: (viewId: string) => void) {
    const resolvedActiveViewId = overrides.activeViewId ?? 'view-production';

    return render(
        <DashboardHeader
            dashboard={makeDashboard({
                name: 'Line A Dashboard',
                views: [
                    makeView('view-production', 'Production'),
                    makeView('view-technical', 'Technical'),
                ],
                activeViewId: 'view-production',
                ...overrides,
            })}
            activeViewId={resolvedActiveViewId}
            equipmentMap={new Map()}
            onSelectView={onSelectView}
        />,
    );
}

describe('DashboardHeader', () => {
    it('renders icon-only internal-view controls and prefixes the subtitle with the active view name in viewer mode', () => {
        renderViewerHeader({
            headerConfig: { subtitle: 'Main line overview' },
        });

        expect(screen.getByRole('heading', { name: 'Line A Dashboard' })).toBeInTheDocument();
        expect(screen.getByText('Production')).toBeInTheDocument();
        expect(screen.getByText('-')).toBeInTheDocument();
        expect(screen.getByText('Main line overview')).toBeInTheDocument();

        const viewControls = screen.getByRole('group', { name: 'Internal dashboard views' });
        expect(viewControls).toBeInTheDocument();

        expect(screen.getByRole('button', { name: 'Production' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Technical' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Production' })).not.toHaveTextContent('Production');
        expect(screen.getByRole('button', { name: 'Technical' })).not.toHaveTextContent('Technical');
    });

    it('shows the existing tooltip primitive label and calls onSelectView with the selected view id', async () => {
        const user = userEvent.setup();
        const onSelectView = vi.fn();

        renderViewerHeader({}, onSelectView);

        await user.hover(screen.getByRole('button', { name: 'Technical' }));

        expect(await screen.findByRole('tooltip')).toHaveTextContent('Technical');

        await user.click(screen.getByRole('button', { name: 'Technical' }));

        expect(onSelectView).toHaveBeenCalledWith('view-technical');
        expect(onSelectView).toHaveBeenCalledTimes(1);
    });

    it('uses the header internal-view icon style variant without background while preserving active state semantics and 18px icons', () => {
        renderViewerHeader();

        const productionButton = screen.getByRole('button', { name: 'Production' });
        const technicalButton = screen.getByRole('button', { name: 'Technical' });

        expect(productionButton.className).toBe(`${HEADER_VIEW_ICON_BUTTON_CLS} ${HEADER_VIEW_ICON_BUTTON_ACTIVE_CLS}`);
        expect(technicalButton.className).toBe(HEADER_VIEW_ICON_BUTTON_CLS);
        expect(productionButton.className).not.toContain('bg-industrial-hover');
        expect(technicalButton.className).not.toContain('bg-industrial-hover');
        expect(within(productionButton).getByTestId('icon-Factory')).toHaveAttribute('width', '18');
        expect(within(productionButton).getByTestId('icon-Factory')).toHaveAttribute('height', '18');
        expect(within(technicalButton).getByTestId('icon-Wrench')).toHaveAttribute('width', '18');
        expect(within(technicalButton).getByTestId('icon-Wrench')).toHaveAttribute('height', '18');
    });

    it('uses the maintenance default mapping and explicit icon overrides for view buttons', () => {
        renderViewerHeader({
            views: [
                makeView('view-production', 'Production'),
                { ...makeView('view-maintenance', 'Maintenance'), iconKey: 'default', order: 1 },
                { ...makeView('view-technical', 'Technical'), iconKey: 'maintenance', order: 2 },
            ],
            activeViewId: 'view-production',
        });

        expect(within(screen.getByRole('button', { name: 'Production' })).getByTestId('icon-Factory')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: 'Maintenance' })).getByTestId('icon-LayoutDashboard')).toBeInTheDocument();
        expect(within(screen.getByRole('button', { name: 'Technical' })).getByTestId('icon-Wrench')).toBeInTheDocument();
    });

    it('keeps internal-view icon navigation inside the header actions area before the header widget slots', () => {
        renderViewerHeader({
            headerConfig: {
                subtitle: 'Main line overview',
                widgetSlots: [{ widgetId: 'header-widget-1', column: 0 }],
            },
            views: [
                {
                    ...makeView('view-production', 'Production'),
                    widgets: [{
                        id: 'header-widget-1',
                        type: 'status',
                        title: 'Header status',
                        position: { x: 0, y: 0 },
                        size: { w: 2, h: 1 },
                    }],
                },
                makeView('view-technical', 'Technical'),
            ],
            widgets: [{
                id: 'header-widget-1',
                type: 'status',
                title: 'Header status',
                position: { x: 0, y: 0 },
                size: { w: 2, h: 1 },
            }],
        });

        const titleBlock = screen.getByTestId('dashboard-header-title-block');
        const actions = screen.getByTestId('dashboard-header-actions');
        const viewControls = screen.getByRole('group', { name: 'Internal dashboard views' });
        const widgetCanvas = screen.getByTestId('header-widget-canvas');

        expect(titleBlock).toContainElement(screen.getByRole('heading', { name: 'Line A Dashboard' }));
        expect(titleBlock).not.toContainElement(screen.getByRole('button', { name: 'Production' }));
        expect(titleBlock).not.toContainElement(screen.getByRole('button', { name: 'Technical' }));
        expect(actions).toContainElement(viewControls);
        expect(actions).toContainElement(widgetCanvas);
        expect(viewControls.compareDocumentPosition(widgetCanvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders header widget slots from the active internal view only, even when global slots share a column', () => {
        const productionHeaderWidget = makeWidget({ id: 'header-production', type: 'status', title: 'Production header status' });
        const technicalHeaderWidget = makeWidget({ id: 'header-technical', type: 'status', title: 'Technical header status' });
        const productionView: DashboardView = {
            ...makeView('view-production', 'Production'),
            widgets: [productionHeaderWidget],
        };
        const technicalView: DashboardView = {
            ...makeView('view-technical', 'Technical'),
            order: 1,
            widgets: [technicalHeaderWidget],
        };

        const { rerender } = render(
            <DashboardHeader
                dashboard={makeDashboard({
                    name: 'Line A Dashboard',
                    activeViewId: 'view-production',
                    widgets: [productionHeaderWidget],
                    views: [productionView, technicalView],
                    headerConfig: {
                        widgetSlots: [
                            { widgetId: 'header-production', column: 0 },
                            { widgetId: 'header-technical', column: 0 },
                        ],
                    },
                })}
                activeViewId="view-technical"
                equipmentMap={new Map()}
            />,
        );

        expect(screen.queryByTestId('header-widget-header-production')).not.toBeInTheDocument();
        expect(screen.getByTestId('header-widget-header-technical')).toHaveTextContent('Technical header status');
        expect(screen.getByTestId('header-widget-header-technical')).toHaveAttribute('data-column', '0');

        rerender(
            <DashboardHeader
                dashboard={makeDashboard({
                    name: 'Line A Dashboard',
                    activeViewId: 'view-production',
                    widgets: [productionHeaderWidget],
                    views: [productionView, technicalView],
                    headerConfig: {
                        widgetSlots: [
                            { widgetId: 'header-production', column: 0 },
                            { widgetId: 'header-technical', column: 0 },
                        ],
                    },
                })}
                activeViewId="view-production"
                equipmentMap={new Map()}
            />,
        );

        expect(screen.getByTestId('header-widget-header-production')).toHaveTextContent('Production header status');
        expect(screen.getByTestId('header-widget-header-production')).toHaveAttribute('data-column', '0');
        expect(screen.queryByTestId('header-widget-header-technical')).not.toBeInTheDocument();
    });

    it('uses the active-view filtered slot index as the fallback header widget column', () => {
        const productionHeaderWidget = makeWidget({ id: 'header-production', type: 'status', title: 'Production header status' });
        const technicalHeaderWidget = makeWidget({ id: 'header-technical', type: 'status', title: 'Technical header status' });

        render(
            <DashboardHeader
                dashboard={makeDashboard({
                    name: 'Line A Dashboard',
                    activeViewId: 'view-production',
                    widgets: [productionHeaderWidget],
                    views: [
                        {
                            ...makeView('view-production', 'Production'),
                            widgets: [productionHeaderWidget],
                        },
                        {
                            ...makeView('view-technical', 'Technical'),
                            order: 1,
                            widgets: [technicalHeaderWidget],
                        },
                    ],
                    headerConfig: {
                        widgetSlots: [
                            { widgetId: 'header-production' },
                            { widgetId: 'header-technical' },
                        ],
                    },
                })}
                activeViewId="view-technical"
                equipmentMap={new Map()}
            />,
        );

        expect(screen.queryByTestId('header-widget-header-production')).not.toBeInTheDocument();
        expect(screen.getByTestId('header-widget-header-technical')).toHaveAttribute('data-column', '0');
    });

    it('falls back to the active view name when no builder subtitle exists', () => {
        renderViewerHeader({
            activeViewId: 'view-technical',
            views: [
                makeView('view-production', 'Production'),
                makeView('view-technical', 'Technical'),
            ],
        });

        expect(screen.getByText('Technical')).toBeInTheDocument();
    });

    it('renders the active internal view as an admin tag in preview mode and updates it when the builder changes view', () => {
        const dashboard = makeDashboard({
            name: 'Line A Dashboard',
            views: [
                { ...makeView('view-production', 'Production'), subtitle: 'Main line overview' },
                { ...makeView('view-technical', 'Technical'), subtitle: 'Service diagnostics' },
            ],
            activeViewId: 'view-production',
        });
        const onTitleChange = vi.fn();
        const onSubtitleChange = vi.fn();

        const { rerender } = render(
            <DashboardHeader
                mode="preview"
                dashboard={dashboard}
                activeViewId="view-production"
                equipmentMap={new Map()}
                onTitleChange={onTitleChange}
                onSubtitleChange={onSubtitleChange}
                onSelectView={vi.fn()}
            />,
        );

        expect(screen.getByText('Production')).toBeInTheDocument();
        expect(screen.getByText('-')).toBeInTheDocument();
        expect(screen.getByText('Main line overview')).toBeInTheDocument();

        rerender(
            <DashboardHeader
                mode="preview"
                dashboard={dashboard}
                activeViewId="view-technical"
                equipmentMap={new Map()}
                onTitleChange={onTitleChange}
                onSubtitleChange={onSubtitleChange}
                onSelectView={vi.fn()}
            />,
        );

        expect(screen.getByText('Technical')).toBeInTheDocument();
        expect(screen.getByText('-')).toBeInTheDocument();
        expect(screen.getByText('Service diagnostics')).toBeInTheDocument();
    });

    it('does not render internal-view controls when only one view is available', () => {
        renderViewerHeader({
            views: [makeView('view-production', 'Production')],
            activeViewId: 'view-production',
        });

        expect(screen.queryByRole('group', { name: 'Internal dashboard views' })).not.toBeInTheDocument();
    });
});
