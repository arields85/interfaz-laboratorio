import type { VoiceEvent } from '../domain/voice.types';

const DEFAULT_VOICE_POLL_INTERVAL_MS = 1_000;

interface VoiceEventListenerOptions {
    url: string | null;
    onEvent: (event: VoiceEvent) => void;
    intervalMs?: number;
    fetchImpl?: typeof fetch;
}

export function startVoiceEventListener({
    url,
    onEvent,
    intervalMs = DEFAULT_VOICE_POLL_INTERVAL_MS,
    fetchImpl = fetch,
}: VoiceEventListenerOptions): () => void {
    if (!url || url.trim() === '') {
        return () => undefined;
    }

    let stopped = false;
    let lastProcessedId: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

    const poll = async () => {
        activeController = typeof AbortController === 'function' ? new AbortController() : null;

        try {
            const response = await fetchImpl(url, {
                method: 'GET',
                signal: activeController?.signal,
            });

            if (!response.ok) {
                return;
            }

            const payload: unknown = await response.json();

            if (stopped || !isVoiceEvent(payload)) {
                return;
            }

            if (lastProcessedId === null) {
                lastProcessedId = payload.id;
                return;
            }

            if (payload.id === lastProcessedId) {
                return;
            }

            lastProcessedId = payload.id;
            onEvent(payload);
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

    void poll();

    return () => {
        stopped = true;

        if (timeoutId !== null) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }

        activeController?.abort();
        activeController = null;
    };
}

function isVoiceEvent(value: unknown): value is VoiceEvent {
    return typeof value === 'object'
        && value !== null
        && 'id' in value
        && typeof value.id === 'string'
        && value.id.trim() !== ''
        && 'timestamp' in value
        && typeof value.timestamp === 'string'
        && 'text' in value
        && typeof value.text === 'string'
        && 'question' in value
        && typeof value.question === 'string';
}
