import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { clearLoaderOptionsConfig, saveLoaderOptionsConfig } from '../config/loaderOptions.config';
import AdminLayout from './AdminLayout';
import { SHIELD_REVEAL_REQUEST_EVENT } from '../hooks/useBootShield';

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

vi.mock('../components/admin/AdminPasswordChangeDialog', () => ({
    default: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
        open ? <button type="button" data-testid="password-change-dialog" onClick={onClose}>Cambio abierto</button> : null
    ),
}));

vi.mock('../components/admin/SharedConfigSaveNotice', () => ({
    default: () => <div data-testid="shared-config-save-notice" />,
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
    }) => unknown) => selector({
        session: { user: { displayName: 'Admin Test' } },
    }),
}));

vi.mock('../services/adminSession.controller', () => ({
    adminSessionController: { exit: logoutMock },
}));

function mountBootShield() {
    const shield = document.createElement('div');
    shield.id = 'hmi-shield';
    shield.className = 'hmi-shield--hidden';
    shield.setAttribute('data-hmi-shield-state', 'hidden');
    shield.setAttribute('aria-hidden', 'true');
    document.body.appendChild(shield);
    return shield;
}

describe('AdminLayout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearLoaderOptionsConfig();
        document.body.innerHTML = '';
    });

    it('mounts the shared configuration save notice below the admin header', () => {
        render(<AdminLayout />);

        const notice = screen.getByTestId('shared-config-save-notice');
        const header = screen.getByRole('banner');
        expect(header.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(header).not.toContainElement(notice);
    });

    it('logs out immediately without revealing the runtime long loader when that profile is disabled', () => {
        saveLoaderOptionsConfig({
            short: { enabled: true, durationSeconds: 2 },
            long: { enabled: false, durationSeconds: 8 },
        });

        const revealRequestSpy = vi.fn();
        mountBootShield();
        document.addEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);

        render(<AdminLayout />);

        fireEvent.click(screen.getByRole('button', { name: /cerrar sesion/i }));

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(revealRequestSpy).not.toHaveBeenCalled();

        document.removeEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);
    });

    it('logs out without imperatively navigating because the auth guard owns the redirect', () => {
        const revealRequestSpy = vi.fn();
        mountBootShield();
        document.addEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);

        render(<AdminLayout />);

        fireEvent.click(screen.getByRole('button', { name: /cerrar sesion/i }));

        expect(logoutMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).not.toHaveBeenCalled();
        expect(revealRequestSpy).toHaveBeenCalledTimes(1);
        expect(revealRequestSpy.mock.calls[0]?.[0]).toMatchObject({
            detail: {
                profileId: 'long',
                runner: 'original-long',
                allowNoContentExtension: true,
                restartCycle: true,
            },
        });

        document.removeEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);
    });

    it('navigates to the viewer without ending the admin session, so returning to /admin stays authenticated', () => {
        // "Ver viewer" only opens the read-only viewer; unlike "Cerrar sesion" it must never
        // call controller.exit(), which revokes the server session and clears the auth store.
        // The '/' route carries no permission guard, so the admin session staying alive here
        // does not leak into viewer behavior, and RequirePermission on '/admin' still redirects
        // an unauthenticated visitor exactly as before.
        render(<AdminLayout />);

        fireEvent.click(screen.getByRole('button', { name: /ver viewer/i }));

        expect(navigateMock).toHaveBeenCalledWith('/');
        expect(logoutMock).not.toHaveBeenCalled();
    });

    it('opens the password change dialog from the admin toolbar without ending the session', () => {
        render(<AdminLayout />);
        expect(screen.queryByTestId('password-change-dialog')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

        expect(screen.getByTestId('password-change-dialog')).toBeInTheDocument();
        expect(logoutMock).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('password-change-dialog'));

        expect(screen.queryByTestId('password-change-dialog')).not.toBeInTheDocument();
    });

    it('opens the global settings dialog from the admin toolbar and renders inactive sections separately', () => {
        render(<AdminLayout />);

        fireEvent.click(screen.getByRole('button', { name: /configuracion general/i }));

        expect(screen.getByTestId('global-settings-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('admin-layout-outlet')).toBeInTheDocument();
        expect(screen.getByText('Dashboards')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });
});
