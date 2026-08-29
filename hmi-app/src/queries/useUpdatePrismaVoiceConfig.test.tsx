import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { savePrismaRuntimeMode } from '../config/prismaRuntime.config';
import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import { createPrismaVoiceConfigQueryKey } from './usePrismaVoiceConfig';
import { useUpdatePrismaVoiceConfig } from './useUpdatePrismaVoiceConfig';

function localEnvelope(config = createDefaultPrismaVoiceConfig()) {
    return {
        config,
        sync: {
            centralUrlConfigured: false,
            lastSyncAt: null,
            lastSyncError: "RuntimeError('PRISMA_CONFIG_URL_MISSING')",
            source: 'local_fallback',
        },
    };
}

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
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
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

        expect(queryClient.getQueryData(createPrismaVoiceConfigQueryKey('central', url, 'legacy-flat')))
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

        expect(queryClient.getQueryData(createPrismaVoiceConfigQueryKey('central', url, 'legacy-flat')))
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
        queryClient.setQueryData(createPrismaVoiceConfigQueryKey('central', url, 'legacy-flat'), cached);
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });

        await expect(act(async () => {
            await result.current.mutateAsync({ url, config: createDefaultPrismaVoiceConfig() });
        })).rejects.toThrow();

        expect(queryClient.getQueryData(createPrismaVoiceConfigQueryKey('central', url, 'legacy-flat'))).toBe(cached);
    });

    it('aborts a stale local PUT when the runtime profile changes', async () => {
        savePrismaRuntimeMode('local');
        let localSignal: AbortSignal | undefined;
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            localSignal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
                localSignal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), {
            wrapper: createHarness().wrapper,
        });
        let update!: Promise<unknown>;
        act(() => {
            update = result.current.mutateAsync({
                url: 'https://node-red.local/hmi/prisma-config',
                config: createDefaultPrismaVoiceConfig(),
            });
        });
        await waitFor(() => expect(localSignal).toBeDefined());

        act(() => savePrismaRuntimeMode('central'));

        expect(localSignal?.aborted).toBe(true);
        expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:5057/hmi/prisma-config');
        await expect(update).rejects.toMatchObject({ name: 'AbortError' });
    });

    it.each([null, '', '/api/hmi-data'])('saves a wrapped Local response at the exact endpoint without using central URL %j', async (centralUrl) => {
        savePrismaRuntimeMode('local');
        const config = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => localEnvelope(config),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), {
            wrapper: createHarness().wrapper,
        });

        await act(async () => {
            await result.current.mutateAsync({ url: centralUrl, config });
        });

        expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:5057/hmi/prisma-config',
            expect.objectContaining({ method: 'PUT' }),
        );
    });

    it('rejects an invalid Local response envelope without updating the cache', async () => {
        savePrismaRuntimeMode('local');
        const config = createDefaultPrismaVoiceConfig();
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ sync: { source: 'local_fallback' } }),
        } as Response)));
        const { queryClient, wrapper } = createHarness();
        const { result } = renderHook(() => useUpdatePrismaVoiceConfig(), { wrapper });
        const localUrl = 'http://127.0.0.1:5057/hmi/prisma-config';

        await expect(act(async () => {
            await result.current.mutateAsync({ url: null, config });
        })).rejects.toMatchObject({
            name: 'PrismaVoiceConfigWriteError',
            kind: 'response-validation',
        });
        expect(queryClient.getQueryData(createPrismaVoiceConfigQueryKey('local', localUrl, 'local-envelope')))
            .toBeUndefined();
    });
});
