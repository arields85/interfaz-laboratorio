import { describe, expect, it } from 'vitest';

import {
    parseChannelAAdministrationStatus,
    parseCredentialMetadata,
    parseCredentialMutation,
    parseTelegramAdministrationStatus,
    parseTelegramPassiveHealth,
    validateCredentialSecret,
    type ChannelAAdministrationStatus,
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
        })).toMatchObject({ lastError: 'TELEGRAM_BOT_IDENTITY_RESERVED' });
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

    describe('channel A administration status', () => {
        const nullChannelA = {
            configured: false,
            desiredGeneration: 3,
            appliedGeneration: null,
            activationEpoch: null,
            activation: null,
            lastError: null,
        } as const;

        const runningActivation = {
            phase: 'running',
            reason: null,
            quiescent: false,
            restartRequired: false,
        } as const;

        it('parses the exact six-field status with null activation, epoch and lastError', () => {
            const parsed: ChannelAAdministrationStatus =
                parseChannelAAdministrationStatus({ ok: true, channelA: nullChannelA });
            expect(parsed).toEqual(nullChannelA);
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
                },
            });
            expect(running.activation).toEqual({ phase: 'running', reason: null, quiescent: false, restartRequired: false });

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
                },
            });
            expect(reserved.activation?.phase).toBe('failed');
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
                    },
                });
                expect(parsed.activation?.phase).toBe(phase);
            }
        });

        it('accepts all ten canonical manager lastError codes in a valid status', () => {
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
                    },
                });
                expect(parsed.lastError).toBe(lastError);
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
