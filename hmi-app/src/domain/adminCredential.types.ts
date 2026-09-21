export type CredentialProvider = 'gemini' | 'telegram' | 'telegram_channel_a';

export interface CredentialProviderMetadata {
    configured: boolean;
}

export interface CredentialMetadata {
    gemini: CredentialProviderMetadata;
    telegram: CredentialProviderMetadata;
    telegram_channel_a: CredentialProviderMetadata;
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
]);

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isProviderMetadata(value: unknown): value is CredentialProviderMetadata {
    return isObject(value) && hasExactKeys(value, ['configured']) && typeof value.configured === 'boolean';
}

function isProvider(value: unknown): value is CredentialProvider {
    return value === 'gemini' || value === 'telegram' || value === 'telegram_channel_a';
}

function isGeneration(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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
        || !isProviderMetadata(value.providers.gemini) || !isProviderMetadata(value.providers.telegram)
        || !isProviderMetadata(value.providers.telegram_channel_a)) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        gemini: value.providers.gemini,
        telegram: value.providers.telegram,
        telegram_channel_a: value.providers.telegram_channel_a,
    };
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

export function parseChannelAAdministrationStatus(value: unknown): ChannelAAdministrationStatus {
    if (!isObject(value) || !hasExactKeys(value, ['ok', 'channelA']) || value.ok !== true
        || !isObject(value.channelA) || !hasExactKeys(value.channelA, [
            'configured', 'desiredGeneration', 'appliedGeneration',
            'activationEpoch', 'activation', 'lastError',
        ])) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    const status = value.channelA;
    if (typeof status.configured !== 'boolean' || !isGeneration(status.desiredGeneration)
        || (status.appliedGeneration !== null && !isGeneration(status.appliedGeneration))
        || (status.activationEpoch !== null && !isGeneration(status.activationEpoch))) {
        throw new Error('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    }
    return {
        configured: status.configured,
        desiredGeneration: status.desiredGeneration,
        appliedGeneration: status.appliedGeneration,
        activationEpoch: status.activationEpoch,
        activation: parseChannelAActivation(status.activation),
        lastError: parseChannelAError(status.lastError),
    };
}

export function parseTelegramPassiveHealth(value: unknown): TelegramPassiveHealth {
    if (!isObject(value) || value.ok !== true
        || typeof value.telegramEnabled !== 'boolean' || typeof value.telegramConfigured !== 'boolean'
        || typeof value.telegramConnected !== 'boolean' || typeof value.telegramVerified !== 'boolean'
        || typeof value.telegramRestartRequired !== 'boolean'
        || (value.telegramDesiredGeneration !== null && !isGeneration(value.telegramDesiredGeneration))
        || (value.telegramAppliedGeneration !== null && !isGeneration(value.telegramAppliedGeneration))) {
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
    };
}

export function validateCredentialSecret(secret: string): void {
    if (!secret.trim()) throw new Error('ADMIN_CREDENTIAL_BLANK');
    if (new TextEncoder().encode(secret).byteLength > 4_096) {
        throw new Error('ADMIN_CREDENTIAL_TOO_LARGE');
    }
}
