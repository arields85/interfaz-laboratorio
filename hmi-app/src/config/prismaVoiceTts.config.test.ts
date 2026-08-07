import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL,
    PRISMA_VOICE_TTS_STORAGE_KEY,
    clearPrismaVoiceTtsServiceUrl,
    getSavedPrismaVoiceTtsServiceUrl,
    readPrismaVoiceTtsServiceUrl,
    savePrismaVoiceTtsServiceUrl,
} from './prismaVoiceTts.config';

describe('prismaVoiceTts.config', () => {
    afterEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('uses the canonical default only when no browser override exists', () => {
        expect(getSavedPrismaVoiceTtsServiceUrl()).toBeNull();
        expect(readPrismaVoiceTtsServiceUrl()).toBe(PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL);
    });

    it('trims and persists a full HTTP or HTTPS service URL', () => {
        expect(savePrismaVoiceTtsServiceUrl('  https://tts.example.test/prisma/speak  '))
            .toBe('https://tts.example.test/prisma/speak');
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY))
            .toBe('https://tts.example.test/prisma/speak');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak');
    });

    it('persists an explicit empty value to disable browser playback', () => {
        expect(savePrismaVoiceTtsServiceUrl('   ')).toBe('');
        expect(getSavedPrismaVoiceTtsServiceUrl()).toBe('');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('');
    });

    it('rejects non-HTTP and partial URLs without replacing the saved runtime value', () => {
        savePrismaVoiceTtsServiceUrl('https://tts.example.test/prisma/speak');

        expect(savePrismaVoiceTtsServiceUrl('/relative/tts'))
            .toBe('https://tts.example.test/prisma/speak');
        expect(savePrismaVoiceTtsServiceUrl('file:///tmp/voice.wav'))
            .toBe('https://tts.example.test/prisma/speak');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak');
    });

    it('clears the browser override back to the canonical default', () => {
        savePrismaVoiceTtsServiceUrl('http://localhost:5056/custom');

        clearPrismaVoiceTtsServiceUrl();

        expect(getSavedPrismaVoiceTtsServiceUrl()).toBeNull();
        expect(readPrismaVoiceTtsServiceUrl()).toBe(PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL);
    });

    it('falls back safely when browser storage is unavailable', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });

        expect(getSavedPrismaVoiceTtsServiceUrl()).toBeNull();
        expect(readPrismaVoiceTtsServiceUrl()).toBe(PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL);
        expect(savePrismaVoiceTtsServiceUrl('https://tts.example.test/prisma/speak'))
            .toBe(PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL);
        expect(() => clearPrismaVoiceTtsServiceUrl()).not.toThrow();
    });
});
