export type CredentialProvider = 'gemini' | 'telegram' | 'telegram_channel_a';

export interface CredentialProviderMetadata {
    configured: boolean;
}

export type GeminiVerificationState = 'not_checked' | 'verified' | 'invalid_key' | 'unreachable' | 'not_configured';

export interface GeminiVerification {
    state: GeminiVerificationState;
    checkedAt: number | null;
}

export interface GeminiCredentialProviderMetadata extends CredentialProviderMetadata {
    verified: boolean;
    verification: GeminiVerification;
    // T15: the exact Gemini TTS model this key is verified/speaks with
    // (backend-sourced, never hardcoded on the frontend), shown as the
    // result area's resting text before the first verification.
    model: string;
}

// T13: on-demand, non-sending bot token verification shared by Telegram
// (Canal B) and Canal A -- the same closed-classification shape as Gemini's,
// plus the bot's own public username once verified (never the token itself).
export type TelegramTokenVerificationState =
    | 'not_checked' | 'verified' | 'invalid_token' | 'unreachable' | 'not_configured';

export interface TelegramTokenVerification {
    state: TelegramTokenVerificationState;
    checkedAt: number | null;
    username: string | null;
}

export interface TelegramFamilyCredentialProviderMetadata extends CredentialProviderMetadata {
    verified: boolean;
    verification: TelegramTokenVerification;
}

export interface CredentialMetadata {
    gemini: GeminiCredentialProviderMetadata;
    telegram: TelegramFamilyCredentialProviderMetadata;
    telegram_channel_a: TelegramFamilyCredentialProviderMetadata;
}

export type TelegramCredentialSource = 'protected' | 'environment' | null;

export type TelegramRuntimeError =
    | 'TELEGRAM_CREDENTIAL_MISSING'
    | 'TELEGRAM_PROVIDER_UNAVAILABLE'
    | 'TELEGRAM_STOP_TIMEOUT'
    | 'TELEGRAM_DISABLED'
    | 'TELEGRAM_BOT_IDENTITY_RESERVED'
    | 'TELEGRAM_POLL_FAILED'
    | 'TELEGRAM_PREPARATION_FAILED'
    | 'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING'
    | null;

export interface TelegramAdministrationStatus {
    source: TelegramCredentialSource;
    enabled: boolean;
    configured: boolean;
    desiredGeneration: number;
    appliedGeneration: number;
    running: boolean;
    verified: boolean;
    restartRequired: boolean;
    lastError: TelegramRuntimeError;
}

export type ChannelALifecyclePhase =
    | 'idle'
    | 'preparing'
    | 'prepared'
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'failed'
    | 'retired';

export type ChannelAActivationReason =
    | 'PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE'
    | 'PRISMA_CHANNEL_A_RESTART_REQUIRED'
    | 'TELEGRAM_BOT_IDENTITY_RESERVED'
    // T16: the runner's own two classified background-failure codes.
    | 'PRISMA_CHANNEL_A_POLL_FAILED'
    | 'PRISMA_CHANNEL_A_UNAUTHORIZED'
    | null;

export type ChannelARuntimeError =
    | 'PRISMA_CHANNEL_A_CONFIGURATION_INVALID'
    | 'PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE'
    | 'PRISMA_CHANNEL_A_CREDENTIAL_MISSING'
    | 'PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE'
    | 'PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE'
    | 'PRISMA_CHANNEL_A_RESTART_REQUIRED'
    | 'TELEGRAM_BOT_IDENTITY_RESERVED'
    | 'INVALID_CREDENTIAL_REQUEST'
    | 'PRISMA_CHANNEL_A_MANAGER_BUSY'
    | 'PRISMA_CHANNEL_A_STOP_UNCONFIRMED'
    // T16: the runner's own two classified background-failure codes.
    | 'PRISMA_CHANNEL_A_POLL_FAILED'
    | 'PRISMA_CHANNEL_A_UNAUTHORIZED'
    | null;

export interface ChannelAActivation {
    phase: ChannelALifecyclePhase;
    reason: ChannelAActivationReason;
    quiescent: boolean;
    restartRequired: boolean;
}

export interface ChannelAAdministrationStatus {
    configured: boolean;
    desiredGeneration: number;
    appliedGeneration: number | null;
    activationEpoch: number | null;
    activation: ChannelAActivation | null;
    lastError: ChannelARuntimeError;
    // The connected bot's Telegram username (public info, never the secret
    // token); non-null only while actually running without a pending restart.
    botUsername: string | null;
    // T15: whether any chat is currently paired to this bot (coarse,
    // owner-agnostic); only meaningful while actually running without a
    // pending restart, false otherwise -- same gating as botUsername.
    paired: boolean;
    // T16: true while a background failure is being automatically retried
    // with backoff. Optional on the wire (a running runtime may predate this
    // field): defaults to false/0 when absent so the UI never breaks against
    // an older backend.
    retrying: boolean;
    retryAttempt: number;
}

