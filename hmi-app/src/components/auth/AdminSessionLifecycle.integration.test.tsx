import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AdminLayout from '../../layouts/AdminLayout';
import { useAuthStore } from '../../store/auth.store';
import { AdminAuthClient } from '../../services/adminAuth.service';
import { AdminSessionController } from '../../services/adminSession.controller';
import RequirePermission from './RequirePermission';
import AdminSessionLifecycle from './AdminSessionLifecycle';

// The Channel B bell polls through the module-singleton client, which these session-lifecycle
// tests do not drive; its own behavior is covered by NotificationBell.test.tsx.
vi.mock('../layout/NotificationBell', () => ({ default: () => null }));

vi.mock('../admin/GlobalSettingsDialog', () => ({
    default: ({ open, onClose }: { open: boolean; onClose: () => void }) => open ? (
        <div role="dialog" aria-label="Configuración general">
            <button type="button" onClick={onClose}>Cerrar</button>
        </div>
    ) : null,
}));

const CSRF_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
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

function renderLifecycle(controller: AdminSessionController) {
    return render(
        <StrictMode>
            <MemoryRouter initialEntries={['/', '/admin']} initialIndex={1}>
                {/* Rendered outside the routed pages: browser back/forward is always
                    available regardless of which route is current. */}
                <HistoryControls />
                <Routes>
                    <Route element={<AdminSessionLifecycle controller={controller} />}>
                        <Route path="/" element={<div>Viewer público</div>} />
                        <Route path="/admin" element={(
                            <RequirePermission permission="admin:access">
                                <AdminLayout controller={controller} />
                            </RequirePermission>
                        )}>
                            <Route index element={<div>Contenido administrador</div>} />
                        </Route>
                    </Route>
                </Routes>
            </MemoryRouter>
        </StrictMode>,
    );
}

function createFetch(absoluteExpiresAt: () => number) {
    return vi.fn<typeof fetch>((path) => {
        if (path === '/api/leda/admin/auth/session') {
            return Promise.resolve(jsonResponse({
                ok: true,
                administrator: { username: 'admin' },
                csrfToken: CSRF_TOKEN,
                absoluteExpiresAt: absoluteExpiresAt(),
            }));
        }
        if (path === '/api/leda/admin/auth/logout') {
            return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(jsonResponse({ configured: true }));
    });
}

describe('AdminSessionLifecycle integration', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.setState({
            session: { user: null, isAuthenticated: false, loginTimestamp: null },
            isHydrated: false,
            isAuthenticating: false,
            error: null,
        });
    });

    it('survives StrictMode setup-cleanup-start and restores absolute expiry enforcement', async () => {
        const fetcher = createFetch(() => (Date.now() + 500) / 1000);
        const controller = new AdminSessionController(new AdminAuthClient(fetcher));

        renderLifecycle(controller);

        expect(await screen.findByText('Contenido administrador')).toBeInTheDocument();
        expect(fetcher.mock.calls.filter(([path]) => path === '/api/leda/admin/auth/session').length).toBeGreaterThanOrEqual(2);
        await waitFor(() => expect(screen.getByText('Viewer público')).toBeInTheDocument(), { timeout: 2_000 });
    });

    it('keeps settings close authenticated and keeps the session alive across Ver viewer and route history', async () => {
        const user = userEvent.setup();
        const fetcher = createFetch(() => (Date.now() + 60_000) / 1000);
        const controller = new AdminSessionController(new AdminAuthClient(fetcher));
        renderLifecycle(controller);
        expect(await screen.findByText('Contenido administrador')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /configuracion general/i }));
        await user.click(screen.getByRole('button', { name: 'Cerrar' }));
        expect(useAuthStore.getState().session.isAuthenticated).toBe(true);
        expect(fetcher.mock.calls.filter(([path]) => path === '/api/leda/admin/auth/logout')).toHaveLength(0);

        // Leaving /admin through "Ver viewer" must not end the session (user decision
        // 2026-09-23, T5b): navigating away is not logging out.
        await user.click(screen.getByRole('button', { name: /ver viewer/i }));
        expect(await screen.findByText('Viewer público')).toBeInTheDocument();
        expect(useAuthStore.getState().session.isAuthenticated).toBe(true);
        expect(fetcher.mock.calls.filter(([path]) => path === '/api/leda/admin/auth/logout')).toHaveLength(0);

        // Browser history round-trips through /admin and back must not end it either.
        await user.click(screen.getByRole('button', { name: 'Atrás' }));
        expect(await screen.findByText('Contenido administrador')).toBeInTheDocument();
        expect(useAuthStore.getState().session.isAuthenticated).toBe(true);
        await user.click(screen.getByRole('button', { name: 'Adelante' }));
        expect(await screen.findByText('Viewer público')).toBeInTheDocument();
        expect(useAuthStore.getState().session.isAuthenticated).toBe(true);
        expect(fetcher.mock.calls.filter(([path]) => path === '/api/leda/admin/auth/logout')).toHaveLength(0);

        // Only "Cerrar sesión" ends it.
        await user.click(screen.getByRole('button', { name: 'Atrás' }));
        expect(await screen.findByText('Contenido administrador')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /cerrar sesion/i }));
        await waitFor(() => {
            expect(useAuthStore.getState().session.isAuthenticated).toBe(false);
        });
        expect(fetcher.mock.calls.filter(([path]) => path === '/api/leda/admin/auth/logout')).toHaveLength(1);
    });
});
