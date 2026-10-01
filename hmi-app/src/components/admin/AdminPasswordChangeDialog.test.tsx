import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminAuthError } from '../../services/adminAuth.service';
import AdminPasswordChangeDialog from './AdminPasswordChangeDialog';

const CURRENT = 'correct horse battery staple';
const NEXT = 'a different durable passphrase';

function setup() {
    const client = { changePassword: vi.fn<(current: string, next: string, signal?: AbortSignal) => Promise<void>>() };
    const controller = { handleProtectedRequestError: vi.fn<(error: unknown) => Promise<void>>().mockResolvedValue(undefined) };
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AdminPasswordChangeDialog open onClose={onClose} client={client} controller={controller} />);
    return { client, controller, onClose, user };
}

const currentField = () => screen.getByLabelText('Contraseña actual') as HTMLInputElement;
const newField = () => screen.getByLabelText('Nueva contraseña') as HTMLInputElement;
const confirmField = () => screen.getByLabelText('Confirmar nueva contraseña') as HTMLInputElement;
const submit = () => screen.getByRole('button', { name: 'Cambiar contraseña' });

async function fill(user: ReturnType<typeof userEvent.setup>, current = CURRENT, next = NEXT, confirmation = next) {
    if (current) await user.type(currentField(), current);
    if (next) await user.type(newField(), next);
    if (confirmation) await user.type(confirmField(), confirmation);
}