export interface CredentialMutationResult {
    provider: CredentialProvider;
    configured: boolean;
}

export interface TelegramPassiveHealth {
    enabled: boolean;
    configured: boolean;
    running: boolean;
    verified: boolean;
    desiredGeneration: number | null;
    appliedGeneration: number | null;
    restartRequired: boolean;
    configurationError: TelegramRuntimeError;
    lastError: TelegramRuntimeError;
    // The connected bot's Telegram username (public info, never the secret
    // token); non-null only while actually running.
    botUsername: string | null;
}

const TELEGRAM_ERRORS = new Set<Exclude<TelegramRuntimeError, null>>([
    'TELEGRAM_CREDENTIAL_MISSING',
    'TELEGRAM_PROVIDER_UNAVAILABLE',
    'TELEGRAM_STOP_TIMEOUT',
    'TELEGRAM_DISABLED',
    'TELEGRAM_BOT_IDENTITY_RESERVED',
    'TELEGRAM_POLL_FAILED',
    'TELEGRAM_PREPARATION_FAILED',
    'PRISMA_LOCAL_TELEGRAM_BOT_TOKEN_MISSING',
]);

const CHANNEL_A_PHASES = new Set<ChannelALifecyclePhase>([
    'idle', 'preparing', 'prepared', 'running', 'stopping', 'stopped', 'failed', 'retired',
]);

const CHANNEL_A_ACTIVATION_REASONS = new Set<Exclude<ChannelAActivationReason, null>>([
    'PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE',
    'PRISMA_CHANNEL_A_RESTART_REQUIRED',
    'TELEGRAM_BOT_IDENTITY_RESERVED',
    'PRISMA_CHANNEL_A_POLL_FAILED',
    'PRISMA_CHANNEL_A_UNAUTHORIZED',
]);

const CHANNEL_A_ERRORS = new Set<Exclude<ChannelARuntimeError, null>>([
    'PRISMA_CHANNEL_A_CONFIGURATION_INVALID',
    'PRISMA_CHANNEL_A_CONFIGURATION_UNAVAILABLE',
    'PRISMA_CHANNEL_A_CREDENTIAL_MISSING',
    'PRISMA_CHANNEL_A_CREDENTIAL_UNAVAILABLE',
    'PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE',
    'PRISMA_CHANNEL_A_RESTART_REQUIRED',
    'TELEGRAM_BOT_IDENTITY_RESERVED',
    'INVALID_CREDENTIAL_REQUEST',
    'PRISMA_CHANNEL_A_MANAGER_BUSY',
    'PRISMA_CHANNEL_A_STOP_UNCONFIRMED',
    'PRISMA_CHANNEL_A_POLL_FAILED',
    'PRISMA_CHANNEL_A_UNAUTHORIZED',
]);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

// T16: every required key must be present; every present key must be either
// required or optional. Unlike hasExactKeys, an optional key may be ABSENT
// (an older runtime's payload) without failing -- but an unrelated unknown
// key still fails closed, exactly like hasExactKeys does.
function hasKeysWithin(
    value: Record<string, unknown>,
    required: readonly string[],
    optional: readonly string[],
): boolean {
    const allowed = new Set<string>([...required, ...optional]);
    const keys = Object.keys(value);
    return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key));
}

const GEMINI_VERIFICATION_STATES = new Set<GeminiVerificationState>([
    'not_checked', 'verified', 'invalid_key', 'unreachable', 'not_configured',
]);

function isGeminiVerification(value: unknown): value is GeminiVerification {
    return isObject(value) && hasExactKeys(value, ['state', 'checkedAt'])
        && typeof value.state === 'string' && GEMINI_VERIFICATION_STATES.has(value.state as GeminiVerificationState)
        && (value.checkedAt === null || (typeof value.checkedAt === 'number' && Number.isFinite(value.checkedAt)));
}

function isGeminiProviderMetadata(value: unknown): value is GeminiCredentialProviderMetadata {
    return isObject(value) && hasExactKeys(value, ['configured', 'verified', 'verification', 'model'])
        && typeof value.configured === 'boolean' && typeof value.verified === 'boolean'
        && isGeminiVerification(value.verification)
        && typeof value.model === 'string' && value.model.length > 0;
}

