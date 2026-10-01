import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
    ChannelBAccessChat,
    ChannelBAccessDecision,
    ChannelBAccessDecisionResult,
} from '../domain';
import { AdminAuthError, adminAuthClient } from '../services/adminAuth.service';
import { adminSessionController } from '../services/adminSession.controller';
import { useAuthStore } from '../store/auth.store';

// The list holds requester names, so it lives only while an admin session does.
export const CHANNEL_B_ACCESS_QUERY_KEY = ['leda', 'admin', 'channel-b-access'] as const;
export const CHANNEL_B_ACCESS_POLL_INTERVAL_MS = 30_000;

export interface ChannelBAccessClient {
    channelBAccessList(signal?: AbortSignal): Promise<ChannelBAccessChat[]>;
    channelBAccessDecision(
        chatId: number,
        decision: ChannelBAccessDecision,
        signal?: AbortSignal,
    ): Promise<ChannelBAccessDecisionResult>;
}

export interface ChannelBAccessController {
    handleProtectedRequestError(error: unknown): Promise<void>;
}

interface UseChannelBAccessOptions {
    client?: ChannelBAccessClient;
    controller?: ChannelBAccessController;
    // The caller is on screen (a tab or a panel that is open or mounted).
    enabled?: boolean;
    // Poll every 30 s and refetch on window focus. Only meaningful with an admin session.
    polling?: boolean;
}

function isAbort(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

// A decision that lost a race (409) or targets a vanished chat (404) leaves the list stale.
function leavesListStale(error: unknown): boolean {
    return error instanceof AdminAuthError && (error.status === 409 || error.status === 404);
}

export function useChannelBAccess({
    client = adminAuthClient,
    controller = adminSessionController,
    enabled = true,
    polling = false,
}: UseChannelBAccessOptions = {}) {
    const authenticated = useAuthStore((state) => state.session.isAuthenticated);
    const queryClient = useQueryClient();
    const active = enabled && authenticated;
    const inFlightRef = useRef(false);
    const [pendingChatId, setPendingChatId] = useState<number | null>(null);

    const query = useQuery({
        queryKey: CHANNEL_B_ACCESS_QUERY_KEY,
        enabled: active,
        retry: false,
        refetchInterval: active && polling ? CHANNEL_B_ACCESS_POLL_INTERVAL_MS : false,
        refetchOnWindowFocus: polling,
        queryFn: async ({ signal }): Promise<ChannelBAccessChat[]> => {
            try {
                return await client.channelBAccessList(signal);
            } catch (error) {
                if (!isAbort(error)) await controller.handleProtectedRequestError(error);
                throw error;
            }
        },
    });

    useEffect(() => {
        if (authenticated) return;
        void queryClient.cancelQueries({ queryKey: CHANNEL_B_ACCESS_QUERY_KEY, exact: true });
        queryClient.removeQueries({ queryKey: CHANNEL_B_ACCESS_QUERY_KEY, exact: true });
    }, [authenticated, queryClient]);

    const refresh = useCallback(async () => {
        if (!useAuthStore.getState().session.isAuthenticated) return;
        await queryClient.invalidateQueries({ queryKey: CHANNEL_B_ACCESS_QUERY_KEY, exact: true });
    }, [queryClient]);

    const decide = useCallback(async (
        chatId: number,
        decision: ChannelBAccessDecision,
    ): Promise<ChannelBAccessDecisionResult> => {
        if (inFlightRef.current) throw new Error('CHANNEL_B_ACCESS_DECISION_PENDING');
        inFlightRef.current = true;
        setPendingChatId(chatId);
        try {
            const result = await client.channelBAccessDecision(chatId, decision);
            await refresh();
            return result;
        } catch (error) {
            if (!isAbort(error)) await controller.handleProtectedRequestError(error);
            if (leavesListStale(error)) await refresh();
            throw error;
        } finally {
            inFlightRef.current = false;
            setPendingChatId(null);
        }
    }, [client, controller, refresh]);

    return {
        chats: query.data ?? null,
        error: query.error,
        isLoading: query.isPending,
        pendingChatId,
        refresh,
        decide,
    };
}
