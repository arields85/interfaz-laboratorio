import type {
    ChannelAAdministrationStatus,
    CredentialMetadata,
    CredentialProvider,
    GeminiCredentialProviderMetadata,
    TelegramAdministrationStatus,
    TelegramFamilyCredentialProviderMetadata,
    TelegramPassiveHealth,
} from '../domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminAuthError, adminAuthClient, type AdminAuthClient } from '../services/adminAuth.service';
import { adminSessionController, type AdminSessionController } from '../services/adminSession.controller';
import { useAuthStore } from '../store/auth.store';

// These caches are metadata-only; credential bytes never enter TanStack Query.
export const LEDA_CREDENTIAL_METADATA_QUERY_KEY = ['leda', 'admin', 'credential-metadata'] as const;
export const LEDA_CHANNEL_A_STATUS_QUERY_KEY = ['leda', 'admin', 'channel-a-status'] as const;

export interface CredentialAdministrationData {
    credentials: CredentialMetadata;
    telegram: TelegramPassiveHealth;
}

export interface CredentialAdministrationClient {
    credentialMetadata(signal?: AbortSignal): Promise<CredentialMetadata>;
    telegramHealth(signal?: AbortSignal): Promise<TelegramPassiveHealth>;
    saveCredential(provider: CredentialProvider, secret: string, signal?: AbortSignal): Promise<unknown>;
    deleteCredential(provider: CredentialProvider, signal?: AbortSignal): Promise<void>;
    applyTelegram(signal?: AbortSignal): Promise<TelegramAdministrationStatus>;
    channelAStatus(signal?: AbortSignal): Promise<ChannelAAdministrationStatus>;
    applyChannelA(signal?: AbortSignal): Promise<ChannelAAdministrationStatus>;
    verifyGemini(signal?: AbortSignal): Promise<GeminiCredentialProviderMetadata>;
    verifyTelegram(signal?: AbortSignal): Promise<TelegramFamilyCredentialProviderMetadata>;
    verifyChannelA(signal?: AbortSignal): Promise<TelegramFamilyCredentialProviderMetadata>;
}

