import { describe, expect, it } from 'vitest';
import {
    createEppiEntryState,
    getCoreReturnTarget,
    isEppiPathname,
    preserveEppiEntryState,
} from './eppiRouting';

describe('EPPI route helpers', () => {
    it('derives viewer mode only from the /eppi route namespace', () => {
        expect(isEppiPathname('/eppi/orders')).toBe(true);
        expect(isEppiPathname('/eppi')).toBe(true);
        expect(isEppiPathname('/eppicenter')).toBe(false);
        expect(isEppiPathname('/')).toBe(false);
    });

    it('captures the exact CoreAnalytics pathname and query when entering EPPI', () => {
        expect(createEppiEntryState('/equipment/reactor-1', '?tab=telemetry&range=8h')).toEqual({
            coreReturnTo: '/equipment/reactor-1?tab=telemetry&range=8h',
        });
    });

    it('preserves a valid CoreAnalytics return target while navigating inside EPPI', () => {
        expect(preserveEppiEntryState({ coreReturnTo: '/alerts?severity=critical' })).toEqual({
            coreReturnTo: '/alerts?severity=critical',
        });
    });

    it('rejects EPPI and malformed return targets and falls back to the Core root', () => {
        expect(getCoreReturnTarget({ coreReturnTo: '/eppi/tools' })).toBe('/');
        expect(getCoreReturnTarget({ coreReturnTo: 'https://example.com' })).toBe('/');
        expect(getCoreReturnTarget(null)).toBe('/');
    });
});
