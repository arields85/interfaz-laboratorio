import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePrismaVoiceConfig } from './usePrismaVoiceConfig';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

describe('usePrismaVoiceConfig', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('keeps a disabled query idle without calling fetch', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => usePrismaVoiceConfig(null), {
            wrapper: createWrapper(),
        });

        expect(result.current.isEnabled).toBe(false);
        expect(result.current.error).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts the GET signal when the last observer unmounts', async () => {
        let requestSignal: AbortSignal | undefined;
        vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            requestSignal = init?.signal as AbortSignal;
            return new Promise<Response>((_resolve, reject) => {
                requestSignal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        }));

        const { unmount } = renderHook(
            () => usePrismaVoiceConfig('https://node-red.local/hmi/prisma-config'),
            { wrapper: createWrapper() },
        );
        await waitFor(() => expect(requestSignal).toBeDefined());

        unmount();

        expect(requestSignal?.aborted).toBe(true);
    });
});
