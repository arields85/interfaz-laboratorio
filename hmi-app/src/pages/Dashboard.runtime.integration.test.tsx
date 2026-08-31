import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { savePrismaRuntimeMode } from '../config/prismaRuntime.config';
import { resetDashboardSnapshotExportStateForTests } from '../services/dashboardSnapshotExport.service';
import { makeDashboard } from '../test/fixtures/dashboard.fixture';
import Dashboard from './Dashboard';

const { dashboardStorageMock, hierarchyStorageMock, useDataOverviewMock } = vi.hoisted(() => ({
    dashboardStorageMock: { getDashboards: vi.fn() },
    hierarchyStorageMock: { getNodes: vi.fn() },
    useDataOverviewMock: vi.fn(),
}));

vi.mock('../services/DashboardStorageService', () => ({ dashboardStorage: dashboardStorageMock }));
vi.mock('../services/HierarchyStorageService', () => ({ hierarchyStorage: hierarchyStorageMock }));
vi.mock('../queries/useDataOverview', () => ({ useDataOverview: useDataOverviewMock }));
vi.mock('../components/viewer/DashboardHeader', () => ({ default: () => <div>Runtime header</div> }));
vi.mock('../components/viewer/DashboardViewer', () => ({
    default: () => <div data-testid="runtime-dashboard-viewer">Runtime viewer</div>,
}));

async function flushDashboardLoad(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('Dashboard Prisma runtime exporter integration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        localStorage.setItem('hmi:node-red-base-url', 'https://192.168.50.250:51880');
        localStorage.setItem('hmi:snapshot-export-endpoint', '/hmi/current-snapshot');
        localStorage.setItem('hmi:snapshot-export-enabled', 'true');
        localStorage.setItem('hmi:snapshot-export-interval-ms', '5000');
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

    it('aborts Server permanently, exports once to Local, and restores one Server owner', async () => {
        const centralSignals: AbortSignal[] = [];
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === 'http://127.0.0.1:5057/hmi/current-snapshot') {
                return Promise.resolve({ ok: true, status: 202 } as Response);
            }

            const signal = init?.signal as AbortSignal;
            centralSignals.push(signal);
            return new Promise<Response>((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason));
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const view = render(
            <MemoryRouter initialEntries={['/']}>
                <Routes><Route path="/" element={<Dashboard />} /></Routes>
            </MemoryRouter>,
        );
        await flushDashboardLoad();
        expect(screen.getByTestId('runtime-dashboard-viewer')).toBeInTheDocument();

        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        expect(fetchMock.mock.calls[0]?.[0]).toBe('https://192.168.50.250:51880/hmi/current-snapshot');
        expect(centralSignals[0]?.aborted).toBe(false);

        act(() => savePrismaRuntimeMode('local'));
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(centralSignals[0]?.aborted).toBe(true);

        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('192.168.50.250'))).toHaveLength(1);
        expect(fetchMock.mock.calls.filter(([url]) => url === 'http://127.0.0.1:5057/hmi/current-snapshot')).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(1);

        act(() => savePrismaRuntimeMode('central'));
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('192.168.50.250'))).toHaveLength(2);
        expect(fetchMock.mock.calls.filter(([url]) => url === 'http://127.0.0.1:5057/hmi/current-snapshot')).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(2);

        view.unmount();
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(centralSignals[1]?.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});
