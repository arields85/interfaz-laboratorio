import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import { PRISMA_VOICE_CONFIG_QUERY_KEY } from './usePrismaVoiceConfig';
import { useUpdatePrismaVoiceConfig } from './useUpdatePrismaVoiceConfig';

function envelope(config = createDefaultPrismaVoiceConfig()) {
    return { config, sync: { configured: false, verified: false } };
}

function createHarness() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, wrapper };
}

describe('useUpdatePrismaVoiceConfig', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends one fixed-route PUT and updates the matching cache after validated success', async () => {
        const normalized = createDefaultPrismaVoiceConfig();
        normalized.effectIntensity = 64;
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => envelope(normalized) } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { queryClient, wrapper } = createHarness();
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });

        await act(async () => result.current.mutateAsync(createDefaultPrismaVoiceConfig()));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/prisma/voice-config', expect.objectContaining({ method: 'PUT' }));
        expect(queryClient.getQueryData(PRISMA_VOICE_CONFIG_QUERY_KEY)).toEqual(normalized);
    });

    it('confirms response loss with one read-after-write GET', async () => {
        const sent = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
            ok: true,
            status: init?.method === 'PUT' ? 204 : 200,
            json: init?.method === 'PUT'
                ? async () => { throw new SyntaxError('response lost'); }
                : async () => envelope(sent),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper: createHarness().wrapper });

        await act(async () => result.current.mutateAsync(sent));

        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('rejects server errors and leaves the cache unchanged', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as Response)));
        const cached = createDefaultPrismaVoiceConfig();
        const { queryClient, wrapper } = createHarness();
        queryClient.setQueryData(PRISMA_VOICE_CONFIG_QUERY_KEY, cached);
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });

        await expect(act(async () => result.current.mutateAsync(createDefaultPrismaVoiceConfig()))).rejects.toThrow();

        expect(queryClient.getQueryData(PRISMA_VOICE_CONFIG_QUERY_KEY)).toBe(cached);
    });

    it('aborts the active PUT on unmount', async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            return new Promise<Response>(() => undefined);
        }));
        const { result, unmount } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper: createHarness().wrapper });
        act(() => { void result.current.mutateAsync(createDefaultPrismaVoiceConfig()); });
        await waitFor(() => expect(signal).toBeDefined());
        unmount();

        expect(signal?.aborted).toBe(true);
    });
});
