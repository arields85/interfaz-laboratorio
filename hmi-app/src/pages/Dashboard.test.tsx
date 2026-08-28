import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { makeDashboard, makeWidget } from '../test/fixtures/dashboard.fixture';
import type { ConnectionHealth, ContractMachine } from '../domain/dataContract.types';
import type { DashboardView } from '../domain/admin.types';
import { useUIStore } from '../store/ui.store';
import { useDashboardPresentationFrame } from '../services/dashboardPresentationFrame.service';

const CONTENT_READY_ATTRIBUTE = 'data-hmi-content-ready';

const {
    dashboardStorageMock,
    hierarchyStorageMock,
    dashboardViewerMock,
    dashboardHeaderMock,
    useDataOverviewMock,
    buildDashboardSnapshotMock,
    exportDashboardSnapshotMock,
    startPrismaLocalSnapshotExporterMock,
    getDataSnapshotExportIntervalMsMock,
    isDataSnapshotExportEnabledMock,
} = vi.hoisted(() => ({
    dashboardStorageMock: {
        getDashboards: vi.fn(),
    },
    hierarchyStorageMock: {
        getNodes: vi.fn(),
    },
    dashboardViewerMock: vi.fn(),
    dashboardHeaderMock: vi.fn(),
    useDataOverviewMock: vi.fn(),
    buildDashboardSnapshotMock: vi.fn(),
    exportDashboardSnapshotMock: vi.fn(),
    startPrismaLocalSnapshotExporterMock: vi.fn(),
    getDataSnapshotExportIntervalMsMock: vi.fn(),
    isDataSnapshotExportEnabledMock: vi.fn(),
}));

vi.mock('../services/DashboardStorageService', () => ({
    dashboardStorage: dashboardStorageMock,
}));

vi.mock('../services/HierarchyStorageService', () => ({
    hierarchyStorage: hierarchyStorageMock,
}));

vi.mock('../components/viewer/DashboardHeader', () => ({
    default: (props: Record<string, unknown>) => {
        dashboardHeaderMock(props);

        const dashboard = props.dashboard as { id: string; views?: DashboardView[]; activeViewId?: string; ownerNodeId?: string };
        const activeViewId = (props.activeViewId as string | undefined) ?? dashboard?.activeViewId;
        const onSelectView = props.onSelectView as ((viewId: string) => void) | undefined;

        return (
            <div data-testid="dashboard-header-title">
                <span data-testid="dashboard-header-dashboard-id">{dashboard?.id}</span>
                <span data-testid="dashboard-header-owner-node-id">{dashboard?.ownerNodeId ?? 'no-owner'}</span>
                <span data-testid="dashboard-header-active-view-id">{activeViewId ?? 'no-view'}</span>
                {dashboard?.views?.map((view) => (
                    <button
                        key={view.id}
                        type="button"
                        aria-pressed={view.id === activeViewId}
                        onClick={() => onSelectView?.(view.id)}
                    >
                        {view.name}
                    </button>
                ))}
            </div>
        );
    },
}));

vi.mock('../components/viewer/DashboardViewer', () => {
    function DashboardViewerMock(props: Record<string, unknown>) {
        dashboardViewerMock(props);
        const frame = useDashboardPresentationFrame();
        return (
            <div data-testid="dashboard-viewer-root">
                Viewer canvas
                <output data-testid="dashboard-presentation-frame">{`${frame.dashboardId}:${frame.viewId}:${frame.profileRevision}:${frame.expectedWidgetIds.join(',')}`}</output>
                </div>
        );
    }

    return { default: DashboardViewerMock };
});

vi.mock('../queries/useDataOverview', () => ({
    useDataOverview: useDataOverviewMock,
}));

vi.mock('../services/dashboardSnapshotBuilder', () => ({
    buildDashboardSnapshot: buildDashboardSnapshotMock,
}));

