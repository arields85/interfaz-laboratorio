import { describe, expect, it } from 'vitest';
import { logShieldDebug, logShieldDebugFromShield } from '../shieldDebug';

describe('shieldDebug', () => {
    it('keeps the debug shim as a safe no-op for generic events', () => {
        expect(logShieldDebug('content-ready:signal', { detail: 'root-attribute-set' })).toBeUndefined();
    });

    it('keeps the debug shim as a safe no-op for shield-scoped events', () => {
        const shield = document.createElement('div');

        expect(logShieldDebugFromShield('shield:reveal-requested', shield, { profile: 'long' })).toBeUndefined();
    });
});
