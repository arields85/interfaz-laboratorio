import { describe, expect, it } from 'vitest';
import {
    createDefaultProdTrendDisplayOptions,
    resolveProdTrendDisplayOptions,
} from './prodTrendWidgetDefaults';

describe('prodTrendWidgetDefaults', () => {
    it('defaults missing persisted data mode to real', () => {
        expect(createDefaultProdTrendDisplayOptions().dataMode).toBe('real');
        expect(resolveProdTrendDisplayOptions().dataMode).toBe('real');
    });

    it('normalizes invalid and legacy automatic persisted data modes to real', () => {
        expect(resolveProdTrendDisplayOptions({ dataMode: 'fallback' as never }).dataMode).toBe('real');
        expect(resolveProdTrendDisplayOptions({ dataMode: 'unknown' as never }).dataMode).toBe('real');
        expect(resolveProdTrendDisplayOptions({ dataMode: 'automatic' as never }).dataMode).toBe('real');
    });

    it('preserves the two selectable persisted modes', () => {
        expect(resolveProdTrendDisplayOptions({ dataMode: 'simulated' }).dataMode).toBe('simulated');
        expect(resolveProdTrendDisplayOptions({ dataMode: 'real' }).dataMode).toBe('real');
    });
});
