import { describe, expect, it } from 'vitest';

import {
    allowedChannelBAccessDecisions,
    parseChannelBAccessDecisionResult,
    parseChannelBAccessList,
} from './channelBAccess.types';

const CHAT = {
    chatId: 1001,
    status: 'pending',
    displayName: 'Ana Pérez',
    username: 'ana_perez',
    requestedAt: '2026-10-01T12:00:00+00:00',
    decidedAt: null,
};

describe('parseChannelBAccessList', () => {
    it('accepts the exact envelope and keeps the server order', () => {
        const second = { ...CHAT, chatId: 1002, status: 'approved', username: null, decidedAt: '2026-10-01T13:00:00+00:00' };

        expect(parseChannelBAccessList({ ok: true, chats: [CHAT, second] })).toEqual([CHAT, second]);
    });

    it('accepts an empty list', () => {
        expect(parseChannelBAccessList({ ok: true, chats: [] })).toEqual([]);
    });

    it.each([
        ['an extra envelope key', { ok: true, chats: [], extra: 1 }],
        ['ok that is not true', { ok: false, chats: [] }],
        ['a missing chats key', { ok: true }],
        ['a non-array chats value', { ok: true, chats: {} }],
        ['an extra chat key', { ok: true, chats: [{ ...CHAT, token: 'x' }] }],
        ['a missing chat key', { ok: true, chats: [{ chatId: 1, status: 'pending' }] }],
        ['an unknown status', { ok: true, chats: [{ ...CHAT, status: 'banned' }] }],
        ['a non-integer chat id', { ok: true, chats: [{ ...CHAT, chatId: 1.5 }] }],
        ['a string chat id', { ok: true, chats: [{ ...CHAT, chatId: '1001' }] }],
        ['a non-string display name', { ok: true, chats: [{ ...CHAT, displayName: 7 }] }],
        ['an empty username', { ok: true, chats: [{ ...CHAT, username: '' }] }],
        ['an unparseable requestedAt', { ok: true, chats: [{ ...CHAT, requestedAt: 'ayer' }] }],
        ['an unparseable decidedAt', { ok: true, chats: [{ ...CHAT, decidedAt: 'hoy' }] }],
        ['a non-object payload', null],
    ])('rejects %s', (_label, payload) => {
        expect(() => parseChannelBAccessList(payload)).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    });
});

describe('parseChannelBAccessDecisionResult', () => {
    it('accepts the exact decision envelope', () => {
        const chat = { ...CHAT, status: 'approved', decidedAt: '2026-10-01T13:00:00+00:00' };

        expect(parseChannelBAccessDecisionResult({ ok: true, chat, noticeSent: false }))
            .toEqual({ chat, noticeSent: false });
    });

    it.each([
        ['a missing noticeSent', { ok: true, chat: CHAT }],
        ['a non-boolean noticeSent', { ok: true, chat: CHAT, noticeSent: 'yes' }],
        ['an extra key', { ok: true, chat: CHAT, noticeSent: true, extra: 1 }],
        ['an invalid chat', { ok: true, chat: { ...CHAT, status: 'x' }, noticeSent: true }],
    ])('rejects %s', (_label, payload) => {
        expect(() => parseChannelBAccessDecisionResult(payload)).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    });
});

describe('allowedChannelBAccessDecisions', () => {
    it.each([
        ['pending', ['approve', 'reject']],
        ['approved', ['revoke']],
        ['rejected', ['approve']],
        ['revoked', ['approve']],
    ] as const)('allows only the valid transitions for %s', (status, expected) => {
        expect(allowedChannelBAccessDecisions(status)).toEqual(expected);
    });
});
