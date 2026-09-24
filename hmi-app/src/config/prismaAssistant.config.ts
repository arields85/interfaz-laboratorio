export const PRISMA_SNAPSHOT_URL = '/api/prisma/snapshot';
export const PRISMA_EVENTS_URL = '/api/prisma/events/latest';
// T13 unit (c) / T10 unit 5: push voice events (SSE) instead of 1s polling.
// The polling URL above stays as the fallback (on SSE error/unsupported).
export const PRISMA_EVENTS_STREAM_URL = '/api/prisma/events/stream';
export const PRISMA_SESSION_URL = '/api/prisma/session';
export const PRISMA_ASK_URL = '/api/prisma/ask';
export const PRISMA_VOICE_CONFIG_URL = '/api/prisma/voice-config';
export const PRISMA_TTS_LIVE_URL = '/api/prisma/tts/live';
export const PRISMA_CHANNEL_A_PAIRING_URL = '/api/prisma/channel-a/pairing';
// T16: batched browser voice timeline diagnostics (see
// prismaVoiceTimelineDiagnosticsSink.ts and the runtime's
// /hmi/voice/timeline route) -- never plant control, read-only logging.
export const PRISMA_VOICE_TIMELINE_URL = '/api/prisma/voice/timeline';

export const PRISMA_BROWSER_ROUTES = Object.freeze({
    snapshot: PRISMA_SNAPSHOT_URL,
    events: PRISMA_EVENTS_URL,
    eventsStream: PRISMA_EVENTS_STREAM_URL,
    session: PRISMA_SESSION_URL,
    ask: PRISMA_ASK_URL,
    voiceConfig: PRISMA_VOICE_CONFIG_URL,
    ttsLive: PRISMA_TTS_LIVE_URL,
    pairing: PRISMA_CHANNEL_A_PAIRING_URL,
    voiceTimeline: PRISMA_VOICE_TIMELINE_URL,
});
