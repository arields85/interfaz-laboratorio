/** voice-ux U1: absent means "answer" (every event published before this
 * task, and every ordinary answer today) -- the existing, TTS-eligible
 * shape. "thinking"/"cancel" are signal-only: no answer text, never
 * eligible for TTS (see the backend's own kind guard on /prisma/speak-live
 * and /internal/prisma/prefetch). The runtime list and the literal union are
 * one source: VoiceEventKind is derived from VOICE_EVENT_KINDS, so a value
 * added to one can never silently miss the other (see
 * domain/voice.ts's isVoiceEventKind, which checks a value against this
 * exact list). */
export const VOICE_EVENT_KINDS = ['thinking', 'cancel'] as const;
export type VoiceEventKind = (typeof VOICE_EVENT_KINDS)[number];

export interface VoiceEvent {
    id?: string;
    telegramChatId?: number;
    kind?: VoiceEventKind;
    timestamp: string;
    text: string;
    question: string;
}

export interface PrismaOrbVisualConfig {
    rays: number;
    speed: number;
    intensity: number;
    size: number;
    core: string;
    glow: string;
}
