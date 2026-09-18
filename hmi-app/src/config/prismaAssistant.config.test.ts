import { describe, expect, it } from 'vitest';

import {
    PRISMA_BROWSER_ROUTES,
    PRISMA_ASK_URL,
    PRISMA_EVENTS_URL,
    PRISMA_SESSION_URL,
    PRISMA_SNAPSHOT_URL,
    PRISMA_TTS_LIVE_URL,
    PRISMA_VOICE_CONFIG_URL,
} from './prismaAssistant.config';

describe('prismaAssistant.config', () => {
    it('exposes only the six fixed same-origin browser routes', () => {
        expect(PRISMA_BROWSER_ROUTES).toEqual({
            snapshot: '/api/prisma/snapshot',
            events: '/api/prisma/events/latest',
            session: '/api/prisma/session',
            ask: '/api/prisma/ask',
            voiceConfig: '/api/prisma/voice-config',
            ttsLive: '/api/prisma/tts/live',
        });
        expect(PRISMA_SNAPSHOT_URL).toBe('/api/prisma/snapshot');
        expect(PRISMA_EVENTS_URL).toBe('/api/prisma/events/latest');
        expect(PRISMA_SESSION_URL).toBe('/api/prisma/session');
        expect(PRISMA_ASK_URL).toBe('/api/prisma/ask');
        expect(PRISMA_VOICE_CONFIG_URL).toBe('/api/prisma/voice-config');
        expect(PRISMA_TTS_LIVE_URL).toBe('/api/prisma/tts/live');
        expect(JSON.stringify(PRISMA_BROWSER_ROUTES)).not.toMatch(/127\.0\.0\.1|localhost|https?:\/\//);
    });
});