export interface CredentialAdministrationController {
    handleProtectedRequestError(error: unknown): Promise<void>;
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export function useLedaCredentialAdministration(options: {
    client?: CredentialAdministrationClient | AdminAuthClient;
    controller?: CredentialAdministrationController | AdminSessionController;
    active?: boolean;
} = {}) {
    const client = options.client ?? adminAuthClient;
    const controller = options.controller ?? adminSessionController;
    const active = options.active ?? true;
    const authenticated = useAuthStore((state) => state.session.isAuthenticated);
    const queryClient = useQueryClient();
    // F4 fix (2026-09-25): this used to be ONE global operationRef/generationRef/
    // pendingAction shared by every provider, so saving or deleting one row's
    // credential blocked every OTHER row's Save/Delete/Verify too (the UI's
    // `disabled` flag read this single value). Scoped per provider, exactly
    // mirroring how T15 already scoped verify below (verifyOperationsRef/
    // verifyGenerationRef/verifyingProviders).
    const operationRefs = useRef<Record<CredentialProvider, { generation: number; controller: AbortController } | null>>({
        gemini: null, telegram: null, telegram_channel_a: null,
    });
    const generationRefs = useRef<Record<CredentialProvider, number>>({
        gemini: 0, telegram: 0, telegram_channel_a: 0,
    });
    const [pendingActions, setPendingActions] = useState<Record<CredentialProvider, string | null>>({
        gemini: null, telegram: null, telegram_channel_a: null,
    });
    // T15: verification is read-only per provider and must never block the
    // other rows' Save/Delete/Verify. It gets its own in-flight controller
    // and generation counter, entirely separate from the per-provider
    // mutation lock above (F4: that lock is scoped per provider too, but
    // save/delete/apply are real mutations, so they stay under it while
    // verify does not). A same-row save/delete bumps that provider's verify
    // generation so a still-in-flight verify's result is discarded (never
    // applied) once it resolves, the same staleness pattern `runOperation`
    // already uses per provider.
    const verifyOperationsRef = useRef<Record<CredentialProvider, AbortController | null>>({
        gemini: null, telegram: null, telegram_channel_a: null,
    });
    const verifyGenerationRef = useRef<Record<CredentialProvider, number>>({
        gemini: 0, telegram: 0, telegram_channel_a: 0,
    });
    const [verifyingProviders, setVerifyingProviders] = useState<Record<CredentialProvider, boolean>>({
        gemini: false, telegram: false, telegram_channel_a: false,
    });
    const enabled = active && authenticated;

    // Separate metadata-only query so a channel A status failure never poisons
    // the existing Gemini/Telegram metadata used by the rest of the panel.
    const channelAQuery = useQuery({
        queryKey: LEDA_CHANNEL_A_STATUS_QUERY_KEY,
        enabled,
        retry: false,
        refetchOnWindowFocus: false,
        queryFn: async ({ signal }): Promise<ChannelAAdministrationStatus> => {
            try {
                return await client.channelAStatus(signal);
            } catch (error) {
                if (!isAbort(error)) await controller.handleProtectedRequestError(error);
                throw error;
            }
        },
    });

    const query = useQuery({
        queryKey: LEDA_CREDENTIAL_METADATA_QUERY_KEY,
        enabled,
        retry: false,
        refetchOnWindowFocus: false,
        queryFn: async ({ signal }): Promise<CredentialAdministrationData> => {
            try {
                const [credentials, telegram] = await Promise.all([
                    client.credentialMetadata(signal),
                    client.telegramHealth(signal),
                ]);
                return { credentials, telegram };
            } catch (error) {
                if (!isAbort(error)) await controller.handleProtectedRequestError(error);
                throw error;
            }
        },
    });

    // Abort and reset every in-flight per-provider mutation (save/delete/
    // apply). Mirrors resetVerifyOperations below exactly, one level up.
    const resetOperations = useCallback(() => {
        for (const provider of ['gemini', 'telegram', 'telegram_channel_a'] as const) {
            generationRefs.current[provider] += 1;
            operationRefs.current[provider]?.controller.abort();
            operationRefs.current[provider] = null;
        }
        setPendingActions({ gemini: null, telegram: null, telegram_channel_a: null });
    }, []);

    // Abort and reset every in-flight per-provider verify, independent of
    // the per-provider mutation operation reset above.
    const resetVerifyOperations = useCallback(() => {
        for (const provider of ['gemini', 'telegram', 'telegram_channel_a'] as const) {
            verifyGenerationRef.current[provider] += 1;
            verifyOperationsRef.current[provider]?.abort();
            verifyOperationsRef.current[provider] = null;
        }
        setVerifyingProviders({ gemini: false, telegram: false, telegram_channel_a: false });
    }, []);

    useEffect(() => {
        if (active && authenticated) return;
        resetOperations();
        resetVerifyOperations();
        // The channel A status query is cancelled as soon as the panel is not
        // active; its cache is additionally purged when authority is revoked.
        void queryClient.cancelQueries({ queryKey: LEDA_CHANNEL_A_STATUS_QUERY_KEY, exact: true });
        if (!authenticated) {
            void queryClient.cancelQueries({ queryKey: LEDA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
            queryClient.removeQueries({ queryKey: LEDA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
            queryClient.removeQueries({ queryKey: LEDA_CHANNEL_A_STATUS_QUERY_KEY, exact: true });
        }
    }, [active, authenticated, queryClient, resetOperations, resetVerifyOperations]);

    useEffect(() => () => {
        resetOperations();
        resetVerifyOperations();
        void queryClient.cancelQueries({ queryKey: LEDA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
        queryClient.removeQueries({ queryKey: LEDA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
        void queryClient.cancelQueries({ queryKey: LEDA_CHANNEL_A_STATUS_QUERY_KEY, exact: true });
        queryClient.removeQueries({ queryKey: LEDA_CHANNEL_A_STATUS_QUERY_KEY, exact: true });
    }, [queryClient, resetOperations, resetVerifyOperations]);

    const refresh = useCallback(async () => {
        if (!active || !useAuthStore.getState().session.isAuthenticated) return;
        // Both refetches start together while the precheck above still holds,
        // so a logout mid-refresh can never gate the channel A status call
        // behind the metadata refetch's settlement.
        await Promise.all([
            query.refetch({ cancelRefetch: true }),
            channelAQuery.refetch({ cancelRefetch: true }),
        ]);
    }, [active, query, channelAQuery]);

    const runOperation = useCallback(async <T,>(
        provider: CredentialProvider,
        action: string,
        execute: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> => {
        if (operationRefs.current[provider]) throw new Error('ADMIN_CREDENTIAL_OPERATION_PENDING');
        const requestController = new AbortController();
        const generation = generationRefs.current[provider] + 1;
        generationRefs.current[provider] = generation;
        operationRefs.current[provider] = { generation, controller: requestController };
        setPendingActions((previous) => ({ ...previous, [provider]: action }));
        try {
            const result = await execute(requestController.signal);
            if (requestController.signal.aborted || generationRefs.current[provider] !== generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            return result;
        } catch (error) {
            if (requestController.signal.aborted || generationRefs.current[provider] !== generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            if (!isAbort(error)) await controller.handleProtectedRequestError(error);
            throw error;
        } finally {
            if (operationRefs.current[provider]?.generation === generation) {
                operationRefs.current[provider] = null;
                setPendingActions((previous) => ({ ...previous, [provider]: null }));
            }
        }
    }, [controller]);

    const saveCredential = useCallback(async (provider: CredentialProvider, secret: string) => {
        // T15: a same-row verify still in flight must never apply its
        // (now-stale) result once the credential has changed underneath it.
        verifyGenerationRef.current[provider] += 1;
        await runOperation(provider, `save-${provider}`, async (signal) => {
            await client.saveCredential(provider, secret, signal);
            await refresh();
        });
    }, [client, refresh, runOperation]);

    const deleteCredential = useCallback(async (provider: CredentialProvider) => {
        // T15: same staleness reasoning as saveCredential above -- delete
        // resets verification on the backend, so a still-in-flight verify's
        // result must never be applied afterwards either.
        verifyGenerationRef.current[provider] += 1;
        return runOperation(provider, `delete-${provider}`, async (signal) => {
            try {
                await client.deleteCredential(provider, signal);
                await refresh();
                return { committed: true, stopUnconfirmed: false };
            } catch (error) {
                if (error instanceof AdminAuthError && error.committed
                    && ((provider === 'telegram' && error.code === 'TELEGRAM_STOP_TIMEOUT')
                        || (provider === 'telegram_channel_a' && error.code === 'LEDA_CHANNEL_A_STOP_UNCONFIRMED'))) {
                    await refresh();
                    return { committed: true, stopUnconfirmed: true };
                }
                throw error;
            }
        });
    }, [client, refresh, runOperation]);

    const applyTelegram = useCallback(async () => {
        return runOperation('telegram', 'apply-telegram', async (signal) => {
            const result = await client.applyTelegram(signal);
            await refresh();
            return result;
        });
    }, [client, refresh, runOperation]);

    const applyChannelA = useCallback(async () => {
        return runOperation('telegram_channel_a', 'apply-channel-a', async (signal) => {
            const result = await client.applyChannelA(signal);
            await refresh();
            return result;
        });
    }, [client, refresh, runOperation]);

    // T15: verify runs OUTSIDE the per-provider mutation lock (`runOperation`
    // above), with its own separate per-provider in-flight tracking -- the
    // backend already 409s a concurrent same-provider verify, and
    // verification is read-only, so it must never disable another row's
    // Save/Delete/Verify. A same-row Save/Delete IS allowed while its own
    // verify is in flight (see saveCredential/deleteCredential's generation
    // bump above); this guard is what discards the verify's result if it
    // resolves afterwards.
    const runVerify = useCallback(async <T,>(provider: CredentialProvider, execute: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        if (verifyOperationsRef.current[provider]) throw new Error('ADMIN_CREDENTIAL_VERIFY_OPERATION_PENDING');
        const requestController = new AbortController();
        const generation = verifyGenerationRef.current[provider] + 1;
        verifyGenerationRef.current[provider] = generation;
        verifyOperationsRef.current[provider] = requestController;
        setVerifyingProviders((previous) => ({ ...previous, [provider]: true }));
        try {
            const result = await execute(requestController.signal);
            if (requestController.signal.aborted || verifyGenerationRef.current[provider] !== generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            return result;
        } catch (error) {
            if (requestController.signal.aborted || verifyGenerationRef.current[provider] !== generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            if (!isAbort(error)) await controller.handleProtectedRequestError(error);
            throw error;
        } finally {
            if (verifyOperationsRef.current[provider] === requestController) {
                verifyOperationsRef.current[provider] = null;
                setVerifyingProviders((previous) => ({ ...previous, [provider]: false }));
            }
        }
    }, [controller]);

    const verifyGemini = useCallback(async () => {
        return runVerify('gemini', async (signal) => {
            const result = await client.verifyGemini(signal);
            await refresh();
            return result;
        });
    }, [client, refresh, runVerify]);

    const verifyTelegram = useCallback(async () => {
        return runVerify('telegram', async (signal) => {
            const result = await client.verifyTelegram(signal);
            await refresh();
            return result;
        });
    }, [client, refresh, runVerify]);

    const verifyChannelA = useCallback(async () => {
        return runVerify('telegram_channel_a', async (signal) => {
            const result = await client.verifyChannelA(signal);
            await refresh();
            return result;
        });
    }, [client, refresh, runVerify]);

    return {
        data: query.data ?? null,
        error: query.error,
        isLoading: query.isLoading,
        channelA: channelAQuery.data ?? null,
        channelAError: channelAQuery.error,
        isChannelALoading: channelAQuery.isLoading,
        pendingActions,
        verifyingProviders,
        refresh,
        saveCredential,
        deleteCredential,
        applyTelegram,
        applyChannelA,
        verifyGemini,
        verifyTelegram,
        verifyChannelA,
    };
}
