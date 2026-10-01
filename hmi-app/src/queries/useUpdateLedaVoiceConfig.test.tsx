import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultLedaVoiceConfig } from '../domain/ledaVoiceConfig';
import { LEDA_VOICE_CONFIG_QUERY_KEY } from './useLedaVoiceConfig';
import { useUpdateLedaVoiceConfig } from './useUpdateLedaVoiceConfig';

function envelope(config = createDefaultLedaVoiceConfig()) {
    return { config, sync: { configured: false, verified: false } };
}

function createHarness() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return { queryClient, wrapper };
}

describe('useUpdateLedaVoiceConfig', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends one fixed-route PUT and updates the matching cache after validated success', async () => {
        const normalized = createDefaultLedaVoiceConfig();
        normalized.effectIntensity = 64;
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => envelope(normalized) } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { queryClient, wrapper } = createHarness();
        const { result } = renderHook(() => useUpdateLedaVoiceConfig(), { wrapper });

        await act(async () => result.current.mutateAsync(createDefaultLedaVoiceConfig()));

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith('/api/leda/voice-config', expect.objectContaining({ method: 'PUT' }));
        expect(queryClient.getQueryData(LEDA_VOICE_CONFIG_QUERY_KEY)).toEqual(normalized);
    });

    it('confirms response loss with one read-after-write GET', async () => {
        const sent = createDefaultLedaVoiceConfig();
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
            ok: true,
            status: init?.method === 'PUT' ? 204 : 200,
            json: init?.method === 'PUT'
                ? async () => { throw new SyntaxError('response lost'); }
                : async () => envelope(sent),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useUpdateLedaVoiceConfig(), { wrapper: createHarness().wrapper });

        await act(async () => result.current.mutateAsync(sent));

        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('rejects server errors and leaves the cache unchanged', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 } as Response)));
        const cached = createDefaultLedaVoiceConfig();
        const { queryClient, wrapper } = createHarness();
        queryClient.setQueryData(LEDA_VOICE_CONFIG_QUERY_KEY, cached);
        const { result } = renderHook(() => useUpdateLedaVoiceConfig(), { wrapper });

        await expect(act(async () => result.current.mutateAsync(createDefaultLedaVoiceConfig()))).rejects.toThrow();

        expect(queryClient.getQueryData(LEDA_VOICE_CONFIG_QUERY_KEY)).toBe(cached);
    });

    it('aborts the active PUT on unmount', async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            return new Promise<Response>(() => undefined);
        }));
        const { result, unmount } = renderHook(() => useUpdateLedaVoiceConfig(), { wrapper: createHarness().wrapper });
        act(() => { void result.current.mutateAsync(createDefaultLedaVoiceConfig()); });
        await waitFor(() => expect(signal).toBeDefined());
        unmount();

        expect(signal?.aborted).toBe(true);
    });
});
