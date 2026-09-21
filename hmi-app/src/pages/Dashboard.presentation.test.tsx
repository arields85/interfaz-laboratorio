import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { makeDashboard, makeLayout, makeWidget } from '../test/fixtures/dashboard.fixture';
import type { DashboardSnapshotExporterOptions } from '../services/dashboardSnapshotExport.service';

const { getDashboardsMock, getNodesMock, useDataOverviewMock, startExporterMock } = vi.hoisted(() => ({
    getDashboardsMock: vi.fn(),
    getNodesMock: vi.fn(),
    useDataOverviewMock: vi.fn(),
    startExporterMock: vi.fn(),
}));

vi.mock('../services/DashboardStorageService', () => ({
    dashboardStorage: { getDashboards: getDashboardsMock },
}));

vi.mock('../services/HierarchyStorageService', () => ({
    hierarchyStorage: { getNodes: getNodesMock },
}));

vi.mock('../queries/useDataOverview', () => ({ useDataOverview: useDataOverviewMock }));

vi.mock('../services/dashboardSnapshotExport.service', () => ({
    startDashboardSnapshotExporter: startExporterMock,
}));

class ImmediateResizeObserver implements ResizeObserver {
    public constructor(private readonly callback: ResizeObserverCallback) {}

    public observe(target: Element): void {
        this.callback([{ target, contentRect: { width: 800, height: 480 } } as ResizeObserverEntry], this);
    }

    public disconnect(): void {}
    public unobserve(): void {}
}

describe('Dashboard canonical presentation materialization', () => {
    beforeEach(() => {
        const headerWidget = makeWidget({
            id: 'header-status',
            type: 'status',
            title: 'Header status',
            binding: { mode: 'simulated_value', simulatedValue: 'warning' },
        } as never);
        const gridWidget = makeWidget({
            id: 'grid-metric',
            type: 'metric-card',
            title: 'Grid metric',
            binding: { mode: 'simulated_value', simulatedValue: 42, unit: 'kW' },
            displayOptions: { variant: 'circular' },
        } as never);
        getDashboardsMock.mockResolvedValue([makeDashboard({
            id: 'published-dashboard',
            status: 'published',
            widgets: [headerWidget, gridWidget],
            layout: [makeLayout({ widgetId: gridWidget.id })],
            headerConfig: { widgetSlots: [{ widgetId: headerWidget.id, column: 0 }] },
        })]);
        getNodesMock.mockResolvedValue([]);
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'online', lastSuccess: null, ageMs: null },
            machines: [],
            isLoading: false,
            isError: false,
        });
        startExporterMock.mockReset().mockReturnValue(vi.fn());
        vi.stubGlobal('ResizeObserver', ImmediateResizeObserver);
    });

    it('retires the old frame exporter immediately when navigating away from its visible widgets', async () => {
        const initial = await getDashboardsMock();
        getDashboardsMock.mockResolvedValue([
            ...initial,
            makeDashboard({ id: 'empty-view', status: 'published', widgets: [], layout: [] }),
        ]);
        const oldStop = vi.fn();
        const newStop = vi.fn();
        startExporterMock.mockClear();
        startExporterMock.mockReturnValueOnce(oldStop).mockReturnValue(newStop);
        const view = render(
            <MemoryRouter>
                <Link to="/?dashboardId=empty-view">Open empty view</Link>
                <Routes><Route path="/" element={<Dashboard />} /></Routes>
            </MemoryRouter>,
        );
        await waitFor(() => expect(screen.getByText('Grid metric')).toBeInTheDocument());
        await waitFor(() => expect(startExporterMock).toHaveBeenCalled());
        const first = startExporterMock.mock.calls[0][0] as DashboardSnapshotExporterOptions;
        await waitFor(() => expect(first.getSnapshot()).not.toBeNull());

        fireEvent.click(screen.getByRole('link', { name: 'Open empty view' }));

        // Retirement is the immediate invalidation seam; no five-second tick.
        await waitFor(() => expect(oldStop).toHaveBeenCalledOnce());
        await waitFor(() => expect(screen.queryByText('Grid metric')).not.toBeInTheDocument());
        const current = startExporterMock.mock.calls.at(-1)![0] as DashboardSnapshotExporterOptions;
        expect(current).not.toBe(first);
        expect(current.getSnapshot()).toMatchObject({ widgets: [] });
        view.unmount();
        expect(newStop).toHaveBeenCalled();
    });

    it('feeds the real viewer and compact header into one frame-backed snapshot independent of DOM appearance', async () => {
        render(
            <MemoryRouter initialEntries={['/?prismaMode=local']}>
                <Routes><Route path="/" element={<Dashboard />} /></Routes>
            </MemoryRouter>,
        );

        await waitFor(() => expect(screen.getByTestId('dashboard-viewer-root')).toBeInTheDocument());
        await waitFor(() => expect(startExporterMock).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('Grid metric')).toBeInTheDocument());

        const exporter = startExporterMock.mock.calls[0]?.[0] as { getSnapshot: () => { widgets: Array<{ id: string; value: unknown }> } | null };
        await waitFor(() => expect(exporter.getSnapshot()).not.toBeNull());
        const beforeDomMutation = exporter.getSnapshot();
        if (!beforeDomMutation) throw new Error('Expected a materialized presentation snapshot.');
        expect(beforeDomMutation.widgets).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'header-status', value: 'warning' }),
            expect.objectContaining({ id: 'grid-metric', value: 42 }),
        ]));

        const gridTitle = screen.getByText('Grid metric');
        gridTitle.textContent = 'DOM-only mutation';

        expect(exporter.getSnapshot()?.widgets).toEqual(beforeDomMutation.widgets);
    });
});
