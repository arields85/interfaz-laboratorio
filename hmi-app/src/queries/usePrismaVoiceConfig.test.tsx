import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { savePrismaRuntimeMode } from '../config/prismaRuntime.config';
import { createDefaultPrismaVoiceConfig } from '../domain/prismaVoiceConfig';
import {
    createPrismaVoiceConfigQueryKey,
    usePrismaVoiceConfig,
} from './usePrismaVoiceConfig';

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

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    const wrapper = function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };

    return { queryClient, wrapper };
}

describe('usePrismaVoiceConfig', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        vi.unstubAllGlobals();
    });

    it('keeps a disabled query idle without calling fetch', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => usePrismaVoiceConfig(null), {
            wrapper: createWrapper().wrapper,
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
            { wrapper: createWrapper().wrapper },
        );
        await waitFor(() => expect(requestSignal).toBeDefined());

        unmount();

        expect(requestSignal?.aborted).toBe(true);
    });

    it('reads a wrapped Local Prisma configuration from the fixed loopback endpoint', async () => {
        savePrismaRuntimeMode('local');
        const config = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => localEnvelope(config),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);

        const { result } = renderHook(() => usePrismaVoiceConfig('https://node-red.local/hmi/prisma-config'), {
            wrapper: createWrapper().wrapper,
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:5057/hmi/prisma-config',
            expect.objectContaining({ method: 'GET' }),
        ));
        await waitFor(() => expect(result.current.data).toEqual(config));
        expect(result.current.error).toBeNull();
    });

    it.each([null, '', '/relative', 'not a URL'])('reads Local configuration without validating or deriving the Node-RED URL %j', async (centralUrl) => {
        savePrismaRuntimeMode('local');
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => localEnvelope(),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);

        renderHook(() => usePrismaVoiceConfig(centralUrl), { wrapper: createWrapper().wrapper });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            'http://127.0.0.1:5057/hmi/prisma-config',
            expect.objectContaining({ method: 'GET' }),
        ));
    });

    it('aborts a stale local GET before switching back to the central query', async () => {
        savePrismaRuntimeMode('local');
        let localSignal: AbortSignal | undefined;
        const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
            localSignal = init?.signal;
            return new Promise<Response>(() => undefined);
        });
        vi.stubGlobal('fetch', fetchMock);
        renderHook(() => usePrismaVoiceConfig(null), { wrapper: createWrapper().wrapper });
        await waitFor(() => expect(localSignal).toBeDefined());

        act(() => savePrismaRuntimeMode('central'));

        expect(localSignal?.aborted).toBe(true);
    });

    it('keeps an intentional Server AbortError out of the succeeding Local query state', async () => {
        let centralSignal: AbortSignal | undefined;
        const localConfig = createDefaultPrismaVoiceConfig();
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input) === 'http://127.0.0.1:5057/hmi/prisma-config') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => localEnvelope(localConfig),
                } as Response);
            }

            centralSignal = init?.signal;
            return new Promise<Response>((_resolve, reject) => {
                centralSignal?.addEventListener('abort', () => {
                    reject(new DOMException('Profile changed', 'AbortError'));
                });
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const { result } = renderHook(
            () => usePrismaVoiceConfig('https://node-red.local/hmi/prisma-config'),
            { wrapper: createWrapper().wrapper },
        );
        await waitFor(() => expect(centralSignal).toBeDefined());

        act(() => savePrismaRuntimeMode('local'));

        await waitFor(() => expect(result.current.data).toEqual(localConfig));
        expect(centralSignal?.aborted).toBe(true);
        expect(result.current.error).toBeNull();
        expect(result.current.isLoading).toBe(false);
    });

    it('classifies a flat Local response as a validation error', async () => {
        savePrismaRuntimeMode('local');
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => createDefaultPrismaVoiceConfig(),
        } as Response)));

        const { result } = renderHook(() => usePrismaVoiceConfig(null), {
            wrapper: createWrapper().wrapper,
        });

        await waitFor(() => expect(result.current.error).toMatchObject({
            name: 'PrismaVoiceConfigReadError',
            kind: 'validation',
            message: expect.stringMatching(/Local.*config.*envelope/i),
        }));
        expect(result.current.data).toBeNull();
    });

    it('keeps Legacy and Local response contracts distinct when they resolve to the same URL', async () => {
        const sharedUrl = 'http://127.0.0.1:5057/hmi/prisma-config';
        const legacyConfig = createDefaultPrismaVoiceConfig();
        legacyConfig.effectIntensity = 41;
        const localConfig = createDefaultPrismaVoiceConfig();
        localConfig.effectIntensity = 42;
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => fetchMock.mock.calls.length === 1
                ? legacyConfig
                : localEnvelope(localConfig),
        } as Response));
        vi.stubGlobal('fetch', fetchMock);
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => usePrismaVoiceConfig(sharedUrl), {
            wrapper,
        });
        await waitFor(() => expect(result.current.data).toEqual(legacyConfig));

        act(() => savePrismaRuntimeMode('local'));

        await waitFor(() => expect(result.current.data).toEqual(localConfig));
        expect(result.current.error).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryData(createPrismaVoiceConfigQueryKey(
            'central',
            sharedUrl,
            'legacy-flat',
        ))).toEqual(legacyConfig);
        expect(queryClient.getQueryData(createPrismaVoiceConfigQueryKey(
            'local',
            sharedUrl,
            'local-envelope',
        ))).toEqual(localConfig);
    });
});
