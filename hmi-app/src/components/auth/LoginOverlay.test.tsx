import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResult, AuthSession } from '../../domain';
import LoginOverlay from './LoginOverlay';

vi.mock('../ui/AnchoredOverlay', () => ({
    default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
        isOpen ? <div data-testid="anchored-overlay">{children}</div> : null,
}));

type AuthStoreState = {
    session: AuthSession;
    login: (username: string, password: string) => Promise<AuthResult>;
    logout: () => void;
};

const INVALID_AUTH_RESULT: Extract<AuthResult, { ok: false }> = {
    ok: false,
    error: 'Credenciales inválidas',
};

const ADMIN_USER: Extract<AuthResult, { ok: true }>['user'] = {
    id: 'admin',
    username: 'admin',
    displayName: 'Administrador',
    role: {
        id: 'role-admin',
        name: 'Admin',
        permissions: ['viewer:access', 'admin:access'],
    },
};

const SUCCESS_AUTH_RESULT: Extract<AuthResult, { ok: true }> = {
    ok: true,
    user: ADMIN_USER,
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
        login: vi.fn(async () => INVALID_AUTH_RESULT),
        logout: vi.fn(),
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

const sessionControllerMock = vi.hoisted(() => ({
    login: vi.fn(),
    exit: vi.fn(),
}));

vi.mock('../../store/auth.store', () => ({
    useAuthStore: authStoreMock.store,
}));

vi.mock('../../services/adminSession.controller', () => ({
    adminSessionController: sessionControllerMock,
}));

function createTriggerRef() {
    return { current: document.createElement('button') };
}

describe('LoginOverlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authStoreMock.store.setState({
            session: unauthenticatedSession,
            login: vi.fn(async () => INVALID_AUTH_RESULT),
            logout: vi.fn(),
        });
        sessionControllerMock.login.mockImplementation((username: string, password: string) => (
            authStoreMock.store.getState().login(username, password)
        ));
        sessionControllerMock.exit.mockReset();
    });

    it('renders the login form when open and unauthenticated', () => {
        render(
            <LoginOverlay
                triggerRef={createTriggerRef()}
                isOpen
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByLabelText('Usuario')).toBeInTheDocument();
        expect(screen.getByLabelText('Contraseña')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Ingresar' })).toBeInTheDocument();
    });

    it('shows a validation error on empty submit and does not authenticate', async () => {
        const user = userEvent.setup();

        render(
            <LoginOverlay
                triggerRef={createTriggerRef()}
                isOpen
                onClose={vi.fn()}
            />,
        );

        await user.click(screen.getByRole('button', { name: 'Ingresar' }));

        expect(authStoreMock.store.getState().login).not.toHaveBeenCalled();
        expect(screen.getByText('Ingresá usuario y contraseña.')).toBeInTheDocument();
    });

    it('shows the authenticated user info instead of the form', () => {
        authStoreMock.store.setState({
            session: {
                user: ADMIN_USER,
                isAuthenticated: true,
                loginTimestamp: '2026-04-28T18:00:00.000Z',
            },
            login: vi.fn(async () => SUCCESS_AUTH_RESULT),
            logout: vi.fn(),
        });

        render(
            <LoginOverlay
                triggerRef={createTriggerRef()}
                isOpen
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByText('Administrador')).toBeInTheDocument();
        expect(screen.getByText('Admin')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cerrar sesion' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Usuario')).not.toBeInTheDocument();
    });

    it('shows the auth error returned by the store', async () => {
        const user = userEvent.setup();

        render(
            <LoginOverlay
                triggerRef={createTriggerRef()}
                isOpen
                onClose={vi.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Usuario'), 'admin');
        await user.type(screen.getByLabelText('Contraseña'), 'wrong');
        await user.click(screen.getByRole('button', { name: 'Ingresar' }));

        expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
    });

    it('preserves submitted username and password bytes', async () => {
        const user = userEvent.setup();
        const onClose = vi.fn();
        const loginResult: AuthResult = SUCCESS_AUTH_RESULT;

        authStoreMock.store.setState({
            session: unauthenticatedSession,
            login: vi.fn(async () => loginResult),
            logout: vi.fn(),
        });

        render(
            <LoginOverlay
                triggerRef={createTriggerRef()}
                isOpen
                onClose={onClose}
            />,
        );

        const usernameInput = screen.getByLabelText('Usuario');
        const passwordInput = screen.getByLabelText('Contraseña');

        await user.type(usernameInput, ' admin ');
        await user.type(passwordInput, ' 7trebol ');
        await user.click(screen.getByRole('button', { name: 'Ingresar' }));

        expect(sessionControllerMock.login).toHaveBeenCalledWith(' admin ', ' 7trebol ');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(usernameInput).toHaveValue('');
        expect(passwordInput).toHaveValue('');
    });

    it('submits a nonempty all-space password without changing any byte', async () => {
        const user = userEvent.setup();
        sessionControllerMock.login.mockResolvedValue(SUCCESS_AUTH_RESULT);
        render(<LoginOverlay triggerRef={createTriggerRef()} isOpen onClose={vi.fn()} />);

        await user.type(screen.getByLabelText('Usuario'), 'admin');
        await user.type(screen.getByLabelText('Contraseña'), '               ');
        await user.click(screen.getByRole('button', { name: 'Ingresar' }));

        expect(sessionControllerMock.login).toHaveBeenCalledWith('admin', '               ');
    });
});
