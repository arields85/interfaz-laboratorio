import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CredentialAdministrationClient, CredentialAdministrationController } from '../../hooks/usePrismaCredentialAdministration';
import { AdminAuthClient, AdminAuthError } from '../../services/adminAuth.service';
import { useAuthStore } from '../../store/auth.store';
import VoiceCredentialSettings from './VoiceCredentialSettings';

const GEMINI_MODEL = 'gemini-3.1-flash-tts-preview';
const GEMINI_NOT_CHECKED = {
    configured: false, verified: false, verification: { state: 'not_checked', checkedAt: null }, model: GEMINI_MODEL,
} as const;
const GEMINI_VERIFIED = {
    configured: true, verified: true, verification: { state: 'verified', checkedAt: 1_700_000_000 }, model: GEMINI_MODEL,
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
// F4 regression matrix fixture (2026-09-25): every row configured, so
// Guardar/Eliminar/Verificar are all meaningfully enableable on all three
// rows at once -- an "enabled" assertion for an unrelated row is never
// confused with an unrelated, legitimate disablement reason (missing
// credential, empty draft).
const allConfiguredMetadata = {
    gemini: { ...GEMINI_NOT_CHECKED, configured: true },
    telegram: { configured: true, verified: false, verification: TELEGRAM_TOKEN_NOT_CHECKED },
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
    paired: false,
    retrying: false,
    retryAttempt: 0,
} as const;
const channelARunning = {
    configured: true,
    desiredGeneration: 4,
    appliedGeneration: 4,
    activationEpoch: 2,
    activation: { phase: 'running', reason: null, quiescent: false, restartRequired: false },
    lastError: null,
    botUsername: 'prisma_channel_a_bot',
    paired: true,
    retrying: false,
    retryAttempt: 0,
} as const;
const channelAStopUnconfirmed = {
    configured: true,
    desiredGeneration: 4,
    appliedGeneration: 4,
    activationEpoch: 2,
    activation: { phase: 'stopped', reason: 'PRISMA_CHANNEL_A_RESTART_REQUIRED', quiescent: true, restartRequired: true },
    lastError: 'PRISMA_CHANNEL_A_STOP_UNCONFIRMED',
    botUsername: null,
    paired: false,
    retrying: false,
    retryAttempt: 0,
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
        expect(within(gemini).queryByText('Credencial no configurada')).not.toBeInTheDocument();
        // T15: the not-yet-verified resting state is the model name, text
        // only (no icon).
        expect(within(gemini).getByText(GEMINI_MODEL)).toBeInTheDocument();
        expect(within(gemini).queryByRole('img', { name: GEMINI_MODEL })).not.toBeInTheDocument();
        // Telegram's connection state reflects the real health fixture (restartRequired
        // true, running true, no lastError -> connected); no username in the
        // default health fixture, so the fallback text is shown.
        expect(await within(telegram).findByText('Bot conectado')).toBeInTheDocument();
        expect(within(telegram).getByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();

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

        // T15: critical connection states are text only (no icon) in the result area.
        expect(await within(telegram).findByText('No se pudo conectar el bot')).toBeInTheDocument();
        expect(within(telegram).queryByRole('img', { name: 'No se pudo conectar el bot' })).not.toBeInTheDocument();
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
        // T15: "Bot detenido" is a warning-tone state, text only (no icon).
        expect(await within(idleCard).findByText('Bot detenido')).toBeInTheDocument();
        expect(within(idleCard).queryByRole('img', { name: 'Bot detenido' })).not.toBeInTheDocument();
        expect(within(idleCard).queryByText('@prisma_channel_a_bot')).not.toBeInTheDocument();
    });

    it('shows no execution icon at all for an unconfigured channel A credential', async () => {
        renderSettings();
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        await waitFor(() => expect(within(channelA).getByLabelText('Telegram bot API Token')).toBeEnabled());
        expect(within(channelA).queryByRole('img', { name: 'Bot conectado' })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Bot detenido' })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'No se pudo conectar el bot' })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Estado no confirmado' })).not.toBeInTheDocument();
    });

    // Regression: the non-quiescent 'stopping' phase must not render as the
    // confirmed-stopped "Bot detenido" state; idle/stopped legitimately keep
    // it. T15: a genuinely FAILED phase is now a CONFIRMED failure (critical
    // "No se pudo conectar el bot"), not the ambiguous "unconfirmed" bucket
    // -- see channelAConnectionResult's own comment for the root-cause
    // reasoning (a background poll-loop failure never updates the manager's
    // own lastError, so phase must be checked independently of it). Every
    // state here is text only (T15: no icon except for a success state).
    it.each([
        { phase: 'stopping' as const, expectedText: 'Conectando…' },
        { phase: 'failed' as const, expectedText: 'No se pudo conectar el bot' },
    ])('does not render a non-running channel A activation phase ($phase) as stopped', async ({ phase, expectedText }) => {
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

        expect(await within(channelA).findByText(expectedText)).toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: expectedText })).not.toBeInTheDocument();
        expect(within(channelA).queryByText('Bot detenido')).not.toBeInTheDocument();
        expect(client.applyChannelA).not.toHaveBeenCalled();
        expect(client.deleteCredential).not.toHaveBeenCalled();
    });

    // A genuinely unconfirmed phase (only 'retired', the 7-day idle horizon)
    // still keeps the neutral, text-only "Estado no confirmado".
    it('shows a genuinely unknown channel A phase as "Estado no confirmado", text only', async () => {
        const status = {
            ...channelARunning,
            activation: { phase: 'retired', reason: 'PRISMA_CHANNEL_A_RESTART_REQUIRED', quiescent: true, restartRequired: true },
            lastError: null,
            botUsername: null,
        } as const;
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => status),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        expect(await within(channelA).findByText('Estado no confirmado')).toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Estado no confirmado' })).not.toBeInTheDocument();
    });

    // T16: a background failure the manager is actively retrying with backoff
    // shows a distinct warning state instead of the generic critical failure
    // text, even though lastError still carries the transient failure code.
    it('shows a retrying channel A background failure as "Reconectando…", warning tone', async () => {
        const status = {
            ...channelARunning,
            activation: { phase: 'failed', reason: 'PRISMA_CHANNEL_A_POLL_FAILED', quiescent: true, restartRequired: false },
            lastError: 'PRISMA_CHANNEL_A_POLL_FAILED',
            botUsername: null,
            retrying: true,
            retryAttempt: 2,
        } as const;
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => status),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        const result = await within(channelA).findByText('Reconectando…');
        expect(result).toBeInTheDocument();
        expect(result.className).toContain('text-status-warning');
        expect(within(channelA).queryByText('No se pudo conectar el bot')).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Reconectando…' })).not.toBeInTheDocument();
    });

    // T16: the two PERMANENT failures the backend never retries get their own
    // specific critical text instead of the generic fallback.
    it.each([
        { lastError: 'PRISMA_CHANNEL_A_UNAUTHORIZED' as const, expectedText: 'Token inválido' },
        { lastError: 'TELEGRAM_BOT_IDENTITY_RESERVED' as const, expectedText: 'Bot en uso por el otro canal' },
    ])('shows the permanent channel A failure ($lastError) with its specific text', async ({ lastError, expectedText }) => {
        const status = {
            ...channelARunning,
            activation: { phase: 'failed', reason: lastError, quiescent: true, restartRequired: false },
            lastError,
            botUsername: null,
            retrying: false,
        } as const;
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => status),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        expect(await within(channelA).findByText(expectedText)).toBeInTheDocument();
        expect(within(channelA).queryByText('No se pudo conectar el bot')).not.toBeInTheDocument();
    });

    it('shows the channel A stop-unconfirmed lastError as the error state, distinct from Telegram, text only', async () => {
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

        expect(await within(channelA).findByText('No se pudo conectar el bot')).toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'No se pudo conectar el bot' })).not.toBeInTheDocument();
        expect(within(telegram).queryByText('No se pudo conectar el bot')).not.toBeInTheDocument();
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

    // T14 (2026-09-23): unified verify UX -- Verificar is now an icon-only
    // button grouped with Save/Delete, and the separate verification icon is
    // replaced by one trailing result area (text + icon).
    it('places the API Key input, credential icon, Save, Delete, Verificar and the result area in one row, in that order', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: GEMINI_VERIFIED })) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const row = await within(gemini).findByTestId('gemini-credential-row');

        const input = within(row).getByLabelText('API Key de Gemini');
        const credentialIcon = within(row).getByRole('img', { name: 'Credencial configurada' });
        const save = within(row).getByRole('button', { name: 'Guardar credencial' });
        const del = within(row).getByRole('button', { name: 'Eliminar credencial' });
        const verify = within(row).getByRole('button', { name: 'Verificar' });
        const resultArea = within(row).getByTestId('gemini-verification-result');
        // T15: already-verified resting state is the model name (still
        // green/Check, since the credential stays verified).
        const resultText = within(resultArea).getByText(GEMINI_MODEL);
        const resultIcon = within(resultArea).getByRole('img', { name: 'Verificado' });

        // Structural: every control lives inside the single shared row container,
        // not split across separate columns, in T14's canonical order.
        const order = [input, credentialIcon, save, del, verify, resultText, resultIcon].map((element) =>
            Array.from(row.querySelectorAll('*')).indexOf(element));
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('disables Verificar until a Gemini credential is configured', async () => {
        renderSettings();
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        expect(await within(gemini).findByRole('button', { name: 'Verificar' })).toBeDisabled();
    });

    it('verifies the Gemini credential through its explicit action and shows "Verificado", then reverts to the model name', async () => {
        const user = userEvent.setup();
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })
            .mockResolvedValue({ ...metadata, gemini: GEMINI_VERIFIED });
        const verifyGemini = vi.fn(async () => GEMINI_VERIFIED);
        const { client } = renderSettings({ credentialMetadata, verifyGemini });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        // T15: Gemini's resting state (not yet verified) is the model name,
        // text only, no icon.
        expect(await within(gemini).findByText(GEMINI_MODEL)).toBeInTheDocument();
        expect(within(gemini).queryByRole('img', { name: GEMINI_MODEL })).not.toBeInTheDocument();
        const verify = within(gemini).getByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(client.verifyGemini).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(await within(gemini).findByText('Verificado')).toBeInTheDocument();
        const verifiedIcon = within(gemini).getByRole('img', { name: 'Verificado' });
        expectLucideIcon(verifiedIcon, 'check');
    });

    // T15: the pressed Verify button must NOT swap to a spinner -- it keeps
    // its Play icon, just disabled. F5 (2026-09-25, coordinator correction:
    // the earlier "Probando voz_" wording was a mistake -- there is no
    // separate test action, this is still Verificar): the RESULT AREA text
    // is "Verificando credencial_" on every row, with the shared
    // blinking-underscore caret; the button's own accessible name
    // ("Verificando…") is unrelated and unchanged.
    it('shows "Verificando credencial_" with the caret in the result area while a Gemini verification is in flight, and keeps the button\'s Play icon, just disabled', async () => {
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

        const verifyingButton = await within(gemini).findByRole('button', { name: 'Verificando…' });
        expect(verifyingButton).toBeDisabled();
        expectLucideIcon(verifyingButton, 'play');
        const resultArea = within(gemini).getByTestId('gemini-verification-result');
        expect(resultArea).toHaveTextContent('Verificando credencial_');
        expect(resultArea).toHaveAttribute('role', 'status');
        expect(resultArea).toHaveAttribute('aria-live', 'polite');
        expect(resultArea.querySelector('.widget-runtime-state-caret')).toBeInTheDocument();
        expect(within(resultArea).queryByRole('img')).not.toBeInTheDocument();
        await act(async () => { release(GEMINI_VERIFIED); });
    });

    // T14 (2026-09-23): Verificar is now an icon-only button (Play/Loader2),
    // grouped with Save/Delete -- T9d's stable-width grid-stacked label pair
    // is dead code now that there is no text label to keep from reflowing.
    it('renders Verificar as an icon-only button with no visible text label', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => ({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const verify = await within(gemini).findByRole('button', { name: 'Verificar' });

        expect(verify.textContent?.trim()).toBe('');
        expect(verify).toHaveAccessibleName('Verificar');
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

    // T15: invalid_key/unreachable are text only (no icon, tone-colored).
    it.each([
        ['invalid_key', 'API key inválida'],
        ['unreachable', 'Sin conexión con Google'],
    ])('shows the %s verification result as text only, no icon', async (state, expectedText) => {
        renderSettings({
            credentialMetadata: vi.fn(async () => ({
                ...metadata,
                gemini: { configured: true, verified: false, verification: { state, checkedAt: 1 }, model: GEMINI_MODEL },
            })),
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });

        expect(await within(gemini).findByText(expectedText)).toBeInTheDocument();
        expect(within(gemini).queryByRole('img', { name: expectedText })).not.toBeInTheDocument();
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
        const verify = await within(group).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

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
        const verify = await within(group).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

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

    // T14/T15: Telegram/Canal A's result area shows the LIVE CONNECTION
    // state by default (not a "not yet verified" placeholder), so there is
    // nothing to pre-check before clicking Verificar any more. Canal B's
    // verify-success message is the generic "@username" + Check (same as
    // its connection display, per the coordinator's Canal-B fallback: it has
    // no reliable "paired" signal, so Verificar just reconfirms connectivity).
    it('verifies the Canal B bot token through its own explicit action and shows "@username" + Check', async () => {
        const user = userEvent.setup();
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce(configuredA)
            .mockResolvedValue({ ...configuredA, telegram: TELEGRAM_VERIFIED });
        const { client } = renderSettings({ credentialMetadata, channelAStatus: vi.fn(async () => channelARunning) });
        const group = await screen.findByRole('group', { name: 'Canal B' });
        const verify = await within(group).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(client.verifyTelegram).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(await within(group).findByText('@prisma_bot')).toBeInTheDocument();
        const verifiedIcon = within(group).getByRole('img', { name: /Token verificado/ });
        expectLucideIcon(verifiedIcon, 'check');
    });

    // T15 (user decision): Canal A's post-Verificar success message names
    // whether the just-verified token is already paired to a chat, instead
    // of jumping straight to "@username" -- text only, muted, no icon.
    it.each([
        [true, 'Bot vinculado'],
        [false, 'Bot disponible, sin vincular'],
    ])('verifies the Canal A bot token and shows the paired-aware message (paired=%s)', async (paired, expectedText) => {
        const user = userEvent.setup();
        const runningFixture = { ...channelARunning, paired };
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce(configuredA)
            .mockResolvedValue({ ...configuredA, telegram_channel_a: CHANNEL_A_VERIFIED });
        const { client } = renderSettings({
            credentialMetadata,
            channelAStatus: vi.fn(async () => runningFixture),
        });
        const group = await screen.findByRole('group', { name: 'Canal A' });
        const verify = await within(group).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(client.verifyChannelA).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(await within(group).findByText(expectedText)).toBeInTheDocument();
        expect(within(group).queryByRole('img', { name: expectedText })).not.toBeInTheDocument();
        expect(within(group).queryByText('@prisma_channel_a_bot')).not.toBeInTheDocument();
    });

    it('never calls the other channel\'s verify action when verifying Canal A', async () => {
        const user = userEvent.setup();
        const { client } = renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const verify = await within(channelA).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(client.verifyChannelA).toHaveBeenCalledTimes(1);
        expect(client.verifyTelegram).not.toHaveBeenCalled();
        expect(client.verifyGemini).not.toHaveBeenCalled();
    });

    // T15 item 1: verification is read-only per provider and must never
    // block another row's Save/Delete/Verify -- only the pressed row's own
    // Verificar disables itself while its own check is in flight. A
    // same-row Save is explicitly allowed while its own verify is still
    // pending (see the "clears a pending revert timer immediately when Save
    // resets verification" fake-timer test above for the staleness guard on
    // that exact scenario).
    it('verifying Canal A never disables Gemini or Canal B\'s Save/Delete/Verify controls', async () => {
        const user = userEvent.setup();
        const pending = new Promise<never>(() => undefined);
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
            verifyChannelA: vi.fn(() => pending),
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const gemini = screen.getByRole('group', { name: 'Proveedor de voz' });
        const channelB = screen.getByRole('group', { name: 'Canal B' });
        const verify = await within(channelA).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(await within(channelA).findByRole('button', { name: 'Verificando…' })).toBeDisabled();
        // Canal A's own Save/Delete stay enabled too (same-row save/delete
        // during its own in-flight verify is allowed).
        expect(within(channelA).getByRole('button', { name: 'Guardar credencial' })).toBeDisabled(); // no draft typed yet
        expect(within(channelA).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled();
        // Other rows are entirely unaffected.
        expect(within(gemini).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled();
        expect(within(channelB).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled();
        expect(within(channelB).getByRole('button', { name: 'Verificar' })).toBeEnabled();
    });

    // F4 full matrix (2026-09-25 coordinator clarification): every row x
    // every action must be checked against every OTHER row, not just the
    // Verificar case T15 already covered. "Probar" (the coordinator's own
    // wording) is the existing Verificar button -- this component has no
    // separate fourth control (confirmed: no "Probar" string or button
    // anywhere in this file) -- so the matrix below is the 3 real actions
    // (save/delete/verify) across the 3 rows.
    const CREDENTIAL_ROWS = [
        { groupName: 'Proveedor de voz', provider: 'gemini' as const, inputLabel: 'API Key de Gemini' },
        { groupName: 'Canal A', provider: 'telegram_channel_a' as const, inputLabel: 'Telegram bot API Token' },
        { groupName: 'Canal B', provider: 'telegram' as const, inputLabel: 'Telegram bot API Token' },
    ] as const;

    function createHangingClient(
        hangingProvider: 'gemini' | 'telegram' | 'telegram_channel_a',
        hangingAction: 'save' | 'delete' | 'verify',
    ): Partial<CredentialAdministrationClient> {
        const pending = new Promise<never>(() => undefined);
        return {
            saveCredential: vi.fn((provider: string) => (hangingAction === 'save' && provider === hangingProvider
                ? pending
                : Promise.resolve({ provider, configured: true }))),
            deleteCredential: vi.fn((provider: string) => (hangingAction === 'delete' && provider === hangingProvider
                ? pending
                : Promise.resolve(undefined))),
            verifyGemini: hangingAction === 'verify' && hangingProvider === 'gemini' ? vi.fn(() => pending) : vi.fn(async () => GEMINI_VERIFIED),
            verifyTelegram: hangingAction === 'verify' && hangingProvider === 'telegram' ? vi.fn(() => pending) : vi.fn(async () => TELEGRAM_VERIFIED),
            verifyChannelA: hangingAction === 'verify' && hangingProvider === 'telegram_channel_a' ? vi.fn(() => pending) : vi.fn(async () => CHANNEL_A_VERIFIED),
        };
    }

    it.each(
        CREDENTIAL_ROWS.flatMap((row) => (['save', 'delete', 'verify'] as const).map((action) => ({ ...row, action }))),
    )('an in-flight $action on $groupName never disables the other two rows\' Guardar/Eliminar/Verificar (F4 matrix)', async ({ groupName, provider, action }) => {
        const user = userEvent.setup();
        renderSettings({
            credentialMetadata: vi.fn(async () => allConfiguredMetadata),
            channelAStatus: vi.fn(async () => channelARunning),
            ...createHangingClient(provider, action),
        });
        const pressedRow = await screen.findByRole('group', { name: groupName });
        const otherRows = CREDENTIAL_ROWS
            .filter((row) => row.groupName !== groupName)
            .map((row) => screen.getByRole('group', { name: row.groupName }));

        // Give every row (including the pressed one) a non-empty draft up
        // front, so an unrelated row's Guardar being enabled is never masked
        // by it simply having no typed value.
        for (const row of [pressedRow, ...otherRows]) {
            const input = within(row).getByLabelText(/API Key de Gemini|Telegram bot API Token/);
            await waitFor(() => expect(input).toBeEnabled());
            await user.type(input, 'draft-secret');
        }

        if (action === 'save') {
            await user.click(within(pressedRow).getByRole('button', { name: 'Guardar credencial' }));
        } else if (action === 'delete') {
            await user.click(within(pressedRow).getByRole('button', { name: 'Eliminar credencial' }));
            await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));
        } else {
            await waitFor(() => expect(within(pressedRow).getByRole('button', { name: 'Verificar' })).toBeEnabled());
            await user.click(within(pressedRow).getByRole('button', { name: 'Verificar' }));
        }

        if (action === 'verify') {
            // T15: verify disables only itself on the pressed row; Save/Delete
            // on that SAME row stay enabled by design (verification is
            // read-only and does not conflict with a same-row mutation).
            expect(await within(pressedRow).findByRole('button', { name: 'Verificando…' })).toBeDisabled();
        } else {
            // Save/Delete gate all three of the pressed row's own controls
            // (the existing double-submit guard, unchanged by F4).
            await waitFor(() => expect(within(pressedRow).getByRole('button', { name: 'Guardar credencial' })).toBeDisabled());
            expect(within(pressedRow).getByRole('button', { name: 'Eliminar credencial' })).toBeDisabled();
            expect(within(pressedRow).getByRole('button', { name: 'Verificar' })).toBeDisabled();
        }

        // The actual F4 assertion: every OTHER row's Guardar/Eliminar/Verificar
        // stay fully enabled, regardless of which row/action is pending.
        for (const otherRow of otherRows) {
            expect(within(otherRow).getByRole('button', { name: 'Guardar credencial' })).toBeEnabled();
            expect(within(otherRow).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled();
            expect(within(otherRow).getByRole('button', { name: 'Verificar' })).toBeEnabled();
            expect(within(otherRow).getByLabelText(/API Key de Gemini|Telegram bot API Token/)).toBeEnabled();
        }
    });

    // F4 concurrent case (2026-09-25 coordinator clarification): two DIFFERENT
    // rows with truly simultaneous in-flight operations must each disable
    // only themselves, never each other, and never the third (idle) row.
    it('lets two different rows run independent in-flight operations at the same time (F4 concurrent case)', async () => {
        const user = userEvent.setup();
        let releaseSave!: () => void;
        const pendingSave = new Promise<{ provider: string; configured: boolean }>((resolve) => {
            releaseSave = () => resolve({ provider: 'gemini', configured: true });
        });
        let releaseDelete!: () => void;
        const pendingDelete = new Promise<void>((resolve) => { releaseDelete = () => resolve(undefined); });
        const saveCredential = vi.fn((provider: string) => (provider === 'gemini' ? pendingSave : Promise.resolve({ provider, configured: true })));
        const deleteCredential = vi.fn((provider: string) => (provider === 'telegram_channel_a' ? pendingDelete : Promise.resolve(undefined)));
        renderSettings({
            credentialMetadata: vi.fn(async () => allConfiguredMetadata),
            channelAStatus: vi.fn(async () => channelARunning),
            saveCredential,
            deleteCredential,
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const channelA = screen.getByRole('group', { name: 'Canal A' });
        const channelB = screen.getByRole('group', { name: 'Canal B' });

        const geminiInput = within(gemini).getByLabelText('API Key de Gemini');
        await waitFor(() => expect(geminiInput).toBeEnabled());
        await user.type(geminiInput, 'gemini-secret');
        // Canal B needs a draft too, purely so its own Guardar can be
        // meaningfully asserted "enabled" below instead of disabled for the
        // unrelated reason of having no typed value.
        const channelBInput = within(channelB).getByLabelText('Telegram bot API Token');
        await user.type(channelBInput, 'channel-b-draft');
        await user.click(within(gemini).getByRole('button', { name: 'Guardar credencial' }));

        await user.click(within(channelA).getByRole('button', { name: 'Eliminar credencial' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        // Both pressed rows disable only their own three controls...
        await waitFor(() => expect(within(gemini).getByRole('button', { name: 'Guardar credencial' })).toBeDisabled());
        expect(within(gemini).getByRole('button', { name: 'Eliminar credencial' })).toBeDisabled();
        expect(within(gemini).getByRole('button', { name: 'Verificar' })).toBeDisabled();
        expect(within(channelA).getByRole('button', { name: 'Guardar credencial' })).toBeDisabled();
        expect(within(channelA).getByRole('button', { name: 'Eliminar credencial' })).toBeDisabled();
        expect(within(channelA).getByRole('button', { name: 'Verificar' })).toBeDisabled();
        // ...never each other, and Canal B (idle) stays fully usable.
        expect(within(channelB).getByRole('button', { name: 'Guardar credencial' })).toBeEnabled();
        expect(within(channelB).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled();
        expect(within(channelB).getByRole('button', { name: 'Verificar' })).toBeEnabled();

        await act(async () => { releaseSave(); });
        await act(async () => { releaseDelete(); });
    });

    // F5 (2026-09-25, coordinator correction): "Verificando credencial_" is
    // the same uniform text on every row, including Canal B -- no separate
    // "Probando bot_" wording.
    it('shows "Verificando credencial_" with the caret in the result area while a Canal B verification is in flight, and keeps the button\'s Play icon, just disabled', async () => {
        const user = userEvent.setup();
        let release!: (value: typeof TELEGRAM_VERIFIED) => void;
        const pending = new Promise<typeof TELEGRAM_VERIFIED>((resolve) => { release = resolve; });
        renderSettings({
            credentialMetadata: vi.fn(async () => configuredA),
            channelAStatus: vi.fn(async () => channelARunning),
            verifyTelegram: vi.fn(() => pending),
        });
        const channelB = await screen.findByRole('group', { name: 'Canal B' });
        const verify = await within(channelB).findByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        const verifyingButton = await within(channelB).findByRole('button', { name: 'Verificando…' });
        expect(verifyingButton).toBeDisabled();
        expectLucideIcon(verifyingButton, 'play');
        const resultArea = within(channelB).getByTestId('telegram-verification-result');
        expect(resultArea).toHaveTextContent('Verificando credencial_');
        expect(resultArea).toHaveAttribute('role', 'status');
        expect(resultArea).toHaveAttribute('aria-live', 'polite');
        expect(resultArea.querySelector('.widget-runtime-state-caret')).toBeInTheDocument();
        expect(within(resultArea).queryByRole('img')).not.toBeInTheDocument();
        await act(async () => { release(TELEGRAM_VERIFIED); });
    });

    // F5 (2026-09-25): Guardar/Eliminar get the same generic caret-based
    // progress copy on every row, unlike Verificar's per-row wording above.
    it.each([
        ['Proveedor de voz', 'gemini', 'gemini-verification-result'] as const,
        ['Canal A', 'telegram_channel_a', 'telegram_channel_a-verification-result'] as const,
        ['Canal B', 'telegram', 'telegram-verification-result'] as const,
    ])('shows "Guardando credencial_" with the caret in %s\'s result area while its own save is in flight', async (groupName, provider, testId) => {
        const user = userEvent.setup();
        const pending = new Promise<never>(() => undefined);
        const saveCredential = vi.fn((savedProvider: string) => (savedProvider === provider ? pending : Promise.resolve({ provider: savedProvider, configured: true })));
        renderSettings({
            credentialMetadata: vi.fn(async () => allConfiguredMetadata),
            channelAStatus: vi.fn(async () => channelARunning),
            saveCredential,
        });
        const row = await screen.findByRole('group', { name: groupName });
        const input = within(row).getByLabelText(/API Key de Gemini|Telegram bot API Token/);
        await waitFor(() => expect(input).toBeEnabled());
        await user.type(input, 'new-secret');

        await user.click(within(row).getByRole('button', { name: 'Guardar credencial' }));

        const resultArea = await within(row).findByTestId(testId);
        await waitFor(() => expect(resultArea).toHaveTextContent('Guardando credencial_'));
        expect(resultArea).toHaveAttribute('role', 'status');
        expect(resultArea).toHaveAttribute('aria-live', 'polite');
        expect(resultArea.querySelector('.widget-runtime-state-caret')).toBeInTheDocument();
    });

    it.each([
        ['Proveedor de voz', 'gemini', 'gemini-verification-result'] as const,
        ['Canal A', 'telegram_channel_a', 'telegram_channel_a-verification-result'] as const,
        ['Canal B', 'telegram', 'telegram-verification-result'] as const,
    ])('shows "Borrando credencial_" with the caret in %s\'s result area while its own delete is in flight', async (groupName, provider, testId) => {
        const user = userEvent.setup();
        const pending = new Promise<never>(() => undefined);
        const deleteCredential = vi.fn((deletedProvider: string) => (deletedProvider === provider ? pending : Promise.resolve(undefined)));
        renderSettings({
            credentialMetadata: vi.fn(async () => allConfiguredMetadata),
            channelAStatus: vi.fn(async () => channelARunning),
            deleteCredential,
        });
        const row = await screen.findByRole('group', { name: groupName });
        await waitFor(() => expect(within(row).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled());

        await user.click(within(row).getByRole('button', { name: 'Eliminar credencial' }));
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        const resultArea = await within(row).findByTestId(testId);
        await waitFor(() => expect(resultArea).toHaveTextContent('Borrando credencial_'));
        expect(resultArea).toHaveAttribute('role', 'status');
        expect(resultArea).toHaveAttribute('aria-live', 'polite');
        expect(resultArea.querySelector('.widget-runtime-state-caret')).toBeInTheDocument();
    });

    // F8 (2026-09-25, live retest): the delete confirmation dialog used to
    // stay open for the whole deletion, with a disabled "Confirmar
    // eliminación" button covering the page, so the row's own F5 "Borrando
    // credencial_" progress text was never visible. Confirming now closes
    // the dialog immediately, and the row's own per-provider pending state
    // (F4's administration.pendingActions[provider]) carries the in-flight
    // indication and the double-submit guard instead: the row's Eliminar
    // stays disabled while its delete is in flight, so the dialog cannot be
    // reopened for that row either.
    it('closes the confirmation dialog immediately on confirm, letting the row show its own delete in flight', async () => {
        const user = userEvent.setup();
        const pending = new Promise<never>(() => undefined);
        const deleteCredential = vi.fn(() => pending);
        renderSettings({
            credentialMetadata: vi.fn(async () => allConfiguredMetadata),
            channelAStatus: vi.fn(async () => channelARunning),
            deleteCredential,
        });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        await waitFor(() => expect(within(gemini).getByRole('button', { name: 'Eliminar credencial' })).toBeEnabled());

        await user.click(within(gemini).getByRole('button', { name: 'Eliminar credencial' }));
        expect(screen.getByRole('dialog', { name: 'Eliminar credencial' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Confirmar eliminación' }));

        expect(screen.queryByRole('dialog', { name: 'Eliminar credencial' })).not.toBeInTheDocument();
        expect(deleteCredential).toHaveBeenCalledTimes(1);
        const deleteButton = within(gemini).getByRole('button', { name: 'Eliminar credencial' });
        expect(deleteButton).toBeDisabled();

        // Re-opening the dialog for this row while it is deleting must not
        // be possible: the row's own Eliminar stays disabled, so clicking it
        // is a no-op and the dialog stays closed, with no second delete call.
        await user.click(deleteButton);
        expect(screen.queryByRole('dialog', { name: 'Eliminar credencial' })).not.toBeInTheDocument();
        expect(deleteCredential).toHaveBeenCalledTimes(1);
    });

    // T15: a failed verification result REPLACES the live connection state
    // in the one shared result area, text only (no icon).
    it.each([
        ['invalid_token', 'Token inválido'],
        ['unreachable', 'Sin conexión con Telegram'],
    ])('shows the %s verification result as text only on Canal A, replacing the connection state', async (state, expectedText) => {
        const user = userEvent.setup();
        const failedVerification = { configured: true, verified: false, verification: { state, checkedAt: 1, username: null } };
        const verifyChannelA = vi.fn(async () => failedVerification);
        // The rendered result reads from the refreshed metadata (T13's
        // pre-existing `credentials?.[provider].verification` contract), so
        // the second credentialMetadata call (triggered by verify's own
        // internal refresh()) must reflect the same failed state the verify
        // call itself returned.
        const credentialMetadata = vi.fn()
            .mockResolvedValueOnce(configuredA)
            .mockResolvedValue({ ...configuredA, telegram_channel_a: failedVerification });
        renderSettings({
            credentialMetadata,
            channelAStatus: vi.fn(async () => channelARunning),
            verifyChannelA,
        });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        expect(await within(channelA).findByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
        const verify = within(channelA).getByRole('button', { name: 'Verificar' });
        await waitFor(() => expect(verify).toBeEnabled());

        await user.click(verify);

        expect(await within(channelA).findByText(expectedText)).toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: expectedText })).not.toBeInTheDocument();
        expect(within(channelA).queryByRole('img', { name: 'Bot conectado' })).not.toBeInTheDocument();
    });

    it('places the credential input, credential icon, Save, Delete, Verificar and the result area in one row for Canal A, in that order', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });
        const row = await within(channelA).findByTestId('telegram_channel_a-credential-row');

        const input = within(row).getByLabelText('Telegram bot API Token');
        const credentialIcon = within(row).getByRole('img', { name: 'Credencial configurada' });
        const save = within(row).getByRole('button', { name: 'Guardar credencial' });
        const del = within(row).getByRole('button', { name: 'Eliminar credencial' });
        const verify = within(row).getByRole('button', { name: 'Verificar' });
        const resultArea = within(row).getByTestId('telegram_channel_a-verification-result');
        const resultText = within(resultArea).getByText('@prisma_channel_a_bot');
        const resultIcon = within(resultArea).getByRole('img', { name: 'Bot conectado' });

        const order = [input, credentialIcon, save, del, verify, resultText, resultIcon].map((element) =>
            Array.from(row.querySelectorAll('*')).indexOf(element));
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    // T14 (coordinator instruction, 2026-09-23): width arithmetic for the
    // grouped-button/result-area layout, verified structurally.
    it('gives the Gemini, Canal A and Canal B result areas the exact same minimum width', async () => {
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => channelARunning) });
        const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
        const channelA = screen.getByRole('group', { name: 'Canal A' });
        const channelB = screen.getByRole('group', { name: 'Canal B' });

        const geminiResult = await within(gemini).findByTestId('gemini-verification-result');
        const channelAResult = within(channelA).getByTestId('telegram_channel_a-verification-result');
        const channelBResult = within(channelB).getByTestId('telegram-verification-result');

        const widthClasses = (element: HTMLElement) =>
            element.className.split(' ').filter((cls) => /^(min-w-|w-)/.test(cls)).sort();
        expect(widthClasses(geminiResult)).toEqual(widthClasses(channelAResult));
        expect(widthClasses(channelAResult)).toEqual(widthClasses(channelBResult));
        expect(widthClasses(geminiResult).length).toBeGreaterThan(0);
    });

    // Telegram usernames are capped at 32 characters by the Telegram Bot API
    // (5-32, https://core.telegram.org/bots/api). This pins the exact worst
    // case the result area must render without truncating, at the panel's
    // normal (>= md) width.
    it('renders a maximum-length (32-char) Telegram username in full, with no truncation classes', async () => {
        const maxLengthUsername = `${'a'.repeat(28)}_bot`;
        expect(maxLengthUsername).toHaveLength(32);
        const longUsernameRunning = { ...channelARunning, botUsername: maxLengthUsername };
        renderSettings({ credentialMetadata: vi.fn(async () => configuredA), channelAStatus: vi.fn(async () => longUsernameRunning) });
        const channelA = await screen.findByRole('group', { name: 'Canal A' });

        const usernameText = await within(channelA).findByText(`@${maxLengthUsername}`);
        expect(usernameText.className).not.toMatch(/truncate|overflow-hidden|text-ellipsis|whitespace-nowrap/);
        const resultArea = within(channelA).getByTestId('telegram_channel_a-verification-result');
        expect(resultArea).toContainElement(usernameText);
        expect(resultArea.className).not.toMatch(/truncate|overflow-hidden|text-ellipsis/);
    });

    // T14: a successful verification result stays visible for
    // VERIFICATION_RESULT_DISPLAY_MS, then reverts to the live connection
    // state; a failed one never reverts on its own.
    describe('verification result display duration', () => {
        beforeEach(() => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('reverts a successful Canal A verification back to the connection state after the display duration', async () => {
            const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
            const credentialMetadata = vi.fn()
                .mockResolvedValueOnce(configuredA)
                .mockResolvedValue({ ...configuredA, telegram_channel_a: CHANNEL_A_VERIFIED });
            renderSettings({ credentialMetadata, channelAStatus: vi.fn(async () => channelARunning) });
            const channelA = await screen.findByRole('group', { name: 'Canal A' });
            const verify = await within(channelA).findByRole('button', { name: 'Verificar' });
            await waitFor(() => expect(verify).toBeEnabled());

            await user.click(verify);

            // T15: Canal A's post-verify success message is the paired-aware
            // text (channelARunning fixture has paired: true), not an icon.
            expect(await within(channelA).findByText('Bot vinculado')).toBeInTheDocument();
            expect(within(channelA).queryByRole('img', { name: 'Bot vinculado' })).not.toBeInTheDocument();

            // shouldAdvanceTime (required for findBy/waitFor to keep working
            // under fake timers) lets the clock also tick with real elapsed
            // time, so this only asserts the two end states -- immediately
            // after a successful verify, and once VERIFICATION_RESULT_DISPLAY_MS
            // has unambiguously elapsed -- rather than a precise "one ms
            // before" boundary, which would be flaky against that auto-tick.
            await act(async () => { vi.advanceTimersByTime(5_000); });
            await waitFor(() => expect(within(channelA).queryByText('Bot vinculado')).not.toBeInTheDocument());
            expect(within(channelA).getByRole('img', { name: 'Bot conectado' })).toBeInTheDocument();
            expect(within(channelA).getByText('@prisma_channel_a_bot')).toBeInTheDocument();
        });

        it('never reverts a failed Canal A verification, even long after the display duration', async () => {
            const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
            const failedVerification = {
                configured: true, verified: false, verification: { state: 'invalid_token' as const, checkedAt: 1, username: null },
            };
            const verifyChannelA = vi.fn(async () => failedVerification);
            const credentialMetadata = vi.fn()
                .mockResolvedValueOnce(configuredA)
                .mockResolvedValue({ ...configuredA, telegram_channel_a: failedVerification });
            renderSettings({ credentialMetadata, channelAStatus: vi.fn(async () => channelARunning), verifyChannelA });
            const channelA = await screen.findByRole('group', { name: 'Canal A' });
            const verify = await within(channelA).findByRole('button', { name: 'Verificar' });
            await waitFor(() => expect(verify).toBeEnabled());

            await user.click(verify);

            expect(await within(channelA).findByText('Token inválido')).toBeInTheDocument();

            await act(async () => { vi.advanceTimersByTime(60_000); });

            expect(within(channelA).getByText('Token inválido')).toBeInTheDocument();
            expect(within(channelA).queryByRole('img', { name: 'Bot conectado' })).not.toBeInTheDocument();
        });

        // T15: Gemini now has a resting display too (the model name), so it
        // shares the same show/revert lifecycle as Canal A/B -- a successful
        // verify shows "Verificado" transiently, then reverts to the model
        // name (still green/Check, since the credential stays verified).
        it('reverts a successful Gemini verification back to the model name after the display duration', async () => {
            const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
            const credentialMetadata = vi.fn()
                .mockResolvedValueOnce({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })
                .mockResolvedValue({ ...metadata, gemini: GEMINI_VERIFIED });
            renderSettings({ credentialMetadata });
            const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
            const verify = await within(gemini).findByRole('button', { name: 'Verificar' });
            await waitFor(() => expect(verify).toBeEnabled());

            await user.click(verify);

            expect(await within(gemini).findByText('Verificado')).toBeInTheDocument();
            expect(within(gemini).getByRole('img', { name: 'Verificado' })).toBeInTheDocument();

            await act(async () => { vi.advanceTimersByTime(5_000); });
            await waitFor(() => expect(within(gemini).queryByText('Verificado')).not.toBeInTheDocument());
            expect(within(gemini).getByText(GEMINI_MODEL)).toBeInTheDocument();
            // Stays green/Check once verified, even after the revert.
            expect(within(gemini).getByRole('img', { name: 'Verificado' })).toBeInTheDocument();
        });

        it('never reverts a failed Gemini verification, even long after the display duration', async () => {
            const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
            const failedGemini = { configured: true, verified: false, verification: { state: 'invalid_key' as const, checkedAt: 1 }, model: GEMINI_MODEL };
            const verifyGemini = vi.fn(async () => failedGemini);
            const credentialMetadata = vi.fn()
                .mockResolvedValueOnce({ ...metadata, gemini: { ...GEMINI_NOT_CHECKED, configured: true } })
                .mockResolvedValue({ ...metadata, gemini: failedGemini });
            renderSettings({ credentialMetadata, verifyGemini });
            const gemini = await screen.findByRole('group', { name: 'Proveedor de voz' });
            const verify = await within(gemini).findByRole('button', { name: 'Verificar' });
            await waitFor(() => expect(verify).toBeEnabled());

            await user.click(verify);

            expect(await within(gemini).findByText('API key inválida')).toBeInTheDocument();

            await act(async () => { vi.advanceTimersByTime(60_000); });

            expect(within(gemini).getByText('API key inválida')).toBeInTheDocument();
            expect(within(gemini).queryByText(GEMINI_MODEL)).not.toBeInTheDocument();
        });

        it('clears the pending revert timer on unmount, with no stale update afterwards', async () => {
            const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
            const credentialMetadata = vi.fn()
                .mockResolvedValueOnce(configuredA)
                .mockResolvedValue({ ...configuredA, telegram_channel_a: CHANNEL_A_VERIFIED });
            const { unmount } = renderSettings({ credentialMetadata, channelAStatus: vi.fn(async () => channelARunning) });
            const channelA = await screen.findByRole('group', { name: 'Canal A' });
            const verify = await within(channelA).findByRole('button', { name: 'Verificar' });
            await waitFor(() => expect(verify).toBeEnabled());

            await user.click(verify);
            expect(await within(channelA).findByText('Bot vinculado')).toBeInTheDocument();

            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            unmount();
            await act(async () => { vi.advanceTimersByTime(10_000); });

            expect(errorSpy).not.toHaveBeenCalled();
            errorSpy.mockRestore();
        });

        it('clears a pending revert timer immediately when Save resets verification', async () => {
            const user = userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime });
            const saveCredential = vi.fn(async () => ({ provider: 'telegram_channel_a' as const, configured: true }));
            const credentialMetadata = vi.fn()
                .mockResolvedValueOnce(configuredA)
                .mockResolvedValue({ ...configuredA, telegram_channel_a: CHANNEL_A_VERIFIED });
            renderSettings({ credentialMetadata, channelAStatus: vi.fn(async () => channelARunning), saveCredential });
            const channelA = await screen.findByRole('group', { name: 'Canal A' });
            const verify = await within(channelA).findByRole('button', { name: 'Verificar' });
            await waitFor(() => expect(verify).toBeEnabled());
            await user.click(verify);
            expect(await within(channelA).findByText('Bot vinculado')).toBeInTheDocument();

            const input = within(channelA).getByLabelText('Telegram bot API Token');
            await user.type(input, 'new-channel-a-secret');
            await user.click(within(channelA).getByRole('button', { name: 'Guardar credencial' }));

            await waitFor(() => expect(within(channelA).queryByText('Bot vinculado')).not.toBeInTheDocument());
            // No leftover timer either: advancing well past the display
            // duration must not resurrect or otherwise touch the result.
            await act(async () => { vi.advanceTimersByTime(10_000); });
            expect(within(channelA).queryByText('Bot vinculado')).not.toBeInTheDocument();
        });
    });
});
