import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialAdministrationClient, CredentialAdministrationController } from '../../hooks/usePrismaCredentialAdministration';
import { AdminAuthClient, AdminAuthError } from '../../services/adminAuth.service';
import { useAuthStore } from '../../store/auth.store';
import VoiceCredentialSettings from './VoiceCredentialSettings';

const GEMINI_NOT_CHECKED = {
    configured: false, verified: false, verification: { state: 'not_checked', checkedAt: null },
} as const;
const GEMINI_VERIFIED = {
    configured: true, verified: true, verification: { state: 'verified', checkedAt: 1_700_000_000 },
} as const;
const TELEGRAM_TOKEN_NOT_CHECKED = { state: 'not_checked', checkedAt: null, username: null } as const;
const metadata = {
    gemini: GEMINI_NOT_CHECKED,
    telegram: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
    telegram_channel_a: { configured: false, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
};
// Shared metadata snapshot for scenarios whose channel A status reports a
// configured credential, so UI gating and status never contradict each other.
const configuredA = {
    ...metadata,
    telegram_channel_a: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
};
const TELEGRAM_VERIFIED = {
    configured: true, verified: true,
    verification: { state: 'verified', checkedAt: 1_700_000_002, username: 'prisma_bot' },
} as const;
const CHANNEL_A_VERIFIED = {
    configured: true, verified: true,
    verification: { state: 'verified', checkedAt: 1_700_000_003, username: 'prisma_channel_a_bot' },
} as const;
// configuredA with both Telegram-family rows already token-verified, so a
// single fixture covers "credential configured AND token verified" for both
// rows without re-deriving it per test.
const configuredAndVerified = {
    gemini: metadata.gemini,
    telegram: TELEGRAM_VERIFIED,
    telegram_channel_a: CHANNEL_A_VERIFIED,
};
const health = {
    enabled: true, configured: true, running: true, verified: false,
    desiredGeneration: 2, appliedGeneration: 1, restartRequired: true,
    configurationError: null, lastError: null, botUsername: null,
} as const;
const applied = {
    source: 'protected', enabled: true, configured: true,
    desiredGeneration: 2, appliedGeneration: 2, running: true,
    verified: true, restartRequired: false, lastError: null, botUsername: null,
} as const;
// Canonical seven-key channel A status (T10 adds botUsername) with nullable
// generations/activation and lowercase backend phases; mirrors the frozen
// domain parser contract.
const channelAIdle = {
    configured: false,
    desiredGeneration: 1,
    appliedGeneration: null,
    activationEpoch: null,
    activation: null,
    lastError: null,
    botUsername: null,
} as const;
const channelARunning = {
    configured: true,
    desiredGeneration: 4,
    appliedGeneration: 4,
    activationEpoch: 2,
    activation: { phase: 'running', reason: null, quiescent: false, restartRequired: false },
    lastError: null,
    botUsername: 'prisma_channel_a_bot',
} as const;
const channelAStopUnconfirmed = {
    configured: true,
    desiredGeneration: 4,
    appliedGeneration: 4,
    activationEpoch: 2,
    activation: { phase: 'stopped', reason: 'PRISMA_CHANNEL_A_RESTART_REQUIRED', quiescent: true, restartRequired: true },
    lastError: 'PRISMA_CHANNEL_A_STOP_UNCONFIRMED',
    botUsername: null,
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
        channelAStatus: vi.fn(async () => channelAIdle),
        applyChannelA: vi.fn(async () => channelARunning),
        verifyGemini: vi.fn(async () => GEMINI_VERIFIED),
        verifyTelegram: vi.fn(async () => TELEGRAM_VERIFIED),
        verifyChannelA: vi.fn(async () => CHANNEL_A_VERIFIED),
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

// Accessible name alone can't distinguish between two icons that share the
// same tooltip copy (e.g. the "not yet verified" label stayed the same when
// CircleDashed became MessageCircleDashedCheck in T9c); assert the actual
// lucide icon identity via its generated `lucide-<kebab-name>` class.
function expectLucideIcon(icon: HTMLElement, kebabName: string): void {
    const svg = icon.querySelector('svg');
    expect(svg).toHaveClass(`lucide-${kebabName}`);
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
        telegramBotUsername: health.botUsername,
    };
}

async function createClientWithDeferredChannelAWrite(method: 'PUT' | 'DELETE') {
    let releaseWrite!: () => void;
    const pendingWrite = new Promise<Response>((resolve) => {
        releaseWrite = () => resolve(method === 'PUT'
            ? jsonResponse({ ok: true, provider: 'telegram_channel_a', configured: true })
            : new Response(null, { status: 204 }));
    });
    const fetcher = vi.fn<typeof fetch>((path, init) => {
        if (path === '/api/prisma/admin/auth/session') {
            return Promise.resolve(jsonResponse({
                ok: true,
                administrator: { username: 'admin' },
                csrfToken: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                absoluteExpiresAt: 2_000_000_000,
            }));
        }
        if (path === '/api/prisma/admin/credentials' && (init?.method ?? 'GET') === 'GET') {
            return Promise.resolve(jsonResponse({ ok: true, providers: metadata }));
        }
        if (path === '/api/prisma/health') return Promise.resolve(jsonResponse(healthEnvelope()));
        if (path === '/api/prisma/admin/credentials/telegram_channel_a/status') {
            return Promise.resolve(jsonResponse({ ok: true, channelA: channelAIdle }));
        }
        if (path === '/api/prisma/admin/credentials/telegram_channel_a' && init?.method === method) {
            return pendingWrite;
        }
        throw new Error(`Unexpected request: ${String(path)} ${String(init?.method)}`);
    });
    const client = new AdminAuthClient(fetcher);
    await client.session();
    return { client, releaseWrite };
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
        if (path === '/api/prisma/admin/credentials/telegram_channel_a/status') {
            return Promise.resolve(jsonResponse({ ok: true, channelA: channelAIdle }));
        }
        if (init?.method === 'PUT') return Promise.resolve(jsonResponse({ ok: true, provider: 'gemini', configured: true }));
        if (init?.method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
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

    it('has no manual "Actualizar estado" refresh button', async () => {
        renderSettings();
        await screen.findByRole('group', { name: 'Proveedor de voz' });

        expect(screen.queryByRole('button', { name: 'Actualizar estado' })).not.toBeInTheDocument();
    });

    it('shows truthful diagnostics, preserves submitted bytes, and clears the local secret after completion', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const telegram = screen.getByRole('group', { name: 'Canal B' });

        expect(await within(gemini).findByRole('img', { name: 'Credencial no configurada' })).toBeInTheDocument();
        expect(within(gemini).getByRole('img', { name: 'Verificación: no realizada' })).toBeInTheDocument();
        expect(within(gemini).queryByText('Credencial no configurada')).not.toBeInTheDocument();
        expect(within(gemini).queryByText('Verificación: no realizada')).not.toBeInTheDocument();
        // Telegram's execution icon reflects the real health fixture (restartRequired
        // true, running true, no lastError -> connected).
        expect(await within(telegram).findByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();

        const input = within(gemini).getByLabelText('API Key de Gemini');
        await user.type(input, '  synthetic-secret  ');
        await user.click(within(gemini).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(client.saveCredential).toHaveBeenCalledWith(
            'gemini', '  synthetic-secret  ', expect.any(AbortSignal),
        ));
        expect(input).toHaveValue('');
        expect(screen.getByText('Credencial guardada. No se aplicaron cambios al proveedor.')).toBeInTheDocument();
        expect(client.deleteCredential).not.toHaveBeenCalled();
    });

    it('clears every provider secret input when hidden or when administrator authority is revoked', async () => {
        const user = userEvent.setup();
        const { rerender, client, controller } = renderSettings();
        const input = await screen.findByLabelText('API Key de Gemini');
        const telegram = screen.getByRole('group', { name: 'Canal B' });
        const channelA = screen.getByRole('group', { name: 'Canal A' });
        await user.type(input, 'synthetic-secret');
        await user.type(within(telegram).getByLabelText('Telegram bot API Token'), 'synthetic-telegram-secret');
        await user.type(within(channelA).getByLabelText('Telegram bot API Token'), 'synthetic-channel-a-secret');

        rerender(<VoiceCredentialSettings active={false} client={client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={client} controller={controller} />);
        expect(await screen.findByLabelText('API Key de Gemini')).toHaveValue('');
        expect(within(screen.getByRole('group', { name: 'Canal B' })).getByLabelText('Telegram bot API Token')).toHaveValue('');
        expect(within(screen.getByRole('group', { name: 'Canal A' })).getByLabelText('Telegram bot API Token')).toHaveValue('');

        await user.type(screen.getByLabelText('API Key de Gemini'), 'another-secret');
        useAuthStore.setState((state) => ({ session: { ...state.session, user: null, isAuthenticated: false } }));
        await waitFor(() => expect(screen.getByLabelText('API Key de Gemini')).toHaveValue(''));
    });

    it('confirms deletion and reconciles a committed Telegram stop timeout only on explicit request', async () => {
        const user = userEvent.setup();
        const deleteCredential = vi.fn(async () => {
            throw new AdminAuthError('TELEGRAM_STOP_TIMEOUT', 409, true);
        });
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce({
                gemini: GEMINI_NOT_CHECKED,
                telegram: { configured: false },
                telegram_channel_a: { configured: false },
            })
            .mockRejectedValue(new AdminAuthError('CREDENTIAL_STORAGE_UNAVAILABLE', 503));
        const { client } = renderSettings({
            credentialMetadata,
            telegramHealth: vi.fn(async () => ({ ...health, configured: false, running: true, restartRequired: true })),
            deleteCredential,
        });
        const telegram = await screen.findByRole('group', { name: 'Canal B' });

        await user.click(within(telegram).getByRole('button', { name: 'Eliminar credencial' }));
        expect(deleteCredential).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        expect(await screen.findByText(/credencial fue eliminada.*detención no pudo confirmarse/i)).toBeInTheDocument();
        expect(client.applyTelegram).not.toHaveBeenCalled();
        const retry = screen.getByRole('button', { name: 'Reintentar detención' });
        expect(retry).toBeEnabled();
        await user.click(retry);
        expect(deleteCredential).toHaveBeenCalledTimes(2);
        expect(deleteCredential).toHaveBeenNthCalledWith(1, 'telegram', expect.any(AbortSignal));
        expect(deleteCredential).toHaveBeenNthCalledWith(2, 'telegram', expect.any(AbortSignal));
        expect(deleteCredential).not.toHaveBeenCalledWith('telegram_channel_a', expect.anything());
        expect(client.applyTelegram).not.toHaveBeenCalled();
    });

    it('shows safe provisioning guidance and disables operations when protected storage is unavailable', async () => {
        renderSettings({
            credentialMetadata: vi.fn(async () => { throw new AdminAuthError('CREDENTIAL_STORAGE_UNAVAILABLE', 503); }),
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(/almacén protegido no está disponible/i);
        expect(screen.queryByText('CREDENTIAL_STORAGE_UNAVAILABLE')).not.toBeInTheDocument();
        const saveButtons = screen.getAllByRole('button', { name: 'Guardar credencial' });
        expect(saveButtons).toHaveLength(3);
        expect(saveButtons).toSatisfy((buttons: HTMLButtonElement[]) =>
            buttons.every((button) => button.disabled));
        expect(screen.getAllByText('Estado no disponible')).toHaveLength(3);
    });

    it('has no "Aplicar cambio" button anywhere: saving Telegram or Canal A applies on the backend instead', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        await screen.findByRole('group', { name: 'Canal B' });

        expect(screen.queryByRole('button', { name: 'Aplicar cambio' })).not.toBeInTheDocument();
    });

    it('saves Telegram through its exact provider only, never through the retired apply action', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings();
        const telegram = await screen.findByRole('group', { name: 'Canal B' });
        const input = within(telegram).getByLabelText('Telegram bot API Token');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'new-telegram-token');

        await user.click(within(telegram).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(client.saveCredential).toHaveBeenCalledWith(
            'telegram', 'new-telegram-token', expect.any(AbortSignal),
        ));
        expect(client.applyTelegram).not.toHaveBeenCalled();
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(client.deleteCredential).not.toHaveBeenCalled();
    });

    it('shows a channel identity collision surfaced after save as the error execution icon with safe guidance, never the raw code', async () => {
        renderSettings({
            telegramHealth: vi.fn(async () => ({
                ...health, running: false, verified: false, lastError: 'TELEGRAM_BOT_IDENTITY_RESERVED',
            })),
        });
        const telegram = await screen.findByRole('group', { name: 'Canal B' });

        const icon = await within(telegram).findByRole('img', { name: 'No se pudo conectar el bot' });
        expectLucideIcon(icon, 'circle-x');
        expect(within(telegram).getByText(
            'Este bot ya está en uso por el otro canal. Configure un bot distinto.',
        )).toBeInTheDocument();
        expect(within(telegram).queryByText('TELEGRAM_BOT_IDENTITY_RESERVED')).not.toBeInTheDocument();
    });

    it('clears the secret and hides unknown backend detail after a failed completed request', async () => {
        const user = userEvent.setup();
        const saveCredential = vi.fn(async () => { throw new Error('raw-provider-detail'); });
        renderSettings({ saveCredential });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const input = within(gemini).getByLabelText('API Key de Gemini');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'synthetic-secret');

        await user.click(within(gemini).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(input).toHaveValue(''));
        expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar la operación con el servicio local.');
        expect(screen.queryByText('raw-provider-detail')).not.toBeInTheDocument();
    });

    it('renders the channel A card with its own status, botUsername and description, matching the Gemini row design', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const telegram = screen.getByRole('group', { name: 'Canal B' });

        expect(screen.getAllByRole('group')).toHaveLength(3);
        expect(channelA).not.toBe(telegram);
        expect(within(channelA).getByText(
            'Canal privado de Telegram: se vincula con un QR y Prisma responde consultas sobre la interfaz.',
        )).toBeInTheDocument();
        const input = await within(channelA).findByLabelText('Telegram bot API Token');
        // Same Chrome password-manager workaround as Gemini's field.
        expect(input).not.toHaveAttribute('type', 'password');
        expect(input).toHaveAttribute('type', 'text');
        expect(input.className).toMatch(/hmi-masked-text/);
        // Running fixture: connected icon and the connected bot's username.
        expect(await within(channelA).findByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        expect(within(channelA).getByText('@prisma_channel_a_bot')).toBeInTheDocument();
        // No "Aplicar cambio" button and no verification claim for channel A.
        expect(within(channelA).queryByRole('button', { name: 'Aplicar cambio' })).not.toBeInTheDocument();
        expect(within(channelA).queryByText(/Verificaci/)).not.toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Guardar credencial' })).toHaveLength(3);
        expect(screen.getAllByRole('button', { name: 'Eliminar credencial' })).toHaveLength(3);
    });

    it('saves and deletes the channel A credential on its exact provider without cross-clearing other drafts', async () => {
        const user = userEvent.setup();
        const saveCredential = vi.fn(async () => ({ provider: 'telegram_channel_a' as const, configured: true }));
        const deleteCredential = vi.fn(async () => undefined);
        const { client } = renderSettings({ saveCredential, deleteCredential });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const telegram = screen.getByRole('group', { name: 'Canal B' });
        const gemini = screen.getByRole('group', { name: 'Proveedor de voz' });
        const geminiInput = within(gemini).getByLabelText('API Key de Gemini');
        const telegramInput = within(telegram).getByLabelText('Telegram bot API Token');
        const channelAInput = within(channelA).getByLabelText('Telegram bot API Token');
        await waitFor(() => expect(channelAInput).toBeEnabled());
        await user.type(geminiInput, 'gemini-draft');
        await user.type(telegramInput, 'telegram-draft');
        await user.type(channelAInput, 'channel-a-secret');

        await user.click(within(channelA).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(saveCredential).toHaveBeenCalledWith(
            'telegram_channel_a', 'channel-a-secret', expect.any(AbortSignal),
        ));
        expect(saveCredential).toHaveBeenCalledTimes(1);
        expect(client.applyTelegram).not.toHaveBeenCalled();
        expect(client.applyChannelA).not.toHaveBeenCalled();
        // Distinct from Gemini's message: Channel A save applies on the backend.
        expect(await screen.findByText('Credencial guardada y aplicada.')).toBeInTheDocument();
        expect(channelAInput).toHaveValue('');
        expect(geminiInput).toHaveValue('gemini-draft');
        expect(telegramInput).toHaveValue('telegram-draft');

        await user.click(within(channelA).getByRole('button', { name: 'Eliminar credencial' }));
        const dialog = screen.getByRole('dialog', { name: 'Eliminar credencial' });
        expect(within(dialog).getByText(
            'La credencial protegida de Canal A se eliminará del servicio local. Esta acción no puede deshacerse.',
        )).toBeInTheDocument();
        expect(deleteCredential).not.toHaveBeenCalled();
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        await waitFor(() => expect(deleteCredential).toHaveBeenCalledWith('telegram_channel_a', expect.any(AbortSignal)));
        expect(client.applyTelegram).not.toHaveBeenCalled();
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(await screen.findByText('Credencial eliminada.')).toBeInTheDocument();
        expect(geminiInput).toHaveValue('gemini-draft');
        expect(telegramInput).toHaveValue('telegram-draft');
    });

    it('never persists channel A credential bytes in browser storage or the metadata cache', async () => {
        const user = userEvent.setup();
        const secret = 'synthetic-channel-a-canary';
        const { queryClient } = renderSettings();
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const input = within(channelA).getByLabelText('Telegram bot API Token');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, secret);

        await user.click(within(channelA).getByRole('button', { name: 'Guardar credencial' }));
        await waitFor(() => expect(input).toHaveValue(''));

        expect(JSON.stringify(localStorage)).not.toContain(secret);
        expect(JSON.stringify(sessionStorage)).not.toContain(secret);
        expect(JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data))).not.toContain(secret);
        expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain(secret);
        expect(JSON.stringify(useAuthStore.getState())).not.toContain(secret);
    });

    it('does not let a late channel A save clear a newer draft or other provider drafts after reactivation', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredChannelAWrite('PUT');
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const input = within(channelA).getByLabelText('Telegram bot API Token');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'old-channel-a-secret');
        await user.click(within(channelA).getByRole('button', { name: 'Guardar credencial' }));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        const reopenedChannelA = await screen.findByRole('group', { name: 'Canal A' });
        const reopened = within(reopenedChannelA).getByLabelText('Telegram bot API Token');
        const telegram = screen.getByRole('group', { name: 'Canal B' });
        const telegramInput = within(telegram).getByLabelText('Telegram bot API Token');
        await user.type(reopened, 'newer-channel-a-draft');
        await user.type(telegramInput, 'telegram-draft');
        await user.type(screen.getByLabelText('API Key de Gemini'), 'gemini-draft');
        await act(async () => { controlled.releaseWrite(); });

        await waitFor(() => expect(reopened).toHaveValue('newer-channel-a-draft'));
        expect(telegramInput).toHaveValue('telegram-draft');
        expect(screen.getByLabelText('API Key de Gemini')).toHaveValue('gemini-draft');
        expect(screen.queryByText('Credencial guardada y aplicada.')).not.toBeInTheDocument();
    });

    it('does not let a stale channel A deletion close a fresh confirmation dialog or clear other drafts', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredChannelAWrite('DELETE');
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        await user.click(within(channelA).getByRole('button', { name: 'Eliminar credencial' }));
        const channelADialog = screen.getByRole('dialog', { name: 'Eliminar credencial' });
        expect(within(channelADialog).getByText(
            'La credencial protegida de Canal A se eliminará del servicio local. Esta acción no puede deshacerse.',
        )).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        const telegram = screen.getByRole('group', { name: 'Canal B' });
        const telegramInput = within(telegram).getByLabelText('Telegram bot API Token');
        await user.type(telegramInput, 'telegram-draft');
        await user.click(within(screen.getByRole('group', { name: 'Proveedor de voz' })).getByRole('button', { name: 'Eliminar credencial' }));
        const freshDialog = screen.getByRole('dialog', { name: 'Eliminar credencial' });
        expect(within(freshDialog).getByText(
            'La credencial protegida del proveedor de voz se eliminará del servicio local. Esta acción no puede deshacerse.',
        )).toBeInTheDocument();
        await act(async () => { controlled.releaseWrite(); });

        await waitFor(() => expect(screen.getByRole('dialog', { name: 'Eliminar credencial' })).toBeInTheDocument());
        expect(screen.queryByText('Credencial eliminada.')).not.toBeInTheDocument();
        expect(telegramInput).toHaveValue('telegram-draft');
    });

    it('renders loading as unknown instead of negative provider facts', async () => {
        const pendingMetadata = new Promise<typeof metadata>(() => undefined);
        renderSettings({
            credentialMetadata: vi.fn(() => pendingMetadata),
            telegramHealth: vi.fn(() => new Promise<typeof health>(() => undefined)),
            channelAStatus: vi.fn(() => new Promise<typeof channelAIdle>(() => undefined)),
        });

        expect(screen.getAllByText('Consultando estado')).toHaveLength(3);
        expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
        expect(screen.queryByText('Ejecución detenida')).not.toBeInTheDocument();
        expect(screen.queryByText('Deshabilitada')).not.toBeInTheDocument();
    });

    it('renders initial and malformed responses as unavailable rather than negative facts', async () => {
        const fetcher = vi.fn<typeof fetch>(async (path) => path === '/api/prisma/admin/credentials'
            ? jsonResponse({ ok: true, providers: { gemini: { configured: 'yes' } }, extra: 'synthetic-secret-canary' })
            : jsonResponse(healthEnvelope()));
        renderSettingsWithClient(new AdminAuthClient(fetcher));

        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación con el servicio local.');
        expect(screen.getAllByText('Estado no disponible')).toHaveLength(3);
        expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
        expect(screen.queryByText('Ejecución detenida')).not.toBeInTheDocument();
        expect(screen.queryByText('synthetic-secret-canary')).not.toBeInTheDocument();
    });

    it('marks retained facts as last known after the automatic post-save refresh fails', async () => {
        // No manual "Actualizar estado" button and no "Aplicar cambio" button
        // exist any more; drive the same refetch-failure path through Save,
        // which triggers an automatic refresh internally (as delete/verify do).
        const user = userEvent.setup();
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce(metadata)
            .mockRejectedValueOnce(new AdminAuthError('CREDENTIAL_STORAGE_UNAVAILABLE', 503));
        renderSettings({ credentialMetadata });
        const telegram = await screen.findByRole('group', { name: 'Canal B' });
        expect(await within(telegram).findByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        const input = within(telegram).getByLabelText('Telegram bot API Token');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'new-telegram-token');

        await user.click(within(telegram).getByRole('button', { name: 'Guardar credencial' }));

        expect(await screen.findByText('Último estado conocido; la actualización falló.')).toBeInTheDocument();
        // Prior Telegram data is retained by TanStack Query on the failed refetch.
        expect(within(telegram).getByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Guardar credencial' })).toSatisfy((buttons: HTMLButtonElement[]) =>
            buttons.every((button) => button.disabled));
    });

    it('retains the last known channel A status and labels the card after the automatic post-save refresh fails', async () => {
        // Same rationale as above: drive the refetch failure through Channel
        // A's own Save instead of the removed refresh/apply buttons.
        const user = userEvent.setup();
        const statusFailure = new AdminAuthError('PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE', 503, false);
        const channelAStatus = vi.fn(async () => channelARunning)
            .mockResolvedValueOnce(channelARunning)
            .mockRejectedValueOnce(statusFailure);
        const saveCredential = vi.fn(async () => ({ provider: 'telegram_channel_a' as const, configured: true }));
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus, saveCredential });
        const initialCard = await screen.findByRole('group', { name: 'Canal A' });
        expect(await within(initialCard).findByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        const input = within(initialCard).getByLabelText('Telegram bot API Token');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'new-channel-a-token');

        await user.click(within(initialCard).getByRole('button', { name: 'Guardar credencial' }));

        const channelACard = screen.getByRole('group', { name: 'Canal A' });
        expect(await within(channelACard).findByText('Último estado conocido; la actualización falló.')).toBeInTheDocument();
        // Prior A data is retained by TanStack Query on the failed refetch.
        expect(within(channelACard).getByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        // The failure surfaces as the sanitized card message, never the raw code.
        expect(within(channelACard).getByText('El estado del Canal A no está disponible.')).toBeInTheDocument();
        expect(screen.queryByText('PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE')).not.toBeInTheDocument();
    });

    it('does not clear a newer draft or publish save success when an old refresh completes', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredRefresh();
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const input = await screen.findByLabelText('API Key de Gemini');
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'old-secret');
        await user.click(within(screen.getByRole('group', { name: 'Proveedor de voz' })).getByRole('button', { name: 'Guardar credencial' }));
        await waitFor(() => expect(controlled.metadataRequestCount()).toBe(2));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        const reopenedInput = await screen.findByLabelText('API Key de Gemini');
        await user.type(reopenedInput, 'new-secret');
        await act(async () => { controlled.releaseRefresh(); });

        await waitFor(() => expect(reopenedInput).toHaveValue('new-secret'));
        expect(screen.queryByText('Credencial guardada. No se aplicaron cambios al proveedor.')).not.toBeInTheDocument();
    });

    it('does not let a stale delete completion close a newer confirmation dialog', async () => {
        const user = userEvent.setup();
        const controlled = await createClientWithDeferredRefresh();
        const { rerender, controller } = renderSettingsWithClient(controlled.client);
        const telegram = await screen.findByRole('group', { name: 'Canal B' });
        await user.click(within(telegram).getByRole('button', { name: 'Eliminar credencial' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));
        await waitFor(() => expect(controlled.metadataRequestCount()).toBe(2));

        rerender(<VoiceCredentialSettings active={false} client={controlled.client} controller={controller} />);
        rerender(<VoiceCredentialSettings active client={controlled.client} controller={controller} />);
        await user.click(within(screen.getByRole('group', { name: 'Proveedor de voz' })).getByRole('button', { name: 'Eliminar credencial' }));
        expect(screen.getByRole('dialog', { name: 'Eliminar credencial' })).toBeInTheDocument();
        await act(async () => { controlled.releaseRefresh(); });

        await waitFor(() => expect(screen.getByRole('dialog', { name: 'Eliminar credencial' })).toBeInTheDocument());
        expect(screen.queryByText('Credencial eliminada.')).not.toBeInTheDocument();
    });

    it('shows the channel A connected/stopped execution icon from the real status', async () => {
        const running = renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
        });
        const runningCard = await screen.findByRole('group', { name: 'Canal A' });
        expect(await within(runningCard).findByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        expect(within(runningCard).getByText('@prisma_channel_a_bot')).toBeInTheDocument();
        running.unmount();

        const stopped = {
            ...channelARunning,
            activation: { phase: 'stopped', reason: null, quiescent: true, restartRequired: false },
            botUsername: null,
        } as const;
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => stopped) });
        const idleCard = await screen.findByRole('group', { name: 'Canal A' });
        expect(await within(idleCard).findByRole('img', { name: 'Bot detenido' })).toBeInTheDocument();
        expect(within(idleCard).queryByText('@prisma_channel_a_bot')).not.toBeInTheDocument();
    });

    it('shows no execution icon at all for an unconfigured channel A credential', async () => {
        renderSettings();
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        await waitFor(() => expect(within(channelA).getByLabelText('Telegram bot API Token')).toBeEnabled());
        expect(within(channelA).queryByRole('img', { name: 'Bot conectado' })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Bot detenido' })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'No se pudo conectar el bot' })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Estado del bot no confirmado' })).not.toBeInTheDocument();
    });

    // Regression: the non-quiescent 'stopping' and 'failed' phases must not
    // render as the confirmed-stopped "Bot detenido" icon; idle/stopped
    // phases legitimately keep it, and only a genuinely unconfirmed phase
    // (failed/retired/running-with-restart) gets the neutral unconfirmed icon.
    it.each([
        { phase: 'stopping' as const, expectedName: 'Conectando…', expectedIcon: 'loader-2' },
        { phase: 'failed' as const, expectedName: 'Estado del bot no confirmado', expectedIcon: 'circle-dashed' },
    ])('does not render a non-running channel A activation phase ($phase) as stopped', async ({ phase, expectedName, expectedIcon }) => {
        const status = {
            ...channelARunning,
            activation: { phase, reason: null, quiescent: false, restartRequired: false },
            lastError: null,
            botUsername: null,
        } as const;
        const { client } = renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => status),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        const icon = await within(channelA).findByRole('img', { name: expectedName });
        expectLucideIcon(icon, expectedIcon);
        expect(within(channelA).queryByRole('img', { name: 'Bot detenido' })).not.toBeInTheDocument();
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(client.deleteCredential).not.toHaveBeenCalled();
    });

    it('shows the channel A stop-unconfirmed lastError as the error icon, distinct from Telegram', async () => {
        const status = {
            ...channelARunning,
            lastError: 'PRISMA_CHANNEL_A_STOP_UNCONFIRMED',
        } as const;
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => status),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const telegram = screen.getByRole('group', { name: 'Canal B' });

        const icon = await within(channelA).findByRole('img', { name: 'No se pudo conectar el bot' });
        expectLucideIcon(icon, 'circle-x');
        expect(within(telegram).queryByRole('img', { name: 'No se pudo conectar el bot' })).not.toBeInTheDocument();
    });

    it('disables only channel A controls when its status fails and keeps Gemini/B usable', async () => {
        renderSettings({
            channelAStatus: vi.fn(async () => {
                throw new AdminAuthError('PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE', 503, false);
            }),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const gemini = screen.getByRole('group', { name: 'Proveedor de voz' });
        const telegram = screen.getByRole('group', { name: 'Canal B' });

        // Anchor every disablement assertion to the settled A error, not to a
        // blank-draft or initial-load state that would disable controls anyway.
        expect(await within(channelA).findByText('El estado del Canal A no está disponible.')).toBeInTheDocument();
        expect(within(channelA).getByLabelText('Telegram bot API Token')).toBeDisabled();
        expect(within(channelA).getByRole('button', { name: 'Guardar credencial' })).toBeDisabled();
        expect(within(channelA).getByRole('button', { name: 'Eliminar credencial' })).toBeDisabled();
        expect(screen.queryByText('PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE')).not.toBeInTheDocument();

        expect(within(gemini).getByLabelText('API Key de Gemini')).toBeEnabled();
        expect(within(telegram).getByLabelText('Telegram bot API Token')).toBeEnabled();
    });

    it('retries only the channel A stop-unconfirmed deletion from its own warning', async () => {
        const user = userEvent.setup();
        const deleteCredential = vi.fn(async () => {
            throw new AdminAuthError('PRISMA_CHANNEL_A_STOP_UNCONFIRMED', 409, true);
        });
        const { client } = renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            deleteCredential,
            channelAStatus: vi.fn(async () => channelARunning),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        await waitFor(() => expect(within(channelA).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled());

        await user.click(within(channelA).getByRole('button', { name: 'Eliminar credencial' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        expect(await screen.findByText('La credencial fue eliminada, pero la detención no pudo confirmarse.'))
            .toBeInTheDocument();
        const retry = screen.getByRole('button', { name: 'Reintentar detención' });
        expect(retry).toBeEnabled();
        await user.click(retry);

        expect(deleteCredential).toHaveBeenCalledTimes(2);
        expect(deleteCredential).toHaveBeenNthCalledWith(1, 'telegram_channel_a', expect.any(AbortSignal));
        expect(deleteCredential).toHaveBeenNthCalledWith(2, 'telegram_channel_a', expect.any(AbortSignal));
        expect(deleteCredential).not.toHaveBeenCalledWith('telegram', expect.anything());
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(await screen.findByText('La credencial ya no existe, pero la detención todavía no pudo confirmarse.'))
            .toBeInTheDocument();
    });

    it('renders save and delete credential actions as icon-only controls with their accessible names preserved', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        const save = within(gemini).getByRole('button', { name: 'Guardar credencial' });
        const remove = within(gemini).getByRole('button', { name: 'Eliminar credencial' });

        // Icon-only: no visible text node, but the accessible name (via aria-label) is unchanged,
        // so every existing getByRole('button', { name: ... }) query keeps working.
        expect(save.textContent?.trim()).toBe('');
        expect(save).toHaveAccessibleName('Guardar credencial');
        expect(remove.textContent?.trim()).toBe('');
        expect(remove).toHaveAccessibleName('Eliminar credencial');
    });

    it('renders a fixed non-secret mask as the API Key placeholder when a Gemini credential is configured', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: GEMINI_VERIFIED })) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const input = await within(gemini).findByLabelText('API Key de Gemini');

        await waitFor(() => expect(input).toHaveAttribute('placeholder', '•'.repeat(12)));
        expect(input).toHaveValue('');
    });

    it('never shows the mask placeholder when no Gemini credential is configured', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const input = await within(gemini).findByLabelText('API Key de Gemini');

        expect(input).not.toHaveAttribute('placeholder');
    });

    it('lets typing a new Gemini key replace the mask without carrying its characters into the saved draft', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: GEMINI_VERIFIED })) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const input = await within(gemini).findByLabelText('API Key de Gemini');
        await waitFor(() => expect(input).toHaveAttribute('placeholder', '•'.repeat(12)));

        await user.type(input, 'new-real-key');
        expect(input).toHaveValue('new-real-key');
        await user.click(within(gemini).getByRole('button', { name: 'Guardar credencial' }));

        await waitFor(() => expect(client.saveCredential).toHaveBeenCalledWith(
            'gemini', 'new-real-key', expect.any(AbortSignal),
        ));
    });

    it('never renders the API Key field as a native password input, to keep Chrome from offering to generate or save one', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const input = await within(gemini).findByLabelText('API Key de Gemini');

        expect(input).not.toHaveAttribute('type', 'password');
        expect(input).toHaveAttribute('type', 'text');
        expect(input).toHaveAttribute('autocomplete', 'off');
        expect(input).toHaveAttribute('spellcheck', 'false');
        expect(input).toHaveAttribute('autocapitalize', 'off');
        expect(input).toHaveAttribute('autocorrect', 'off');
        expect(input).toHaveAttribute('data-1p-ignore');
        expect(input).toHaveAttribute('data-lpignore', 'true');
        expect(input).toHaveAttribute('data-form-type', 'other');
        // Visually masks keystrokes via CSS (-webkit-text-security) instead of
        // a real type="password" input, which is what triggers Chrome's
        // generate/save-password prompts in the first place.
        expect(input.className).toMatch(/hmi-masked-text/);
    });

    it('renders the Gemini legend as a floated full-width block, not the native border-notch legend', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const legend = gemini.querySelector('legend');

        expect(legend).toHaveTextContent('Proveedor de voz');
        // The float-left + w-full technique is what takes the legend out of the
        // fieldset's native border-notch rendering path so the top border stays
        // continuous; a following clearing element keeps later row content from
        // trying to wrap beside it.
        expect(legend).toHaveClass('float-left');
        expect(legend).toHaveClass('w-full');
    });

    it('renames the Gemini API Key field to "API Key de Gemini"', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        expect(await within(gemini).findByLabelText('API Key de Gemini')).toBeInTheDocument();
        expect(within(gemini).queryByLabelText('API Key', { exact: true })).not.toBeInTheDocument();
    });

    it('shows the Gemini credential status as a warning-tone MessageCircleWarning when not configured, Check once configured', async () => {
        const notConfigured = renderSettings();
        const notConfiguredGroup = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const notConfiguredIcon = await within(notConfiguredGroup).findByRole('img', { name: 'Credencial no configurada' });
        expectLucideIcon(notConfiguredIcon, 'message-circle-warning');
        expect(within(notConfiguredGroup).queryByText('Credencial no configurada')).not.toBeInTheDocument();
        notConfigured.unmount();

        renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: GEMINI_VERIFIED })) });
        const configuredGroup = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const configuredIcon = await within(configuredGroup).findByRole('img', { name: 'Credencial configurada' });
        expectLucideIcon(configuredIcon, 'check');
        expect(within(configuredGroup).queryByText('Credencial configurada')).not.toBeInTheDocument();
    });

    it('shows a tooltip explaining why Verificar is disabled when Gemini is not configured', async () => {
        const user = userEvent.setup();
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const verify = await within(gemini).findByRole('button', { name: 'Verificar' });
        expect(verify).toBeDisabled();

        await user.hover(verify);

        expect(await screen.findByRole('tooltip')).toHaveTextContent('Configure una API key para verificarla.');
    });

    it('places the API Key input, credential icon, Save, Delete, Verificar and the verification icon in one row', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: GEMINI_VERIFIED })) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const row = await within(gemini).findByTestId('gemini-credential-row');

        const input = within(row).getByLabelText('API Key de Gemini');
        const credentialIcon = within(row).getByRole('img', { name: 'Credencial configurada' });
        const save = within(row).getByRole('button', { name: 'Guardar credencial' });
        const del = within(row).getByRole('button', { name: 'Eliminar credencial' });
        const verify = within(row).getByRole('button', { name: 'Verificar' });
        const verificationIcon = within(row).getByRole('img', { name: 'Verificada' });

        // Structural: every control lives inside the single shared row container,
        // not split across separate columns.
        expect(row).toContainElement(input);
        expect(row).toContainElement(credentialIcon);
        expect(row).toContainElement(save);
        expect(row).toContainElement(del);
        expect(row).toContainElement(verify);
        expect(row).toContainElement(verificationIcon);
    });

    it('disables Verificar until a Gemini credential is configured', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        expect(await within(gemini).findByRole('button', { name: 'Verificar' })).toBeDisabled();
    });

    it('verifies the Gemini credential through its explicit action and shows the result as an icon', async () => {
        const user = userEvent.setup();
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })
            .mockResolvedValueOnce({ ...metadata, gemini: GEMINI_VERIFIED });
        const verifyGemini = vi.fn(async () => GEMINI_VERIFIED);
        const { client } = renderSettings({ credentialMetadata, verifyGemini });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const notCheckedIcon = await within(gemini).findByRole('img', { name: 'Verificación: no realizada' });
        expectLucideIcon(notCheckedIcon, 'message-circle-dashed-check');
        const verify = within(gemini).getByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(client.verifyGemini).toHaveBeenCalledWith(expect.any(AbortSignal));
        const verifiedIcon = await within(gemini).findByRole('img', { name: 'Verificada' });
        expectLucideIcon(verifiedIcon, 'check');
        expect(within(gemini).queryByText('Verificada')).not.toBeInTheDocument();
    });

    it('shows Verificando and a spinning icon while a Gemini verification is in flight, and disables the button', async () => {
        const user = userEvent.setup();
        let release!: (value: typeof GEMINI_VERIFIED) => void;
        const pending = new Promise<typeof GEMINI_VERIFIED>((resolve) => { release = resolve; });
        const verifyGemini = vi.fn(() => pending);
        renderSettings({
            credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })),
            verifyGemini,
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const verify = await within(gemini).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(await within(gemini).findByRole('button', { name: 'Verificando…' })).toBeDisabled();
        const verifyingIcon = within(gemini).getByRole('img', { name: 'Verificando…' });
        expectLucideIcon(verifyingIcon, 'loader-2');
        expect(verifyingIcon.querySelector('svg')).toHaveClass('animate-spin');
        await act(async () => { release(GEMINI_VERIFIED); });
    });

    it('keeps the Verificar button width stable across Verificar/Verificando by grid-stacking both labels', async () => {
        const user = userEvent.setup();
        let release!: (value: typeof GEMINI_VERIFIED) => void;
        const pending = new Promise<typeof GEMINI_VERIFIED>((resolve) => { release = resolve; });
        const verifyGemini = vi.fn(() => pending);
        renderSettings({
            credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })),
            verifyGemini,
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const verify = await within(gemini).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        // Both labels always exist in the DOM (grid-stacked in the same cell),
        // so the button's intrinsic width never changes; only the inactive one
        // is aria-hidden, which is what keeps the accessible name exact.
        expect(within(verify).getByText('Verificar')).not.toHaveAttribute('aria-hidden', 'true');
        expect(within(verify).getByText('Verificando…')).toHaveAttribute('aria-hidden', 'true');

        await user.click(verify);

        const verifying = await within(gemini).findByRole('button', { name: 'Verificando…' });
        expect(within(verifying).getByText('Verificando…')).not.toHaveAttribute('aria-hidden', 'true');
        expect(within(verifying).getByText('Verificar')).toHaveAttribute('aria-hidden', 'true');
        await act(async () => { release(GEMINI_VERIFIED); });
    });

    it('renders the Gemini Delete button matching Verificar, not the red danger variant, while Save stays distinct', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: GEMINI_VERIFIED })) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const save = await within(gemini).findByRole('button', { name: 'Guardar credencial' });
        const del = within(gemini).getByRole('button', { name: 'Eliminar credencial' });
        const verify = within(gemini).getByRole('button', { name: 'Verificar' });

        expect(del.className).not.toMatch(/status-critical/);
        // Same variant/size contract as Verificar (HmiButton's class output is a
        // pure function of variant+size+className), not a hardcoded class
        // snapshot; Save intentionally keeps its own (primary) styling.
        expect(del.className.split(' ').sort()).toEqual(verify.className.split(' ').sort());
        expect(del.className.split(' ').sort()).not.toEqual(save.className.split(' ').sort());
    });

    it.each([
        ['invalid_key', 'API key inválida', 'circle-x'],
        ['unreachable', 'No se pudo verificar: sin conexión con Google', 'wifi-off'],
    ])('shows the %s verification result as the %s icon with its safe accessible name', async (state, expectedName, expectedIcon) => {
        renderSettings({
            credentialMetadata: vi.fn(async () => ({
                ...metadata,
                gemini: { configured: true, verified: false, verification: { state, checkedAt: 1 } },
            })),
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        const icon = await within(gemini).findByRole('img', { name: expectedName });
        expectLucideIcon(icon, expectedIcon);
        expect(within(gemini).queryByText(expectedName)).not.toBeInTheDocument();
    });

    it('shows a safe message when a concurrent Gemini verification is rejected', async () => {
        const user = userEvent.setup();
        const verifyGemini = vi.fn(async () => { throw new AdminAuthError('GEMINI_VERIFICATION_IN_PROGRESS', 409, false); });
        renderSettings({
            credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })),
            verifyGemini,
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const verify = await within(gemini).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay una verificación en curso. Espere a que finalice.');
    });

    it.each([
        ['Canal A' as const, 'verifyChannelA' as const, 'PRISMA_CHANNEL_A_VERIFICATION_IN_PROGRESS', 'Ya hay una verificación en curso. Espere a que finalice.'],
        ['Canal B' as const, 'verifyTelegram' as const, 'TELEGRAM_VERIFICATION_IN_PROGRESS', 'Ya hay una verificación en curso. Espere a que finalice.'],
    ])('shows a safe message when a concurrent %s verification is rejected', async (groupName, clientMethod, code, expectedText) => {
        const user = userEvent.setup();
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
            [clientMethod]: vi.fn(async () => { throw new AdminAuthError(code, 409, false); }),
        });
        const group = await screen.findByRole('group', { name: groupName });
        await within(group).findByRole('img', { name: 'Verificación: no realizada' });
        const verify = within(group).getByRole('button', { name: 'Verificar' });
        expect(verify).toBeEnabled();

        await user.click(verify);

        expect(await screen.findByRole('alert')).toHaveTextContent(expectedText);
    });

    it.each([
        ['Canal A' as const, 'verifyChannelA' as const, 'PRISMA_CHANNEL_A_VERIFICATION_UNAVAILABLE', 'La verificación del Canal A no está disponible.'],
        ['Canal B' as const, 'verifyTelegram' as const, 'TELEGRAM_VERIFICATION_UNAVAILABLE', 'La verificación del Canal B no está disponible.'],
    ])('shows the exact safe message when %s verification is reported unavailable, never the raw code', async (
        groupName, clientMethod, code, expectedText,
    ) => {
        const user = userEvent.setup();
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
            [clientMethod]: vi.fn(async () => { throw new AdminAuthError(code, 503, false); }),
        });
        const group = await screen.findByRole('group', { name: groupName });
        await within(group).findByRole('img', { name: 'Verificación: no realizada' });
        const verify = within(group).getByRole('button', { name: 'Verificar' });
        expect(verify).toBeEnabled();

        await user.click(verify);

        expect(await screen.findByRole('alert')).toHaveTextContent(expectedText);
        expect(screen.queryByText(code)).not.toBeInTheDocument();
    });

    it('never renders a verification claim before Gemini metadata has loaded', async () => {
        renderSettings({ credentialMetadata: vi.fn(() => new Promise<typeof metadata>(() => undefined)) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        expect(within(gemini).queryByRole('img', { name: 'Verificación: no realizada' })).not.toBeInTheDocument();
        expect(within(gemini).queryByRole('button', { name: 'Verificar' })).not.toBeInTheDocument();
        expect(within(gemini).getByText('Consultando estado')).toBeInTheDocument();
    });

    it('shows the channel A lastError as safe guidance without raw internal codes', async () => {
        renderSettings({ channelAStatus: vi.fn(async () => channelAStopUnconfirmed) });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        expect(await within(channelA).findByText('No se pudo confirmar la detención del Canal A.')).toBeInTheDocument();
        expect(within(channelA).queryByText('PRISMA_CHANNEL_A_STOP_UNCONFIRMED')).not.toBeInTheDocument();
    });

    // T11 (2026-09-23, user manual-test feedback): Canal A must render above
    // Canal B (renamed from the plain "Telegram" row), and every credential
    // row's input must share one fixed width regardless of its own trailing
    // content, instead of growing to fill the row (flex-1), which made widths
    // differ between rows and shift as content like Verificar or @username
    // appeared/disappeared.
    it('renders Canal A above Canal B in the provider list', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        await screen.findByRole('group', { name: 'Canal A' });

        const groupNames = screen.getAllByRole('group').map((group) => group.querySelector('legend')?.textContent);
        expect(groupNames).toEqual(['Proveedor de voz', 'Canal A', 'Canal B']);
    });

    it('gives the Gemini, Canal A and Canal B credential inputs the exact same fixed width', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const channelA = screen.getByRole('group', { name: 'Canal A' });
        const channelB = screen.getByRole('group', { name: 'Canal B' });

        const geminiInput = within(gemini).getByLabelText('API Key de Gemini');
        const channelAInput = within(channelA).getByLabelText('Telegram bot API Token');
        const channelBInput = within(channelB).getByLabelText('Telegram bot API Token');

        // Same width class list on all three, and no flex-grow class left over
        // from the old per-row-different width (each row's own trailing
        // content -- Verificar, @username, an execution icon -- used to
        // stretch or shrink the input instead of the input staying fixed).
        expect(geminiInput.className).not.toMatch(/\bflex-1\b/);
        expect(channelAInput.className).not.toMatch(/\bflex-1\b/);
        expect(channelBInput.className).not.toMatch(/\bflex-1\b/);
        const widthClasses = (element: HTMLElement) => element.className.split(' ').filter((cls) => /^(w-|md:w-)/.test(cls)).sort();
        expect(widthClasses(geminiInput)).toEqual(widthClasses(channelAInput));
        expect(widthClasses(channelAInput)).toEqual(widthClasses(channelBInput));
        expect(widthClasses(geminiInput).length).toBeGreaterThan(0);
    });

    it.each([
        ['Canal A', 'Canal privado de Telegram: se vincula con un QR y Prisma responde consultas sobre la interfaz.'],
        ['Canal B', 'Consultas a distancia por Telegram: Prisma responde por mensaje, sin necesidad de mirar la interfaz.'],
    ])('gives the %s description extra bottom margin before its field label', async (groupName, description) => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        const group = await screen.findByRole('group', { name: groupName });

        const paragraph = within(group).getByText(description);
        expect(paragraph.tagName).toBe('P');
        expect(paragraph).toHaveClass('mb-3');
    });

    // Placeholder text pending the parent's final Canal B copy (T11, item 3);
    // once received, only this literal and the component's constant change --
    // the row/legend/description wiring stays the same.
    it('renders the Canal B row with its own legend and a description placeholder', async () => {
        renderSettings();
        const channelB = await screen.findByRole('group', { name: 'Canal B' });

        expect(within(channelB).getByText('Consultas a distancia por Telegram: Prisma responde por mensaje, sin necesidad de mirar la interfaz.')).toBeInTheDocument();
        expect(await within(channelB).findByLabelText('Telegram bot API Token')).toBeInTheDocument();
    });

    it.each([
        ['Canal A' as const, 'telegram_channel_a' as const, 'La credencial protegida de Canal A se eliminará del servicio local. Esta acción no puede deshacerse.'],
        ['Canal B' as const, 'telegram' as const, 'La credencial protegida de Canal B se eliminará del servicio local. Esta acción no puede deshacerse.'],
        ['Proveedor de voz' as const, 'gemini' as const, 'La credencial protegida del proveedor de voz se eliminará del servicio local. Esta acción no puede deshacerse.'],
    ])('shows the exact per-provider delete confirmation copy for %s', async (groupName, _provider, expectedText) => {
        const user = userEvent.setup();
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        const group = await screen.findByRole('group', { name: groupName });
        await waitFor(() => expect(within(group).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled());

        await user.click(within(group).getByRole('button', { name: 'Eliminar credencial' }));

        const dialog = screen.getByRole('dialog', { name: 'Eliminar credencial' });
        expect(within(dialog).getByText(expectedText)).toBeInTheDocument();
    });

    // T13: "Verificar" (non-sending token check) for Canal A and Canal B,
    // same UX as Gemini's row -- stable-width label stack, secondary variant,
    // a dedicated verification icon distinct from the execution icon, and a
    // tooltip when disabled.
    it.each(['Canal A' as const, 'Canal B' as const])('shows a tooltip explaining why %s\'s Verificar is disabled when no token is configured', async (groupName) => {
        const user = userEvent.setup();
        renderSettings({
            credentialMetadata: vi.fn(async () => ({
                ...metadata,
                telegram: { configured: false, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
            })),
        });
        const group = await screen.findByRole('group', { name: groupName });
        const verify = await within(group).findByRole('button', { name: 'Verificar' });
        expect(verify).toBeDisabled();

        await user.hover(verify);

        expect(await screen.findByRole('tooltip')).toHaveTextContent('Configure un token para verificarlo.');
    });

    it.each([
        ['Canal A' as const, 'telegram_channel_a' as const, 'verifyChannelA' as const],
        ['Canal B' as const, 'telegram' as const, 'verifyTelegram' as const],
    ])('verifies the %s bot token through its own explicit action and shows the result as an icon', async (
        groupName, provider, clientMethod,
    ) => {
        const user = userEvent.setup();
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce(configuredA)
            .mockResolvedValueOnce({ ...configuredA, [provider]: (provider === 'telegram' ? TELEGRAM_VERIFIED : CHANNEL_A_VERIFIED) });
        const { client } = renderSettings({ credentialMetadata, channelAStatus: vi.fn(async () => channelARunning) });
        const group = await screen.findByRole('group', { name: groupName });
        const notCheckedIcon = await within(group).findByRole('img', { name: 'Verificación: no realizada' });
        expectLucideIcon(notCheckedIcon, 'message-circle-dashed-check');
        const verify = within(group).getByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(client[clientMethod]).toHaveBeenCalledWith(expect.any(AbortSignal));
        const verifiedIcon = await within(group).findByRole('img', { name: /Token verificado/ });
        expectLucideIcon(verifiedIcon, 'check');
    });

    it('never calls the other channel\'s verify action when verifying Canal A', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        await within(channelA).findByRole('img', { name: 'Verificación: no realizada' });
        const verify = within(channelA).getByRole('button', { name: 'Verificar' });
        expect(verify).toBeEnabled();

        await user.click(verify);

        expect(client.verifyChannelA).toHaveBeenCalledTimes(1);
        expect(client.verifyTelegram).not.toHaveBeenCalled();
        expect(client.verifyGemini).not.toHaveBeenCalled();
    });

    it('shows Verificando and a spinning icon while a Canal B verification is in flight, and disables the button', async () => {
        const user = userEvent.setup();
        let release!: (value: typeof TELEGRAM_VERIFIED) => void;
        const pending = new Promise<typeof TELEGRAM_VERIFIED>((resolve) => { release = resolve; });
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
            verifyTelegram: vi.fn(() => pending),
        });
        const channelB = await screen.findByRole('group', { name: 'Canal B' });
        await within(channelB).findByRole('img', { name: 'Verificación: no realizada' });
        const verify = within(channelB).getByRole('button', { name: 'Verificar' });
        expect(verify).toBeEnabled();

        await user.click(verify);

        expect(await within(channelB).findByRole('button', { name: 'Verificando…' })).toBeDisabled();
        const verifyingIcon = within(channelB).getByRole('img', { name: 'Verificando…' });
        expectLucideIcon(verifyingIcon, 'loader-2');
        expect(verifyingIcon.querySelector('svg')).toHaveClass('animate-spin');
        await act(async () => { release(TELEGRAM_VERIFIED); });
    });

    it.each([
        ['invalid_token', 'Token inválido', 'circle-x'],
        ['unreachable', 'No se pudo verificar: sin conexión con Telegram', 'wifi-off'],
    ])('shows the %s verification result as the %s icon on Canal A, distinct from the execution icon', async (state, expectedName, expectedIcon) => {
        renderSettings({
            credentialMetadata: vi.fn(async () => ({
                ...configuredA,
                telegram_channel_a: { configured: true, verified: false, verification: { state, checkedAt: 1, username: null } },
            })),
            channelAStatus: vi.fn(async () => channelARunning),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        const icon = await within(channelA).findByRole('img', { name: expectedName });
        expectLucideIcon(icon, expectedIcon);
        // The execution icon (live connectivity) still reads "Bot conectado"
        // from the running fixture, independent of the token check result.
        expect(within(channelA).getByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
    });

    it('places Verificar and its verification icon after the execution icon, in the same trailing row as @username', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredAndVerified), channelAStatus: vi.fn(async () => channelARunning) });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const row = await within(channelA).findByTestId('telegram_channel_a-credential-row');

        const username = within(row).getByText('@prisma_channel_a_bot');
        const executionIcon = within(row).getByRole('img', { name: 'Bot conectado' });
        const verify = within(row).getByRole('button', { name: 'Verificar' });
        const verificationIcon = within(row).getByRole('img', { name: /Token verificado/ });

        const order = [username, executionIcon, verify, verificationIcon].map((element) =>
            Array.from(row.querySelectorAll('*')).indexOf(element));
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });
});
