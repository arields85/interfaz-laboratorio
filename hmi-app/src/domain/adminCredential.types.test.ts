import { describe, expect, it } from 'vitest';

import {
    parseCredentialMetadata,
    parseCredentialMutation,
    parseTelegramAdministrationStatus,
    parseTelegramPassiveHealth,
    validateCredentialSecret,
} from './adminCredential.types';

describe('admin credential domain', () => {
    const exactProviders = {
        gemini: { configured: false },
        telegram: { configured: true },
        telegram_channel_a: { configured: false },
    };

    it('parses exact three-provider metadata and mutation envelopes', () => {
        expect(parseCredentialMetadata({ ok: true, providers: exactProviders })).toEqual(exactProviders);
        expect(parseCredentialMutation({ ok: true, provider: 'telegram', configured: true })).toEqual({
            provider: 'telegram', configured: true,
        });
        expect(parseCredentialMutation({ ok: true, provider: 'telegram_channel_a', configured: false })).toEqual({
            provider: 'telegram_channel_a', configured: false,
        });
    });

    it('rejects malformed or unknown metadata instead of coercing it', () => {
        expect(() => parseCredentialMetadata({
            ok: true,
            providers: { ...exactProviders, gemini: { configured: 'yes' } },
        })).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        expect(() => parseCredentialMutation({ ok: true, provider: 'unknown', configured: true }))
            .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    });

    it('fails closed on missing, extra, or nonboolean channel A metadata', () => {
        const malformed = [
            { gemini: exactProviders.gemini, telegram: exactProviders.telegram },
            { ...exactProviders, telegram_channel_b: { configured: false } },
            { ...exactProviders, telegram_channel_a: { configured: 'yes' } },
        ];
        for (const providers of malformed) {
            expect(() => parseCredentialMetadata({ ok: true, providers }))
                .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        }
    });

    it('rejects dishonest channel A mutation envelopes', () => {
        expect(() => parseCredentialMutation({ ok: true, provider: 'telegram_channel_b', configured: false }))
            .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        expect(() => parseCredentialMutation({ ok: true, provider: 'telegram_channel_a', configured: 'yes' }))
            .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    });

    it('parses truthful Telegram administration status and rejects unsafe error values', () => {
        const status = {
            source: 'protected', enabled: true, configured: true,
            desiredGeneration: 4, appliedGeneration: 3, running: true,
            verified: false, restartRequired: true, lastError: 'TELEGRAM_PREPARATION_FAILED',
        } as const;
        expect(parseTelegramAdministrationStatus({ ok: true, telegram: status })).toEqual(status);
        expect(() => parseTelegramAdministrationStatus({
            ok: true, telegram: { ...status, lastError: 'secret backend detail' },
        })).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
    });

    it('selects only safe passive Telegram health metadata from the public health envelope', () => {
        expect(parseTelegramPassiveHealth({
            ok: true,
            ready: true,
            telegramEnabled: true,
            telegramConfigured: false,
            telegramConnected: false,
            telegramVerified: false,
            telegramConfigurationError: 'TELEGRAM_CREDENTIAL_MISSING',
            telegramLastError: null,
            telegramDesiredGeneration: 3,
            telegramAppliedGeneration: 2,
            telegramRestartRequired: true,
        })).toEqual({
            enabled: true,
            configured: false,
            running: false,
            verified: false,
            configurationError: 'TELEGRAM_CREDENTIAL_MISSING',
            lastError: null,
            desiredGeneration: 3,
            appliedGeneration: 2,
            restartRequired: true,
        });
    });

    it('accepts original nonblank UTF-8 bytes and rejects blank or oversized secrets', () => {
        expect(() => validateCredentialSecret('  synthetic-secret\n')).not.toThrow();
        expect(() => validateCredentialSecret(' \n\t ')).toThrow('ADMIN_CREDENTIAL_BLANK');
        expect(() => validateCredentialSecret('á'.repeat(2_049))).toThrow('ADMIN_CREDENTIAL_TOO_LARGE');
    });
});
