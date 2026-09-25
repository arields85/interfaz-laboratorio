/** voice-ux U1: absent means "answer" (every event published before this
 * task, and every ordinary answer today) -- the existing, TTS-eligible
 * shape. "thinking"/"cancel" are signal-only: no answer text, never
 * eligible for TTS (see the backend's own kind guard on /prisma/speak-live
 * and /internal/prisma/prefetch). */
export type VoiceEventKind = 'thinking' | 'cancel';

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
