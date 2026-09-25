import type { VoiceEventKind } from './voice.types';

export function normalizeTelegramChatId(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value !== 0
        ? value
        : undefined;
}

/** voice-ux U1: the single place the recognized non-answer voice-event
 * kinds are listed, so a caller checking one value against the whole set
 * (isVoiceEventKind below) and a caller needing the individual literal
 * types (VoiceEventKind in voice.types.ts) can never silently drift apart. */
const VOICE_EVENT_KINDS: readonly VoiceEventKind[] = ['thinking', 'cancel'];

export function isVoiceEventKind(value: unknown): value is VoiceEventKind {
    return typeof value === 'string' && (VOICE_EVENT_KINDS as readonly string[]).includes(value);
}
