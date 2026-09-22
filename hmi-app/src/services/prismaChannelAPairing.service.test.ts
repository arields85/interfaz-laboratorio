import { beforeEach, describe, expect, it, vi } from 'vitest';

// The session client boundary is fully mocked: no real fetch, capability, or network here.
const harness = vi.hoisted(() => {
    class PrismaStaleSessionResponse extends Error {}
    return {
        PrismaStaleSessionResponse,
        client: {
            fetch: vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(),
            isCurrentResponse: vi.fn<(response: Response) => boolean>(),
        },
    };
});
vi.mock('./prismaSessionClient', () => ({
    prismaSessionClient: harness.client,
    PrismaStaleSessionResponse: harness.PrismaStaleSessionResponse,
}));

import { PRISMA_CHANNEL_A_PAIRING_URL } from '../config/prismaAssistant.config';
import { prismaChannelAPairing, PrismaChannelAPairingError } from './prismaChannelAPairing.service';

// Test-only opaque values shaped like the backend projection. Never a real credential.
const FAKE_PAIRING_TOKEN = 'f4ke'.padEnd(43, 'x');
const FAKE_DEEP_LINK = `https://t.me/hmi_lab_bot?start=${FAKE_PAIRING_TOKEN}`;
const VALID_FAKE_STATUS = { ok: true, state: 'free' } as const;
const VALID_FAKE_ISSUE = { ok: true, qr: { deepLink: FAKE_DEEP_LINK, expiresInSeconds: 42 } } as const;

function knownResponse(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

// Fake body whose JSON resolution is deferred; bodyStarted resolves when json() is actually
// called, so staleness can be injected deterministically after fetch without timers or loops.
function deferredJsonResponse(status: number): {
    response: Response;
    body: { resolve: (value: unknown) => void };
    bodyStarted: { promise: Promise<void> };
} {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((resolvePromise) => { resolve = resolvePromise; });
    let signalStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => { signalStarted = resolveStarted; });
    return {
        response: {
            status,
            ok: status >= 200 && status < 300,
            json: () => {
                signalStarted();
                return promise;
            },
        } as unknown as Response,
        body: { resolve },
        bodyStarted: { promise: started },
    };
}

async function caughtOf(pending: Promise<unknown>): Promise<unknown> {
    return pending.catch((caught: unknown) => caught);
}

describe('prismaChannelAPairing.status', () => {
    beforeEach(() => {
        harness.client.fetch.mockReset();
        harness.client.isCurrentResponse.mockReset();
    });

    it('issues the exact pairing GET through the session client without store, CSRF or capability duplication', async () => {
        harness.client.fetch.mockResolvedValue(knownResponse(200, VALID_FAKE_STATUS));
        harness.client.isCurrentResponse.mockReturnValue(true);

        await expect(prismaChannelAPairing.status()).resolves.toEqual(VALID_FAKE_STATUS);

        expect(harness.client.fetch).toHaveBeenCalledTimes(1);
        expect(harness.client.fetch).toHaveBeenCalledWith(
            PRISMA_CHANNEL_A_PAIRING_URL,
            expect.objectContaining({ method: 'GET', cache: 'no-store' }),
        );
        const headers = new Headers(harness.client.fetch.mock.calls[0]?.[1]?.headers);
        expect(headers.get('X-CSRF-Token')).toBeNull();
        expect(headers.get('X-Prisma-Session-Capability')).toBeNull();
    });

    it('forwards the caller abort signal to the session client', async () => {
        harness.client.fetch.mockResolvedValue(knownResponse(200, VALID_FAKE_STATUS));
        harness.client.isCurrentResponse.mockReturnValue(true);
        const controller = new AbortController();

        await prismaChannelAPairing.status(controller.signal);

        expect(harness.client.fetch.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
    });

    it('keeps no cached QR or status state between calls', async () => {
        // A fresh Response per call: a real Response body cannot be consumed twice.
        harness.client.fetch.mockImplementation(() => Promise.resolve(knownResponse(200, VALID_FAKE_STATUS)));
        harness.client.isCurrentResponse.mockReturnValue(true);

        await prismaChannelAPairing.status();
        await prismaChannelAPairing.status();

        expect(harness.client.fetch).toHaveBeenCalledTimes(2);
    });

    it('preserves a caller AbortError instead of mapping it to a pairing error', async () => {
        harness.client.fetch.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(DOMException);
        expect(caught).not.toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as DOMException).name).toBe('AbortError');
    });

    it('passes a session-client stale failure through untouched for the local lifecycle guard', async () => {
        harness.client.fetch.mockRejectedValue(new harness.PrismaStaleSessionResponse('stale epoch'));

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(harness.PrismaStaleSessionResponse);
        expect(caught).not.toBeInstanceOf(PrismaChannelAPairingError);
    });

    it('fails stale when the response epoch is no longer current before the body is consumed', async () => {
        harness.client.fetch.mockResolvedValue(knownResponse(200, VALID_FAKE_STATUS));
        harness.client.isCurrentResponse.mockReturnValue(false);

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(harness.PrismaStaleSessionResponse);
        expect(caught).not.toBeInstanceOf(PrismaChannelAPairingError);
    });
});

