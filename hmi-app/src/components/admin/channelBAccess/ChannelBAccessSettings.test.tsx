import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelBAccessClient } from '../../../hooks/useChannelBAccess';
import { useAuthStore } from '../../../store/auth.store';
import {
    accessError,
    ALL_CHATS,
    APPROVED_CHAT,
    decidedResult,
    makeChannelBClient,
    PENDING_CHAT,
    PENDING_CHAT_NO_NAME,
    REJECTED_CHAT,
    REVOKED_CHAT,
} from '../../../test/fixtures/channelBAccess.fixture';
import ChannelBAccessSettings from './ChannelBAccessSettings';

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

function renderSettings(client: ChannelBAccessClient, active = true) {
    const controller = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = render(
        <ChannelBAccessSettings active={active} client={client} controller={controller} />,
        { wrapper: Wrapper },
    );
    return { ...view, controller, queryClient };
}

function actionNames(personName: string): Array<string | null> {
    return within(screen.getByText(personName).closest('li') as HTMLElement)
        .getAllByRole('button').map((button) => button.textContent);
}

describe('ChannelBAccessSettings', () => {
    beforeEach(() => {
        authenticated();
    });

    it('shows the loading state before the list arrives', () => {
        renderSettings(makeChannelBClient(ALL_CHATS, { channelBAccessList: () => new Promise(() => undefined) }));

        expect(screen.getByText('Acceso al Canal B')).toBeInTheDocument();
        expect(screen.getByText('Cargando solicitudes de acceso...')).toBeInTheDocument();
    });

    it('does not fetch while the tab is inactive', async () => {
        const client = makeChannelBClient();
        const spy = vi.spyOn(client, 'channelBAccessList');

        renderSettings(client, false);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(spy).not.toHaveBeenCalled();
    });

    it('groups requests with counts and keeps the server order inside each group', async () => {
        renderSettings(makeChannelBClient());

        const pending = await screen.findByRole('group', { name: 'Pendientes (2)' });
        expect(within(pending).getAllByRole('listitem')).toHaveLength(2);
        expect(within(pending).getAllByRole('listitem')[0]).toHaveTextContent('Ana Pérez');
        expect(within(screen.getByRole('group', { name: 'Aprobados (1)' })).getByText('Beto Gómez')).toBeInTheDocument();
        const closed = screen.getByRole('group', { name: 'Rechazados o revocados (2)' });
        expect(within(closed).getByText('Carla Ruiz')).toBeInTheDocument();
        expect(within(closed).getByText('Dario Paz')).toBeInTheDocument();
    });

    it('shows the name, the @username when present and the request date', async () => {
        renderSettings(makeChannelBClient([PENDING_CHAT, REJECTED_CHAT]));

        const row = (await screen.findByText('Ana Pérez')).closest('li') as HTMLElement;
        expect(within(row).getByText('@ana_perez')).toBeInTheDocument();
        expect(row.querySelector('time')).toHaveAttribute('dateTime', PENDING_CHAT.requestedAt);
        const rejectedRow = screen.getByText('Carla Ruiz').closest('li') as HTMLElement;
        expect(within(rejectedRow).queryByText(/^@/)).not.toBeInTheDocument();
    });

    it('falls back to "Chat <id>" when the display name is empty', async () => {
        renderSettings(makeChannelBClient([PENDING_CHAT_NO_NAME]));

        expect(await screen.findByText('Chat 1002')).toBeInTheDocument();
    });

    it('offers only the valid actions for each status', async () => {
        renderSettings(makeChannelBClient([PENDING_CHAT, APPROVED_CHAT, REJECTED_CHAT, REVOKED_CHAT]));
        await screen.findByText('Ana Pérez');

        expect(actionNames('Ana Pérez')).toEqual(['Aprobar', 'Rechazar']);
        expect(actionNames('Beto Gómez')).toEqual(['Revocar']);
        expect(actionNames('Carla Ruiz')).toEqual(['Aprobar']);
        expect(actionNames('Dario Paz')).toEqual(['Aprobar']);
    });

    it('shows the empty state', async () => {
        renderSettings(makeChannelBClient([]));

        expect(await screen.findByText('No hay solicitudes de acceso.')).toBeInTheDocument();
    });

    it('approves, shows feedback and refreshes the list', async () => {
        const user = userEvent.setup();
        let chats = [PENDING_CHAT];
        const decide = vi.fn(async () => {
            chats = [decidedResult(PENDING_CHAT, 'approve').chat];
            return decidedResult(PENDING_CHAT, 'approve');
        });
        const list = vi.fn(async () => chats);
        renderSettings({ channelBAccessList: list, channelBAccessDecision: decide });

        await user.click(await screen.findByRole('button', { name: 'Aprobar' }));

        expect(decide).toHaveBeenCalledWith(1001, 'approve');
        expect(await screen.findByText('Acceso aprobado para Ana Pérez.')).toBeInTheDocument();
        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
        expect(await screen.findByRole('group', { name: 'Aprobados (1)' })).toBeInTheDocument();
    });

    it('tells the user when the approval notice could not be sent', async () => {
        const user = userEvent.setup();
        renderSettings(makeChannelBClient([PENDING_CHAT], {
            channelBAccessDecision: async () => decidedResult(PENDING_CHAT, 'approve', false),
        }));

        await user.click(await screen.findByRole('button', { name: 'Aprobar' }));

        expect(await screen.findByText(
            'Acceso aprobado para Ana Pérez, pero no se pudo enviar el aviso por Telegram.',
        )).toBeInTheDocument();
    });

    it('rejects a pending request', async () => {
        const user = userEvent.setup();
        const decide = vi.fn(async () => decidedResult(PENDING_CHAT, 'reject'));
        renderSettings(makeChannelBClient([PENDING_CHAT], { channelBAccessDecision: decide }));

        await user.click(await screen.findByRole('button', { name: 'Rechazar' }));

        expect(decide).toHaveBeenCalledWith(1001, 'reject');
        expect(await screen.findByText('Solicitud de Ana Pérez rechazada.')).toBeInTheDocument();
    });

    it('asks for confirmation before revoking and does nothing on cancel', async () => {
        const user = userEvent.setup();
        const decide = vi.fn(async () => decidedResult(APPROVED_CHAT, 'revoke'));
        renderSettings(makeChannelBClient([APPROVED_CHAT], { channelBAccessDecision: decide }));

        await user.click(await screen.findByRole('button', { name: 'Revocar' }));
        const dialog = await screen.findByRole('dialog', { name: 'Revocar acceso' });
        expect(within(dialog).getByText('Beto Gómez')).toBeInTheDocument();
        expect(decide).not.toHaveBeenCalled();

        await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(decide).not.toHaveBeenCalled();
    });

    it('revokes after the user confirms', async () => {
        const user = userEvent.setup();
        const decide = vi.fn(async () => decidedResult(APPROVED_CHAT, 'revoke'));
        renderSettings(makeChannelBClient([APPROVED_CHAT], { channelBAccessDecision: decide }));

        await user.click(await screen.findByRole('button', { name: 'Revocar' }));
        const dialog = await screen.findByRole('dialog', { name: 'Revocar acceso' });
        await user.click(within(dialog).getByRole('button', { name: 'Revocar' }));

        expect(decide).toHaveBeenCalledWith(2001, 'revoke');
        expect(await screen.findByText('Acceso de Beto Gómez revocado.')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('explains that Channel B is not active on a 503 CHANNEL_B_ACCESS_UNAVAILABLE', async () => {
        renderSettings(makeChannelBClient([], {
            channelBAccessList: async () => { throw accessError('CHANNEL_B_ACCESS_UNAVAILABLE', 503); },
        }));

        expect(await screen.findByText(
            'El Canal B no está activo. Inicie el bot para gestionar las solicitudes de acceso.',
        )).toBeInTheDocument();
        expect(screen.queryByText('No hay solicitudes de acceso.')).not.toBeInTheDocument();
    });

    it('shows a clear message for any other list error', async () => {
        renderSettings(makeChannelBClient([], {
            channelBAccessList: async () => { throw accessError('TELEGRAM_STATE_UNAVAILABLE', 503); },
        }));

        expect(await screen.findByText(
            'No se pudo leer el estado de acceso del Canal B. Intente nuevamente.',
        )).toBeInTheDocument();
    });

    it('reports a 409 as a changed request and refetches the list', async () => {
        const user = userEvent.setup();
        const list = vi.fn(async () => [PENDING_CHAT]);
        renderSettings({
            channelBAccessList: list,
            channelBAccessDecision: async () => { throw accessError('CHANNEL_B_INVALID_TRANSITION', 409); },
        });

        await user.click(await screen.findByRole('button', { name: 'Aprobar' }));

        expect(await screen.findByText('La solicitud cambió mientras tanto. Se actualizó la lista.')).toBeInTheDocument();
        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    });

    it('routes protected errors to the session controller', async () => {
        const user = userEvent.setup();
        const error = accessError('AUTHENTICATION_REQUIRED', 401);
        const { controller } = renderSettings(makeChannelBClient([PENDING_CHAT], {
            channelBAccessDecision: async () => { throw error; },
        }));

        await user.click(await screen.findByRole('button', { name: 'Aprobar' }));

        await waitFor(() => expect(controller.handleProtectedRequestError).toHaveBeenCalledWith(error));
        expect(await screen.findByText('La sesión de administrador ya no está disponible.')).toBeInTheDocument();
    });

    it('refreshes the list on demand', async () => {
        const user = userEvent.setup();
        const list = vi.fn(async () => [PENDING_CHAT]);
        renderSettings({ channelBAccessList: list, channelBAccessDecision: vi.fn() });
        await screen.findByText('Ana Pérez');

        await user.click(screen.getByRole('button', { name: 'Actualizar solicitudes' }));

        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    });
});
