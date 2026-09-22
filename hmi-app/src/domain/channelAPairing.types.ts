// Channel A pairing projection (read-only HMI view of the backend pairing registry).
// The backend builds every deep link; the HMI only validates the frozen envelope shapes.

export const CHANNEL_A_PAIRING_TTL_SECONDS = 60;

export type ChannelAPairingState = 'free' | 'pending' | 'linked' | 'unavailable';

export interface ChannelAPairingStatus {
    ok: true;
    state: ChannelAPairingState;
}

export interface ChannelAPairingQr {
    deepLink: string;
    expiresInSeconds: number;
}

export interface ChannelAPairingIssue {
    ok: true;
    qr: ChannelAPairingQr;
}

export type ChannelAPairingErrorKind = 'session' | 'conflict' | 'unavailable';

const PAIRING_STATES: readonly string[] = ['free', 'pending', 'linked', 'unavailable'];

// Exact Telegram deep link: https://t.me/<botUsername 5-32 chars, letter first>?start=<43-char
// URL-safe token>. Nothing else may precede, follow or extend the link.
const DEEP_LINK_PATTERN = /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{4,31}\?start=[A-Za-z0-9_-]{43}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
    const keys = Object.keys(value);
    return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

// JS `$` also matches right before a final newline, so the anchored pattern alone would accept
// one trailing "\n". Canonical links contain no whitespace at all; reject it explicitly.
function isCanonicalDeepLink(value: string): boolean {
    return !/\s/.test(value) && DEEP_LINK_PATTERN.test(value);
}

function isValidExpiresInSeconds(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value > 0
        && value <= CHANNEL_A_PAIRING_TTL_SECONDS;
}

export function parseChannelAPairingStatus(value: unknown): ChannelAPairingStatus | null {
    if (!isPlainObject(value) || !hasExactKeys(value, ['ok', 'state'])) return null;
    if (value.ok !== true) return null;
    if (typeof value.state !== 'string' || !PAIRING_STATES.includes(value.state)) return null;
    return { ok: true, state: value.state as ChannelAPairingState };
}

function parseChannelAPairingQr(value: unknown): ChannelAPairingQr | null {
    if (!isPlainObject(value) || !hasExactKeys(value, ['deepLink', 'expiresInSeconds'])) return null;
    if (typeof value.deepLink !== 'string' || !isCanonicalDeepLink(value.deepLink)) return null;
    if (!isValidExpiresInSeconds(value.expiresInSeconds)) return null;
    return { deepLink: value.deepLink, expiresInSeconds: value.expiresInSeconds };
}

export function parseChannelAPairingIssue(value: unknown): ChannelAPairingIssue | null {
    if (!isPlainObject(value) || !hasExactKeys(value, ['ok', 'qr'])) return null;
    if (value.ok !== true) return null;
    const qr = parseChannelAPairingQr(value.qr);
    if (qr === null) return null;
    return { ok: true, qr };
}
