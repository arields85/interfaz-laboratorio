import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSession, Permission } from '../domain';

vi.mock('../layouts/MainLayout', async () => {
    const { Outlet } = await import('react-router-dom');

    return {
        default: function MockMainLayout() {
            return (
                <div>
                    <span>Main layout</span>
                    <Outlet />
                </div>
            );
        },
    };
});

vi.mock('../layouts/AdminLayout', async () => {
    const { Outlet } = await import('react-router-dom');

    return {
        default: function MockAdminLayout() {
            return (
                <div>
                    <span>Admin layout</span>
                    <Outlet />
                </div>
            );
        },
    };
});

vi.mock('../pages/Dashboard', () => ({ default: () => <div>Dashboard viewer</div> }));
vi.mock('../pages/EquipmentDetail', () => ({ default: () => <div>Equipment detail</div> }));
vi.mock('../pages/AlertsPage', () => ({ default: () => <div>Alerts page</div> }));
vi.mock('../pages/TrendsPage', () => ({ default: () => <div>Trends page</div> }));
vi.mock('../pages/ExplorerPage', () => ({ default: () => <div>Explorer page</div> }));
vi.mock('../pages/TraceabilityPage', () => ({ default: () => <div>Traceability page</div> }));
vi.mock('../pages/OverviewPage', () => ({ default: () => <div>Overview page</div> }));
vi.mock('../pages/DiagnosticsPage', () => ({ default: () => <div>Diagnostics page</div> }));
vi.mock('../pages/LogsPage', () => ({ default: () => <div>Logs page</div> }));
vi.mock('../components/viewer/eppi/EppiViewer', () => ({ default: () => <div>EPPI viewer</div> }));
vi.mock('../pages/admin/DashboardManagerPage', () => ({ default: () => <div>Admin dashboards</div> }));
vi.mock('../pages/admin/DashboardBuilderPage', () => ({ default: () => <div>Admin builder</div> }));
vi.mock('../pages/admin/HierarchyPage', () => ({ default: () => <div>Admin hierarchy</div> }));

type AuthStoreState = {
    session: AuthSession;
    isHydrated: boolean;
    hasPermission: (permission: Permission) => boolean;
};

const unauthenticatedSession: AuthSession = {
    user: null,
    isAuthenticated: false,
    loginTimestamp: null,
};

const authStoreMock = vi.hoisted(() => {
    let state: AuthStoreState = {
        session: {
            user: null,
            isAuthenticated: false,
            loginTimestamp: null,
        },
        isHydrated: true,
        hasPermission: () => false,
    };

    const store = Object.assign(
        vi.fn(<T,>(selector: (currentState: AuthStoreState) => T) => selector(state)),
        {
            getState: () => state,
            setState: (nextState: AuthStoreState) => {
                state = nextState;
            },
        },
    );

    return { store };
});

vi.mock('../store/auth.store', () => ({
    useAuthStore: authStoreMock.store,
}));

async function renderRouterAt(pathname: string) {
    window.history.replaceState({}, '', pathname);
    const { default: AppRouter } = await import('./router');

    return render(<AppRouter />);
}

describe('AppRouter admin guard', () => {
    beforeEach(() => {
        vi.resetModules();
        authStoreMock.store.setState({
            session: unauthenticatedSession,
            isHydrated: true,
            hasPermission: () => false,
        });
        window.history.replaceState({}, '', '/');
    });

    it('redirects direct /admin/dashboards access when no authenticated admin exists', async () => {
        await renderRouterAt('/admin/dashboards');

        expect(await screen.findByText('Dashboard viewer')).toBeInTheDocument();
        expect(screen.queryByText('Admin dashboards')).not.toBeInTheDocument();
    });

    it('redirects direct /admin/hierarchy access for viewer-only sessions', async () => {
        authStoreMock.store.setState({
            session: {
                user: {
                    id: 'user-viewer',
                    username: 'usuario',
                    displayName: 'Visualizador',
                    role: {
                        id: 'role-viewer',
                        name: 'Viewer',
                        permissions: ['viewer:access'],
                    },
                },
                isAuthenticated: true,
                loginTimestamp: '2026-04-28T18:00:00.000Z',
            },
            isHydrated: true,
            hasPermission: () => false,
        });

        await renderRouterAt('/admin/hierarchy');

        expect(await screen.findByText('Dashboard viewer')).toBeInTheDocument();
        expect(screen.queryByText('Admin hierarchy')).not.toBeInTheDocument();
    });

    it('renders EPPI deep links inside the persistent main layout', async () => {
        await renderRouterAt('/eppi/logbook?page=2');

        expect(await screen.findByText('Main layout')).toBeInTheDocument();
        expect(screen.getByText('EPPI viewer')).toBeInTheDocument();
        expect(window.location.pathname).toBe('/eppi/logbook');
        expect(window.location.search).toBe('?page=2');
    });
});
