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
}

let activeVoiceEventListener: { stop: () => void } | null = null;

export function startVoiceEventListener({
    url,
    onEvent,
    intervalMs = DEFAULT_VOICE_POLL_INTERVAL_MS,
    fetchImpl,
}: VoiceEventListenerOptions): () => void {
    activeVoiceEventListener?.stop();

    if (!url || url.trim() === '') {
        return () => undefined;
    }

    let stopped = false;
    let lastProcessedKey: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

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
        if (activeVoiceEventListener === owner) {
            activeVoiceEventListener = null;
        }
    };

    owner.stop = stop;
    activeVoiceEventListener = owner;
    void poll();

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
