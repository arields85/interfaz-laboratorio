import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import { PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX } from './usePrismaVoiceConfig';
import { useUpdatePrismaVoiceConfig } from './useUpdatePrismaVoiceConfig';

function createHarness() {
    const queryClient = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    return { queryClient, wrapper };
}

describe('useUpdatePrismaVoiceConfig', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('updates the matching GET cache only after a successful validated PUT', async () => {
        const url = 'https://node-red.local/hmi/prisma-config';
        const normalized = createDefaultPrismaVoiceConfig();
        normalized.effectIntensity = 64;
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: vi.fn(async () => normalized),
        } as Response)));
        const { queryClient, wrapper } = createHarness();
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ url, config: createDefaultPrismaVoiceConfig() });
        });

        expect(queryClient.getQueryData([...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, url]))
            .toEqual(normalized);
    });

    it('updates the matching GET cache after an exact read-after-write confirmation', async () => {
        const url = 'https://node-red.local/hmi/prisma-config';
        const sent = createDefaultPrismaVoiceConfig();
        sent.effectIntensity = 65;
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
            ok: true,
            status: init?.method === 'PUT' ? 204 : 200,
            json: init?.method === 'PUT'
                ? vi.fn(async () => { throw new SyntaxError('Unexpected end of JSON input'); })
                : vi.fn(async () => sent),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { queryClient, wrapper } = createHarness();
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });

        await act(async () => {
            await result.current.mutateAsync({ url, config: sent });
        });

        expect(queryClient.getQueryData([...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, url]))
            .toEqual(sent);
        expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PUT', 'GET']);
    });

    it('leaves the matching GET cache unchanged when PUT fails', async () => {
        const url = 'https://node-red.local/hmi/prisma-config';
        const cached = createDefaultPrismaVoiceConfig();
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 503,
            json: vi.fn(),
        } as unknown as Response)));
        const { queryClient, wrapper } = createHarness();
        queryClient.setQueryData([...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, url], cached);
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });

        await expect(act(async () => {
            await result.current.mutateAsync({ url, config: createDefaultPrismaVoiceConfig() });
        })).rejects.toThrow();

        expect(queryClient.getQueryData([...PRISMA_VOICE_CONFIG_QUERY_KEY_PREFIX, url])).toBe(cached);
    });
});