vi.mock('../services/dashboardSnapshotExport.service', () => ({
    exportDashboardSnapshot: exportDashboardSnapshotMock,
    startPrismaLocalSnapshotExporter: startPrismaLocalSnapshotExporterMock,
}));

vi.mock('../config/dataConnection.config', async () => {
    const actual = await vi.importActual('../config/dataConnection.config') as Record<string, unknown>;

    return {
        ...actual,
        getDataSnapshotExportIntervalMs: getDataSnapshotExportIntervalMsMock,
        isDataSnapshotExportEnabled: isDataSnapshotExportEnabledMock,
    };
});

function renderDashboard(initialEntry = '/', options?: Parameters<typeof render>[1]) {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route path="/" element={<Dashboard />} />
            </Routes>
        </MemoryRouter>,
        options,
    );
}

function makeView(id: string, name: string, widgetId = `${id}-widget`): DashboardView {
    return {
        id,
        name,
        order: 0,
        widgets: [{
            id: widgetId,
            type: 'metric-card',
            title: `${name} widget`,
            position: { x: 0, y: 0 },
            size: { w: 4, h: 3 },
        }],
        layout: [{
            widgetId,
            x: 0,
            y: 0,
            w: 4,
            h: 3,
        }],
    };
}

describe('Dashboard page layout', () => {
    beforeEach(() => {
        const dashboard = makeDashboard({ status: 'published', publishedSnapshot: undefined });
        dashboardStorageMock.getDashboards.mockResolvedValue([dashboard]);
        hierarchyStorageMock.getNodes.mockResolvedValue([]);
        buildDashboardSnapshotMock.mockReturnValue({ timestamp: '2026-07-07T10:00:00.000Z', widgets: [] });
        exportDashboardSnapshotMock.mockResolvedValue(true);
        startPrismaLocalSnapshotExporterMock.mockReturnValue(vi.fn());
        getDataSnapshotExportIntervalMsMock.mockReturnValue(5_000);
        isDataSnapshotExportEnabledMock.mockReturnValue(true);
        useUIStore.setState({
            selectedPlantId: null,
            selectedAreaId: null,
            selectedEquipmentId: null,
        });
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'unknown', lastSuccess: null, ageMs: null },
            machines: [],
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 0,
            isEnabled: true,
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('keeps the viewer header title and canvas inside the same padded column for left-edge alignment', async () => {
        const { container } = renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        const pageColumn = container.firstElementChild as HTMLElement | null;
        const header = screen.getByTestId('dashboard-header-title');
        const viewerRoot = screen.getByTestId('dashboard-viewer-root');
        const canvasShell = viewerRoot.parentElement;

        expect(pageColumn).not.toBeNull();
        expect(pageColumn).toHaveClass('px-2');
        expect(pageColumn).toContainElement(header);
        expect(pageColumn).toContainElement(canvasShell);
        expect(canvasShell).toHaveClass('overflow-hidden');
    });

    it('provides the current dashboard view and visible widget IDs to production presentation paths', async () => {
        const dashboardWidget = makeWidget({ id: 'current-view-widget' });
        const headerWidget = makeWidget({ id: 'current-header-widget', type: 'status' as never });
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-presentation',
                status: 'published',
                views: [{
                    id: 'view-presentation',
                    name: 'Presentation',
                    order: 0,
                    widgets: [dashboardWidget, headerWidget],
                    layout: [makeView('view-presentation', 'Presentation', dashboardWidget.id).layout[0]],
                }],
                headerConfig: { widgetSlots: [{ widgetId: headerWidget.id, column: 0 }] },
            }),
        ]);

        renderDashboard('/?prismaMode=local');

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-presentation-frame')).toHaveTextContent(
                new RegExp(`^dashboard-presentation:view-presentation:\\d+:${dashboardWidget.id},${headerWidget.id}$`),
            );
        });

        expect(dashboardViewerMock).toHaveBeenCalledWith(expect.objectContaining({ presentationFrame: true }));
        expect(dashboardHeaderMock).toHaveBeenCalledWith(expect.objectContaining({ presentationFrame: true }));
    });

    it('passes published snapshot cols to the viewer when rendering a published dashboard', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                status: 'published',
                cols: 20,
                rows: 12,
                publishedSnapshot: {
                    aspect: '16:9',
                    cols: 30,
                    rows: 12,
                    widgets: [],
                    layout: [],
                    publishedAt: '2026-04-20T12:00:00.000Z',
                },
            }),
        ]);

        renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        expect(dashboardViewerMock).toHaveBeenCalledWith(
            expect.objectContaining({
                cols: 30,
                rows: 12,
            }),
        );
    });

    it('passes a viewer widget persistence callback so published dashboards can restore custom windows on reload', async () => {
        renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        expect(dashboardViewerMock).toHaveBeenCalledWith(
            expect.objectContaining({
                onPersistWidgetDisplayOptions: expect.any(Function),
            }),
        );
    });

    it('switches the active published dashboard when the viewer navigation callback targets another published dashboard', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({ id: 'dashboard-a', name: 'Dashboard A', status: 'published', widgets: [], layout: [] }),
            makeDashboard({ id: 'dashboard-b', name: 'Dashboard B', status: 'published', widgets: [], layout: [] }),
        ]);

        renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        const firstViewerCall = dashboardViewerMock.mock.calls.at(-1)?.[0] as { onNavigateDashboard: (dashboardId: string) => void };
        act(() => {
            firstViewerCall.onNavigateDashboard('dashboard-b');
        });

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    dashboard: expect.objectContaining({ id: 'dashboard-b' }),
                }),
            );
        });
    });

    it('passes contract machines to the viewer pipeline', async () => {
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

        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'online', lastSuccess: '2026-04-21T13:00:00.000Z', ageMs: 0 },
            machines,
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 123,
            isEnabled: true,
        });

        renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        expect(dashboardViewerMock).toHaveBeenCalledWith(
            expect.objectContaining({
                machines,
            }),
        );
    });

    it('passes overview loading and error state to the viewer pipeline', async () => {
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'unknown', lastSuccess: null, ageMs: null },
            machines: [],
            isLoading: true,
            isError: true,
            error: new Error('overview unavailable'),
            dataUpdatedAt: 0,
            isEnabled: true,
        });

        renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        expect(dashboardViewerMock).toHaveBeenCalledWith(
            expect.objectContaining({
                isLoadingOverview: true,
                hasOverviewError: true,
            }),
        );
    });

    it('passes contract connection and machines to the header pipeline', async () => {
        const connection: ConnectionHealth = {
            globalStatus: 'degradado',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: 5000,
        };
        const machines: ContractMachine[] = [{
            unitId: 101,
            name: 'Extrusora 101',
            status: 'offline',
            lastSuccess: '2026-04-21T13:00:00.000Z',
            ageMs: null,
            values: {},
        }];

        useDataOverviewMock.mockReturnValue({
            connection,
            machines,
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 123,
            isEnabled: true,
        });

        renderDashboard();

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header-title')).toBeInTheDocument();
        });

        expect(dashboardHeaderMock).toHaveBeenCalledWith(
            expect.objectContaining({
                connection,
                machines,
            }),
        );
    });

    it('signals loading and empty dashboard layouts as coherent content and clears readiness on unmount', async () => {
        let resolveDashboards!: (value: ReturnType<typeof makeDashboard>[]) => void;
        let resolveNodes!: (value: never[]) => void;

        dashboardStorageMock.getDashboards.mockReturnValue(new Promise((resolve) => {
            resolveDashboards = resolve;
        }));
        hierarchyStorageMock.getNodes.mockReturnValue(new Promise((resolve) => {
            resolveNodes = resolve;
        }));

        document.body.innerHTML = '<div id="root"></div>';
        const root = document.getElementById('root') as HTMLDivElement;

        const { unmount } = renderDashboard('/', { container: root });

        await waitFor(() => {
            expect(root).toHaveAttribute(CONTENT_READY_ATTRIBUTE, 'true');
        });

        resolveDashboards([]);
        resolveNodes([]);

        await waitFor(() => {
            expect(screen.getByText('Sin Vistas Publicadas')).toBeInTheDocument();
        });

        expect(root).toHaveAttribute(CONTENT_READY_ATTRIBUTE, 'true');

        unmount();

        expect(root).not.toHaveAttribute(CONTENT_READY_ATTRIBUTE);
    });

    it('signals the published viewer layout as coherent content once the dashboard shell mounts', async () => {
        document.body.innerHTML = '<div id="root"></div>';
        const root = document.getElementById('root') as HTMLDivElement;

        renderDashboard('/', { container: root });

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        expect(root).toHaveAttribute(CONTENT_READY_ATTRIBUTE, 'true');
        expect(screen.getByTestId('dashboard-header-title')).toBeInTheDocument();
    });

    it('signals the post-error dashboard shell as coherent content after storage load failures', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        dashboardStorageMock.getDashboards.mockRejectedValue(new Error('storage offline'));
        hierarchyStorageMock.getNodes.mockResolvedValue([]);

        document.body.innerHTML = '<div id="root"></div>';
        const root = document.getElementById('root') as HTMLDivElement;

        renderDashboard('/', { container: root });

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar los dashboards públicos.');
        });

        expect(root).toHaveAttribute(CONTENT_READY_ATTRIBUTE, 'true');
        expect(screen.getByText('Reintentá desde el navegador o contactá a un administrador si el problema persiste.')).toBeInTheDocument();
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error cargando dashboards públicos:', expect.any(Error));
    });

    it('opens the requested published dashboard when Home navigation passes a dashboardId search param', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({ id: 'dashboard-a', name: 'Dashboard A', status: 'published', widgets: [], layout: [] }),
            makeDashboard({ id: 'dashboard-main', name: 'Dashboard Main', status: 'published', widgets: [], layout: [] }),
        ]);

        renderDashboard('/?dashboardId=dashboard-main');

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    dashboard: expect.objectContaining({ id: 'dashboard-main' }),
                }),
            );
        });
    });

    it('does not snap back to the query dashboard after internal viewer navigation moves to another published dashboard', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({ id: 'dashboard-a', name: 'Dashboard A', status: 'published', widgets: [], layout: [] }),
            makeDashboard({ id: 'dashboard-main', name: 'Dashboard Main', status: 'published', widgets: [], layout: [] }),
        ]);

        renderDashboard('/?dashboardId=dashboard-main');

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    dashboard: expect.objectContaining({ id: 'dashboard-main' }),
                }),
            );
        });

        const viewerCall = dashboardViewerMock.mock.calls.at(-1)?.[0] as { onNavigateDashboard: (dashboardId: string) => void };

        act(() => {
            viewerCall.onNavigateDashboard('dashboard-a');
        });

        await waitFor(() => {
            expect(dashboardHeaderMock).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    dashboard: expect.objectContaining({ id: 'dashboard-a' }),
                }),
            );
        });
    });

    it('opens the requested internal view from the viewId query param and materializes that view without changing dashboard context', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-main',
                name: 'Dashboard Main',
                status: 'published',
                ownerNodeId: 'line-a',
                views: [
                    makeView('view-production', 'Production', 'widget-production'),
                    makeView('view-technical', 'Technical', 'widget-technical'),
                ],
                activeViewId: 'view-production',
            }),
        ]);

        renderDashboard('/?dashboardId=dashboard-main&viewId=view-technical');

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header-active-view-id')).toHaveTextContent('view-technical');
        });

        expect(screen.getByTestId('dashboard-header-dashboard-id')).toHaveTextContent('dashboard-main');
        expect(screen.getByTestId('dashboard-header-owner-node-id')).toHaveTextContent('line-a');
        expect(dashboardViewerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                widgets: [expect.objectContaining({ id: 'widget-technical' })],
                layout: [expect.objectContaining({ widgetId: 'widget-technical' })],
            }),
        );
    });

    it('falls back to the persisted active view when the viewId query param is invalid', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-main',
                name: 'Dashboard Main',
                status: 'published',
                views: [
                    makeView('view-production', 'Production', 'widget-production'),
                    makeView('view-technical', 'Technical', 'widget-technical'),
                ],
                activeViewId: 'view-technical',
            }),
        ]);

        renderDashboard('/?dashboardId=dashboard-main&viewId=view-missing');

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header-active-view-id')).toHaveTextContent('view-production');
        });

        expect(dashboardViewerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                widgets: [expect.objectContaining({ id: 'widget-production' })],
            }),
        );
    });

    it('ignores persisted activeViewId on initial viewer load and defaults to the first ordered internal view', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-main',
                name: 'Dashboard Main',
                status: 'published',
                views: [
                    { ...makeView('view-technical', 'Technical', 'widget-technical'), order: 1 },
                    { ...makeView('view-production', 'Production', 'widget-production'), order: 0 },
                ],
                activeViewId: 'view-technical',
            }),
        ]);

        renderDashboard('/?dashboardId=dashboard-main');

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header-active-view-id')).toHaveTextContent('view-production');
        });

        expect(dashboardViewerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                widgets: [expect.objectContaining({ id: 'widget-production' })],
                layout: [expect.objectContaining({ widgetId: 'widget-production' })],
            }),
        );
    });

    it('switches internal views from the header without confusing them with global dashboard navigation', async () => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({
                id: 'dashboard-a',
                name: 'Dashboard A',
                status: 'published',
                ownerNodeId: 'plant-a',
                views: [
                    makeView('view-main', 'Main', 'widget-main'),
                    makeView('dashboard-b', 'Technical', 'widget-technical'),
                ],
                activeViewId: 'view-main',
            }),
            makeDashboard({
                id: 'dashboard-b',
                name: 'Dashboard B',
                status: 'published',
                ownerNodeId: 'plant-b',
                views: [makeView('view-b', 'Dashboard B main', 'widget-b')],
                activeViewId: 'view-b',
            }),
        ]);

        const user = userEvent.setup();
        renderDashboard('/?dashboardId=dashboard-a');

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header-dashboard-id')).toHaveTextContent('dashboard-a');
        });

        await user.click(screen.getByRole('button', { name: 'Technical' }));

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-header-active-view-id')).toHaveTextContent('dashboard-b');
        });

        expect(screen.getByTestId('dashboard-header-dashboard-id')).toHaveTextContent('dashboard-a');
        expect(screen.getByTestId('dashboard-header-owner-node-id')).toHaveTextContent('plant-a');
        expect(dashboardViewerMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                widgets: [expect.objectContaining({ id: 'widget-technical' })],
            }),
        );
        expect(dashboardHeaderMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                dashboard: expect.objectContaining({ id: 'dashboard-a', ownerNodeId: 'plant-a' }),
            }),
        );
    });

    it('exports the visible dashboard snapshot only after the configured interval without breaking the viewer shell', async () => {
        vi.useFakeTimers();
        renderDashboard();

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        expect(buildDashboardSnapshotMock).not.toHaveBeenCalled();
        expect(exportDashboardSnapshotMock).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledWith(
            expect.objectContaining({
                dashboard: expect.objectContaining({ id: 'dashboard-1' }),
            }),
        );
        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(1);
        expect(exportDashboardSnapshotMock).toHaveBeenCalledWith({
            timestamp: '2026-07-07T10:00:00.000Z',
            widgets: [],
        });
        expect(exportDashboardSnapshotMock).toHaveBeenCalledTimes(1);
    });

    it('does not start a new snapshot export tick while the previous export is still in flight', async () => {
        vi.useFakeTimers();

        let resolveExport: ((value: boolean) => void) | null = null;
        exportDashboardSnapshotMock.mockImplementation(() => new Promise((resolve) => {
            resolveExport = resolve;
        }));

        renderDashboard();

        await act(async () => {
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).not.toHaveBeenCalled();
        expect(exportDashboardSnapshotMock).not.toHaveBeenCalled();

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(1);
        expect(exportDashboardSnapshotMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(15_000);
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(1);
        expect(exportDashboardSnapshotMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveExport?.(true);
            await Promise.resolve();
        });

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(2);
        expect(exportDashboardSnapshotMock).toHaveBeenCalledTimes(2);
    });

    it('does not send immediately again on data-refresh rerenders and uses the latest overview values on the next tick', async () => {
        vi.useFakeTimers();

        const initialConnection: ConnectionHealth = { globalStatus: 'unknown', lastSuccess: null, ageMs: null };
        const nextConnection: ConnectionHealth = { globalStatus: 'online', lastSuccess: '2026-07-07T10:05:00.000Z', ageMs: 150 };
        const initialMachines: ContractMachine[] = [];
        const nextMachines: ContractMachine[] = [{
            unitId: 7,
            name: 'Compresora 7',
            status: 'online',
            values: {},
            lastSuccess: '2026-07-07T10:05:00.000Z',
            ageMs: 150,
        }];

        let currentOverview = {
            connection: initialConnection,
            machines: initialMachines,
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 0,
            isEnabled: true,
        };

        useDataOverviewMock.mockImplementation(() => currentOverview);

        const view = renderDashboard();

        await act(async () => {
            await Promise.resolve();
        });

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(1);
        expect(buildDashboardSnapshotMock).toHaveBeenLastCalledWith(expect.objectContaining({
            connection: initialConnection,
            machines: initialMachines,
        }));

        currentOverview = {
            connection: nextConnection,
            machines: nextMachines,
            isLoading: false,
            isError: false,
            error: null,
            dataUpdatedAt: 5_000,
            isEnabled: true,
        };

        view.rerender(
            <MemoryRouter initialEntries={['/']}>
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                </Routes>
            </MemoryRouter>,
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(1);
        expect(exportDashboardSnapshotMock).toHaveBeenCalledTimes(1);

        await act(async () => {
            vi.advanceTimersByTime(5_000);
            await Promise.resolve();
        });

        expect(buildDashboardSnapshotMock).toHaveBeenCalledTimes(2);
        expect(buildDashboardSnapshotMock).toHaveBeenLastCalledWith(expect.objectContaining({
            connection: nextConnection,
            machines: nextMachines,
        }));
        expect(exportDashboardSnapshotMock).toHaveBeenCalledTimes(2);
    });

    it('starts only the local exporter for local mode when central settings are empty or disabled', async () => {
        isDataSnapshotExportEnabledMock.mockReturnValue(false);
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({ id: 'local-dashboard', status: 'published', widgets: [], layout: [] }),
        ]);

        renderDashboard('/?prismaMode=local');

        await waitFor(() => {
            expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument();
        });

        expect(startPrismaLocalSnapshotExporterMock).toHaveBeenCalledWith(expect.objectContaining({
            intervalMs: 5_000,
            revision: expect.any(Number),
            getSnapshot: expect.any(Function),
        }));
        expect(exportDashboardSnapshotMock).not.toHaveBeenCalled();

        const localExporterOptions = startPrismaLocalSnapshotExporterMock.mock.calls[0]?.[0] as { getSnapshot: () => unknown };
        expect(localExporterOptions.getSnapshot()).toMatchObject({
            widgets: [],
        });
        expect(buildDashboardSnapshotMock).toHaveBeenCalledWith(expect.objectContaining({
            dashboard: expect.objectContaining({ id: 'local-dashboard' }),
            presentationFrame: expect.objectContaining({ dashboardId: 'local-dashboard' }),
        }));
    });
});
