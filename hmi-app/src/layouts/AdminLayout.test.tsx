import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminLayout from './AdminLayout';

const { logoutMock, navigateMock } = vi.hoisted(() => ({
    logoutMock: vi.fn(),
    navigateMock: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
    Outlet: () => <div data-testid="admin-layout-outlet" />,
    NavLink: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    useLocation: () => ({ pathname: '/admin/dashboards' }),
    useNavigate: () => navigateMock,
}));

vi.mock('../components/admin/GlobalSettingsDialog', () => ({
    default: ({ open }: { open: boolean }) => (
        open ? <div data-testid="global-settings-dialog">Configuracion abierta</div> : null
    ),
}));

vi.mock('../utils/adminNavigation', () => ({
    ADMIN_SECTIONS: [
        { key: 'dashboards', navTo: '/admin/dashboards', label: 'Dashboards' },
        { key: 'settings', navTo: '/admin/settings', label: 'Settings' },
    ],
    getAdminSectionByPath: () => ({ key: 'dashboards' }),
}));

vi.mock('../store/auth.store', () => ({
    useAuthStore: (selector: (state: {
        session: { user?: { displayName?: string } };
        logout: typeof logoutMock;
    }) => unknown) => selector({
        session: { user: { displayName: 'Admin Test' } },
        logout: logoutMock,
    }),
}));

describe('AdminLayout', () => {
    it('logs out without imperatively navigating because the auth guard owns the redirect', () => {
        render(<AdminLayout />);

        fireEvent.click(screen.getByRole('button', { name: /cerrar sesion/i }));

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it('opens the global settings dialog from the admin toolbar and renders inactive sections separately', () => {
        render(<AdminLayout />);

        fireEvent.click(screen.getByRole('button', { name: /configuracion general/i }));

        expect(screen.getByTestId('global-settings-dialog')).toBeInTheDocument();
        expect(screen.getByText('Dashboards')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });
});
