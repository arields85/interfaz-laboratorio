import { describe, expect, it } from 'vitest';

import {
    createDefaultStatusDisplayOptions,
    DEFAULT_STATUS_LABELS,
    EQUIPMENT_STATUS_VALUES,
    normalizeSimulatedEquipmentStatus,
    resolveStatusLabel,
} from './statusWidget';

describe('normalizeSimulatedEquipmentStatus', () => {
    it('preserves supported equipment statuses from strings', () => {
        for (const status of EQUIPMENT_STATUS_VALUES) {
            expect(normalizeSimulatedEquipmentStatus(` ${status.toUpperCase()} `)).toBe(status);
        }
    });

    it('maps numeric and boolean simulated states', () => {
        expect(normalizeSimulatedEquipmentStatus(1)).toBe('running');
        expect(normalizeSimulatedEquipmentStatus(0)).toBe('unknown');
        expect(normalizeSimulatedEquipmentStatus(true)).toBe('running');
        expect(normalizeSimulatedEquipmentStatus(false)).toBe('unknown');
    });

    it('maps string booleans and numbers to supported statuses', () => {
        expect(normalizeSimulatedEquipmentStatus('1')).toBe('running');
        expect(normalizeSimulatedEquipmentStatus('true')).toBe('running');
        expect(normalizeSimulatedEquipmentStatus('0')).toBe('unknown');
        expect(normalizeSimulatedEquipmentStatus('false')).toBe('unknown');
    });

    it('returns unknown for unsupported or missing values', () => {
        expect(normalizeSimulatedEquipmentStatus(99)).toBe('unknown');
        expect(normalizeSimulatedEquipmentStatus('maybe')).toBe('unknown');
        expect(normalizeSimulatedEquipmentStatus(undefined)).toBe('unknown');
    });
});

describe('resolveStatusLabel', () => {
    it('prefers trimmed custom labels over defaults', () => {
        expect(resolveStatusLabel('running', { runningText: '  Producing  ' })).toBe('Producing');
    });

    it('falls back to default labels when custom text is blank or missing', () => {
        expect(resolveStatusLabel('offline', { offlineText: '   ' })).toBe(DEFAULT_STATUS_LABELS.offline);
        expect(resolveStatusLabel('unknown')).toBe(DEFAULT_STATUS_LABELS.unknown);
    });
});

describe('createDefaultStatusDisplayOptions', () => {
    it('creates default labels for every equipment status', () => {
        expect(createDefaultStatusDisplayOptions()).toEqual({
            runningText: DEFAULT_STATUS_LABELS.running,
            idleText: DEFAULT_STATUS_LABELS.idle,
            warningText: DEFAULT_STATUS_LABELS.warning,
            criticalText: DEFAULT_STATUS_LABELS.critical,
            offlineText: DEFAULT_STATUS_LABELS.offline,
            maintenanceText: DEFAULT_STATUS_LABELS.maintenance,
            unknownText: DEFAULT_STATUS_LABELS.unknown,
        });
    });
});
