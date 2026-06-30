import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { makeDashboard } from '../test/fixtures/dashboard.fixture';
import type { ConnectionHealth, ContractMachine } from '../domain/dataContract.types';
import { useUIStore } from '../store/ui.store';

const CONTENT_READY_ATTRIBUTE = 'data-hmi-content-ready';

const { dashboardStorageMock, hierarchyStorageMock, dashboardViewerMock, dashboardHeaderMock, useDataOverviewMock } = vi.hoisted(() => ({
    dashboardStorageMock: {
        getDashboards: vi.fn(),
    },
    hierarchyStorageMock: {
        getNodes: vi.fn(),
    },
    dashboardViewerMock: vi.fn(),
    dashboardHeaderMock: vi.fn(),
    useDataOverviewMock: vi.fn(),
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
        return <div data-testid="dashboard-header-title">Header title</div>;
    },
}));

vi.mock('../components/viewer/DashboardViewer', () => ({
    default: (props: Record<string, unknown>) => {
        dashboardViewerMock(props);
        return <div data-testid="dashboard-viewer-root">Viewer canvas</div>;
    },
}));

vi.mock('../queries/useDataOverview', () => ({
    useDataOverview: useDataOverviewMock,
}));

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

describe('Dashboard page layout', () => {
    beforeEach(() => {
        const dashboard = makeDashboard({ status: 'published', publishedSnapshot: undefined });
        dashboardStorageMock.getDashboards.mockResolvedValue([dashboard]);
        hierarchyStorageMock.getNodes.mockResolvedValue([]);
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
});
