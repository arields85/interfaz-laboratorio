// @vitest-environment node

// T4d regression test: this is the ONE test that exercises the REAL prismaSessionClient
// singleton wired to the REAL prismaChannelAPairing service (neither mocked), with only
// `global.fetch` stubbed. Every other prismaChannelAPairing.service test mocks
// `./prismaSessionClient` entirely, which is exactly why the original bug (the session
// bootstrap's generic "bootstrap failed" Error discarding the proxy's detected port) went
// unnoticed: the bootstrap step never actually ran in those tests.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRISMA_SESSION_URL } from '../config/prismaAssistant.config';
import { prismaChannelAPairing, PrismaChannelAPairingError } from './prismaChannelAPairing.service';

function runtimeUnreachableResponse(detail?: { reason: string; port: number }): Response {
    const body = detail
        ? { error: 'prisma_runtime_unreachable', reason: detail.reason, port: detail.port }
        : { error: 'prisma_runtime_unreachable' };
    return new Response(JSON.stringify(body), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('prismaChannelAPairing wired to the real prismaSessionClient (T4d)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('carries the detected busy port through the session bootstrap failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async (path: RequestInfo | URL) => {
            if (String(path) === PRISMA_SESSION_URL) return runtimeUnreachableResponse({ reason: 'port_in_use', port: 5057 });
            throw new Error(`unexpected fetch in this test: ${String(path)}`);
        }));

        const caught = await prismaChannelAPairing.status().catch((error: unknown) => error);

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('runtime_unreachable');
        expect((caught as PrismaChannelAPairingError).detail).toEqual({ reason: 'port_in_use', port: 5057 });
    });

    it('still maps to runtime_unreachable with no detail when the session marker carries none', async () => {
        vi.stubGlobal('fetch', vi.fn(async (path: RequestInfo | URL) => {
            if (String(path) === PRISMA_SESSION_URL) return runtimeUnreachableResponse();
            throw new Error(`unexpected fetch in this test: ${String(path)}`);
        }));

        const caught = await prismaChannelAPairing.status().catch((error: unknown) => error);

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('runtime_unreachable');
        expect((caught as PrismaChannelAPairingError).detail).toBeUndefined();
    });
});