const TELEGRAM_TOKEN_VERIFICATION_STATES = new Set<TelegramTokenVerificationState>([
    'not_checked', 'verified', 'invalid_token', 'unreachable', 'not_configured',
]);

function isTelegramTokenVerification(value: unknown): value is TelegramTokenVerification {
    return isObject(value) && hasExactKeys(value, ['state', 'checkedAt', 'username'])
        && typeof value.state === 'string'
        && TELEGRAM_TOKEN_VERIFICATION_STATES.has(value.state as TelegramTokenVerificationState)
        && (value.checkedAt === null || (typeof value.checkedAt === 'number' && Number.isFinite(value.checkedAt)))
        && isBotUsername(value.username);
}

function isTelegramFamilyProviderMetadata(value: unknown): value is TelegramFamilyCredentialProviderMetadata {
    return isObject(value) && hasExactKeys(value, ['configured', 'verified', 'verification'])
        && typeof value.configured === 'boolean' && typeof value.verified === 'boolean'
        && isTelegramTokenVerification(value.verification);
}

function isProvider(value: unknown): value is CredentialProvider {
    return value === 'gemini' || value === 'telegram' || value === 'telegram_channel_a';
}

function isGeneration(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

// Public info (never the secret token): null, or a non-empty string. An
// empty string is never a real Telegram username, so it is rejected rather
// than silently accepted as an equivalent of null.
function isBotUsername(value: unknown): value is string | null {
    return value === null || (typeof value === 'string' && value.length > 0);
}

function parseTelegramError(value: unknown): TelegramRuntimeError {
    if (value === null) return null;
    if (typeof value === 'string' && TELEGRAM_ERRORS.has(value as Exclude<TelegramRuntimeError, null>)) {
        return value as Exclude<TelegramRuntimeError, null>;
    }
    throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
}

export function parseCredentialMetadata(value: unknown): CredentialMetadata {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'providers']) || value.ok !== true
        || !isObject(value.providers)
        || !hasExactKeys(value.providers, ['gemini', 'telegram', 'telegram_channel_a'])
        || !isGeminiProviderMetadata(value.providers.gemini)
        || !isTelegramFamilyProviderMetadata(value.providers.telegram)
        || !isTelegramFamilyProviderMetadata(value.providers.telegram_channel_a)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        gemini: value.providers.gemini,
        telegram: value.providers.telegram,
        telegram_channel_a: value.providers.telegram_channel_a,
    };
}

export function parseGeminiVerificationResult(value: unknown): GeminiCredentialProviderMetadata {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'gemini']) || value.ok !== true
        || !isGeminiProviderMetadata(value.gemini)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return value.gemini;
}

export function parseTelegramVerificationResult(value: unknown): TelegramFamilyCredentialProviderMetadata {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'telegram']) || value.ok !== true
        || !isTelegramFamilyProviderMetadata(value.telegram)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return value.telegram;
}

export function parseChannelAVerificationResult(value: unknown): TelegramFamilyCredentialProviderMetadata {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'channelA']) || value.ok !== true
        || !isTelegramFamilyProviderMetadata(value.channelA)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return value.channelA;
}

export function parseCredentialMutation(value: unknown): CredentialMutationResult {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'provider', 'configured']) || value.ok !== true
        || !isProvider(value.provider) || typeof value.configured !== 'boolean') {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return { provider: value.provider, configured: value.configured };
}

export function parseTelegramAdministrationStatus(value: unknown): TelegramAdministrationStatus {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'telegram']) || value.ok !== true
        || !isObject(value.telegram) || !hasExactKeys(value.telegram, [
            'source', 'enabled', 'configured', 'desiredGeneration', 'appliedGeneration',
            'running', 'verified', 'restartRequired', 'lastError',
        ])) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    const status = value.telegram;
    if ((status.source !== 'protected' && status.source !== 'environment' && status.source !== null)
        || typeof status.enabled !== 'boolean' || typeof status.configured !== 'boolean'
        || !isGeneration(status.desiredGeneration) || !isGeneration(status.appliedGeneration)
        || typeof status.running !== 'boolean' || typeof status.verified !== 'boolean'
        || typeof status.restartRequired !== 'boolean') {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        source: status.source,
        enabled: status.enabled,
        configured: status.configured,
        desiredGeneration: status.desiredGeneration,
        appliedGeneration: status.appliedGeneration,
        running: status.running,
        verified: status.verified,
        restartRequired: status.restartRequired,
        lastError: parseTelegramError(status.lastError),
    };
}

