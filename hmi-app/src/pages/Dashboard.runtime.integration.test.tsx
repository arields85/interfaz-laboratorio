import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDashboardSnapshotExportStateForTests } from '../services/dashboardSnapshotExport.service';
import { makeDashboard } from '../test/fixtures/dashboard.fixture';
import Dashboard from './Dashboard';

const { dashboardStorageMock, hierarchyStorageMock, useDataOverviewMock } = vi.hoisted(() => ({
    dashboardStorageMock: { getDashboards: vi.fn() },
    hierarchyStorageMock: { getNodes: vi.fn() },
    useDataOverviewMock: vi.fn(),
}));
const SESSION_CAPABILITY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

vi.mock('../services/DashboardStorageService', () => ({ dashboardStorage: dashboardStorageMock }));
vi.mock('../services/HierarchyStorageService', () => ({ hierarchyStorage: hierarchyStorageMock }));
vi.mock('../queries/useDataOverview', () => ({ useDataOverview: useDataOverviewMock }));
vi.mock('../components/viewer/DashboardHeader', () => ({ default: () => <div>Runtime header</div> }));
vi.mock('../components/viewer/DashboardViewer', () => ({
    default: () => <div data-testid="runtime-dashboard-viewer">Runtime viewer</div>,
}));

describe('Dashboard unified Prisma exporter integration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        localStorage.setItem('hmi:prisma-runtime-mode', 'central');
        localStorage.setItem('hmi:snapshot-export-endpoint', 'https://legacy.invalid/snapshot');
        localStorage.setItem('hmi:snapshot-export-enabled', 'false');
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({ id: 'runtime-dashboard', status: 'published', widgets: [], layout: [] }),
        ]);
        hierarchyStorageMock.getNodes.mockResolvedValue([]);
        useDataOverviewMock.mockReturnValue({
            connection: { globalStatus: 'online', lastSuccess: null, ageMs: null },
            machines: [],
            isLoading: false,
            isError: false,
        });
    });

    afterEach(() => {
        resetDashboardSnapshotExportStateForTests();
        localStorage.clear();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('exports one frame-ready snapshot to the fixed route while leaving legacy settings inert', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(
                JSON.stringify({ ok: true, idleExpiresAt: 1, absoluteExpiresAt: 2 }),
                { status: 201, headers: { 'Content-Type': 'application/json', 'X-Prisma-Session-Capability': SESSION_CAPABILITY } },
            ))
            .mockResolvedValueOnce(new Response(null, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(
            <MemoryRouter initialEntries={['/?prismaMode=local']}>
                <Routes><Route path="/" element={<Dashboard />} /></Routes>
            </MemoryRouter>,
        );
        await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
        expect(screen.getByTestId('runtime-dashboard-viewer')).toBeInTheDocument();

        await act(async () => vi.advanceTimersByTimeAsync(5_000));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/prisma/session');
        expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/prisma/snapshot');
        expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('X-Prisma-Session-Capability')).toBe(SESSION_CAPABILITY);
        expect(localStorage.getItem('hmi:prisma-runtime-mode')).toBe('central');
        expect(localStorage.getItem('hmi:snapshot-export-endpoint')).toBe('https://legacy.invalid/snapshot');
        view.unmount();
    });
});
