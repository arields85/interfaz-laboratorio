import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    TEMPORAL_SETTINGS_CHANGED_EVENT,
    TEMPORAL_SETTINGS_FALLBACK_TIMEZONE,
    TEMPORAL_SETTINGS_STORAGE_KEY,
    clearTemporalSettingsConfig,
    readTemporalSettingsConfig,
    resolveTemporalSettingsTimezone,
    saveTemporalSettingsConfig,
} from './temporalSettings.config';

describe('temporalSettings.config', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('returns safe defaults when storage is empty or corrupted', () => {
        expect(readTemporalSettingsConfig()).toEqual({
            plantTimezone: null,
            shifts: [],
        });

        localStorage.setItem(TEMPORAL_SETTINGS_STORAGE_KEY, '{invalid-json');

        expect(readTemporalSettingsConfig()).toEqual({
            plantTimezone: null,
            shifts: [],
        });
    });

    it('persists normalized temporal settings locally and dispatches the same-session change event', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const changeEvent = new Promise<Event>((resolve) => {
            document.addEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, resolve, { once: true });
        });

        saveTemporalSettingsConfig({
            plantTimezone: 'America/Santiago',
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' },
                { id: '', label: '', start: 'bad', end: '14:00' },
            ],
        });

        expect(readTemporalSettingsConfig()).toEqual({
            plantTimezone: 'America/Santiago',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
        });
        expect(fetchSpy).not.toHaveBeenCalled();

        const event = await changeEvent;
        expect(event).toBeInstanceOf(CustomEvent);
        expect((event as CustomEvent).detail).toEqual({
            plantTimezone: 'America/Santiago',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
        });

        clearTemporalSettingsConfig();
        expect(readTemporalSettingsConfig()).toEqual({ plantTimezone: null, shifts: [] });
    });

    it('fails gracefully when storage persistence throws and does not dispatch a false success event', () => {
        const eventSpy = vi.fn();
        const storageSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        document.addEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, eventSpy);

        expect(() => saveTemporalSettingsConfig({
            plantTimezone: 'UTC',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' }],
        })).not.toThrow();

        expect(storageSpy).toHaveBeenCalledTimes(1);
        expect(eventSpy).not.toHaveBeenCalled();
        expect(readTemporalSettingsConfig()).toEqual({ plantTimezone: null, shifts: [] });

        document.removeEventListener(TEMPORAL_SETTINGS_CHANGED_EVENT, eventSpy);
    });

    it('keeps legacy shifts readable by normalizing missing weekdays to the full week', () => {
        localStorage.setItem(TEMPORAL_SETTINGS_STORAGE_KEY, JSON.stringify({
            plantTimezone: 'UTC',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00' }],
        }));

        expect(readTemporalSettingsConfig()).toEqual({
            plantTimezone: 'UTC',
            shifts: [{ id: 'shift-a', label: 'Turno A', start: '06:00', end: '14:00', weekdays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }],
        });
    });

    it('rejects invalid weekly schedules before persistence', () => {
        const result = saveTemporalSettingsConfig({
            plantTimezone: 'UTC',
            shifts: [
                { id: 'shift-a', label: 'Turno A', start: '22:00', end: '06:00', weekdays: ['fri'] },
                { id: 'shift-b', label: 'Turno B', start: '04:00', end: '12:00', weekdays: ['sat'] },
            ],
        });

        expect(result.ok).toBe(false);
        expect(localStorage.getItem(TEMPORAL_SETTINGS_STORAGE_KEY)).toBeNull();
        expect(readTemporalSettingsConfig()).toEqual({ plantTimezone: null, shifts: [] });
    });

    it('resolves the saved timezone first, then the browser timezone, then the deterministic fallback', () => {
        expect(resolveTemporalSettingsTimezone({ plantTimezone: 'UTC', shifts: [] })).toBe('UTC');

        const resolvedOptionsFormat = vi.fn(() => ({ timeZone: 'America/Montevideo' }));
        const actualIntl = globalThis.Intl;
        const mockDateTimeFormat = vi.fn(function (this: unknown, locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
            if (options?.timeZone) {
                return {
                    format: actualIntl.DateTimeFormat(locale, options).format,
                    resolvedOptions: () => ({ timeZone: options.timeZone }),
                } as Intl.DateTimeFormat;
            }

            return {
                format: actualIntl.DateTimeFormat(locale, options).format,
                resolvedOptions: resolvedOptionsFormat,
            } as Intl.DateTimeFormat;
        });
        vi.stubGlobal('Intl', {
            ...actualIntl,
            DateTimeFormat: mockDateTimeFormat,
        });

        expect(resolveTemporalSettingsTimezone({ plantTimezone: null, shifts: [] })).toBe('America/Montevideo');

        resolvedOptionsFormat.mockReturnValue({ timeZone: undefined });

        expect(resolveTemporalSettingsTimezone({ plantTimezone: null, shifts: [] })).toBe(
            TEMPORAL_SETTINGS_FALLBACK_TIMEZONE
        );
    });

    it('ignores invalid saved or browser timezones and falls back deterministically', () => {
        localStorage.setItem(TEMPORAL_SETTINGS_STORAGE_KEY, JSON.stringify({
            plantTimezone: 'Invalid/Admin-Timezone',
            shifts: [],
        }));

        expect(readTemporalSettingsConfig()).toEqual({
            plantTimezone: null,
            shifts: [],
        });

        const resolvedOptionsFormat = vi.fn(() => ({ timeZone: 'Invalid/Browser-Timezone' }));
        const actualIntl = globalThis.Intl;
        const mockDateTimeFormat = vi.fn(function (this: unknown, locale?: string | string[], options?: Intl.DateTimeFormatOptions) {
            if (options?.timeZone) {
                return {
                    format: () => {
                        if (options.timeZone === 'Invalid/Browser-Timezone') {
                            throw new RangeError('Invalid time zone');
                        }

                        return actualIntl.DateTimeFormat(locale, options).format(new Date(0));
                    },
                    resolvedOptions: () => ({ timeZone: options.timeZone }),
                } as unknown as Intl.DateTimeFormat;
            }

            return {
                format: actualIntl.DateTimeFormat(locale, options).format,
                resolvedOptions: resolvedOptionsFormat,
            } as Intl.DateTimeFormat;
        });
        vi.stubGlobal('Intl', {
            ...actualIntl,
            DateTimeFormat: mockDateTimeFormat,
        });

        expect(resolveTemporalSettingsTimezone({ plantTimezone: 'Invalid/Admin-Timezone', shifts: [] })).toBe(
            TEMPORAL_SETTINGS_FALLBACK_TIMEZONE
        );

        resolvedOptionsFormat.mockReturnValue({ timeZone: 'America/Montevideo' });

        expect(resolveTemporalSettingsTimezone({ plantTimezone: 'Invalid/Admin-Timezone', shifts: [] })).toBe('America/Montevideo');
    });
});
