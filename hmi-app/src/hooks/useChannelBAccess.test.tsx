import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UNAUTHENTICATED_SESSION, useAuthStore } from '../store/auth.store';
import {
    accessError,
    PENDING_CHAT,
    decidedResult,
} from '../test/fixtures/channelBAccess.fixture';
import {
    CHANNEL_B_ACCESS_POLL_INTERVAL_MS,
    CHANNEL_B_ACCESS_QUERY_KEY,
    useChannelBAccess,
    type ChannelBAccessClient,
} from './useChannelBAccess';

function setAuthenticated(isAuthenticated: boolean) {
    useAuthStore.setState({
        session: isAuthenticated
            ? {
                user: { id: 'administrator:admin', username: 'admin', displayName: 'admin', role: { id: 'admin', name: 'Admin', permissions: ['admin:access'] } },
                isAuthenticated: true,
                loginTimestamp: new Date().toISOString(),
            }
            : UNAUTHENTICATED_SESSION,
        isHydrated: true,
    });
}

function setup(client: ChannelBAccessClient, options: { enabled?: boolean; polling?: boolean } = {}) {
    const controller = { handleProtectedRequestError: vi.fn(async () => undefined) };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useChannelBAccess({ client, controller, ...options }), { wrapper });
    return { ...hook, controller, queryClient };
}

describe('useChannelBAccess', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        setAuthenticated(true);
    });

    afterEach(() => {
        focusManager.setFocused(undefined);
        vi.useRealTimers();
    });

    it('polls the list every 30 seconds while polling is on and the admin session is active', async () => {
        const list = vi.fn(async () => [PENDING_CHAT]);
        setup({ channelBAccessList: list, channelBAccessDecision: vi.fn() }, { polling: true });
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

        await act(async () => { await vi.advanceTimersByTimeAsync(CHANNEL_B_ACCESS_POLL_INTERVAL_MS); });

        expect(CHANNEL_B_ACCESS_POLL_INTERVAL_MS).toBe(30_000);
        expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('does not poll when polling is off', async () => {
        const list = vi.fn(async () => [PENDING_CHAT]);
        setup({ channelBAccessList: list, channelBAccessDecision: vi.fn() });
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

        await act(async () => { await vi.advanceTimersByTimeAsync(CHANNEL_B_ACCESS_POLL_INTERVAL_MS * 2); });

        expect(list).toHaveBeenCalledTimes(1);
    });

    it('never fetches without an admin session, even with polling on', async () => {
        setAuthenticated(false);
        const list = vi.fn(async () => [PENDING_CHAT]);
        setup({ channelBAccessList: list, channelBAccessDecision: vi.fn() }, { polling: true });

        await act(async () => { await vi.advanceTimersByTimeAsync(CHANNEL_B_ACCESS_POLL_INTERVAL_MS * 2); });

        expect(list).not.toHaveBeenCalled();
    });

    it('stops polling and drops the cached names when the admin session ends', async () => {
        const list = vi.fn(async () => [PENDING_CHAT]);
        const { queryClient, result } = setup(
            { channelBAccessList: list, channelBAccessDecision: vi.fn() },
            { polling: true },
        );
        await waitFor(() => expect(result.current.chats).toEqual([PENDING_CHAT]));

        act(() => setAuthenticated(false));
        await act(async () => { await vi.advanceTimersByTimeAsync(CHANNEL_B_ACCESS_POLL_INTERVAL_MS * 2); });

        expect(list).toHaveBeenCalledTimes(1);
        expect(queryClient.getQueryData(CHANNEL_B_ACCESS_QUERY_KEY)).toBeUndefined();
    });

    it('refetches on window focus only while polling', async () => {
        const list = vi.fn(async () => [PENDING_CHAT]);
        setup({ channelBAccessList: list, channelBAccessDecision: vi.fn() }, { polling: true });
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

        await act(async () => {
            focusManager.setFocused(false);
            focusManager.setFocused(true);
        });

        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    });

    it('does not refetch on window focus when polling is off', async () => {
        const list = vi.fn(async () => [PENDING_CHAT]);
        setup({ channelBAccessList: list, channelBAccessDecision: vi.fn() });
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

        await act(async () => {
            focusManager.setFocused(false);
            focusManager.setFocused(true);
        });

        expect(list).toHaveBeenCalledTimes(1);
    });

    it('blocks a second decision while one is in flight', async () => {
        let release: (() => void) | undefined;
        const decide = vi.fn(() => new Promise<ReturnType<typeof decidedResult>>((resolve) => {
            release = () => resolve(decidedResult(PENDING_CHAT, 'approve'));
        }));
        const { result } = setup({ channelBAccessList: async () => [PENDING_CHAT], channelBAccessDecision: decide });
        await waitFor(() => expect(result.current.chats).not.toBeNull());

        let first: Promise<unknown> = Promise.resolve();
        act(() => { first = result.current.decide(1001, 'approve'); });
        await waitFor(() => expect(result.current.pendingChatId).toBe(1001));
        await expect(result.current.decide(1001, 'reject')).rejects.toThrow('CHANNEL_B_ACCESS_DECISION_PENDING');

        await act(async () => { release?.(); await first; });
        expect(decide).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(result.current.pendingChatId).toBeNull());
    });

    it('shares the in-flight guard between two consumers of the same query client', async () => {
        let release: (() => void) | undefined;
        const decide = vi.fn(() => new Promise<ReturnType<typeof decidedResult>>((resolve) => {
            release = () => resolve(decidedResult(PENDING_CHAT, 'approve'));
        }));
        const client: ChannelBAccessClient = { channelBAccessList: async () => [PENDING_CHAT], channelBAccessDecision: decide };
        const controller = { handleProtectedRequestError: vi.fn(async () => undefined) };
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        // The topbar bell and the Leda tab are two mounted consumers of one cache.
        const bell = renderHook(() => useChannelBAccess({ client, controller, polling: true }), { wrapper });
        const tab = renderHook(() => useChannelBAccess({ client, controller }), { wrapper });
        await waitFor(() => expect(tab.result.current.chats).not.toBeNull());

        let first: Promise<unknown> = Promise.resolve();
        act(() => { first = bell.result.current.decide(1001, 'approve'); });

        await waitFor(() => expect(tab.result.current.pendingChatId).toBe(1001));
        expect(bell.result.current.pendingChatId).toBe(1001);
        await expect(tab.result.current.decide(1001, 'reject')).rejects.toThrow('CHANNEL_B_ACCESS_DECISION_PENDING');
        expect(decide).toHaveBeenCalledTimes(1);

        await act(async () => { release?.(); await first; });
        await waitFor(() => expect(tab.result.current.pendingChatId).toBeNull());
        expect(bell.result.current.pendingChatId).toBeNull();
    });

    it('invalidates and reports to the controller when a decision hits a 409', async () => {
        const list = vi.fn(async () => [PENDING_CHAT]);
        const error = accessError('CHANNEL_B_INVALID_TRANSITION', 409);
        const { result, controller } = setup({
            channelBAccessList: list,
            channelBAccessDecision: async () => { throw error; },
        });
        await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

        await act(async () => { await expect(result.current.decide(1001, 'approve')).rejects.toBe(error); });

        expect(controller.handleProtectedRequestError).toHaveBeenCalledWith(error);
        await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    });
});
