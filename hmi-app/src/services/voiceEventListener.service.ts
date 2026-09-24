import type { VoiceEvent } from '../domain/voice.types';
import { normalizeTelegramChatId } from '../domain/voice';
import { PRISMA_EVENTS_URL } from '../config/prismaAssistant.config';
import { prismaSessionClient } from './prismaSessionClient';

const DEFAULT_VOICE_POLL_INTERVAL_MS = 1_000;

interface VoiceEventListenerOptions {
    url: string | null;
    onEvent: (event: VoiceEvent) => void;
    intervalMs?: number;
    fetchImpl?: typeof fetch;
    /** T13 unit (c) / T10 unit 5, revised by T13b: push voice events (SSE)
     * instead of polling every intervalMs. Attempted only in real
     * production usage (fetchImpl === undefined, matching every existing
     * test/injected-transport seam in this module). Read with a
     * fetch-based reader through prismaSessionClient.fetch -- the same
     * transport polling uses -- so the session capability travels in the
     * ordinary request header, never in the stream URL (T13b's blocking
     * finding: a native EventSource cannot set custom headers, so an
     * earlier revision put the capability in `?capability=`, which
     * Werkzeug's dev server then logged to disk). Falls back to the
     * polling loop above on any connection/stream error, on an
     * unsupported/non-streaming response, or when the stream ends. */
    streamUrl?: string | null;
}

/** Guards a single unterminated SSE frame from growing forever if the
 * server (or a proxy) never sends the closing blank line. Well above any
 * real voice-event payload. */
const MAX_SSE_BUFFERED_CHARS = 64 * 1024;

let activeVoiceEventListener: { stop: () => void } | null = null;

export function startVoiceEventListener({
    url,
    onEvent,
    intervalMs = DEFAULT_VOICE_POLL_INTERVAL_MS,
    fetchImpl,
    streamUrl = null,
}: VoiceEventListenerOptions): () => void {
    activeVoiceEventListener?.stop();

    if (!url || url.trim() === '') {
        return () => undefined;
    }

    let stopped = false;
    // Shared between the SSE path and the polling fallback so a mid-stream
    // fallback never replays (or is blocked from delivering) an event the
    // other path already handled.
    let lastProcessedKey: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;
    let activeSse: { stop: () => void } | null = null;
    let usingPolling = false;

    const poll = async () => {
        activeController = typeof AbortController === 'function' ? new AbortController() : null;

        try {
            const response = await (fetchImpl ?? prismaSessionClient.fetch.bind(prismaSessionClient))(url, {
                method: 'GET',
                signal: activeController?.signal,
            });

            if (!response.ok) {
                return;
            }

            const payload: unknown = await response.json();
            if (fetchImpl === undefined && !prismaSessionClient.isCurrentResponse(response)) {
                return;
            }

            const event = normalizeVoiceEvent(payload);
            if (stopped || !event) {
                return;
            }

            const eventKey = getVoiceEventDedupeKey(event);
            if (lastProcessedKey === null && (url !== PRISMA_EVENTS_URL || event.id === undefined)) {
                lastProcessedKey = eventKey;
                return;
            }
            if (eventKey === lastProcessedKey) {
                return;
            }

            lastProcessedKey = eventKey;
            if (fetchImpl === undefined && !prismaSessionClient.acceptVoiceEvent(eventKey)) {
                return;
            }
            onEvent(event);
        } catch {
            // Voice channel failures must never interrupt the HMI.
        } finally {
            activeController = null;

            if (!stopped) {
                timeoutId = setTimeout(() => {
                    void poll();
                }, intervalMs);
            }
        }
    };

    const startPolling = () => {
        if (stopped || usingPolling) {
            return;
        }

        usingPolling = true;
        activeSse?.stop();
        activeSse = null;
        void poll();
    };

    const handleSseFrame = (frame: string) => {
        const data = extractSseFrameData(frame);
        if (data === null) {
            return;
        }

        let payload: unknown;
        try {
            payload = JSON.parse(data);
        } catch {
            return;
        }

        const event = normalizeVoiceEvent(payload);
        if (!event) {
            return;
        }

        const eventKey = getVoiceEventDedupeKey(event);
        if (eventKey === lastProcessedKey) {
            return;
        }

        lastProcessedKey = eventKey;
        if (!prismaSessionClient.acceptVoiceEvent(eventKey)) {
            return;
        }
        onEvent(event);
    };

    const startSse = async () => {
        if (stopped || usingPolling || !streamUrl) {
            return;
        }

        let response: Response;
        try {
            response = await prismaSessionClient.fetch(streamUrl, {
                method: 'GET',
                headers: { Accept: 'text/event-stream' },
            });
        } catch {
            if (!stopped && !usingPolling) {
                startPolling();
            }
            return;
        }

        if (stopped || usingPolling) {
            void response.body?.cancel().catch(() => undefined);
            return;
        }

        if (
            !response.ok
            || response.body === null
            || typeof response.body.getReader !== 'function'
            || !prismaSessionClient.isCurrentResponse(response)
        ) {
            void response.body?.cancel().catch(() => undefined);
            startPolling();
            return;
        }

        const reader = response.body.getReader();
        let closed = false;
        const stopSse = () => {
            if (closed) {
                return;
            }

            closed = true;
            void reader.cancel().catch(() => undefined);
        };
        activeSse = { stop: stopSse };

        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (!closed) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });

                let boundary = buffer.indexOf('\n\n');
                while (boundary !== -1) {
                    handleSseFrame(buffer.slice(0, boundary));
                    buffer = buffer.slice(boundary + 2);
                    boundary = buffer.indexOf('\n\n');
                }

                if (buffer.length > MAX_SSE_BUFFERED_CHARS) {
                    // Every complete frame in this chunk was already
                    // extracted above; what remains is one unterminated
                    // frame that is not a well-formed SSE stream (or a
                    // malicious/broken one). Drop it rather than buffering
                    // forever -- a later `\n\n` still resynchronizes.
                    buffer = '';
                }
            }
        } catch {
            // A read rejected (network error mid-stream); fall through to
            // the same fallback the natural stream end takes below.
        } finally {
            closed = true;
        }

        if (activeSse?.stop === stopSse) {
            activeSse = null;
        }

        // Reaching here means the stream ended -- naturally (`done`) or via
        // a rejected read -- without this listener having been stopped or
        // already switched to polling by another path. Either way, fall
        // back to polling.
        if (!stopped && !usingPolling) {
            startPolling();
        }
    };

    const owner = { stop: () => undefined as void };
    const stop = () => {
        if (stopped) {
            return;
        }

        stopped = true;

        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }

        activeController?.abort();
        activeController = null;
        activeSse?.stop();
        activeSse = null;
        if (activeVoiceEventListener === owner) {
            activeVoiceEventListener = null;
        }
    };

    owner.stop = stop;
    activeVoiceEventListener = owner;

    const canAttemptSse = fetchImpl === undefined
        && !!streamUrl
        && streamUrl.trim() !== '';

    if (canAttemptSse) {
        void startSse();
    } else {
        startPolling();
    }

    return stop;
}

