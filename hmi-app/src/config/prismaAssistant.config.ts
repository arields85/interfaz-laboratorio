export const PRISMA_SNAPSHOT_URL = '/api/prisma/snapshot';
export const PRISMA_EVENTS_URL = '/api/prisma/events/latest';
export const PRISMA_SESSION_URL = '/api/prisma/session';
export const PRISMA_ASK_URL = '/api/prisma/ask';
export const PRISMA_VOICE_CONFIG_URL = '/api/prisma/voice-config';
export const PRISMA_TTS_LIVE_URL = '/api/prisma/tts/live';
export const PRISMA_CHANNEL_A_PAIRING_URL = '/api/prisma/channel-a/pairing';

export const PRISMA_BROWSER_ROUTES = Object.freeze({
    snapshot: PRISMA_SNAPSHOT_URL,
    events: PRISMA_EVENTS_URL,
    session: PRISMA_SESSION_URL,
    ask: PRISMA_ASK_URL,
    voiceConfig: PRISMA_VOICE_CONFIG_URL,
    ttsLive: PRISMA_TTS_LIVE_URL,
    pairing: PRISMA_CHANNEL_A_PAIRING_URL,
});
