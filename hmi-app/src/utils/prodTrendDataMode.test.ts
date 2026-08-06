import { describe, expect, it } from 'vitest';
import { resolveProdTrendConfiguredMode } from './prodTrendDataMode';

describe('prodTrendDataMode', () => {
    it('preserves only real and simulated configured modes', () => {
        expect(resolveProdTrendConfiguredMode('real')).toBe('real');
        expect(resolveProdTrendConfiguredMode('simulated')).toBe('simulated');
    });

    it('normalizes legacy automatic and invalid persisted modes to real', () => {
        expect(resolveProdTrendConfiguredMode('automatic')).toBe('real');
        expect(resolveProdTrendConfiguredMode('fallback')).toBe('real');
        expect(resolveProdTrendConfiguredMode(undefined)).toBe('real');
    });
});
