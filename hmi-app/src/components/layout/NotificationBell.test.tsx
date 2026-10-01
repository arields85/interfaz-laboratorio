import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHANNEL_B_ACCESS_POLL_INTERVAL_MS, type ChannelBAccessClient } from '../../hooks/useChannelBAccess';
import { UNAUTHENTICATED_SESSION, useAuthStore } from '../../store/auth.store';
import {
    accessError,
    ALL_CHATS,
    APPROVED_CHAT,
    decidedResult,
    makeChannelBClient,
    PENDING_CHAT,
    PENDING_CHAT_NO_NAME,
} from '../../test/fixtures/channelBAccess.fixture';
import NotificationBell from './NotificationBell';

function setAdminSession(isAuthenticated = true) {
    useAuthStore.setState({
        session: isAuthenticated
            ? {
                user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } },
                isAuthenticated: true,
                loginTimestamp: new Date().toISOString(),
            }
            : UNAUTHENTICATED_SESSION,
        isHydrated: true,
    });
}

function renderBell(client: ChannelBAccessClient) {
    const controller = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = render(
        <div>
            <NotificationBell client={client} controller={controller} />
            <p>fuera del panel</p>
        </div>,
        { wrapper: Wrapper },
    );
    return { ...view, controller, queryClient };
}

