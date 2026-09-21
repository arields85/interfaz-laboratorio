import { normalizeHmiName } from '../domain/hmiName';
import type { HmiNameReadResult, HmiNameSaveResult } from '../domain/hmiName';

const STORAGE_KEY = 'hmi:prisma-hmi-name';

export function readHmiName(): HmiNameReadResult {
    let raw: string | null;
    try {
        raw = localStorage.getItem(STORAGE_KEY);
    } catch {
        return { ok: false, name: null, error: 'unavailable' };
    }
    if (raw === null) return { ok: true, name: null };
    try {
        const stored: unknown = JSON.parse(raw);
        if (typeof stored !== 'object' || stored === null || Array.isArray(stored)
            || Object.keys(stored).length !== 2
            || !('version' in stored) || stored.version !== 1 || !('name' in stored)) {
            return { ok: false, name: null, error: 'invalid' };
        }
        if (stored.name === null) return { ok: true, name: null };
        const name = normalizeHmiName(stored.name);
        return name === null
            ? { ok: false, name: null, error: 'invalid' }
            : { ok: true, name };
    } catch {
        return { ok: false, name: null, error: 'invalid' };
    }
}

export function saveHmiName(value: string): HmiNameSaveResult {
    const name = normalizeHmiName(value);
    if (name === null && value.trim() !== '') return { ok: false, error: 'invalid' };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, name }));
    } catch {
        return { ok: false, error: 'unavailable' };
    }
    const persisted = readHmiName();
    if (!persisted.ok || persisted.name !== name) return { ok: false, error: 'unavailable' };
    return { ok: true, name };
}
