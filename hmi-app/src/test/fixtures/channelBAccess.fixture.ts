import type {
    ChannelBAccessChat,
    ChannelBAccessDecision,
    ChannelBAccessDecisionResult,
} from '../../domain';
import type { ChannelBAccessClient } from '../../hooks/useChannelBAccess';
import { AdminAuthError } from '../../services/adminAuth.service';

export function makeChannelBChat(overrides: Partial<ChannelBAccessChat> = {}): ChannelBAccessChat {
    return {
        chatId: 1001,
        status: 'pending',
        displayName: 'Ana Pérez',
        username: 'ana_perez',
        requestedAt: '2026-10-01T12:00:00+00:00',
        decidedAt: null,
        ...overrides,
    };
}

export const PENDING_CHAT = makeChannelBChat();
export const PENDING_CHAT_NO_NAME = makeChannelBChat({
    chatId: 1002, displayName: '', username: null, requestedAt: '2026-10-01T12:05:00+00:00',
});
export const APPROVED_CHAT = makeChannelBChat({
    chatId: 2001, status: 'approved', displayName: 'Beto Gómez', username: 'beto',
    decidedAt: '2026-10-01T13:00:00+00:00',
});
export const REJECTED_CHAT = makeChannelBChat({
    chatId: 3001, status: 'rejected', displayName: 'Carla Ruiz', username: null,
    decidedAt: '2026-10-01T13:10:00+00:00',
});
export const REVOKED_CHAT = makeChannelBChat({
    chatId: 4001, status: 'revoked', displayName: 'Dario Paz', username: 'dario',
    decidedAt: '2026-10-01T13:20:00+00:00',
});

export const ALL_CHATS: ChannelBAccessChat[] = [
    PENDING_CHAT, PENDING_CHAT_NO_NAME, APPROVED_CHAT, REJECTED_CHAT, REVOKED_CHAT,
];

const STATUS_AFTER: Record<ChannelBAccessDecision, ChannelBAccessChat['status']> = {
    approve: 'approved', reject: 'rejected', revoke: 'revoked',
};

export function decidedResult(
    chat: ChannelBAccessChat,
    decision: ChannelBAccessDecision,
    noticeSent = true,
): ChannelBAccessDecisionResult {
    return {
        chat: { ...chat, status: STATUS_AFTER[decision], decidedAt: '2026-10-01T14:00:00+00:00' },
        noticeSent,
    };
}

export function makeChannelBClient(
    chats: ChannelBAccessChat[] = ALL_CHATS,
    overrides: Partial<ChannelBAccessClient> = {},
): ChannelBAccessClient {
    return {
        channelBAccessList: async () => chats,
        channelBAccessDecision: async (chatId, decision) => {
            const chat = chats.find((entry) => entry.chatId === chatId) ?? PENDING_CHAT;
            return decidedResult(chat, decision);
        },
        ...overrides,
    };
}

export function accessError(code: string, status: number): AdminAuthError {
    return new AdminAuthError(code, status);
}
