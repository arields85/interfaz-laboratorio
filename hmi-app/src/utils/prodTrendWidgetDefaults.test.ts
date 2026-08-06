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

    it('normalizes invalid persisted data modes to real without selecting fallback', () => {
        expect(resolveProdTrendDisplayOptions({ dataMode: 'fallback' as never }).dataMode).toBe('real');
        expect(resolveProdTrendDisplayOptions({ dataMode: 'unknown' as never }).dataMode).toBe('real');
    });

    it('preserves selectable persisted modes', () => {
        expect(resolveProdTrendDisplayOptions({ dataMode: 'simulated' }).dataMode).toBe('simulated');
        expect(resolveProdTrendDisplayOptions({ dataMode: 'automatic' }).dataMode).toBe('automatic');
    });
});
