import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialAdministrationClient, CredentialAdministrationController } from '../../hooks/usePrismaCredentialAdministration';
import { AdminAuthClient, AdminAuthError } from '../../services/adminAuth.service';
import { useAuthStore } from '../../store/auth.store';
import VoiceCredentialSettings from './VoiceCredentialSettings';

const metadata = { gemini: { configured: false }, telegram: { configured: true } };
const health = {
    enabled: true, configured: true, running: true, verified: false,
    desiredGeneration: 2, appliedGeneration: 1, restartRequired: true,
    configurationError: null, lastError: null,
} as const;
const applied = {
    source: 'protected', enabled: true, configured: true,
    desiredGeneration: 2, appliedGeneration: 2, running: true,
    verified: true, restartRequired: false, lastError: null,
} as const;

function authenticated() {
    useAuthStore.setState({
        session: {
            user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } },
            isAuthenticated: true,
            loginTimestamp: new Date().toISOString(),
            absoluteExpiresAt: Math.floor(Date.now() / 1_000) + 600,
        },
        isHydrated: true,
        isAuthenticating: false,
        error: null,
    });
}

function renderSettings(clientOverrides: Partial<CredentialAdministrationClient> = {}) {
    const client: CredentialAdministrationClient = {
        credentialMetadata: vi.fn(async () => metadata),
        telegramHealth: vi.fn(async () => health),
        saveCredential: vi.fn(async () => ({ provider: 'gemini', configured: true })),
        deleteCredential: vi.fn(async () => undefined),
        applyTelegram: vi.fn(async () => applied),
        ...clientOverrides,
    };
    const controller: CredentialAdministrationController = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = render(<VoiceCredentialSettings active client={client} controller={controller} />, { wrapper: Wrapper });
    return { ...view, client, controller, queryClient, Wrapper };
}

function renderSettingsWithClient(client: AdminAuthClient) {
    const controller: CredentialAdministrationController = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = render(<VoiceCredentialSettings active client={client} controller={controller} />, { wrapper: Wrapper });
    return { ...view, controller, queryClient };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function healthEnvelope(): Record<string, unknown> {
    return {
        ok: true,
        telegramEnabled: health.enabled,
        telegramConfigured: health.configured,
        telegramConnected: health.running,
        telegramVerified: health.verified,
        telegramConfigurationError: health.configurationError,
        telegramLastError: health.lastError,
        telegramDesiredGeneration: health.desiredGeneration,
        telegramAppliedGeneration: health.appliedGeneration,
        telegramRestartRequired: health.restartRequired,
    };
}

async function createClientWithDeferredRefresh() {
    let metadataRequests = 0;
    let releaseRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => { releaseRefresh = resolve; });
    const fetcher = vi.fn<typeof fetch>((path, init) => {
        if (path === '/api/prisma/admin/auth/session') {
            return Promise.resolve(jsonResponse({
                ok: true,
                administrator: { username: 'admin' },
                csrfToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                absoluteExpiresAt: 2_000_000_000,
            }));
        }
        if (path === '/api/prisma/admin/credentials') {
            metadataRequests += 1;
            if (metadataRequests === 2) return pendingRefresh;
            return Promise.resolve(jsonResponse({ ok: true, providers: metadata }));
        }
        if (path === '/api/prisma/health') return Promise.resolve(jsonResponse(healthEnvelope()));
        if (init?.method === 'PUT') return Promise.resolve(jsonResponse({ ok: true, provider: 'gemini', configured: true }));
        if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
        if (path === '/api/prisma/admin/credentials/telegram/apply') {
            return Promise.resolve(jsonResponse({ ok: true, telegram: applied }));
        }
        throw new Error(`Unexpected request: ${String(path)} ${String(init?.method)}`);
    });
    const client = new AdminAuthClient(fetcher);
    await client.session();
    return {
        client,
        metadataRequestCount: () => metadataRequests,
        releaseRefresh: () => releaseRefresh(jsonResponse({ ok: true, providers: metadata })),
    };
}

