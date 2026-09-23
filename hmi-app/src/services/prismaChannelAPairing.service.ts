import { PRISMA_CHANNEL_A_PAIRING_URL } from '../config/prismaAssistant.config';
import {
    parseChannelAPairingIssue,
    parseChannelAPairingStatus,
    type ChannelAPairingErrorKind,
    type ChannelAPairingIssue,
    type ChannelARuntimeUnreachableDetail,
    type ChannelAPairingStatus,
} from '../domain/channelAPairing.types';
import { PrismaStaleSessionResponse, prismaSessionClient } from './prismaSessionClient';

const CONFLICT_ERROR_CODE = 'PRISMA_CHANNEL_A_CONFLICT';

// Safe, owned messages only: raw server text, causes and network details never propagate.
const ERROR_MESSAGES: Record<ChannelAPairingErrorKind, string> = {
    session: 'Channel A pairing requires an active Prisma session.',
    conflict: 'Channel A is already linked or has a pending pairing.',
    unavailable: 'Channel A pairing is currently unavailable.',
    runtime_unreachable: 'The Prisma runtime could not be reached.',
};

export class PrismaChannelAPairingError extends Error {
    readonly kind: ChannelAPairingErrorKind;
    readonly detail?: ChannelARuntimeUnreachableDetail;

    constructor(kind: ChannelAPairingErrorKind, detail?: ChannelARuntimeUnreachableDetail) {
        super(ERROR_MESSAGES[kind]);
        this.name = 'PrismaChannelAPairingError';
        this.kind = kind;
        this.detail = detail;
    }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The dev proxy's own structured failure marker (T4b, vite.prismaProxy.config.ts's error
// handler): { error: 'prisma_runtime_unreachable', reason?, port? }. Recognizing it takes
// precedence over the generic "non-2xx with valid JSON = unavailable" rule below, because this
// JSON body was never produced by the Prisma runtime itself — it is the proxy reporting that
// the runtime could not be reached, exactly like the malformed-body case, just with detail.
const RUNTIME_UNREACHABLE_MARKER = 'prisma_runtime_unreachable';

function parseRuntimeUnreachableDetail(payload: unknown): ChannelARuntimeUnreachableDetail | undefined {
    if (!isPlainObject(payload)) return undefined;
    const { reason, port } = payload;
    if (reason !== 'port_in_use') return undefined;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
    return { reason, port };
}

function isRuntimeUnreachableMarker(payload: unknown): boolean {
    return isPlainObject(payload) && payload.error === RUNTIME_UNREACHABLE_MARKER;
}

// 409 counts as a pairing conflict only for the exact canonical payload; any extra key,
// different code or malformed body falls back to the safe unavailable kind.
function isExactConflictPayload(value: unknown): boolean {
    return isPlainObject(value)
        && Object.keys(value).length === 2
        && value.ok === false
        && value.error === CONFLICT_ERROR_CODE;
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

async function requestPairing<T>(
    init: RequestInit,
    parse: (payload: unknown) => T | null,
): Promise<T> {
    let response: Response;
    try {
        response = await prismaSessionClient.fetch(PRISMA_CHANNEL_A_PAIRING_URL, init);
    } catch (error: unknown) {
        if (isAbortError(error) || error instanceof PrismaStaleSessionResponse) throw error;
        // fetch() only rejects for a genuine connectivity failure (a TypeError per the Fetch
        // spec): the Prisma runtime was never reached at all, distinct from any case below
        // where a real HTTP response was read from it.
        throw new PrismaChannelAPairingError('runtime_unreachable');
    }

    // The real client invalidates its epoch when a response is 401, so classifying the
    // capability rejection must precede the stale check below or it would misreport as stale.
    if (response.status === 401) throw new PrismaChannelAPairingError('session');

    // Session epoch check before the body is consumed.
    if (!prismaSessionClient.isCurrentResponse(response)) throw new PrismaStaleSessionResponse();

    let payload: unknown = null;
    let bodyMalformed = false;
    try {
        payload = await response.json();
    } catch (error: unknown) {
        // A body read that aborts (or turns stale) is a lifecycle event, not malformed data:
        // rethrow the SAME error instead of mapping it to a pairing failure.
        if (isAbortError(error) || error instanceof PrismaStaleSessionResponse) throw error;
        bodyMalformed = true;
    }

    // Session epoch check again AFTER body resolution: a QR resolved against a stale
    // session must never be returned.
    if (!prismaSessionClient.isCurrentResponse(response)) throw new PrismaStaleSessionResponse();

    // The dev proxy's own runtime_unreachable marker takes precedence over every classification
    // below, including 409: a body carrying it was never produced by the Prisma runtime, no
    // matter which status code the proxy answered with, so it is never a real runtime response.
    if (!response.ok && !bodyMalformed && isRuntimeUnreachableMarker(payload)) {
        throw new PrismaChannelAPairingError('runtime_unreachable', parseRuntimeUnreachableDetail(payload));
    }

    if (response.status === 409) {
        // A pairing conflict exists only for the exact canonical payload; any extra key,
        // different code or malformed body falls back to the safe unavailable kind. This
        // classification is independent of the runtime_unreachable split below: a 409 is by
        // definition a response the runtime itself produced.
        if (isExactConflictPayload(payload)) throw new PrismaChannelAPairingError('conflict');
        throw new PrismaChannelAPairingError('unavailable');
    }
    // Every non-success code other than 409 is refused before any success parse: a valid
    // payload carried by 5xx/4xx must never surface as a status or QR. A non-2xx response with
    // NO valid JSON body never came from the Prisma runtime's own contract (it always answers
    // in JSON); it is the dev proxy's own failure page instead — e.g. Vite's default proxy
    // error handler answers an ECONNREFUSED to the runtime with a bare 500 and an empty
    // text/plain body (vite/dist/node/chunks/config.js, proxyMiddleware's `proxy.on('error', ...)`
    // handler: `res.writeHead(500, { 'Content-Type': 'text/plain' }).end()`). That case is
    // reported as runtime_unreachable; a non-2xx response the runtime DID answer with valid
    // JSON keeps the existing unavailable kind.
    if (!response.ok) {
        if (bodyMalformed) throw new PrismaChannelAPairingError('runtime_unreachable');
        throw new PrismaChannelAPairingError('unavailable');
    }
    if (bodyMalformed) throw new PrismaChannelAPairingError('unavailable');

    const parsed = parse(payload);
    if (parsed === null) throw new PrismaChannelAPairingError('unavailable');
    return parsed;
}

export const prismaChannelAPairing = {
    status(signal?: AbortSignal): Promise<ChannelAPairingStatus> {
        return requestPairing({ method: 'GET', cache: 'no-store', signal }, parseChannelAPairingStatus);
    },

    issue(signal?: AbortSignal): Promise<ChannelAPairingIssue> {
        return requestPairing(
            {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
                signal,
            },
            parseChannelAPairingIssue,
        );
    },
};
