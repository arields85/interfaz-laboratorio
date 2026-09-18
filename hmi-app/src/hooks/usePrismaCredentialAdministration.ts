import type {
    CredentialMetadata,
    CredentialProvider,
    TelegramAdministrationStatus,
    TelegramPassiveHealth,
} from '../domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AdminAuthError, adminAuthClient, type AdminAuthClient } from '../services/adminAuth.service';
import { adminSessionController, type AdminSessionController } from '../services/adminSession.controller';
import { useAuthStore } from '../store/auth.store';

// This cache is metadata-only; credential bytes never enter TanStack Query.
export const PRISMA_CREDENTIAL_METADATA_QUERY_KEY = ['prisma', 'admin', 'credential-metadata'] as const;

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
}

export interface CredentialAdministrationController {
    handleProtectedRequestError(error: unknown): Promise<void>;
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

export function usePrismaCredentialAdministration(options: {
    client?: CredentialAdministrationClient | AdminAuthClient;
    controller?: CredentialAdministrationController | AdminSessionController;
    active?: boolean;
} = {}) {
    const client = options.client ?? adminAuthClient;
    const controller = options.controller ?? adminSessionController;
    const active = options.active ?? true;
    const authenticated = useAuthStore((state) => state.session.isAuthenticated);
    const queryClient = useQueryClient();
    const operationRef = useRef<{ generation: number; controller: AbortController } | null>(null);
    const generationRef = useRef(0);
    const [pendingAction, setPendingAction] = useState<string | null>(null);
    const enabled = active && authenticated;

    const query = useQuery({
        queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY,
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

    useEffect(() => {
        if (active && authenticated) return;
        generationRef.current += 1;
        operationRef.current?.controller.abort();
        operationRef.current = null;
        setPendingAction(null);
        if (!authenticated) {
            void queryClient.cancelQueries({ queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
            queryClient.removeQueries({ queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
        }
    }, [active, authenticated, queryClient]);

    useEffect(() => () => {
        generationRef.current += 1;
        operationRef.current?.controller.abort();
        operationRef.current = null;
        void queryClient.cancelQueries({ queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
        queryClient.removeQueries({ queryKey: PRISMA_CREDENTIAL_METADATA_QUERY_KEY, exact: true });
    }, [queryClient]);

    const refresh = useCallback(async () => {
        if (!active || !useAuthStore.getState().session.isAuthenticated) return;
        await query.refetch({ cancelRefetch: true });
    }, [active, query]);

    const runOperation = useCallback(async <T,>(action: string, execute: (signal: AbortSignal) => Promise<T>): Promise<T> => {
        if (operationRef.current) throw new Error('ADMIN_CREDENTIAL_OPERATION_PENDING');
        const requestController = new AbortController();
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        operationRef.current = { generation, controller: requestController };
        setPendingAction(action);
        try {
            const result = await execute(requestController.signal);
            if (requestController.signal.aborted || generationRef.current !== generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            return result;
        } catch (error) {
            if (requestController.signal.aborted || generationRef.current !== generation) {
                throw new DOMException('The operation was aborted.', 'AbortError');
            }
            if (!isAbort(error)) await controller.handleProtectedRequestError(error);
            throw error;
        } finally {
            if (operationRef.current?.generation === generation) {
                operationRef.current = null;
                setPendingAction(null);
            }
        }
    }, [controller]);

    const saveCredential = useCallback(async (provider: CredentialProvider, secret: string) => {
        await runOperation(`save-${provider}`, async (signal) => {
            await client.saveCredential(provider, secret, signal);
            await refresh();
        });
    }, [client, refresh, runOperation]);

    const deleteCredential = useCallback(async (provider: CredentialProvider) => {
        return runOperation(`delete-${provider}`, async (signal) => {
            try {
                await client.deleteCredential(provider, signal);
                await refresh();
                return { committed: true, stopUnconfirmed: false };
            } catch (error) {
                if (error instanceof AdminAuthError && error.committed
                    && error.code === 'TELEGRAM_STOP_TIMEOUT') {
                    await refresh();
                    return { committed: true, stopUnconfirmed: true };
                }
                throw error;
            }
        });
    }, [client, refresh, runOperation]);

    const applyTelegram = useCallback(async () => {
        return runOperation('apply-telegram', async (signal) => {
            const result = await client.applyTelegram(signal);
            await refresh();
            return result;
        });
    }, [client, refresh, runOperation]);

    return {
        data: query.data ?? null,
        error: query.error,
        isLoading: query.isLoading,
        pendingAction,
        refresh,
        saveCredential,
        deleteCredential,
        applyTelegram,
    };
}
