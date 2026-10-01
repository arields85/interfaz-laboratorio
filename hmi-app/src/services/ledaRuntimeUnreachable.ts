import type { ChannelARuntimeUnreachableDetail } from '../domain/channelAPairing.types';

// The dev proxy's own structured failure marker (T4b/T4c, vite.ledaProxy.config.ts):
// { error: 'leda_runtime_unreachable', reason?, port? }. A body carrying it was never
// produced by the Leda runtime itself, no matter which endpoint or status answered it —
// including the session bootstrap endpoint (T4d): the proxy answers every Leda route the
// same way once the launcher reported a startup failure, so the session POST gets exactly
// the same marker the pairing GET/POST would have. Shared by ledaSessionClient.ts (which
// throws LedaRuntimeUnreachableError from bootstrap) and ledaChannelAPairing.service.ts
// (which recognizes the marker directly on its own response, and also catches the error
// bootstrap throws) so the parsing logic exists in exactly one place.
const RUNTIME_UNREACHABLE_MARKER = 'leda_runtime_unreachable';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isLedaRuntimeUnreachableMarker(payload: unknown): boolean {
    return isPlainObject(payload) && payload.error === RUNTIME_UNREACHABLE_MARKER;
}

export function parseLedaRuntimeUnreachableDetail(payload: unknown): ChannelARuntimeUnreachableDetail | undefined {
    if (!isPlainObject(payload)) return undefined;
    const { reason, port } = payload;
    if (reason !== 'port_in_use') return undefined;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return undefined;
    return { reason, port };
}

// Thrown by the session client's bootstrap when the proxy answered the session endpoint
// with its own runtime_unreachable marker (never a response the Leda runtime itself
// produced). Every other session-client consumer (dashboardSnapshotExport, voice TTS/event
// listeners, main.tsx) already catches bootstrap/fetch failures generically and treats this
// exactly like the pre-existing plain Error — only the channel A pairing service recognizes
// it specially, to carry the detected port through to the popover.
export class LedaRuntimeUnreachableError extends Error {
    readonly detail?: ChannelARuntimeUnreachableDetail;

    constructor(detail?: ChannelARuntimeUnreachableDetail) {
        super('The Leda runtime could not be reached.');
        this.name = 'LedaRuntimeUnreachableError';
        this.detail = detail;
    }
}