describe('VoiceCredentialSettings', () => {
    beforeEach(authenticated);

    it('shows truthful diagnostics, preserves submitted bytes, and clears the local secret after completion', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Gemini' });
        const telegram = screen.getByRole('group', { name: 'Telegram' });

        expect(await within(gemini).findByText('Sin configurar')).toBeInTheDocument();
        expect(await within(telegram).findByText('Cambio pendiente de aplicar')).toBeInTheDocument();
        expect(within(telegram).getByText('Ejecución activa')).toBeInTheDocument();
        expect(within(telegram).getByText('Última aplicación sin verificar')).toBeInTheDocument();
        expect(within(telegram).getByText('Origen: almacén protegido')).toBeInTheDocument();
        expect(within(telegram).getByText('Generación: 2 / 1')).toBeInTheDocument();

        const input = within(gemini).getByLabelText('Credencial Gemini');
        await user.type(input, '  synthetic-secret  ');
        await user.click(within(gemini).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(client.saveCredential).toHaveBeenCalledWith(
            'gemini', '  synthetic-secret  ', expect.any(AbortSignal),
        ));
        expect(input).toHaveValue('');
        expect(screen.getByText('Credencial guardada. No se aplicaron cambios al proveedor.')).toBeInTheDocument();
        expect(client.applyTelegram).not.toHaveBeenCalled();
        expect(client.deleteCredential).not.toHaveBeenCalled();
    });

    it('clears secret inputs when hidden or when administrator authority is revoked', async () => {
        const user = userEvent.setup();
        const { rerender, client, controller } = renderSettings();
        const input = await screen.findByLabelText('Credencial Gemini');
        await user.type(input, 'synthetic-secret');

        rerender(<VoiceCredentialSettings active={false} client={client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={client} controller={controller} />);
        expect(await screen.findByLabelText('Credencial Gemini')).toHaveValue('');

        await user.type(screen.getByLabelText('Credencial Gemini'), 'another-secret');
        useAuthStore.setState((state) => ({ session: { ...state.session, user: null, isAuthenticated: false } }));
        await waitFor(() => expect(screen.getByLabelText('Credencial Gemini')).toHaveValue(''));
    });

    it('confirms deletion and reconciles a committed Telegram stop timeout only on explicit request', async () => {
        const user = userEvent.setup();
        const deleteCredential = vi.fn(async () => {
            throw new AdminAuthError('TELEGRAM_STOP_TIMEOUT', 409, true);
        });
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce({ gemini: { configured: false }, telegram: { configured: false } })
            .mockRejectedValue(new AdminAuthError('CREDENTIAL_STORAGE_UNAVAILABLE', 503));
        const { client } = renderSettings({
            credentialMetadata,
            telegramHealth: vi.fn(async () => ({ ...health, configured: false, running: true, restartRequired: true })),
            deleteCredential,
        });
        const telegram = await screen.findByRole('group', { name: 'Telegram' });

        await user.click(within(telegram).getByRole('button', { name: 'Eliminar credencial' }));
        expect(deleteCredential).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        expect(await screen.findByText(/credencial fue eliminada.*detención no pudo confirmarse/i)).toBeInTheDocument();
        expect(client.applyTelegram).not.toHaveBeenCalled();
        const retry = screen.getByRole('button', { name: 'Reintentar detención' });
        expect(retry).toBeEnabled();
        await user.click(retry);
        expect(deleteCredential).toHaveBeenCalledTimes(2);
        expect(client.applyTelegram).not.toHaveBeenCalled();
    });

    it('shows safe provisioning guidance and disables operations when protected storage is unavailable', async () => {
        renderSettings({
            credentialMetadata: vi.fn(async () => { throw new AdminAuthError('CREDENTIAL_STORAGE_UNAVAILABLE', 503); }),
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(/almacén protegido no está disponible/i);
        expect(screen.queryByText('CREDENTIAL_STORAGE_UNAVAILABLE')).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Guardar credencial' })).toSatisfy((buttons: HTMLButtonElement[]) =>
            buttons.every((button) => button.disabled));
    });

    it('applies Telegram only through its explicit action', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings();
        const apply = await screen.findByRole('button', { name: 'Aplicar cambio' });
        await waitFor(() => expect(apply).toBeEnabled());

        await user.click(apply);

        await waitFor(() => expect(client.applyTelegram).toHaveBeenCalledTimes(1));
        expect(client.saveCredential).not.toHaveBeenCalled();
        expect(client.deleteCredential).not.toHaveBeenCalled();
    });

    it('clears the secret and hides unknown backend detail after a failed completed request', async () => {
        const user = userEvent.setup();
        const saveCredential = vi.fn(async () => { throw new Error('raw-provider-detail'); });
        renderSettings({ saveCredential });
        const gemini = await screen.findByRole('group', { name: 'Gemini' });
        const input = within(gemini).getByLabelText('Credencial Gemini');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'synthetic-secret');

        await user.click(within(gemini).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(input).toHaveValue(''));
        expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar la operación con el servicio local.');
        expect(screen.queryByText('raw-provider-detail')).not.toBeInTheDocument();
    });

    it('renders loading as unknown instead of negative provider facts', async () => {
        const pendingMetadata = new Promise<typeof metadata>(() => undefined);
        renderSettings({
            credentialMetadata: vi.fn(() => pendingMetadata),
            telegramHealth: vi.fn(() => new Promise<typeof health>(() => undefined)),
        });

        expect(screen.getAllByText('Consultando estado')).toHaveLength(2);
        expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
        expect(screen.queryByText('Ejecución detenida')).not.toBeInTheDocument();
        expect(screen.queryByText('Deshabilitada')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Actualizar estado' })).toBeEnabled();
    });

    it('renders initial and malformed responses as unavailable rather than negative facts', async () => {
        const fetcher = vi.fn<typeof fetch>(async (path) => path === '/api/prisma/admin/credentials'
            ? jsonResponse({ ok: true, providers: { gemini: { configured: 'yes' } }, extra: 'synthetic-secret-canary' })
            : jsonResponse(healthEnvelope()));
        renderSettingsWithClient(new AdminAuthClient(fetcher));

        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación con el servicio local.');
        expect(screen.getAllByText('Estado no disponible')).toHaveLength(2);
        expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
        expect(screen.queryByText('Ejecución detenida')).not.toBeInTheDocument();
        expect(screen.queryByText('synthetic-secret-canary')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Actualizar estado' })).toBeEnabled();
    });

    it('marks retained facts as last known after a failed refresh and keeps only refresh enabled', async () => {
        const user = userEvent.setup();
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce(metadata)
            .mockRejectedValueOnce(new AdminAuthError('CREDENTIAL_STORAGE_UNAVAILABLE', 503));
        renderSettings({ credentialMetadata });
        expect(await screen.findByText('Ejecución activa')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Actualizar estado' }));

        expect(await screen.findByText('Último estado conocido; la actualización falló.')).toBeInTheDocument();
        expect(screen.getByText('Ejecución activa')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Actualizar estado' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Aplicar cambio' })).toBeDisabled();
        expect(screen.getAllByRole('button', { name: 'Guardar credencial' })).toSatisfy((buttons: HTMLButtonElement[]) =>
            buttons.every((button) => button.disabled));
    });

    it('does not clear a newer draft or publish save success when an old refresh completes', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredRefresh();
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const input = await screen.findByLabelText('Credencial Gemini');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'old-secret');
        await user.click(within(screen.getByRole('group', { name: 'Gemini' })).getByRole('button', { name: 'Guardar credencial' }));
        await waitFor(() => expect(controlled.metadataRequestCount()).toBe(2));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        const reopenedInput = await screen.findByLabelText('Credencial Gemini');
        await user.type(reopenedInput, 'new-secret');
        await act(async () => { controlled.releaseRefresh(); });

        await waitFor(() => expect(reopenedInput).toHaveValue('new-secret'));
        expect(screen.queryByText('Credencial guardada. No se aplicaron cambios al proveedor.')).not.toBeInTheDocument();
    });

    it('does not let a stale delete completion close a newer confirmation dialog', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredRefresh();
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const telegram = await screen.findByRole('group', { name: 'Telegram' });
        await user.click(within(telegram).getByRole('button', { name: 'Eliminar credencial' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));
        await waitFor(() => expect(controlled.metadataRequestCount()).toBe(2));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        await user.click(within(screen.getByRole('group', { name: 'Gemini' })).getByRole('button', { name: 'Eliminar credencial' }));
        expect(screen.getByRole('dialog', { name: 'Eliminar credencial' })).toBeInTheDocument();
        await act(async () => { controlled.releaseRefresh(); });

        await waitFor(() => expect(screen.getByRole('dialog', { name: 'Eliminar credencial' })).toBeInTheDocument());
        expect(screen.queryByText('Credencial eliminada.')).not.toBeInTheDocument();
    });

    it('does not publish stale Telegram apply success after panel reactivation', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredRefresh();
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const apply = await screen.findByRole('button', { name: 'Aplicar cambio' });
        await waitFor(() => expect(apply).toBeEnabled());
        await user.click(apply);
        await waitFor(() => expect(controlled.metadataRequestCount()).toBe(2));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        await act(async () => { controlled.releaseRefresh(); });

        await waitFor(() => expect(screen.queryByText('Cambio de Telegram aplicado y estado actualizado.')).not.toBeInTheDocument());
    });
});
