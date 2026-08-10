export interface VoiceEvent {
    id?: string;
    telegramChatId?: number;
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