function parseChannelAError(value: unknown): ChannelARuntimeError {
    if (value === null) return null;
    if (typeof value === 'string' && CHANNEL_A_ERRORS.has(value as Exclude<ChannelARuntimeError, null>)) {
        return value as Exclude<ChannelARuntimeError, null>;
    }
    throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
}

function parseChannelAActivation(value: unknown): ChannelAActivation | null {
    if (value === null) return null;
    if (!isObject(value) || !hasExactKeys(value, ['phase', 'reason', 'quiescent', 'restartRequired'])
        || typeof value.quiescent !== 'boolean' || typeof value.restartRequired !== 'boolean'
        || typeof value.phase !== 'string' || !CHANNEL_A_PHASES.has(value.phase as ChannelALifecyclePhase)
        || (value.reason !== null && (typeof value.reason !== 'string'
            || !CHANNEL_A_ACTIVATION_REASONS.has(value.reason as Exclude<ChannelAActivationReason, null>)))) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        phase: value.phase as ChannelALifecyclePhase,
        reason: value.reason as ChannelAActivationReason,
        quiescent: value.quiescent,
        restartRequired: value.restartRequired,
    };
}

// T16: required on every payload; optional so an older runtime's response
// (predating retrying/retryAttempt) still parses, defaulting to false/0.
const CHANNEL_A_STATUS_REQUIRED_FIELDS = [
    'configured', 'desiredGeneration', 'appliedGeneration',
    'activationEpoch', 'activation', 'lastError', 'botUsername', 'paired',
] as const;
const CHANNEL_A_STATUS_OPTIONAL_FIELDS = ['retrying', 'retryAttempt'] as const;

export function parseChannelAAdministrationStatus(value: unknown): ChannelAAdministrationStatus {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'channelA']) || value.ok !== true
        || !isObject(value.channelA) || !hasKeysWithin(
            value.channelA, CHANNEL_A_STATUS_REQUIRED_FIELDS, CHANNEL_A_STATUS_OPTIONAL_FIELDS,
        )) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    const status = value.channelA;
    if (typeof status.configured !== 'boolean' || !isGeneration(status.desiredGeneration)
        || (status.appliedGeneration !== null && !isGeneration(status.appliedGeneration))
        || (status.activationEpoch !== null && !isGeneration(status.activationEpoch))
        || !isBotUsername(status.botUsername)
        || typeof status.paired !== 'boolean'
        || (status.retrying !== undefined && typeof status.retrying !== 'boolean')
        || (status.retryAttempt !== undefined && !isGeneration(status.retryAttempt))) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        configured: status.configured,
        desiredGeneration: status.desiredGeneration,
        appliedGeneration: status.appliedGeneration,
        activationEpoch: status.activationEpoch,
        activation: parseChannelAActivation(status.activation),
        lastError: parseChannelAError(status.lastError),
        botUsername: status.botUsername,
        paired: status.paired,
        retrying: status.retrying === undefined ? false : status.retrying,
        retryAttempt: status.retryAttempt === undefined ? 0 : status.retryAttempt,
    };
}

export function parseTelegramPassiveHealth(value: unknown): TelegramPassiveHealth {
    if (!isObject(value) || value.ok !== true
        || typeof value.telegramEnabled !== 'boolean' || typeof value.telegramConfigured !== 'boolean'
        || typeof value.telegramConnected !== 'boolean' || typeof value.telegramVerified !== 'boolean'
        || typeof value.telegramRestartRequired !== 'boolean'
        || (value.telegramDesiredGeneration !== null && !isGeneration(value.telegramDesiredGeneration))
        || (value.telegramAppliedGeneration !== null && !isGeneration(value.telegramAppliedGeneration))
        || !isBotUsername(value.telegramBotUsername)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        enabled: value.telegramEnabled,
        configured: value.telegramConfigured,
        running: value.telegramConnected,
        verified: value.telegramVerified,
        desiredGeneration: value.telegramDesiredGeneration,
        appliedGeneration: value.telegramAppliedGeneration,
        restartRequired: value.telegramRestartRequired,
        configurationError: parseTelegramError(value.telegramConfigurationError),
        lastError: parseTelegramError(value.telegramLastError),
        botUsername: value.telegramBotUsername,
    };
}

export function validateCredentialSecret(secret: string): void {
    if (!secret.trim()) throw new Error('ADMIN_CREDENTIAL_BLANK');
    if (new TextEncoder().encode(secret).byteLength > 4_096) {
        throw new Error('ADMIN_CREDENTIAL_TOO_LARGE');
    }
}
