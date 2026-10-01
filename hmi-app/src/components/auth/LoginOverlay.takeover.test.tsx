import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResult } from '../../domain';
import { useAuthStore } from '../../store/auth.store';
import LoginOverlay from './LoginOverlay';

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
        isOpen ? <div data-testid="anchored-overlay">{children}</div> : null,
}));

const controllerMock = vi.hoisted(() => ({ login: vi.fn(), exit: vi.fn() }));

vi.mock('../../services/adminSession.controller', () => ({
    adminSessionController: controllerMock,
}));

const WARNING = 'Hay una sesión de administrador abierta en otro equipo. Si continúa, esa sesión se cerrará.';
const ACTIVE_ELSEWHERE: AuthResult = { ok: false, error: WARNING, code: 'ADMIN_SESSION_ACTIVE_ELSEWHERE' };
const LOGGED_IN: AuthResult = {
    ok: true,
    user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'role-admin', name: 'Admin', permissions: [] } },
};

async function submitCredentials() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Usuario'), 'admin');
    await user.type(screen.getByLabelText('Contraseña'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    return user;
}

function renderOverlay(onClose = vi.fn()) {
    render(<LoginOverlay triggerRef={{ current: document.createElement('button') }} isOpen onClose={onClose} />);
    return onClose;
}

describe('LoginOverlay single administrator session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useAuthStore.setState({
            session: { user: null, isAuthenticated: false, loginTimestamp: null },
            isHydrated: true,
            isAuthenticating: false,
            error: null,
        });
    });

    it('asks for confirmation instead of logging in when another session is active', async () => {
        controllerMock.login.mockResolvedValue(ACTIVE_ELSEWHERE);
        const onClose = renderOverlay();

        await submitCredentials();

        const dialog = await screen.findByRole('alertdialog');
        expect(dialog).toHaveTextContent(WARNING);
        expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
        expect(controllerMock.login).toHaveBeenCalledTimes(1);
        expect(controllerMock.login).toHaveBeenCalledWith('admin', 'secret');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('retries the same credentials with the takeover flag on Continuar and closes on success', async () => {
        controllerMock.login.mockResolvedValueOnce(ACTIVE_ELSEWHERE).mockResolvedValueOnce(LOGGED_IN);
        const onClose = renderOverlay();
        const user = await submitCredentials();

        await user.click(await screen.findByRole('button', { name: 'Continuar' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(controllerMock.login).toHaveBeenNthCalledWith(2, 'admin', 'secret', { takeover: true });
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    it('returns to the form without logging in on Cancelar and drops the password', async () => {
        controllerMock.login.mockResolvedValue(ACTIVE_ELSEWHERE);
        const onClose = renderOverlay();
        const user = await submitCredentials();

        await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Usuario')).toHaveValue('admin');
        expect(screen.getByLabelText('Contraseña')).toHaveValue('');
        expect(controllerMock.login).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows the failure of the confirmed retry in the form', async () => {
        controllerMock.login
            .mockResolvedValueOnce(ACTIVE_ELSEWHERE)
            .mockResolvedValueOnce({ ok: false, error: 'Credenciales inválidas.' } satisfies AuthResult);
        renderOverlay();
        const user = await submitCredentials();

        await user.click(await screen.findByRole('button', { name: 'Continuar' }));

        expect(await screen.findByText('Credenciales inválidas.')).toBeInTheDocument();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
});
