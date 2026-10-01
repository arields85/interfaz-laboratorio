import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultLedaVoiceConfig } from '../domain/ledaVoiceConfig';
import { useLedaVoiceConfig } from './useLedaVoiceConfig';

function envelope(config = createDefaultLedaVoiceConfig()) {
    return { config, sync: { configured: false, verified: false } };
}

function createWrapper() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
}

describe('useLedaVoiceConfig', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('reads the runtime envelope from the fixed same-origin route', async () => {
        const config = createDefaultLedaVoiceConfig();
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => envelope(config) } as Response));
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => useLedaVoiceConfig(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.data).toEqual(config));
        expect(fetchMock).toHaveBeenCalledWith('/api/leda/voice-config', expect.objectContaining({ method: 'GET' }));
        expect(result.current.isEnabled).toBe(true);
    });

    it('aborts the GET when its last observer unmounts', async () => {
        let signal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            signal = init?.signal;
            return new Promise<Response>(() => undefined);
        }));
        const { unmount } = renderHook(() => useLedaVoiceConfig(), { wrapper: createWrapper() });
        await waitFor(() => expect(signal).toBeDefined());

        unmount();

        expect(signal?.aborted).toBe(true);
    });

    it('rejects flat and malformed response shapes', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => createDefaultLedaVoiceConfig(),
        } as Response)));

        const { result } = renderHook(() => useLedaVoiceConfig(), { wrapper: createWrapper() });

        await waitFor(() => expect(result.current.error).toMatchObject({
            name: 'LedaVoiceConfigReadError',
            kind: 'validation',
        }));
        expect(result.current.data).toBeNull();
    });
});