describe('prismaChannelAPairing.issue', () => {
    beforeEach(() => {
        harness.client.fetch.mockReset();
        harness.client.isCurrentResponse.mockReset();
    });

    it('issues the exact pairing POST with an empty JSON object and no store', async () => {
        harness.client.fetch.mockResolvedValue(knownResponse(200, VALID_FAKE_ISSUE));
        harness.client.isCurrentResponse.mockReturnValue(true);

        await expect(prismaChannelAPairing.issue()).resolves.toEqual(VALID_FAKE_ISSUE);

        const init = harness.client.fetch.mock.calls[0]?.[1] ?? {};
        expect(harness.client.fetch).toHaveBeenCalledTimes(1);
        expect(harness.client.fetch).toHaveBeenCalledWith(
            PRISMA_CHANNEL_A_PAIRING_URL,
            expect.objectContaining({ method: 'POST', cache: 'no-store', body: '{}' }),
        );
        expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
    });

    it('refuses a stale QR whose epoch changed while the deferred body was being resolved', async () => {
        const { response, body, bodyStarted } = deferredJsonResponse(200);
        harness.client.fetch.mockResolvedValue(response);
        harness.client.isCurrentResponse.mockReturnValue(true);

        const pending = prismaChannelAPairing.issue();
        await bodyStarted.promise;
        harness.client.isCurrentResponse.mockReturnValue(false);
        body.resolve(VALID_FAKE_ISSUE);
        const caught = await caughtOf(pending);

        expect(caught).toBeInstanceOf(harness.PrismaStaleSessionResponse);
        expect(caught).not.toBeInstanceOf(PrismaChannelAPairingError);
    });
});

