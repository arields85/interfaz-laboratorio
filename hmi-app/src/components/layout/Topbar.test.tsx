import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLoaderOptionsConfig, saveLoaderOptionsConfig } from '../../config/loaderOptions.config';
import type { AuthSession } from '../../domain';
import { AUTH_SESSION_STORAGE_KEY, useAuthStore } from '../../store/auth.store';

const sessionControllerMock = vi.hoisted(() => ({
    login: vi.fn(),
    refresh: vi.fn(),
    exit: vi.fn(),
}));

vi.mock('../../services/adminSession.controller', () => ({ adminSessionController: sessionControllerMock }));
import { useUIStore } from '../../store/ui.store';
import { setHiddenAccessRevealed } from '../../services/hiddenAccess.service';
import { useHiddenAccessShortcut } from '../../hooks/useHiddenAccessShortcut';
import Topbar from './Topbar';
import { SHIELD_REVEAL_REQUEST_EVENT } from '../../hooks/useBootShield';

const { hierarchyStorageMock, dashboardStorageMock } = vi.hoisted(() => ({
    hierarchyStorageMock: {
        getNodes: vi.fn(),
    },
    dashboardStorageMock: {
        getDashboards: vi.fn(),
    },
}));

vi.mock('../../services/HierarchyStorageService', () => ({
    hierarchyStorage: hierarchyStorageMock,
}));

vi.mock('../../services/DashboardStorageService', () => ({
    dashboardStorage: dashboardStorageMock,
}));

vi.mock('./ShaderSettingsPanel', () => ({
    default: () => null,
}));

// Isolation mock only: the real control is covered by LedaPairingControl.test.tsx. The fake
// is never rendered unconditionally at the root — it only appears where Topbar itself mounts
// the control, so an un-integrated source fails the wiring assertions below instead of
// passing through the mock.
vi.mock('./LedaPairingControl', () => ({
    default: () => (
        <button
            type="button"
            aria-label="Leda"
            title="Leda"
            aria-haspopup="dialog"
            aria-expanded="false"
        >
            Leda
        </button>
    ),
}));

const unauthenticatedSession: AuthSession = {
    user: null,
    isAuthenticated: false,
    loginTimestamp: null,
};

const adminSession: AuthSession = {
    user: {
        id: 'user-admin',
        username: 'admin',
        displayName: 'Administrador',
        role: {
            id: 'role-admin',
            name: 'Admin',
            permissions: ['viewer:access', 'admin:access'],
        },
    },
    isAuthenticated: true,
    loginTimestamp: '2026-04-28T18:00:00.000Z',
};

function mountBootShield() {
    const shield = document.createElement('div');
    shield.id = 'hmi-shield';
    shield.className = 'hmi-shield--hidden';
    shield.setAttribute('data-hmi-shield-state', 'hidden');
    shield.setAttribute('aria-hidden', 'true');
    document.body.appendChild(shield);
    return shield;
}

function LocationIndicator() {
    const location = useLocation();

    return <div data-testid="current-path">{`${location.pathname}${location.search}`}</div>;
}

function HistoryControls() {
    const navigate = useNavigate();

    return (
        <>
            <button type="button" onClick={() => navigate(-1)}>Atrás</button>
            <button type="button" onClick={() => navigate(1)}>Adelante</button>
        </>
    );
}

function renderTopbar(initialEntry: string | { pathname: string; state?: unknown } = '/') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Topbar />
            <LocationIndicator />
            <HistoryControls />
        </MemoryRouter>,
    );
}

function ShortcutHost() {
    useHiddenAccessShortcut();
    return null;
}

const REVEAL_COMBINATION = { code: 'KeyA', key: 'a', ctrlKey: true, altKey: true } as const;

