import { describe, expect, it, vi } from 'vitest';

import { AdminAuthClient, AdminAuthError } from './adminAuth.service';
import {
    AdminSessionController,
    createMemoryAuthStatePort,
    type AdminAuthGateway,
} from './adminSession.controller';

const IDENTITY = { username: 'admin', absoluteExpiresAt: 2_000_000_000 };
const ACTIVE_ELSEWHERE = 'ADMIN_SESSION_ACTIVE_ELSEWHERE';
const REPLACED = 'ADMIN_SESSION_REPLACED';
const ACTIVE_ELSEWHERE_MESSAGE = 'Hay una sesión de administrador abierta en otro equipo. Si continúa, esa sesión se cerrará.';
const SESSION_BODY = {
    ok: true,
    administrator: { username: 'admin' },
    csrfToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    absoluteExpiresAt: 2_000_000_000,
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}

function bodyOf(call: Parameters<typeof fetch>): unknown {
    return JSON.parse(String(call[1]?.body));
}

describe('AdminAuthClient single administrator session', () => {
    it('sends the takeover flag only when it is requested', async () => {
        const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse(SESSION_BODY)));
        const client = new AdminAuthClient(fetcher, () => 1_000);

        await client.login('admin', 'secret');
        await client.login('admin', 'secret', undefined, true);

        expect(bodyOf(fetcher.mock.calls[0])).toEqual({ username: 'admin', password: 'secret' });
        expect(bodyOf(fetcher.mock.calls[1])).toEqual({ username: 'admin', password: 'secret', takeover: true });
    });

    it('surfaces the active-elsewhere and replaced codes instead of a generic failure', async () => {
        const answers = [
            jsonResponse({ ok: false, error: ACTIVE_ELSEWHERE }, 409),
            jsonResponse({ ok: false, error: REPLACED }, 401),
        ];
        const client = new AdminAuthClient(vi.fn<typeof fetch>(() => Promise.resolve(answers.shift()!)), () => 1_000);

        await expect(client.login('admin', 'secret')).rejects.toMatchObject({ code: ACTIVE_ELSEWHERE, status: 409 });
        await expect(client.session()).rejects.toMatchObject({ code: REPLACED, status: 401 });
    });

    it('tells subscribers when any request learns the session was replaced', async () => {
        const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ ok: false, error: REPLACED }, 401)));
        const client = new AdminAuthClient(fetcher, () => 1_000);
        const listener = vi.fn();
        const unsubscribe = client.onSessionReplaced(listener);

        await expect(client.credentialMetadata()).rejects.toBeInstanceOf(AdminAuthError);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        await expect(client.session()).rejects.toBeInstanceOf(AdminAuthError);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not notify for a plain 401', async () => {
        const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse({ ok: false, error: 'AUTHENTICATION_REQUIRED' }, 401)));
        const client = new AdminAuthClient(fetcher, () => 1_000);
        const listener = vi.fn();
        client.onSessionReplaced(listener);

        await expect(client.session()).rejects.toBeInstanceOf(AdminAuthError);

        expect(listener).not.toHaveBeenCalled();
    });
});

function gateway(overrides: Partial<AdminAuthGateway> = {}): AdminAuthGateway {
    return {
        clearPrivateSession: vi.fn(),
        login: vi.fn().mockResolvedValue(IDENTITY),
        session: vi.fn().mockResolvedValue(IDENTITY),
        logout: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function controllerFor(client: AdminAuthGateway) {
    const state = createMemoryAuthStatePort();
    const controller = new AdminSessionController(client, null, null, () => 1_000, state);
    return { controller, state };
}

describe('AdminSessionController single administrator session', () => {
    it('reports an active session elsewhere without treating it as a failed login', async () => {
        const client = gateway({ login: vi.fn().mockRejectedValue(new AdminAuthError(ACTIVE_ELSEWHERE, 409)) });
        const { controller, state } = controllerFor(client);

        const result = await controller.login('admin', 'secret');

        expect(result).toEqual({ ok: false, error: ACTIVE_ELSEWHERE_MESSAGE, code: ACTIVE_ELSEWHERE });
        expect(state.get().error).toBeNull();
        expect(state.get().isAuthenticating).toBe(false);
        expect(state.get().session.isAuthenticated).toBe(false);
    });

    it('retries with the takeover flag only when asked to', async () => {
        const client = gateway();
        const { controller, state } = controllerFor(client);

        await controller.login('admin', 'secret');
        await controller.login('admin', 'secret', { takeover: true });

        expect(vi.mocked(client.login).mock.calls[0][3]).toBeFalsy();
        expect(vi.mocked(client.login).mock.calls[1][3]).toBe(true);
        expect(state.get().session.isAuthenticated).toBe(true);
    });

    it('suspends the session and flags it as replaced when revalidation says so', async () => {
        const client = gateway();
        const { controller, state } = controllerFor(client);
        await controller.login('admin', 'secret');
        vi.mocked(client.session).mockRejectedValue(new AdminAuthError(REPLACED, 401));

        await controller.refresh();

        expect(state.get().session.isAuthenticated).toBe(false);
        expect(state.get().sessionReplaced).toBe(true);
        expect(state.get().error).toBeNull();
    });

    it('keeps plain expiry unflagged', async () => {
        const client = gateway();
        const { controller, state } = controllerFor(client);
        await controller.login('admin', 'secret');
        vi.mocked(client.session).mockRejectedValue(new AdminAuthError('AUTHENTICATION_REQUIRED', 401));

        await controller.refresh();

        expect(state.get().session.isAuthenticated).toBe(false);
        expect(state.get().sessionReplaced).toBe(false);
    });

    it('flags a protected request answered with the replaced code', async () => {
        const { controller, state } = controllerFor(gateway());
        await controller.login('admin', 'secret');

        await controller.handleProtectedRequestError(new AdminAuthError(REPLACED, 401));

        expect(state.get().session.isAuthenticated).toBe(false);
        expect(state.get().sessionReplaced).toBe(true);
    });

    it('reacts to the client learning it was replaced outside the controller (shared configuration writes)', async () => {
        let notify: () => void = () => undefined;
        const unsubscribe = vi.fn();
        const client = gateway({ onSessionReplaced: vi.fn((listener: () => void) => { notify = listener; return unsubscribe; }) });
        const { controller, state } = controllerFor(client);
        await controller.login('admin', 'secret');
        controller.start();

        notify();

        expect(state.get().session.isAuthenticated).toBe(false);
        expect(state.get().sessionReplaced).toBe(true);
        controller.stop();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('clears the replaced flag on the next successful login', async () => {
        const { controller, state } = controllerFor(gateway());
        await controller.login('admin', 'secret');
        await controller.handleProtectedRequestError(new AdminAuthError(REPLACED, 401));
        expect(state.get().sessionReplaced).toBe(true);

        await controller.login('admin', 'secret', { takeover: true });

        expect(state.get().sessionReplaced).toBe(false);
        expect(state.get().session.isAuthenticated).toBe(true);
    });
});
