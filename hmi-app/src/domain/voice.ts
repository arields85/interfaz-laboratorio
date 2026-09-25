import { VOICE_EVENT_KINDS } from './voice.types';
import type { VoiceEventKind } from './voice.types';

export function normalizeTelegramChatId(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0
        ? value
        : undefined;
}

/** voice-ux U1: checks a value against the exact same VOICE_EVENT_KINDS
 * list VoiceEventKind is derived from (voice.types.ts) -- a kind added to
 * that list is automatically recognized here too, never the other way
 * around. */
export function isVoiceEventKind(value: unknown): value is VoiceEventKind {
    return typeof value === 'string' && (VOICE_EVENT_KINDS as readonly string[]).includes(value);
}
