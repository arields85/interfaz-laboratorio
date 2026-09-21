import { StrictMode, type ComponentProps } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDashboardSnapshotExportStateForTests } from '../services/dashboardSnapshotExport.service';
import { prismaSessionClient } from '../services/prismaSessionClient';
import { useDashboardPresentationFrame } from '../services/dashboardPresentationFrame.service';
import type { ProdHistoryWidgetConfig } from '../domain/admin.types';
import { ProductionHistoryPresentationController } from '../widgets/controllers/PresentationControllers';
import { makeDashboard, makeWidget } from '../test/fixtures/dashboard.fixture';
import Dashboard from './Dashboard';

const { dashboardStorageMock, hierarchyStorageMock, useDataOverviewMock } = vi.hoisted(() => ({
    dashboardStorageMock: { getDashboards: vi.fn(), persistPublishedWidgetDisplayOptions: vi.fn() },
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
// Viewer shells isolate navigation/render cost; session, exporter and frame stay real.
vi.mock('../components/viewer/DashboardHeader', () => ({
    default: function Header(props: ComponentProps<typeof import('../components/viewer/DashboardHeader').default>) {
        const frame = useDashboardPresentationFrame();
        return <>
            <div>Runtime header</div>
            <output data-testid="runtime-frame">{JSON.stringify({
                dashboardId: frame.dashboardId, viewId: frame.viewId,
                profileRevision: frame.profileRevision, ready: frame.ready,
            })}</output>
            <button onClick={() => props.onNavigateDashboard?.('next-dashboard')}>Next dashboard</button>
            <button onClick={() => props.onNavigateDashboard?.('runtime-dashboard')}>Original dashboard</button>
        </>;
    },
}));
vi.mock('../components/viewer/DashboardViewer', () => ({
    default: (props: ComponentProps<typeof import('../components/viewer/DashboardViewer').default>) => <div data-testid="runtime-dashboard-viewer">
        Runtime viewer
        {props.widgets.filter(widget => widget.type === 'prod-history').map(widget => (
            <ProductionHistoryPresentationController
                key={widget.id} widget={widget} equipmentMap={props.equipmentMap}
                render={() => null}
            />
        ))}
        <button onClick={() => props.onPersistWidgetDisplayOptions?.('history', { productionChartMode: 'area' })}>Save display profile</button>
    </div>,
}));

describe('Dashboard unified Prisma exporter integration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        prismaSessionClient.reset({ close: false });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
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

    afterEach(async () => {
        resetDashboardSnapshotExportStateForTests();
        await vi.advanceTimersByTimeAsync(0);
        prismaSessionClient.reset({ close: false });
        localStorage.clear();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
        vi.restoreAllMocks();
    });

    it('exports one frame-ready snapshot to the fixed route while leaving legacy settings inert', async () => {
        const fetchMock = vi.fn<typeof fetch>()
            .mockResolvedValueOnce(new Response(
                JSON.stringify({ ok: true, idleExpiresAt: 1, absoluteExpiresAt: 2 }),
                { status: 201, headers: { 'Content-Type': 'application/json', 'X-Prisma-Session-Capability': SESSION_CAPABILITY } },
            ))
            .mockImplementation(async () => new Response(null, { status: 202 }));
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
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
            version: 1, command: 'publish', order: expect.any(Number), snapshot: expect.objectContaining({ widgets: [] }),
        });
        expect(localStorage.getItem('hmi:prisma-runtime-mode')).toBe('central');
        expect(localStorage.getItem('hmi:snapshot-export-endpoint')).toBe('https://legacy.invalid/snapshot');
        view.unmount();
    });

    it.each([false, true])('invalidates a changed view before the next tick and captures only its ready successor (unready=%s)', async (unready) => {
        dashboardStorageMock.getDashboards.mockResolvedValue([
            makeDashboard({ id: 'runtime-dashboard', status: 'published', widgets: [] }),
            makeDashboard({ id: 'next-dashboard', status: 'published', widgets: unready ? [makeWidget()] : [] }),
        ]);
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => (
            path === '/api/prisma/session'
                ? new Response(JSON.stringify({ ok: true, idleExpiresAt: 1, absoluteExpiresAt: 2 }), {
                    status: 201, headers: { 'X-Prisma-Session-Capability': SESSION_CAPABILITY },
                })
                : new Response(null, { status: 202 })
        ));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(<MemoryRouter><Dashboard /></MemoryRouter>);
        await act(async () => vi.advanceTimersByTimeAsync(0));
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        const commands = () => fetchMock.mock.calls.filter(([path]) => path === '/api/prisma/snapshot')
            .map(([, init]) => JSON.parse(String(init?.body)));
        expect(commands().at(-1)?.command).toBe('publish');
        const firstOrder = commands().at(-1).order;

        fireEvent.click(screen.getByRole('button', { name: 'Next dashboard' }));
        await act(async () => vi.advanceTimersByTimeAsync(0));
        expect(commands().at(-1)).toEqual({ version: 1, command: 'invalidate', order: firstOrder + 1 });
        const afterNavigation = commands().length;
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        if (unready) {
            expect(commands()).toHaveLength(afterNavigation);
            fireEvent.click(screen.getByRole('button', { name: 'Original dashboard' }));
            await act(async () => vi.advanceTimersByTimeAsync(5_000));
        }
        expect(commands().at(-1)?.command).toBe('publish');
        expect(commands().at(-1)?.order).toBeGreaterThan(firstOrder + 1);
        view.unmount();
    });

    it('StrictMode cleanup and unmount cannot close the replacement document session', async () => {
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => (
            path === '/api/prisma/session'
                ? new Response(JSON.stringify({ ok: true, idleExpiresAt: 1, absoluteExpiresAt: 2 }), {
                    status: 201, headers: { 'X-Prisma-Session-Capability': SESSION_CAPABILITY },
                })
                : new Response(null, { status: 202 })
        ));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(<StrictMode><MemoryRouter><Dashboard /></MemoryRouter></StrictMode>);
        await act(async () => vi.advanceTimersByTimeAsync(0));
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        const publications = fetchMock.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).command === 'publish');
        expect(publications).toHaveLength(1);
        view.unmount();
        await act(async () => vi.advanceTimersByTimeAsync(0));
        const last = fetchMock.mock.calls.at(-1);
        expect(last?.[0]).toBe('/api/prisma/snapshot');
        expect(JSON.parse(String(last?.[1]?.body))).toMatchObject({ version: 1, command: 'invalidate' });
        expect(last?.[1]?.signal?.aborted).toBe(false);
        expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
        const count = fetchMock.mock.calls.length;
        await act(async () => vi.advanceTimersByTimeAsync(10_000));
        expect(fetchMock).toHaveBeenCalledTimes(count);
    });

    it('changes the real frame profile identity after a persisted display-profile edit in the same view', async () => {
        const widget: ProdHistoryWidgetConfig = {
            id: 'history', type: 'prod-history', title: 'History',
            position: { x: 0, y: 0 }, size: { w: 4, h: 3 },
            displayOptions: { productionChartMode: 'bars' },
        };
        const dashboard = makeDashboard({ id: 'runtime-dashboard', status: 'published', widgets: [widget] });
        dashboardStorageMock.getDashboards.mockResolvedValue([dashboard]);
        dashboardStorageMock.persistPublishedWidgetDisplayOptions.mockResolvedValue({
            ...dashboard, widgets: [{ ...widget, displayOptions: { productionChartMode: 'area' } }],
        });
        const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (path) => (
            path === '/api/prisma/session'
                ? new Response(JSON.stringify({ ok: true, idleExpiresAt: 1, absoluteExpiresAt: 2 }), {
                    status: 201, headers: { 'X-Prisma-Session-Capability': SESSION_CAPABILITY },
                })
                : new Response(null, { status: 202 })
        ));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(<MemoryRouter><Dashboard /></MemoryRouter>);
        await act(async () => vi.advanceTimersByTimeAsync(0));
        const before = JSON.parse(screen.getByTestId('runtime-frame').textContent!);
        expect(before.ready).toBe(true);
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        const commands = () => fetchMock.mock.calls.filter(([path]) => path === '/api/prisma/snapshot')
            .map(([, init]) => JSON.parse(String(init?.body)));
        expect(commands().at(-1)?.command).toBe('publish');
        const priorOrder = commands().at(-1).order;
        fireEvent.click(screen.getByRole('button', { name: 'Save display profile' }));
        await act(async () => vi.advanceTimersByTimeAsync(0));
        const after = JSON.parse(screen.getByTestId('runtime-frame').textContent!);
        expect(dashboardStorageMock.persistPublishedWidgetDisplayOptions).toHaveBeenCalledWith(
            'runtime-dashboard', before.viewId, 'history', { productionChartMode: 'area' },
        );
        expect(after.dashboardId).toBe(before.dashboardId);
        expect(after.viewId).toBe(before.viewId);
        expect(Number.isSafeInteger(after.profileRevision)).toBe(true);
        expect(after.profileRevision).toBeGreaterThan(before.profileRevision);
        expect(after.ready).toBe(true);
        expect(commands().at(-1)).toMatchObject({ command: 'invalidate' });
        expect(commands().at(-1)?.order).toBeGreaterThan(priorOrder);
        await act(async () => vi.advanceTimersByTimeAsync(5_000));
        expect(commands().at(-1)).toMatchObject({
            command: 'publish', snapshot: { widgets: [expect.objectContaining({ id: 'history' })] },
        });
        view.unmount();
    });
});
