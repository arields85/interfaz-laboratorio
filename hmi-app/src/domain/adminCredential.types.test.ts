import { describe, expect, it } from 'vitest';

import {
    parseChannelAAdministrationStatus,
    parseChannelAVerificationResult,
    parseCredentialMetadata,
    parseCredentialMutation,
    parseGeminiVerificationResult,
    parseTelegramAdministrationStatus,
    parseTelegramPassiveHealth,
    parseTelegramVerificationResult,
    validateCredentialSecret,
    type ChannelAAdministrationStatus,
} from './adminCredential.types';

describe('admin credential domain', () => {
    const notCheckedVerification = { state: 'not_checked', checkedAt: null } as const;
    const notCheckedTokenVerification = { state: 'not_checked', checkedAt: null, username: null } as const;
    const MODEL = 'gemini-3.1-flash-tts-preview';
    const exactProviders = {
        gemini: { configured: false, verified: false, verification: notCheckedVerification, model: MODEL },
        telegram: { configured: true, verified: false, verification: notCheckedTokenVerification },
        telegram_channel_a: { configured: false, verified: false, verification: notCheckedTokenVerification },
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

    describe('gemini verification metadata', () => {
        it('accepts every canonical verification state with a numeric or null timestamp', () => {
            for (const state of ['not_checked', 'verified', 'invalid_key', 'unreachable', 'not_configured'] as const) {
                for (const checkedAt of [null, 0, 1_699_999_999.5]) {
                    const providers = {
                        ...exactProviders,
                        gemini: { configured: true, verified: state === 'verified', verification: { state, checkedAt }, model: MODEL },
                    };
                    expect(parseCredentialMetadata({ ok: true, providers }).gemini).toEqual(providers.gemini);
                }
            }
        });

        it('rejects an unknown state, extra keys, or a non-boolean verified flag', () => {
            const malformed = [
                { configured: true, verified: false, verification: { state: 'pending', checkedAt: null }, model: MODEL },
                { configured: true, verified: false, verification: { state: 'verified', checkedAt: null }, model: MODEL, extra: 1 },
                { configured: true, verified: false, verification: { state: 'verified', checkedAt: null, extra: 1 }, model: MODEL },
                { configured: true, verified: 'yes', verification: { state: 'not_checked', checkedAt: null }, model: MODEL },
                { configured: true, verified: false, verification: { state: 'not_checked', checkedAt: 'now' }, model: MODEL },
                { configured: true, verified: false, verification: null, model: MODEL },
            ];
            for (const gemini of malformed) {
                expect(() => parseCredentialMetadata({ ok: true, providers: { ...exactProviders, gemini } }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });

        it('rejects a missing, non-string or empty model', () => {
            for (const model of [undefined, 42, '', null]) {
                const gemini = { configured: true, verified: false, verification: notCheckedVerification, model };
                expect(() => parseCredentialMetadata({ ok: true, providers: { ...exactProviders, gemini } }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });

        it('parses the verify endpoint envelope with the same gemini metadata shape', () => {
            const gemini = { configured: true, verified: true, verification: { state: 'verified', checkedAt: 42 }, model: MODEL } as const;
            expect(parseGeminiVerificationResult({ ok: true, gemini })).toEqual(gemini);
            expect(() => parseGeminiVerificationResult({ ok: false, gemini })).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            expect(() => parseGeminiVerificationResult({ ok: true, gemini, extra: 1 }))
                .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        });
    });

    describe('telegram-family (Telegram and Canal A) token verification metadata', () => {
        it('accepts every canonical verification state with a numeric-or-null timestamp and a nullable username', () => {
            for (const state of ['not_checked', 'verified', 'invalid_token', 'unreachable', 'not_configured'] as const) {
                for (const checkedAt of [null, 0, 1_699_999_999.5]) {
                    for (const username of [null, 'prisma_channel_a_bot']) {
                        const providers = {
                            ...exactProviders,
                            telegram_channel_a: {
                                configured: true, verified: state === 'verified',
                                verification: { state, checkedAt, username },
                            },
                        };
                        expect(parseCredentialMetadata({ ok: true, providers }).telegram_channel_a)
                            .toEqual(providers.telegram_channel_a);
                    }
                }
            }
        });

        it('rejects an unknown state, extra keys, a missing username key, or a non-boolean verified flag', () => {
            const malformed = [
                { configured: true, verified: false, verification: { state: 'invalid_key', checkedAt: null, username: null } },
                { configured: true, verified: false, verification: { state: 'verified', checkedAt: null, username: null }, extra: 1 },
                { configured: true, verified: false, verification: { state: 'verified', checkedAt: null } },
                { configured: true, verified: false, verification: { state: 'verified', checkedAt: null, username: '' } },
                { configured: true, verified: 'yes', verification: notCheckedTokenVerification },
                { configured: true, verified: false, verification: null },
            ];
            for (const telegram of malformed) {
                expect(() => parseCredentialMetadata({ ok: true, providers: { ...exactProviders, telegram } }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });

        it('parses the Telegram verify endpoint envelope with the username the check observed', () => {
            const telegram = {
                configured: true, verified: true,
                verification: { state: 'verified', checkedAt: 42, username: 'prisma_bot' },
            } as const;
            expect(parseTelegramVerificationResult({ ok: true, telegram })).toEqual(telegram);
            expect(() => parseTelegramVerificationResult({ ok: false, telegram })).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            expect(() => parseTelegramVerificationResult({ ok: true, telegram, extra: 1 }))
                .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        });

        it('parses the Channel A verify endpoint envelope under its own "channelA" key', () => {
            const channelA = {
                configured: true, verified: false,
                verification: { state: 'invalid_token', checkedAt: 1, username: null },
            } as const;
            expect(parseChannelAVerificationResult({ ok: true, channelA })).toEqual(channelA);
            expect(() => parseChannelAVerificationResult({ ok: false, channelA })).toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            expect(() => parseChannelAVerificationResult({ ok: true, channelA, extra: 1 }))
                .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            // The two channels' verify envelopes are shaped identically apart from
            // their key name -- reusing the wrong parser for the wrong key must fail.
            expect(() => parseChannelAVerificationResult({ ok: true, telegram: channelA }))
                .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        });
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

    it('accepts only the fixed cooperative-identity code as a Telegram error', () => {
        const status = {
            source: 'protected', enabled: true, configured: true,
            desiredGeneration: 2, appliedGeneration: 0, running: false,
            verified: false, restartRequired: true, lastError: 'TELEGRAM_BOT_IDENTITY_RESERVED',
        } as const;
        expect(parseTelegramAdministrationStatus({ ok: true, telegram: status })).toEqual(status);
        expect(parseTelegramPassiveHealth({
            ok: true,
            telegramEnabled: true,
            telegramConfigured: true,
            telegramConnected: false,
            telegramVerified: false,
            telegramConfigurationError: null,
            telegramLastError: 'TELEGRAM_BOT_IDENTITY_RESERVED',
            telegramDesiredGeneration: 2,
            telegramAppliedGeneration: 0,
            telegramRestartRequired: true,
            telegramBotUsername: null,
        })).toMatchObject({ lastError: 'TELEGRAM_BOT_IDENTITY_RESERVED', botUsername: null });
        expect(() => parseTelegramAdministrationStatus({
            ok: true, telegram: { ...status, lastError: 'TELEGRAM_BOT_IDENTITY_RELEASED' },
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
            telegramBotUsername: null,
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
            botUsername: null,
        });
    });

    it('exposes the connected Telegram bot username and rejects a non-string, non-null or empty one', () => {
        const base = {
            ok: true,
            telegramEnabled: true,
            telegramConfigured: true,
            telegramConnected: true,
            telegramVerified: true,
            telegramConfigurationError: null,
            telegramLastError: null,
            telegramDesiredGeneration: 2,
            telegramAppliedGeneration: 2,
            telegramRestartRequired: false,
        };
        expect(parseTelegramPassiveHealth({ ...base, telegramBotUsername: 'prisma_channel_b_bot' }))
            .toMatchObject({ botUsername: 'prisma_channel_b_bot' });
        for (const telegramBotUsername of [42, '', false]) {
            expect(() => parseTelegramPassiveHealth({ ...base, telegramBotUsername }))
                .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
        }
    });

    describe('channel A administration status', () => {
        const nullChannelA = {
            configured: false,
            desiredGeneration: 3,
            appliedGeneration: null,
            activationEpoch: null,
            activation: null,
            lastError: null,
            botUsername: null,
            paired: false,
            retrying: false,
            retryAttempt: 0,
        } as const;

        const runningActivation = {
            phase: 'running',
            reason: null,
            quiescent: false,
            restartRequired: false,
        } as const;

        it('parses the exact ten-field status with null activation, epoch, lastError and botUsername', () => {
            const parsed: ChannelAAdministrationStatus =
                parseChannelAAdministrationStatus({ ok: true, channelA: nullChannelA });
            expect(parsed).toEqual(nullChannelA);
        });

        it('T16: tolerates an older payload missing retrying/retryAttempt, defaulting to false/0', () => {
            const legacy = Object.fromEntries(
                Object.entries(nullChannelA).filter(([key]) => key !== 'retrying' && key !== 'retryAttempt'),
            );
            const parsed = parseChannelAAdministrationStatus({ ok: true, channelA: legacy });
            expect(parsed.retrying).toBe(false);
            expect(parsed.retryAttempt).toBe(0);
        });

        it('T16: parses retrying and retryAttempt when the runtime provides them', () => {
            const parsed = parseChannelAAdministrationStatus({
                ok: true,
                channelA: { ...nullChannelA, retrying: true, retryAttempt: 3 },
            });
            expect(parsed.retrying).toBe(true);
            expect(parsed.retryAttempt).toBe(3);
        });

        it('T16: rejects a non-boolean retrying or a malformed retryAttempt when present', () => {
            for (const retrying of ['yes', 1, null]) {
                expect(() => parseChannelAAdministrationStatus({ ok: true, channelA: { ...nullChannelA, retrying } }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
            for (const retryAttempt of [-1, 1.5, '2', null]) {
                expect(() => parseChannelAAdministrationStatus({ ok: true, channelA: { ...nullChannelA, retryAttempt } }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });

        it('parses running, restart-required and identity-reserved activations with canonical codes', () => {
            const running = parseChannelAAdministrationStatus({
                ok: true,
                channelA: {
                    configured: true,
                    desiredGeneration: 4,
                    appliedGeneration: 4,
                    activationEpoch: 7,
                    activation: runningActivation,
                    lastError: null,
                    botUsername: 'prisma_channel_a_bot',
                    paired: true,
                },
            });
            expect(running.activation).toEqual({ phase: 'running', reason: null, quiescent: false, restartRequired: false });
            expect(running.botUsername).toBe('prisma_channel_a_bot');
            expect(running.paired).toBe(true);

            const restartRequired = parseChannelAAdministrationStatus({
                ok: true,
                channelA: {
                    configured: true,
                    desiredGeneration: 5,
                    appliedGeneration: 4,
                    activationEpoch: 2,
                    activation: {
                        phase: 'stopped',
                        reason: 'PRISMA_CHANNEL_A_RESTART_REQUIRED',
                        quiescent: true,
                        restartRequired: true,
                    },
                    lastError: 'PRISMA_CHANNEL_A_STOP_UNCONFIRMED',
                    botUsername: null,
                    paired: false,
                },
            });
            expect(restartRequired.activation?.reason).toBe('PRISMA_CHANNEL_A_RESTART_REQUIRED');
            expect(restartRequired.lastError).toBe('PRISMA_CHANNEL_A_STOP_UNCONFIRMED');

            const reserved = parseChannelAAdministrationStatus({
                ok: true,
                channelA: {
                    configured: true,
                    desiredGeneration: 1,
                    appliedGeneration: 0,
                    activationEpoch: 0,
                    activation: {
                        phase: 'failed',
                        reason: 'TELEGRAM_BOT_IDENTITY_RESERVED',
                        quiescent: true,
                        restartRequired: false,
                    },
                    lastError: 'TELEGRAM_BOT_IDENTITY_RESERVED',
                    botUsername: null,
                    paired: false,
                },
            });
            expect(reserved.activation?.phase).toBe('failed');
        });

        it('T16: accepts the two classified background-failure activation reasons', () => {
            for (const reason of ['PRISMA_CHANNEL_A_POLL_FAILED', 'PRISMA_CHANNEL_A_UNAUTHORIZED'] as const) {
                const parsed = parseChannelAAdministrationStatus({
                    ok: true,
                    channelA: {
                        ...nullChannelA,
                        activation: { phase: 'failed', reason, quiescent: true, restartRequired: false },
                        lastError: reason,
                    },
                });
                expect(parsed.activation?.reason).toBe(reason);
                expect(parsed.lastError).toBe(reason);
            }
        });

        it('accepts only the eight canonical lifecycle phases', () => {
            for (const phase of [
                'idle', 'preparing', 'prepared', 'running',
                'stopping', 'stopped', 'failed', 'retired',
            ] as const) {
                const parsed = parseChannelAAdministrationStatus({
                    ok: true,
                    channelA: {
                        configured: true,
                        desiredGeneration: 1,
                        appliedGeneration: 1,
                        activationEpoch: 1,
                        activation: { phase, reason: null, quiescent: true, restartRequired: false },
                        lastError: null,
                        botUsername: null,
                        paired: false,
                    },
                });
                expect(parsed.activation?.phase).toBe(phase);
            }
        });

        it('accepts all twelve canonical manager lastError codes in a valid status', () => {
            for (const lastError of [
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
            ] as const) {
                const parsed = parseChannelAAdministrationStatus({
                    ok: true,
                    channelA: {
                        configured: true,
                        desiredGeneration: 1,
                        appliedGeneration: 1,
                        activationEpoch: 1,
                        activation: { phase: 'failed', reason: null, quiescent: true, restartRequired: false },
                        lastError,
                        botUsername: null,
                        paired: false,
                    },
                });
                expect(parsed.lastError).toBe(lastError);
            }
        });

        it('rejects a non-boolean paired flag', () => {
            for (const paired of ['yes', 1, null, undefined]) {
                expect(() => parseChannelAAdministrationStatus({ ok: true, channelA: { ...nullChannelA, paired } }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });

        it('rejects a non-string, non-null or empty botUsername', () => {
            const missingBotUsername = Object.fromEntries(
                Object.entries(nullChannelA).filter(([key]) => key !== 'botUsername'),
            );
            for (const payload of [42, '', false].map((botUsername) => ({ ...nullChannelA, botUsername }))
                .concat([missingBotUsername])) {
                expect(() => parseChannelAAdministrationStatus({ ok: true, channelA: payload }))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });

        it('rejects malformed or dishonest channel A status instead of coercing it', () => {
            const malformed = [
                { ok: true },
                { ok: true, channelA: 42 },
                { ok: false, channelA: nullChannelA },
                { ok: true, channelA: nullChannelA, extra: 1 },
                { ok: true, channelA: { ...nullChannelA, future: true } },
                { ok: true, channelA: { ...nullChannelA, configured: 'yes' } },
                { ok: true, channelA: { ...nullChannelA, desiredGeneration: 1.5 } },
                { ok: true, channelA: { ...nullChannelA, desiredGeneration: -1 } },
                { ok: true, channelA: { ...nullChannelA, appliedGeneration: '2' } },
                { ok: true, channelA: { ...nullChannelA, activationEpoch: Number.MAX_SAFE_INTEGER + 1 } },
                { ok: true, channelA: { ...nullChannelA, activation: { phase: 'running' } } },
                { ok: true, channelA: { ...nullChannelA, activation: { ...runningActivation, future: true } } },
                { ok: true, channelA: { ...nullChannelA, activation: { ...runningActivation, phase: 'PAUSED' } } },
                {
                    ok: true,
                    channelA: {
                        ...nullChannelA,
                        activation: { ...runningActivation, reason: 'PRISMA_CHANNEL_A_FUTURE_UNKNOWN' },
                    },
                },
                { ok: true, channelA: { ...nullChannelA, activation: { ...runningActivation, quiescent: 'yes' } } },
                { ok: true, channelA: { ...nullChannelA, lastError: 'internal diagnostic detail' } },
                { ok: true, channelA: { ...nullChannelA, lastError: 'PRISMA_CHANNEL_A_FUTURE_UNKNOWN' } },
                { ok: true, channelA: { ...nullChannelA, paired: 'yes' } },
            ];
            for (const payload of malformed) {
                expect(() => parseChannelAAdministrationStatus(payload))
                    .toThrow('ADMIN_CREDENTIAL_RESPONSE_INVALID');
            }
        });
    });

    it('accepts original nonblank UTF-8 bytes and rejects blank or oversized secrets', () => {
        expect(() => validateCredentialSecret('  synthetic-secret\n')).not.toThrow();
        expect(() => validateCredentialSecret(' \n\t ')).toThrow('ADMIN_CREDENTIAL_BLANK');
        expect(() => validateCredentialSecret('á'.repeat(2_049))).toThrow('ADMIN_CREDENTIAL_TOO_LARGE');
    });
});
