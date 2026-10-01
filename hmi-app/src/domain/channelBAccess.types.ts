// Channel B access administration: who may use the Telegram assistant. These are HMI
// configuration records (approve, reject, revoke a person), never plant control.

export type ChannelBAccessStatus = 'pending' | 'approved' | 'rejected' | 'revoked';

export type ChannelBAccessDecision = 'approve' | 'reject' | 'revoke';

export interface ChannelBAccessChat {
    chatId: number;
    status: ChannelBAccessStatus;
    displayName: string;
    username: string | null;
    requestedAt: string;
    decidedAt: string | null;
}

export interface ChannelBAccessDecisionResult {
    chat: ChannelBAccessChat;
    // False when the decision was recorded but the Telegram notice could not be delivered.
    noticeSent: boolean;
}

const STATUSES = new Set<ChannelBAccessStatus>(['pending', 'approved', 'rejected', 'revoked']);

// Mirrors the runtime transition table: pending -> approved | rejected, approved -> revoked,
// rejected | revoked -> approved.
const ALLOWED_DECISIONS: Record<ChannelBAccessStatus, readonly ChannelBAccessDecision[]> = {
    pending: ['approve', 'reject'],
    approved: ['revoke'],
    rejected: ['approve'],
    revoked: ['approve'],
};

export function allowedChannelBAccessDecisions(status: ChannelBAccessStatus): readonly ChannelBAccessDecision[] {
    return ALLOWED_DECISIONS[status];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isTimestamp(value: unknown): value is string {
    return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

function isChat(value: unknown): value is ChannelBAccessChat {
    return isObject(value)
        && hasExactKeys(value, ['chatId', 'status', 'displayName', 'username', 'requestedAt', 'decidedAt'])
        && typeof value.chatId === 'number' && Number.isSafeInteger(value.chatId)
        && typeof value.status === 'string' && STATUSES.has(value.status as ChannelBAccessStatus)
        && typeof value.displayName === 'string'
        && (value.username === null || (typeof value.username === 'string' && value.username.length > 0))
        && isTimestamp(value.requestedAt)
        && (value.decidedAt === null || isTimestamp(value.decidedAt));
}

export function parseChannelBAccessList(value: unknown): ChannelBAccessChat[] {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'chats']) || value.ok !== true
        || !Array.isArray(value.chats) || !value.chats.every(isChat)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return value.chats.map((chat) => ({
        chatId: chat.chatId,
        status: chat.status,
        displayName: chat.displayName,
        username: chat.username,
        requestedAt: chat.requestedAt,
        decidedAt: chat.decidedAt,
    }));
}

export function parseChannelBAccessDecisionResult(value: unknown): ChannelBAccessDecisionResult {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'chat', 'noticeSent']) || value.ok !== true
        || !isChat(value.chat) || typeof value.noticeSent !== 'boolean') {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    const { chat } = value;
    return {
        chat: {
            chatId: chat.chatId,
            status: chat.status,
            displayName: chat.displayName,
            username: chat.username,
            requestedAt: chat.requestedAt,
            decidedAt: chat.decidedAt,
        },
        noticeSent: value.noticeSent,
    };
}