describe('Topbar', () => {
    beforeEach(() => {
        localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
        // The existing behavior is exercised with the hidden access revealed.
        setHiddenAccessRevealed(true);
        clearLoaderOptionsConfig();
        hierarchyStorageMock.getNodes.mockResolvedValue([]);
        dashboardStorageMock.getDashboards.mockResolvedValue([]);
        useUIStore.setState({
            selectedPlantId: null,
            selectedAreaId: null,
            selectedEquipmentId: null,
        });
        useAuthStore.setState({
            session: unauthenticatedSession,
            isHydrated: true,
            isAuthenticating: false,
            error: null,
        });
        sessionControllerMock.login.mockImplementation(async () => {
            useAuthStore.setState({ session: adminSession, isHydrated: true, isAuthenticating: false, error: null });
            return { ok: true as const, user: adminSession.user! };
        });
        sessionControllerMock.refresh.mockResolvedValue(undefined);
        sessionControllerMock.exit.mockResolvedValue(undefined);
    });

    it('hides admin-only actions until auth hydration completes', () => {
        useAuthStore.setState({
            session: adminSession,
            isHydrated: false,
            isAuthenticating: false,
            error: null,
        });

        renderTopbar('/explorer');

        expect(screen.queryByTitle('Personalizar fondo')).not.toBeInTheDocument();
        expect(screen.queryByTitle('Administracion')).not.toBeInTheDocument();
        expect(screen.getByTitle('Usuario')).toBeInTheDocument();
    });

    it('keeps the viewer route and swaps in admin actions after successful admin login', async () => {
        const user = userEvent.setup();

        renderTopbar('/explorer');

        await user.click(screen.getByTitle('Usuario'));
        await user.type(screen.getByLabelText('Usuario'), 'admin');
        await user.type(screen.getByLabelText('Contraseña'), '7trebol');
        await user.click(screen.getByRole('button', { name: 'Ingresar' }));

        await waitFor(() => {
            expect(screen.getByTitle('Personalizar fondo')).toBeInTheDocument();
        });

        expect(screen.getByTitle('Administracion')).toBeInTheDocument();
        expect(screen.getByTestId('current-path')).toHaveTextContent('/explorer');
        expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument();
    });

    it('navigates Home to the selected plant main dashboard when the plant links a published dashboard', async () => {
        const user = userEvent.setup();

        useUIStore.getState().setSelectedPlant('node-plant-01');
        hierarchyStorageMock.getNodes.mockResolvedValue([
            {
                id: 'node-plant-01',
                name: 'Planta Demo',
                type: 'plant',
                parentId: null,
                order: 0,
                linkedDashboardId: 'dash-main',
            },
        ]);
        dashboardStorageMock.getDashboards.mockResolvedValue([
            {
                id: 'dash-main',
                status: 'published',
            },
        ]);

        renderTopbar('/explorer');

        await user.click(screen.getByTitle('Visión General'));

        await waitFor(() => {
            expect(screen.getByTestId('current-path')).toHaveTextContent('/?dashboardId=dash-main');
        });
    });

    it('renders central non-Home navigation buttons as disabled muted controls while Home remains clickable', async () => {
        const user = userEvent.setup();

        renderTopbar('/explorer');

        const disabledNavLabels = [
            'Explorador',
            'Tendencias',
            'Alarmas',
            'Trazabilidad',
            'Overview',
            'Diagnostics',
            'Logs',
        ];

        for (const label of disabledNavLabels) {
            const button = screen.getByRole('button', { name: label });
            expect(button).toBeDisabled();
            expect(button).toHaveClass('cursor-default');
            expect(button).toHaveClass('text-industrial-muted/50');
        }

        const homeButton = screen.getByRole('button', { name: 'Visión General' });
        expect(homeButton).toBeEnabled();
        expect(homeButton).not.toHaveClass('cursor-default');
        expect(homeButton).not.toHaveClass('text-industrial-muted/50');

        await user.click(homeButton);

        await waitFor(() => {
            expect(screen.getByTestId('current-path')).toHaveTextContent('/');
        });
    });

    it('renders notifications as a disabled muted control without the red status dot', () => {
        const { container } = renderTopbar('/explorer');

        const notificationsButton = screen.getByRole('button', { name: 'Notificaciones' });
        expect(notificationsButton).toBeDisabled();
        expect(notificationsButton).toHaveClass('cursor-default');
        expect(notificationsButton).toHaveClass('text-industrial-muted/50');
        expect(container.querySelector('.led-glow-red')).not.toBeInTheDocument();
    });

    it('hides Core-only notifications while keeping the EPPI profile actions', () => {
        useAuthStore.setState({
            session: adminSession,
            isHydrated: true,
            isAuthenticating: false,
            error: null,
        });
        renderTopbar('/eppi/orders');

        expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
        expect(screen.getByTitle('Personalizar fondo')).toBeInTheDocument();
        expect(screen.getByTitle('Administracion')).toBeInTheDocument();
        expect(screen.getByTitle('Usuario')).toBeInTheDocument();
    });

    it('enters EPPI from the brand while preserving the exact CoreAnalytics location', async () => {
        const user = userEvent.setup();

        renderTopbar('/equipment/reactor-1?tab=telemetry&range=8h');

        await user.click(screen.getByRole('button', { name: 'Abrir EPPI' }));

        expect(screen.getByTestId('current-path')).toHaveTextContent('/eppi/orders');
        expect(screen.getByRole('button', { name: 'Volver a CoreAnalytics' })).toHaveTextContent('EPPI');
        expect(screen.getByRole('navigation', { name: 'Navegación EPPI' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Visión General' })).not.toBeInTheDocument();
    });

    it('returns from EPPI to the captured CoreAnalytics pathname and query', async () => {
        const user = userEvent.setup();

        renderTopbar({
            pathname: '/eppi/tools',
            state: { coreReturnTo: '/alerts?severity=critical' },
        });

        await user.click(screen.getByRole('button', { name: 'Volver a CoreAnalytics' }));

        expect(screen.getByTestId('current-path')).toHaveTextContent('/alerts?severity=critical');
    });

    it('falls back to the CoreAnalytics root for an EPPI deep link without prior Core state', async () => {
        const user = userEvent.setup();

        renderTopbar('/eppi/orders');

        await user.click(screen.getByRole('button', { name: 'Volver a CoreAnalytics' }));

        expect(screen.getByTestId('current-path')).toHaveTextContent('/');
    });

    it('derives mode coherently while traversing browser history', async () => {
        const user = userEvent.setup();

        renderTopbar('/alerts?severity=warning');
        await user.click(screen.getByRole('button', { name: 'Abrir EPPI' }));

        await user.click(screen.getByRole('button', { name: 'Atrás' }));
        expect(screen.getByTestId('current-path')).toHaveTextContent('/alerts?severity=warning');
        expect(screen.getByRole('button', { name: 'Abrir EPPI' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Adelante' }));
        expect(screen.getByTestId('current-path')).toHaveTextContent('/eppi/orders');
        expect(screen.getByRole('button', { name: 'Volver a CoreAnalytics' })).toBeInTheDocument();
    });

    it('keeps the current Home fallback when no plant main dashboard can be resolved', async () => {
        const user = userEvent.setup();

        useUIStore.getState().setSelectedPlant('node-plant-01');
        hierarchyStorageMock.getNodes.mockResolvedValue([
            {
                id: 'node-plant-01',
                name: 'Planta Demo',
                type: 'plant',
                parentId: null,
                order: 0,
            },
        ]);

        renderTopbar('/alerts');

        await user.click(screen.getByTitle('Visión General'));

        await waitFor(() => {
            expect(screen.getByTestId('current-path')).toHaveTextContent('/');
        });
        expect(screen.getByTestId('current-path')).toHaveTextContent('/');
        expect(screen.getByTestId('current-path')).not.toHaveTextContent('dashboardId=');
    });

    it('uses the short loader and same-tab routing when entering admin from a viewer route', async () => {
        const user = userEvent.setup();
        const revealRequestSpy = vi.fn();
        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        mountBootShield();

        document.addEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);
        useAuthStore.setState({
            session: adminSession,
            isHydrated: true,
            isAuthenticating: false,
            error: null,
        });

        renderTopbar('/explorer');

        await user.click(screen.getByTitle('Administracion'));

        expect(windowOpenSpy).not.toHaveBeenCalled();
        await waitFor(() => {
            expect(screen.getByTestId('current-path')).toHaveTextContent('/admin');
        });
        expect(revealRequestSpy).toHaveBeenCalledTimes(1);
        expect(revealRequestSpy.mock.calls[0]?.[0]).toMatchObject({
            detail: {
                profileId: 'short',
                runner: 'short',
                allowNoContentExtension: false,
                restartCycle: true,
            },
        });

        document.removeEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);
        windowOpenSpy.mockRestore();
    });

    it('continues admin navigation immediately when runtime short is disabled', async () => {
        saveLoaderOptionsConfig({
            short: { enabled: false, durationSeconds: 2 },
            long: { enabled: true, durationSeconds: 8 },
        });

        const user = userEvent.setup();
        const revealRequestSpy = vi.fn();
        mountBootShield();
        document.addEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);
        useAuthStore.setState({
            session: adminSession,
            isHydrated: true,
            isAuthenticating: false,
            error: null,
        });

        renderTopbar('/explorer');

        await user.click(screen.getByTitle('Administracion'));

        expect(screen.getByTestId('current-path')).toHaveTextContent('/admin');
        expect(revealRequestSpy).not.toHaveBeenCalled();

        document.removeEventListener(SHIELD_REVEAL_REQUEST_EVENT, revealRequestSpy as EventListener);
    });

    it('does not expose the retired Leda Local indicator for legacy storage or query state', () => {
        localStorage.setItem('hmi:leda-runtime-mode', 'local');
        renderTopbar('/?ledaMode=local');

        expect(screen.queryByRole('status', { name: 'LEDA LOCAL' })).not.toBeInTheDocument();
        expect(localStorage.getItem('hmi:leda-runtime-mode')).toBe('local');
    });

    it('places the Leda pairing control immediately after Logs in the Core Topbar nav', () => {
        renderTopbar('/explorer');

        const ledaButton = screen.queryByRole('button', { name: 'Leda' });
        const logsButton = screen.getByRole('button', { name: 'Logs' });

        // Soft assertions keep BOTH wiring failures observable while the control is not yet
        // integrated. The unchanged Logs behavior is asserted first and must keep passing.
        expect.soft(logsButton).toBeDisabled();
        expect.soft(ledaButton, 'the pairing control must render in the Core Topbar nav').not.toBeNull();
        expect.soft(logsButton.nextElementSibling).toContainElement(ledaButton);
    });

    it('keeps the Leda pairing control out of the EPPI route', () => {
        renderTopbar('/eppi/orders');

        // EPPI never mounts the Core pairing control; the component owns its open state
        // locally, so leaving EPPI unmounts it and nothing is persisted or auto-reopened.
        expect(screen.queryByRole('button', { name: 'Leda' })).not.toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Navegación EPPI' })).toBeInTheDocument();
    });

    describe('hidden access', () => {
        beforeEach(() => {
            setHiddenAccessRevealed(false);
        });

        it('shows neither the users icon nor the Leda control by default', () => {
            renderTopbar('/explorer');

            expect(screen.queryByTitle('Usuario')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Leda' })).not.toBeInTheDocument();
        });

        it('shows both after Ctrl+Alt+A, hides them on the second press and remembers the state in this browser', () => {
            render(
                <MemoryRouter initialEntries={['/explorer']}>
                    <ShortcutHost />
                    <Topbar />
                </MemoryRouter>,
            );

            fireEvent.keyDown(document.body, REVEAL_COMBINATION);
            expect(screen.getByTitle('Usuario')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Leda' })).toBeInTheDocument();
            expect(localStorage.getItem('hmi:hidden-access')).toBe('on');

            fireEvent.keyDown(document.body, REVEAL_COMBINATION);
            expect(screen.queryByTitle('Usuario')).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Leda' })).not.toBeInTheDocument();
            expect(localStorage.getItem('hmi:hidden-access')).toBeNull();
        });

        it('stays revealed after a reload in the same browser', () => {
            setHiddenAccessRevealed(true);

            renderTopbar('/explorer');

            expect(screen.getByTitle('Usuario')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Leda' })).toBeInTheDocument();
        });

        it('ignores the combination while typing in the search field', () => {
            render(
                <MemoryRouter initialEntries={['/explorer']}>
                    <ShortcutHost />
                    <Topbar />
                </MemoryRouter>,
            );

            fireEvent.keyDown(screen.getByPlaceholderText('Analyze equipment...'), REVEAL_COMBINATION);

            expect(screen.queryByTitle('Usuario')).not.toBeInTheDocument();
        });

        it('closes the login when the icons are hidden again', async () => {
            const user = userEvent.setup();
            setHiddenAccessRevealed(true);
            render(
                <MemoryRouter initialEntries={['/explorer']}>
                    <ShortcutHost />
                    <Topbar />
                </MemoryRouter>,
            );
            await user.click(screen.getByTitle('Usuario'));
            expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();

            fireEvent.keyDown(document.body, REVEAL_COMBINATION);

            expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
        });

        it('keeps the admin actions of an authenticated administrator while the icons are hidden', () => {
            useAuthStore.setState({ session: adminSession, isHydrated: true, isAuthenticating: false, error: null });

            renderTopbar('/explorer');

            expect(screen.getByTitle('Administracion')).toBeInTheDocument();
            expect(screen.queryByTitle('Usuario')).not.toBeInTheDocument();
        });
    });
});
