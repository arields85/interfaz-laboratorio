import { describe, expect, it } from 'vitest';

import {
    parseChannelAPairingIssue,
    parseChannelAPairingStatus,
    type ChannelAPairingIssue,
    type ChannelAPairingStatus,
} from './channelAPairing.types';

// Test-only opaque values shaped like the backend projection. Never a real credential.
const FAKE_PAIRING_TOKEN = 'f4ke'.padEnd(43, 'x');
const FAKE_BOT_USERNAME = 'hmi_lab_bot';
const FAKE_DEEP_LINK = `https://t.me/${FAKE_BOT_USERNAME}?start=${FAKE_PAIRING_TOKEN}`;
const VALID_FAKE_QR = { deepLink: FAKE_DEEP_LINK, expiresInSeconds: 42 };

function issueWithQr(qr: unknown): unknown {
    return { ok: true, qr };
}

function issueWithExpires(expiresInSeconds: unknown): unknown {
    return issueWithQr({ deepLink: FAKE_DEEP_LINK, expiresInSeconds });
}

function issueWithDeepLink(deepLink: unknown): unknown {
    return issueWithQr({ deepLink, expiresInSeconds: 42 });
}

describe('parseChannelAPairingStatus', () => {
    it.each(['free', 'pending', 'linked', 'unavailable'] as const)(
        'parses the exact status envelope for the pairing state %s',
        (state) => {
            const parsed: ChannelAPairingStatus | null = parseChannelAPairingStatus({ ok: true, state });

            expect(parsed).toEqual({ ok: true, state });
        },
    );

    it.each([
        ['null value', null],
        ['array payload', [{ ok: true, state: 'free' }]],
        ['non-object payload', 'free'],
        ['missing envelope keys', { state: 'free' }],
        ['ok false', { ok: false, state: 'free' }],
        ['ok not the literal true', { ok: 'true', state: 'free' }],
        ['unknown state string', { ok: true, state: 'frobnicate' }],
        ['case-sensitive state', { ok: true, state: 'Free' }],
        ['state not a string', { ok: true, state: 1 }],
        ['extra top-level key', { ok: true, state: 'free', owner: 'someone' }],
        ['nested qr leakage into status', { ok: true, state: 'free', qr: VALID_FAKE_QR }],
    ])('rejects the invalid status payload: %s', (_name, payload) => {
        expect(parseChannelAPairingStatus(payload)).toBeNull();
    });
});

describe('parseChannelAPairingIssue', () => {
    it('parses the exact issue envelope with the fake opaque deep link', () => {
        const parsed: ChannelAPairingIssue | null = parseChannelAPairingIssue({ ok: true, qr: VALID_FAKE_QR });

        expect(parsed).toEqual({ ok: true, qr: { deepLink: FAKE_DEEP_LINK, expiresInSeconds: 42 } });
        expect(parsed?.qr.deepLink).toBeTypeOf('string');
    });

    it.each([
        ['canonical fake deep link', FAKE_DEEP_LINK],
        ['hyphen, underscore and digits inside the token', `https://t.me/${FAKE_BOT_USERNAME}?start=a-B_9${'x'.repeat(38)}`],
        ['minimum bot username length', `https://t.me/hmi_b?start=${FAKE_PAIRING_TOKEN}`],
        ['maximum bot username length (32 total)', `https://t.me/${'b'.repeat(32)}?start=${FAKE_PAIRING_TOKEN}`],
    ])('accepts the deep link row: %s', (_name, deepLink) => {
        expect(parseChannelAPairingIssue(issueWithDeepLink(deepLink)))
            .toEqual({ ok: true, qr: { deepLink, expiresInSeconds: 42 } });
    });

    it.each([
        ['http scheme', FAKE_DEEP_LINK.replace('https://', 'http://')],
        ['token moved into the path', `https://t.me/${FAKE_BOT_USERNAME}/${FAKE_PAIRING_TOKEN}`],
        ['extra query parameter', `${FAKE_DEEP_LINK}&x=1`],
        ['second query string', `${FAKE_DEEP_LINK}?extra=1`],
        ['fragment suffix', `${FAKE_DEEP_LINK}#anchor`],
        ['token one char short', FAKE_DEEP_LINK.slice(0, -1)],
        ['token one char long', `${FAKE_DEEP_LINK}x`],
        ['invalid token character', `https://t.me/${FAKE_BOT_USERNAME}?start=${`${FAKE_PAIRING_TOKEN.slice(0, -1)}+`}`],
        ['bot username starting with a digit', FAKE_DEEP_LINK.replace(FAKE_BOT_USERNAME, `1${FAKE_BOT_USERNAME.slice(1)}`)],
        ['bot username too short', FAKE_DEEP_LINK.replace(FAKE_BOT_USERNAME, 'hmi')],
        ['bot username too long (33 total)', `https://t.me/${'b'.repeat(33)}?start=${FAKE_PAIRING_TOKEN}`],
        ['userinfo prefix', FAKE_DEEP_LINK.replace('https://t.me', 'https://user@t.me')],
        ['leading whitespace', ` ${FAKE_DEEP_LINK}`],
        ['trailing whitespace', `${FAKE_DEEP_LINK} `],
        ['deep link not a string', 42],
    ])('rejects the invalid deep link row: %s', (_name, deepLink) => {
        expect(parseChannelAPairingIssue(issueWithDeepLink(deepLink))).toBeNull();
    });

    it.each([
        ['minimum remaining seconds', 1],
        ['maximum TTL boundary', 60],
        ['monotonic fractional second', 1.5],
        ['sub-second fraction', 0.25],
    ])('accepts expiresInSeconds: %s', (_name, expiresInSeconds) => {
        expect(parseChannelAPairingIssue(issueWithExpires(expiresInSeconds)))
            .toEqual({ ok: true, qr: { deepLink: FAKE_DEEP_LINK, expiresInSeconds } });
    });

    it.each([
        ['zero', 0],
        ['negative', -1],
        ['above the TTL', 61],
        ['NaN', Number.NaN],
        ['infinite', Number.POSITIVE_INFINITY],
        ['boolean true', true],
        ['boolean false', false],
        ['numeric string', '30'],
        ['null', null],
        ['missing', undefined],
    ])('rejects expiresInSeconds: %s', (_name, expiresInSeconds) => {
        expect(parseChannelAPairingIssue(issueWithExpires(expiresInSeconds))).toBeNull();
    });

    it.each([
        ['missing qr', { ok: true }],
        ['qr null', { ok: true, qr: null }],
        ['qr array', issueWithQr([VALID_FAKE_QR])],
        ['qr not an object', issueWithQr('qr')],
        ['extra key inside qr', issueWithQr({ ...VALID_FAKE_QR, botUsername: FAKE_BOT_USERNAME })],
        ['missing expires inside qr', issueWithQr({ deepLink: FAKE_DEEP_LINK })],
        ['extra envelope key', { ok: true, qr: VALID_FAKE_QR, owner: 'someone' }],
        ['ok false', { ok: false, qr: VALID_FAKE_QR }],
        ['array envelope', [{ ok: true, qr: VALID_FAKE_QR }]],
    ])('rejects the invalid issue envelope: %s', (_name, payload) => {
        expect(parseChannelAPairingIssue(payload)).toBeNull();
    });
});