/**
 * Extracts the `data:` payload of one SSE frame (the text between two
 * consecutive `\n\n` separators, decoded and reassembled from the stream
 * before this is called). Returns null for a frame that carries no `data:`
 * line at all -- a comment/heartbeat (`: keep-alive`) or a blank frame --
 * so the caller can skip it without attempting to parse anything. Multiple
 * `data:` lines in one frame are joined with `\n`, per the SSE spec; this
 * server only ever sends a single line, but the join is forward-compatible.
 * Other SSE fields (`event:`, `id:`, `retry:`) are not produced by this
 * server and are ignored here rather than rejected.
 */
function extractSseFrameData(frame: string): string | null {
    const dataLines: string[] = [];
    for (const rawLine of frame.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (line === '' || line.startsWith(':')) {
            continue;
        }
        if (line.startsWith('data:')) {
            const value = line.slice('data:'.length);
            dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
        }
    }
    return dataLines.length === 0 ? null : dataLines.join('\n');
}

function normalizeVoiceEvent(value: unknown): VoiceEvent | null {
    if (typeof value !== 'object'
        || value === null
        || !('timestamp' in value)
        || typeof value.timestamp !== 'string'
        || !('text' in value)
        || typeof value.text !== 'string'
        || !('question' in value)
        || typeof value.question !== 'string') {
        return null;
    }

    const id = 'id' in value && typeof value.id === 'string' && value.id.trim() !== ''
        ? value.id
        : undefined;
    const telegramChatId = 'telegramChatId' in value
        ? normalizeTelegramChatId(value.telegramChatId)
        : undefined;
    return {
        ...(id === undefined ? {} : { id }),
        ...(telegramChatId === undefined ? {} : { telegramChatId }),
        timestamp: value.timestamp,
        text: value.text,
        question: value.question,
    };
}

function getVoiceEventDedupeKey(event: VoiceEvent): string {
    return event.id === undefined
        ? `legacy:${JSON.stringify([
            event.timestamp,
            event.text,
            event.question,
            event.telegramChatId,
        ])}`
        : `id:${event.id}`;
}
