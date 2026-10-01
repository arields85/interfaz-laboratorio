import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HIDDEN_ACCESS_STORAGE_KEY, setHiddenAccessRevealed } from '../../services/hiddenAccess.service';
import { useAuthStore } from '../../store/auth.store';
import { useLoginOverlayStore } from '../../store/loginOverlay.store';
import Topbar from '../layout/Topbar';
import HiddenAccessRoute from './HiddenAccessRoute';

vi.mock('../../services/adminSession.controller', () => ({
    adminSessionController: { login: vi.fn(), refresh: vi.fn(), exit: vi.fn() },
}));
vi.mock('../layout/ShaderSettingsPanel', () => ({ default: () => null }));
vi.mock('../layout/PrismaPairingControl', () => ({
    default: () => <button type="button" aria-label="Prisma">Prisma</button>,
}));

function Layout() {
    return (
        <>
            <Topbar />
            <Outlet />
        </>
    );
}

function Path() {
    return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderAt(entry: string) {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route element={<Layout />}>
                    <Route path="/" element={<Path />} />
                    <Route path="/acceso" element={<HiddenAccessRoute />} />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

describe('HiddenAccessRoute', () => {
    beforeEach(() => {
        localStorage.clear();
        setHiddenAccessRevealed(false);
        useLoginOverlayStore.setState({ open: false });
        useAuthStore.setState({
            session: { user: null, isAuthenticated: false, loginTimestamp: null },
            isHydrated: true,
            isAuthenticating: false,
            error: null,
        });
    });

    it('reveals the icons, opens the login and lands on the viewer root', async () => {
        renderAt('/acceso');

        expect(await screen.findByTestId('path')).toHaveTextContent('/');
        expect(localStorage.getItem(HIDDEN_ACCESS_STORAGE_KEY)).toBe('on');
        expect(screen.getByTitle('Usuario')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Prisma' })).toBeInTheDocument();
        expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
    });

    it('leaves the viewer root untouched when it is opened directly', async () => {
        renderAt('/');

        expect(await screen.findByTestId('path')).toHaveTextContent('/');
        expect(screen.queryByTitle('Usuario')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Contraseña')).not.toBeInTheDocument();
    });
});
