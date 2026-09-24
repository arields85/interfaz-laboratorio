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
    /** T13 unit (c) / T10 unit 5: push voice events (SSE) instead of
     * polling every intervalMs. Attempted only in real production usage
     * (fetchImpl === undefined, matching every existing test/injected-
     * transport seam in this module) and only when a native EventSource
     * is available; falls back to the polling loop above on any error,
     * on stream end, or when unsupported. */
    streamUrl?: string | null;
    /** Test seam for the SSE path, mirroring fetchImpl's role for polling. */
    eventSourceImpl?: typeof EventSource;
}

let activeVoiceEventListener: { stop: () => void } | null = null;

export function startVoiceEventListener({
    url,
    onEvent,
    intervalMs = DEFAULT_VOICE_POLL_INTERVAL_MS,
    fetchImpl,
    streamUrl = null,
    eventSourceImpl,
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

    const startSse = async () => {
        let capability: string;

        try {
            capability = await prismaSessionClient.capability();
        } catch {
            startPolling();
            return;
        }

        if (stopped || usingPolling) {
            return;
        }

        const EventSourceCtor = eventSourceImpl
            ?? (typeof EventSource === 'function' ? EventSource : undefined);
        if (!EventSourceCtor || !streamUrl) {
            startPolling();
            return;
        }

        const source = new EventSourceCtor(
            `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}capability=${encodeURIComponent(capability)}`,
        );
        let closed = false;
        const stopSse = () => {
            if (closed) {
                return;
            }

            closed = true;
            source.close();
        };

        if (stopped || usingPolling) {
            stopSse();
            return;
        }

        activeSse = { stop: stopSse };

        source.onmessage = (message: MessageEvent<string>) => {
            if (stopped || closed) {
                return;
            }

            let payload: unknown;
            try {
                payload = JSON.parse(message.data);
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

        source.onerror = () => {
            stopSse();
            if (!stopped) {
                startPolling();
            }
        };
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
        && streamUrl.trim() !== ''
        && (eventSourceImpl !== undefined || typeof EventSource === 'function');

    if (canAttemptSse) {
        void startSse();
    } else {
        startPolling();
    }

    return stop;
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
