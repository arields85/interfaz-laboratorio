import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

vi.mock('../admin/GlobalSettingsDialog', () => ({ default: () => null }));

const CSRF_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOTICE = 'Su sesión se cerró porque se inició sesión en otro equipo.';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderApp(controller: AdminSessionController) {
    return render(
        <MemoryRouter initialEntries={['/admin']}>
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
        </MemoryRouter>,
    );
}

describe('AdminSessionLifecycle replaced session', () => {
    beforeEach(() => {
        localStorage.clear();
        useAuthStore.setState({
            session: { user: null, isAuthenticated: false, loginTimestamp: null },
            isHydrated: false,
            isAuthenticating: false,
            error: null,
            sessionReplaced: false,
        });
    });

    it('sends a displaced administrator to the viewer with a dismissible notice on the next focus', async () => {
        const user = userEvent.setup();
        let replaced = false;
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/leda/admin/auth/session') {
                return Promise.resolve(replaced
                    ? jsonResponse({ ok: false, error: 'ADMIN_SESSION_REPLACED' }, 401)
                    : jsonResponse({
                        ok: true,
                        administrator: { username: 'admin' },
                        csrfToken: CSRF_TOKEN,
                        absoluteExpiresAt: (Date.now() + 60_000) / 1000,
                    }));
            }
            return Promise.resolve(jsonResponse({ configured: true }));
        });
        renderApp(new AdminSessionController(new AdminAuthClient(fetcher)));
        expect(await screen.findByText('Contenido administrador')).toBeInTheDocument();
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();

        replaced = true;
        window.dispatchEvent(new Event('focus'));

        expect(await screen.findByText('Viewer público')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(NOTICE);

        await user.click(screen.getByRole('button', { name: 'Entendido' }));
        await waitFor(() => expect(screen.queryByText(NOTICE)).not.toBeInTheDocument());
    });

    it('keeps plain expiry silent: viewer, no replaced notice', async () => {
        let expired = false;
        const fetcher = vi.fn<typeof fetch>((path) => {
            if (path === '/api/leda/admin/auth/session') {
                return Promise.resolve(expired
                    ? jsonResponse({ ok: false, error: 'AUTHENTICATION_REQUIRED' }, 401)
                    : jsonResponse({
                        ok: true,
                        administrator: { username: 'admin' },
                        csrfToken: CSRF_TOKEN,
                        absoluteExpiresAt: (Date.now() + 60_000) / 1000,
                    }));
            }
            return Promise.resolve(jsonResponse({ configured: true }));
        });
        renderApp(new AdminSessionController(new AdminAuthClient(fetcher)));
        expect(await screen.findByText('Contenido administrador')).toBeInTheDocument();

        expired = true;
        window.dispatchEvent(new Event('focus'));

        expect(await screen.findByText('Viewer público')).toBeInTheDocument();
        expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    });
});
