import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    CONTRACT_STATUS_VALUES,
    createDefaultConnectionStatusDisplayOptions,
    DEFAULT_CONTRACT_STATUS_LABELS,
    formatAbsoluteConnectionTime,
    formatConnectionFreshness,
    normalizeSimulatedToContractStatus,
    resolveContractStatusLabel,
} from './connectionWidget';

describe('normalizeSimulatedToContractStatus', () => {
    it('preserves supported contract statuses from strings', () => {
        for (const status of CONTRACT_STATUS_VALUES) {
            expect(normalizeSimulatedToContractStatus(` ${status.toUpperCase()} `)).toBe(status);
        }
    });

    it('maps legacy connected and disconnected values', () => {
        expect(normalizeSimulatedToContractStatus('connected')).toBe('online');
        expect(normalizeSimulatedToContractStatus('conectado')).toBe('online');
        expect(normalizeSimulatedToContractStatus('disconnected')).toBe('offline');
        expect(normalizeSimulatedToContractStatus('desconectado')).toBe('offline');
        expect(normalizeSimulatedToContractStatus('degraded')).toBe('degradado');
        expect(normalizeSimulatedToContractStatus('stale')).toBe('degradado');
    });

    it('maps numeric and boolean simulated states', () => {
        expect(normalizeSimulatedToContractStatus(1)).toBe('online');
        expect(normalizeSimulatedToContractStatus(0)).toBe('offline');
        expect(normalizeSimulatedToContractStatus(99)).toBe('unknown');
        expect(normalizeSimulatedToContractStatus(true)).toBe('online');
        expect(normalizeSimulatedToContractStatus(false)).toBe('offline');
    });

    it('returns unknown for unsupported or missing values', () => {
        expect(normalizeSimulatedToContractStatus('maybe')).toBe('unknown');
        expect(normalizeSimulatedToContractStatus(undefined)).toBe('unknown');
    });
});

describe('resolveContractStatusLabel', () => {
    it('prefers trimmed custom labels over defaults', () => {
        expect(resolveContractStatusLabel('online', { onlineText: '  Linked  ' })).toBe('Linked');
    });

    it('falls back to default labels when custom text is blank or missing', () => {
        expect(resolveContractStatusLabel('offline', { offlineText: '   ' })).toBe(DEFAULT_CONTRACT_STATUS_LABELS.offline);
        expect(resolveContractStatusLabel('unknown')).toBe(DEFAULT_CONTRACT_STATUS_LABELS.unknown);
    });
});

describe('formatAbsoluteConnectionTime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns an empty string when there is no timestamp or the date is invalid', () => {
        expect(formatAbsoluteConnectionTime(null)).toBe('');
        expect(formatAbsoluteConnectionTime('not-a-date')).toBe('');
    });

    it('formats valid timestamps through Intl.DateTimeFormat', () => {
        const format = vi.fn().mockReturnValue('14:15:16');
        function MockDateTimeFormat() {
            return { format };
        }
        const dateTimeFormatSpy = vi
            .spyOn(Intl, 'DateTimeFormat')
            .mockImplementation(MockDateTimeFormat as typeof Intl.DateTimeFormat);

        expect(formatAbsoluteConnectionTime('2026-06-17T14:15:16.000Z')).toBe('14:15:16');
        expect(dateTimeFormatSpy).toHaveBeenCalledWith(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        expect(format).toHaveBeenCalledTimes(1);
    });
});

describe('formatConnectionFreshness', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses absolute time formatting when age is unavailable', () => {
        function MockDateTimeFormat() {
            return { format: () => '09:10:11' };
        }

        vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(MockDateTimeFormat as typeof Intl.DateTimeFormat);

        expect(formatConnectionFreshness(null, '2026-06-17T09:10:11.000Z')).toBe('09:10:11');
    });

    it('formats freshness in seconds, minutes, and hours', () => {
        expect(formatConnectionFreshness(59_000, null)).toBe('59s');
        expect(formatConnectionFreshness(61_000, null)).toBe('1min');
        expect(formatConnectionFreshness(7_200_000, null)).toBe('2h');
    });

    it('returns an empty string for negative ages', () => {
        expect(formatConnectionFreshness(-1_000, '2026-06-17T09:10:11.000Z')).toBe('');
    });
});

describe('createDefaultConnectionStatusDisplayOptions', () => {
    it('creates default labels for every contract status', () => {
        expect(createDefaultConnectionStatusDisplayOptions()).toEqual({
            onlineText: DEFAULT_CONTRACT_STATUS_LABELS.online,
            degradadoText: DEFAULT_CONTRACT_STATUS_LABELS.degradado,
            offlineText: DEFAULT_CONTRACT_STATUS_LABELS.offline,
            unknownText: DEFAULT_CONTRACT_STATUS_LABELS.unknown,
        });
    });
});
