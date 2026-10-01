import { describe, expect, it } from 'vitest';

import {
    LEDA_BROWSER_ROUTES,
    LEDA_ASK_URL,
    LEDA_CHANNEL_A_PAIRING_URL,
    LEDA_EVENTS_STREAM_URL,
    LEDA_EVENTS_URL,
    LEDA_SESSION_URL,
    LEDA_SNAPSHOT_URL,
    LEDA_TTS_LIVE_URL,
    LEDA_VOICE_CONFIG_URL,
    LEDA_VOICE_TIMELINE_URL,
} from './ledaAssistant.config';

describe('ledaAssistant.config', () => {
    it('exposes only the nine fixed same-origin browser routes', () => {
        expect(LEDA_BROWSER_ROUTES).toEqual({
            snapshot: '/api/leda/snapshot',
            events: '/api/leda/events/latest',
            eventsStream: '/api/leda/events/stream',
            session: '/api/leda/session',
            ask: '/api/leda/ask',
            voiceConfig: '/api/leda/voice-config',
            ttsLive: '/api/leda/tts/live',
            pairing: '/api/leda/channel-a/pairing',
            voiceTimeline: '/api/leda/voice/timeline',
        });
        expect(LEDA_SNAPSHOT_URL).toBe('/api/leda/snapshot');
        expect(LEDA_EVENTS_URL).toBe('/api/leda/events/latest');
        expect(LEDA_EVENTS_STREAM_URL).toBe('/api/leda/events/stream');
        expect(LEDA_SESSION_URL).toBe('/api/leda/session');
        expect(LEDA_ASK_URL).toBe('/api/leda/ask');
        expect(LEDA_VOICE_CONFIG_URL).toBe('/api/leda/voice-config');
        expect(LEDA_TTS_LIVE_URL).toBe('/api/leda/tts/live');
        expect(LEDA_CHANNEL_A_PAIRING_URL).toBe('/api/leda/channel-a/pairing');
        expect(LEDA_VOICE_TIMELINE_URL).toBe('/api/leda/voice/timeline');
        expect(JSON.stringify(LEDA_BROWSER_ROUTES)).not.toMatch(/127\.0\.0\.1|localhost|https?:\/\//);
    });
});
