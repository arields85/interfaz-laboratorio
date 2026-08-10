export const PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL = 'http://127.0.0.1:5056/prisma/speak-live';
export const PRISMA_VOICE_TTS_STORAGE_KEY = 'hmi:prisma-voice-tts-service-url';
export const PRISMA_VOICE_TTS_CONFIG_CHANGED_EVENT = 'hmi:prisma-voice-tts-config-changed';

export interface PrismaVoiceTtsServiceUrls {
    liveUrl: string;
    fallbackUrl: string | null;
}

export function normalizePrismaVoiceTtsServiceUrl(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed === '') {
        return '';
    }

    try {
        const url = new URL(trimmed);
        return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
            ? trimmed
            : null;
    } catch {
        return null;
    }
}

export function getSavedPrismaVoiceTtsServiceUrl(): string | null {
    try {
        return localStorage.getItem(PRISMA_VOICE_TTS_STORAGE_KEY);
    } catch {
        return null;
    }
}

export function resolvePrismaVoiceTtsServiceUrls(
    value: string,
): PrismaVoiceTtsServiceUrls | null {
    const normalized = normalizePrismaVoiceTtsServiceUrl(value);
    if (normalized === null) {
        return null;
    }
    if (normalized === '') {
        return { liveUrl: '', fallbackUrl: null };
    }

    const url = new URL(normalized);
    if (url.pathname.endsWith('/speak-live')) {
        const fallbackUrl = new URL(url);
        fallbackUrl.pathname = `${url.pathname.slice(0, -'/speak-live'.length)}/speak`;
        return { liveUrl: normalized, fallbackUrl: fallbackUrl.toString() };
    }
    if (url.pathname.endsWith('/speak')) {
        const liveUrl = new URL(url);
        liveUrl.pathname = `${url.pathname.slice(0, -'/speak'.length)}/speak-live`;
        return { liveUrl: liveUrl.toString(), fallbackUrl: normalized };
    }

    return { liveUrl: normalized, fallbackUrl: null };
}

export function readPrismaVoiceTtsServiceUrl(): string {
    const savedValue = getSavedPrismaVoiceTtsServiceUrl();
    if (savedValue === null) {
        return PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL;
    }

    return normalizePrismaVoiceTtsServiceUrl(savedValue)
        ?? PRISMA_VOICE_TTS_DEFAULT_SERVICE_URL;
}

export function savePrismaVoiceTtsServiceUrl(value: string): string {
    const normalized = normalizePrismaVoiceTtsServiceUrl(value);
    if (normalized === null) {
        return readPrismaVoiceTtsServiceUrl();
    }
    const resolved = resolvePrismaVoiceTtsServiceUrls(normalized);
    const valueToSave = resolved?.fallbackUrl === null
        ? normalized
        : resolved?.liveUrl ?? normalized;

    try {
        localStorage.setItem(PRISMA_VOICE_TTS_STORAGE_KEY, valueToSave);
        notifyPrismaVoiceTtsConfigChanged();
        return valueToSave;
    } catch {
        return readPrismaVoiceTtsServiceUrl();
    }
}

export function clearPrismaVoiceTtsServiceUrl(): void {
    try {
        localStorage.removeItem(PRISMA_VOICE_TTS_STORAGE_KEY);
        notifyPrismaVoiceTtsConfigChanged();
    } catch {
        // Browser storage may be blocked by policy or privacy mode.
    }
}

function notifyPrismaVoiceTtsConfigChanged(): void {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(PRISMA_VOICE_TTS_CONFIG_CHANGED_EVENT));
    }
}