describe('prismaChannelAPairing error mapping', () => {
    beforeEach(() => {
        harness.client.fetch.mockReset();
        harness.client.isCurrentResponse.mockReset();
        harness.client.isCurrentResponse.mockReturnValue(true);
    });

    it('maps a 401 response to the session kind even though the real client already invalidated the epoch', async () => {
        // Actual prismaSessionClient behavior: a 401 invalidates the capability BEFORE the
        // response is returned, so isCurrentResponse is already false. The service must still
        // surface the session kind, never a stale QR and never a stale failure for this case.
        harness.client.isCurrentResponse.mockReturnValue(false);
        harness.client.fetch.mockResolvedValue(knownResponse(401, { ok: false, error: 'PRISMA_SESSION_REQUIRED' }));

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('session');
        expect(caught).not.toBeInstanceOf(harness.PrismaStaleSessionResponse);
    });

    it('maps a 401 response to the session kind even without a readable payload', async () => {
        harness.client.fetch.mockResolvedValue(new Response('{', { status: 401 }));

        const caught = await caughtOf(prismaChannelAPairing.issue());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('session');
    });

    it('maps a 409 response carrying exactly the canonical conflict payload to the conflict kind', async () => {
        harness.client.fetch.mockResolvedValue(
            knownResponse(409, { ok: false, error: 'PRISMA_CHANNEL_A_CONFLICT' }),
        );

        const caught = await caughtOf(prismaChannelAPairing.issue());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('conflict');
    });

    it.each([
        ['the status endpoint', () => prismaChannelAPairing.status(), VALID_FAKE_STATUS],
        ['the issue endpoint', () => prismaChannelAPairing.issue(), VALID_FAKE_ISSUE],
    ])('never returns a structurally valid success payload from a 503 response on %s', async (_name, call, payload) => {
        // HTTP failure semantics are frozen: a non-success status is unavailable BEFORE any
        // body parsing, even when the body itself would parse as a valid status or QR.
        harness.client.fetch.mockResolvedValue(knownResponse(503, payload));

        const caught = await caughtOf(call());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('unavailable');
    });

    it('rethrows an AbortError raised while reading the body instead of mapping it', async () => {
        const abort = new DOMException('Aborted', 'AbortError');
        harness.client.fetch.mockResolvedValue({
            status: 200,
            ok: true,
            json: () => Promise.reject(abort),
        } as unknown as Response);

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBe(abort);
        expect(caught).not.toBeInstanceOf(PrismaChannelAPairingError);
    });

    it.each([
        ['a different error code', knownResponse(409, { ok: false, error: 'SOMETHING_ELSE' })],
        ['a 409 without the error key', knownResponse(409, { ok: false })],
        ['a 409 with the canonical code plus an extra key', knownResponse(409, { ok: false, error: 'PRISMA_CHANNEL_A_CONFLICT', extra: 1 })],
        ['a 409 with malformed JSON', new Response('{', { status: 409 })],
    ])('maps %s to the safe unavailable kind instead of conflict', async (_name, response) => {
        harness.client.fetch.mockResolvedValue(response);

        const caught = await caughtOf(prismaChannelAPairing.issue());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('unavailable');
    });

    it.each([
        ['lifecycle unavailable with 502', 502, { ok: false, error: 'PRISMA_CHANNEL_A_LIFECYCLE_UNAVAILABLE' }],
        ['manager unavailable with 503', 503, { ok: false, error: 'PRISMA_CHANNEL_A_MANAGER_UNAVAILABLE' }],
        ['a 200 body failing the domain parser', 200, { ok: true, state: 'frobnicate' }],
        ['a 200 body with extra keys', 200, { ok: true, state: 'free', qr: VALID_FAKE_ISSUE.qr }],
    ])('maps %s to the safe unavailable kind', async (_name, status, payload) => {
        harness.client.fetch.mockResolvedValue(knownResponse(status, payload));

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('unavailable');
    });

    it('never propagates raw server failure text into the pairing error', async () => {
        harness.client.fetch.mockResolvedValue(
            knownResponse(500, { ok: false, error: 'SUPER_SECRET_INTERNAL_TRACE' }),
        );

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('unavailable');
        expect((caught as PrismaChannelAPairingError).message).not.toContain('SUPER_SECRET');
    });

    it('maps a malformed JSON success body to the safe unavailable kind', async () => {
        harness.client.fetch.mockResolvedValue(new Response('{', { status: 200 }));

        const caught = await caughtOf(prismaChannelAPairing.issue());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('unavailable');
    });

    it('maps a generic network rejection to the safe unavailable kind', async () => {
        harness.client.fetch.mockRejectedValue(new Error('NETWORK_DOWN'));

        const caught = await caughtOf(prismaChannelAPairing.status());

        expect(caught).toBeInstanceOf(PrismaChannelAPairingError);
        expect((caught as PrismaChannelAPairingError).kind).toBe('unavailable');
        expect((caught as PrismaChannelAPairingError).message).not.toContain('NETWORK_DOWN');
    });
});
