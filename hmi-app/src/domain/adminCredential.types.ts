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
