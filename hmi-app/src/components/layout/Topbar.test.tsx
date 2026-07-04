import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLoaderOptionsConfig, saveLoaderOptionsConfig } from '../../config/loaderOptions.config';
import type { AuthSession } from '../../domain';
import { AUTH_SESSION_STORAGE_KEY, useAuthStore } from '../../store/auth.store';
import { useUIStore } from '../../store/ui.store';
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

function renderTopbar(initialEntry = '/') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Topbar />
            <LocationIndicator />
        </MemoryRouter>,
    );
}

describe('Topbar', () => {
    beforeEach(() => {
        localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
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
        expect(screen.getByTestId('current-path')).toHaveTextContent('/admin');
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
});