describe('AdminPasswordChangeDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('offers three masked password fields with the right autofill hints', () => {
        setup();

        expect(currentField()).toHaveAttribute('type', 'password');
        expect(currentField()).toHaveAttribute('autocomplete', 'current-password');
        expect(newField()).toHaveAttribute('type', 'password');
        expect(newField()).toHaveAttribute('autocomplete', 'new-password');
        expect(confirmField()).toHaveAttribute('type', 'password');
        expect(confirmField()).toHaveAttribute('autocomplete', 'new-password');
    });

    it('keeps the submit disabled until all three fields are filled', async () => {
        const { user } = setup();
        expect(submit()).toBeDisabled();

        await user.type(currentField(), CURRENT);
        await user.type(newField(), NEXT);
        expect(submit()).toBeDisabled();
        await user.type(confirmField(), NEXT);
        expect(submit()).toBeEnabled();
    });

    it.each([
        ['a new password that is too short', CURRENT, 'short', 'short', /al menos 10 caracteres/],
        ['a confirmation that does not match', CURRENT, NEXT, `${NEXT}!`, /no coincide/],
        ['a new password equal to the current one', CURRENT, CURRENT, CURRENT, /distinta de la actual/],
    ])('refuses %s without calling the server', async (_name, current, next, confirmation, message) => {
        const { client, user } = setup();
        await fill(user, current, next, confirmation);

        await user.click(submit());

        expect(screen.getByRole('alert')).toHaveTextContent(message);
        expect(client.changePassword).not.toHaveBeenCalled();
    });

    it('sends the passwords, clears every field and confirms on success', async () => {
        const { client, controller, user } = setup();
        client.changePassword.mockResolvedValue(undefined);
        await fill(user);

        await user.click(submit());

        await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Contraseña actualizada'));
        expect(client.changePassword).toHaveBeenCalledWith(CURRENT, NEXT, expect.any(AbortSignal));
        expect(currentField()).toHaveValue('');
        expect(newField()).toHaveValue('');
        expect(confirmField()).toHaveValue('');
        expect(controller.handleProtectedRequestError).not.toHaveBeenCalled();
    });

    it('says the current password is wrong without ending the session, keeping the new password typed', async () => {
        const { client, controller, user } = setup();
        client.changePassword.mockRejectedValue(new AdminAuthError('INVALID_CURRENT_PASSWORD', 401));
        await fill(user);

        await user.click(submit());

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('La contraseña actual es incorrecta.'));
        expect(controller.handleProtectedRequestError).not.toHaveBeenCalled();
        expect(currentField()).toHaveValue('');
        expect(newField()).toHaveValue(NEXT);
        expect(confirmField()).toHaveValue(NEXT);
    });

    it.each([
        ['PASSWORD_POLICY_REJECTED', 400, /al menos 10 caracteres/],
        ['PASSWORD_UNCHANGED', 400, /distinta de la actual/],
        ['LOGIN_RATE_LIMITED', 429, /Demasiados intentos/],
        ['AUTH_STORAGE_UNAVAILABLE', 503, /servicio de autenticación no está disponible/],
        ['AUTH_REQUEST_FAILED', 500, /No se pudo cambiar la contraseña/],
    ])('maps the %s failure to a clear message', async (code, status, message) => {
        const { client, controller, user } = setup();
        client.changePassword.mockRejectedValue(new AdminAuthError(code, status));
        await fill(user);

        await user.click(submit());

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
        expect(controller.handleProtectedRequestError).not.toHaveBeenCalled();
    });

    it.each([
        ['AUTHENTICATION_REQUIRED', 401],
        ['CSRF_VALIDATION_FAILED', 403],
    ])('hands a %s session failure to the session controller', async (code, status) => {
        const { client, controller, user } = setup();
        const error = new AdminAuthError(code, status);
        client.changePassword.mockRejectedValue(error);
        await fill(user);

        await user.click(submit());

        await waitFor(() => expect(controller.handleProtectedRequestError).toHaveBeenCalledWith(error));
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('prevents a second submit while one is in flight', async () => {
        const { client, user } = setup();
        let finish: () => void = () => undefined;
        client.changePassword.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
        await fill(user);

        await user.click(submit());

        expect(submit()).toBeDisabled();
        expect(client.changePassword).toHaveBeenCalledTimes(1);
        finish();
        await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    });

    it('closes from Cancelar without sending anything', async () => {
        const { client, onClose, user } = setup();
        await fill(user);

        await user.click(screen.getByRole('button', { name: 'Cancelar' }));

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(client.changePassword).not.toHaveBeenCalled();
    });

    it('relabels the secondary button as Cerrar after a success, and keeps Cancelar otherwise', async () => {
        const { client, onClose, user } = setup();
        client.changePassword.mockRejectedValueOnce(new AdminAuthError('PASSWORD_UNCHANGED', 400));
        await fill(user);

        await user.click(submit());
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();

        client.changePassword.mockResolvedValueOnce(undefined);
        await user.click(submit());
        await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Cerrar' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('accepts a new password of exactly 10 characters', async () => {
        const { client, user } = setup();
        client.changePassword.mockResolvedValue(undefined);
        await fill(user, CURRENT, 'abcdefghij');

        await user.click(submit());

        await waitFor(() => expect(client.changePassword).toHaveBeenCalledWith(CURRENT, 'abcdefghij', expect.any(AbortSignal)));
    });

    it('blocks every way of closing while a request is in flight and restores them afterwards', async () => {
        const { client, onClose, user } = setup();
        let finish: () => void = () => undefined;
        client.changePassword.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
        await fill(user);

        await user.click(submit());

        expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
        fireEvent.keyDown(window, { key: 'Escape' });
        const backdrop = screen.getByRole('dialog').parentElement as HTMLElement;
        fireEvent.mouseDown(backdrop);
        expect(onClose).not.toHaveBeenCalled();

        finish();
        await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Cerrar' })).toBeEnabled();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['a transport failure', new AdminAuthError('AUTH_TRANSPORT_UNAVAILABLE', null)],
        ['an invalid response', new AdminAuthError('AUTH_RESPONSE_INVALID', 200)],
        ['an unexpected fetch error', new TypeError('Failed to fetch')],
    ])('says the result is unknown after %s, without the generic failure text', async (_name, failure) => {
        const { client, controller, user } = setup();
        client.changePassword.mockRejectedValue(failure);
        await fill(user);

        await user.click(submit());

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'No se pudo confirmar el cambio. Es posible que la contraseña ya se haya cambiado: verifique iniciando sesión con la nueva contraseña.',
        ));
        expect(screen.getByRole('alert')).not.toHaveTextContent('No se pudo cambiar la contraseña.');
        expect(controller.handleProtectedRequestError).not.toHaveBeenCalled();
    });

    it('aborts an in-flight request when it unmounts', async () => {
        const client = { changePassword: vi.fn<(current: string, next: string, signal?: AbortSignal) => Promise<void>>() };
        client.changePassword.mockReturnValue(new Promise<void>(() => undefined));
        const user = userEvent.setup();
        const view = render(
            <AdminPasswordChangeDialog
                open
                onClose={() => undefined}
                client={client}
                controller={{ handleProtectedRequestError: vi.fn().mockResolvedValue(undefined) }}
            />,
        );
        await fill(user);
        await user.click(submit());
        const signal = client.changePassword.mock.calls[0]?.[2];

        view.unmount();

        expect(signal?.aborted).toBe(true);
    });
});