describe('NotificationBell', () => {
    beforeEach(() => {
        setAdminSession(true);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('is an enabled button without a badge when nothing is pending', async () => {
        const list = vi.fn(async () => [APPROVED_CHAT]);
        renderBell(makeChannelBClient([], { channelBAccessList: list }));
        await waitFor(() => expect(list).toHaveBeenCalled());

        const bell = screen.getByRole('button', { name: 'Notificaciones' });
        expect(bell).toBeEnabled();
        expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    });

    it('shows the pending count in a badge and in the accessible name', async () => {
        renderBell(makeChannelBClient(ALL_CHATS));

        const bell = await screen.findByRole('button', { name: 'Notificaciones: 2 pendientes' });
        expect(within(bell).getByTestId('notification-badge')).toHaveTextContent('2');
    });

    it('uses the singular for one pending request', async () => {
        renderBell(makeChannelBClient([PENDING_CHAT, APPROVED_CHAT]));

        expect(await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' })).toBeInTheDocument();
    });

    it('caps a large count in the badge without changing the accessible count', async () => {
        const many = Array.from({ length: 12 }, (_, index) => ({ ...PENDING_CHAT, chatId: 5000 + index }));
        renderBell(makeChannelBClient(many));

        const bell = await screen.findByRole('button', { name: 'Notificaciones: 12 pendientes' });
        expect(within(bell).getByTestId('notification-badge')).toHaveTextContent('9+');
    });

    it('opens a panel listing only pending requests with their actions', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient(ALL_CHATS));

        await user.click(await screen.findByRole('button', { name: 'Notificaciones: 2 pendientes' }));

        const panel = screen.getByRole('dialog', { name: 'Notificaciones' });
        expect(within(panel).getByText('Solicitudes de acceso al Canal B (2)')).toBeInTheDocument();
        const rows = within(panel).getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(within(rows[0]).getByText('Ana Pérez')).toBeInTheDocument();
        expect(within(rows[0]).getByText('@ana_perez')).toBeInTheDocument();
        expect(rows[0].querySelector('time')).toHaveAttribute('dateTime', PENDING_CHAT.requestedAt);
        expect(within(rows[1]).getByText('Chat 1002')).toBeInTheDocument();
        expect(within(rows[0]).getAllByRole('button').map((button) => button.textContent)).toEqual(['Aprobar', 'Rechazar']);
        expect(within(panel).queryByText('Beto Gómez')).not.toBeInTheDocument();
        expect(within(panel).queryByRole('link', { name: /Ver todas/ })).not.toBeInTheDocument();
    });

    it('shows the empty state', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([APPROVED_CHAT]));

        await user.click(screen.getByRole('button', { name: 'Notificaciones' }));

        expect(await screen.findByText('No hay notificaciones.')).toBeInTheDocument();
    });

    it('says Channel B is not active on a 503 CHANNEL_B_ACCESS_UNAVAILABLE', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([], {
            channelBAccessList: async () => { throw accessError('CHANNEL_B_ACCESS_UNAVAILABLE', 503); },
        }));

        await user.click(screen.getByRole('button', { name: 'Notificaciones' }));

        expect(await screen.findByText('El Canal B no está activo.')).toBeInTheDocument();
        expect(screen.queryByText('No hay notificaciones.')).not.toBeInTheDocument();
    });

    it('shows a clear message for any other error', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([], {
            channelBAccessList: async () => { throw accessError('TELEGRAM_STATE_UNAVAILABLE', 503); },
        }));

        await user.click(screen.getByRole('button', { name: 'Notificaciones' }));

        expect(await screen.findByText(
            'No se pudo leer el estado de acceso del Canal B. Intente nuevamente.',
        )).toBeInTheDocument();
    });

    it('approves a request from the panel and updates the badge', async () => {
        const user = userEvent.setup();
        let chats = [PENDING_CHAT];
        const decide = vi.fn(async () => {
            chats = [];
            return decidedResult(PENDING_CHAT, 'approve');
        });
        renderBell({ channelBAccessList: async () => chats, channelBAccessDecision: decide });

        await user.click(await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }));

        expect(decide).toHaveBeenCalledWith(1001, 'approve');
        expect(await screen.findByText('Acceso aprobado para Ana Pérez.')).toBeInTheDocument();
        expect(await screen.findByRole('button', { name: 'Notificaciones' })).toBeInTheDocument();
        expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
        expect(screen.getByText('No hay notificaciones.')).toBeInTheDocument();
    });

    it('rejects a request from the panel', async () => {
        const user = userEvent.setup();
        const decide = vi.fn(async () => decidedResult(PENDING_CHAT, 'reject'));
        renderBell(makeChannelBClient([PENDING_CHAT], { channelBAccessDecision: decide }));

        await user.click(await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Rechazar' }));

        expect(decide).toHaveBeenCalledWith(1001, 'reject');
        expect(await screen.findByText('Solicitud de Ana Pérez rechazada.')).toBeInTheDocument();
    });

    it('warns when the approval notice could not be sent', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([PENDING_CHAT_NO_NAME], {
            channelBAccessDecision: async () => decidedResult(PENDING_CHAT_NO_NAME, 'approve', false),
        }));

        await user.click(await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }));

        expect(await screen.findByText(
            'Acceso aprobado para Chat 1002, pero no se pudo enviar el aviso por Telegram.',
        )).toBeInTheDocument();
    });

    it('explains a decision conflict', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([PENDING_CHAT], {
            channelBAccessDecision: async () => { throw accessError('CHANNEL_B_INVALID_TRANSITION', 409); },
        }));

        await user.click(await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aprobar' }));

        expect(await screen.findByText('La solicitud cambió mientras tanto. Se actualizó la lista.')).toBeInTheDocument();
    });

    it('closes on Escape and returns focus to the bell', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([PENDING_CHAT]));
        const bell = await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' });
        await user.click(bell);
        expect(screen.getByRole('dialog', { name: 'Notificaciones' })).toBeInTheDocument();

        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(bell).toHaveFocus();
    });

    it('closes on an outside click but not on a click inside the panel', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([PENDING_CHAT]));
        await user.click(await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' }));

        await user.click(screen.getByText('Solicitudes de acceso al Canal B (1)'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        await user.click(screen.getByText('fuera del panel'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('toggles closed when the bell is clicked again', async () => {
        const user = userEvent.setup();
        renderBell(makeChannelBClient([PENDING_CHAT]));
        const bell = await screen.findByRole('button', { name: 'Notificaciones: 1 pendiente' });

        await user.click(bell);
        await user.click(bell);

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('never fetches without an admin session', async () => {
        setAdminSession(false);
        const list = vi.fn(async () => [PENDING_CHAT]);
        renderBell(makeChannelBClient([], { channelBAccessList: list }));

        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(list).not.toHaveBeenCalled();
    });

    it('polls every 30 seconds while the admin session is active', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        const list = vi.fn(async () => [PENDING_CHAT]);
        renderBell(makeChannelBClient([], { channelBAccessList: list }));
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

        await act(async () => { await vi.advanceTimersByTimeAsync(CHANNEL_B_ACCESS_POLL_INTERVAL_MS); });

        expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
});
