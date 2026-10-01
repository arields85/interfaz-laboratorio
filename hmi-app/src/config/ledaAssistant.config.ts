export const LEDA_SNAPSHOT_URL = '/api/leda/snapshot';
export const LEDA_EVENTS_URL = '/api/leda/events/latest';
// T13 unit (c) / T10 unit 5: push voice events (SSE) instead of 1s polling.
// The polling URL above stays as the fallback (on SSE error/unsupported).
export const LEDA_EVENTS_STREAM_URL = '/api/leda/events/stream';
export const LEDA_SESSION_URL = '/api/leda/session';
export const LEDA_ASK_URL = '/api/leda/ask';
export const LEDA_VOICE_CONFIG_URL = '/api/leda/voice-config';
export const LEDA_TTS_LIVE_URL = '/api/leda/tts/live';
export const LEDA_CHANNEL_A_PAIRING_URL = '/api/leda/channel-a/pairing';
// T16: batched browser voice timeline diagnostics (see
// ledaVoiceTimelineDiagnosticsSink.ts and the runtime's
// /hmi/voice/timeline route) -- never plant control, read-only logging.
export const LEDA_VOICE_TIMELINE_URL = '/api/leda/voice/timeline';

export const LEDA_BROWSER_ROUTES = Object.freeze({
    snapshot: LEDA_SNAPSHOT_URL,
    events: LEDA_EVENTS_URL,
    eventsStream: LEDA_EVENTS_STREAM_URL,
    session: LEDA_SESSION_URL,
    ask: LEDA_ASK_URL,
    voiceConfig: LEDA_VOICE_CONFIG_URL,
    ttsLive: LEDA_TTS_LIVE_URL,
    pairing: LEDA_CHANNEL_A_PAIRING_URL,
    voiceTimeline: LEDA_VOICE_TIMELINE_URL,
});
