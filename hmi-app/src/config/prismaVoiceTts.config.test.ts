import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL,
    PRISMA_VOICE_TTS_STORAGE_KEY,
    clearPrismaVoiceTtsServiceUrl,
    getSavedPrismaVoiceTtsServiceUrl,
    readPrismaVoiceTtsServiceUrl,
    resolvePrismaVoiceTtsServiceUrls,
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

    it('migrates a saved WAV endpoint to the Live sibling only when saving', () => {
        localStorage.setItem(
            PRISMA_VOICE_TTS_STORAGE_KEY,
            'https://tts.example.test/prisma/speak',
        );

        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak');
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY))
            .toBe('https://tts.example.test/prisma/speak');
        expect(savePrismaVoiceTtsServiceUrl('https://tts.example.test/prisma/speak'))
            .toBe('https://tts.example.test/prisma/speak-live');
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY))
            .toBe('https://tts.example.test/prisma/speak-live');
    });

    it('trims and persists a full HTTP or HTTPS Live service URL', () => {
        expect(savePrismaVoiceTtsServiceUrl('  https://tts.example.test/prisma/speak  '))
            .toBe('https://tts.example.test/prisma/speak-live');
        expect(localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY))
            .toBe('https://tts.example.test/prisma/speak-live');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak-live');
    });

    it.each([
        ['https://tts.example.test/prisma/speak', {
            liveUrl: 'https://tts.example.test/prisma/speak-live',
            fallbackUrl: 'https://tts.example.test/prisma/speak',
        }],
        ['https://tts.example.test/prisma/speak-live', {
            liveUrl: 'https://tts.example.test/prisma/speak-live',
            fallbackUrl: 'https://tts.example.test/prisma/speak',
        }],
        ['https://tts.example.test/custom-live', {
            liveUrl: 'https://tts.example.test/custom-live',
            fallbackUrl: null,
        }],
        ['', { liveUrl: '', fallbackUrl: null }],
    ])('resolves compatible Live and fallback URLs from %s', (value, expected) => {
        expect(resolvePrismaVoiceTtsServiceUrls(value)).toEqual(expected);
    });

    it('persists an explicit empty value to disable browser playback', () => {
        expect(savePrismaVoiceTtsServiceUrl('   ')).toBe('');
        expect(getSavedPrismaVoiceTtsServiceUrl()).toBe('');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('');
    });

    it('rejects non-HTTP and partial URLs without replacing the saved runtime value', () => {
        savePrismaVoiceTtsServiceUrl('https://tts.example.test/prisma/speak');

        expect(savePrismaVoiceTtsServiceUrl('/relative/tts'))
            .toBe('https://tts.example.test/prisma/speak-live');
        expect(savePrismaVoiceTtsServiceUrl('file:///tmp/voice.wav'))
            .toBe('https://tts.example.test/prisma/speak-live');
        expect(readPrismaVoiceTtsServiceUrl()).toBe('https://tts.example.test/prisma/speak-live');
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
