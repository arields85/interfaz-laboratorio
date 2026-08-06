import { describe, expect, it } from 'vitest';
import {
    createInitialProdTrendDataModeState,
    transitionProdTrendDataMode,
    type ProdTrendDataModeState,
} from './prodTrendDataModeResolver';

function transition(
    state: ProdTrendDataModeState,
    event: Parameters<typeof transitionProdTrendDataMode>[1],
): ProdTrendDataModeState {
    return transitionProdTrendDataMode(state, event);
}

describe('prodTrendDataModeResolver', () => {
    it('keeps real mode real when the real source fails', () => {
        const initial = createInitialProdTrendDataModeState('real');

        const next = transition(initial, { type: 'real-error', reason: 'network' });

        expect(next).toMatchObject({
            configuredMode: 'real',
            effectiveMode: 'real',
            phase: 'active',
            committedSource: null,
            fallbackReason: null,
        });
    });

    it('does not activate fallback for repeated empty responses in real mode', () => {
        const initial = createInitialProdTrendDataModeState('real');
        const firstEmpty = transition(initial, { type: 'real-success', hasData: false });
        const secondEmpty = transition(firstEmpty, { type: 'real-success', hasData: false });

        expect(secondEmpty).toMatchObject({
            configuredMode: 'real',
            effectiveMode: 'real',
            phase: 'active',
            fallbackReason: null,
        });
    });

    it('ignores real-source events while configured as simulated', () => {
        const initial = createInitialProdTrendDataModeState('simulated');
        const afterError = transition(initial, { type: 'real-error', reason: 'network' });
        const afterSuccess = transition(afterError, { type: 'real-success', hasData: true });

        expect(afterError).toEqual(initial);
        expect(afterSuccess).toEqual(initial);
    });

    it('activates fallback after an automatic real error and keeps the reason', () => {
        const initial = createInitialProdTrendDataModeState('automatic');

        const next = transition(initial, { type: 'real-error', reason: 'timeout' });

        expect(next).toMatchObject({
            configuredMode: 'automatic',
            effectiveMode: 'fallback',
            phase: 'fallback',
            fallbackReason: 'timeout',
            emptyStreak: 0,
            successStreak: 0,
        });
    });

    it('requires two consecutive empty real responses before automatic fallback', () => {
        const initial = createInitialProdTrendDataModeState('automatic');

        const firstEmpty = transition(initial, { type: 'real-success', hasData: false });
        const secondEmpty = transition(firstEmpty, { type: 'real-success', hasData: false });

        expect(firstEmpty).toMatchObject({
            effectiveMode: 'real',
            phase: 'active',
            emptyStreak: 1,
            fallbackReason: null,
        });
        expect(secondEmpty).toMatchObject({
            effectiveMode: 'fallback',
            phase: 'fallback',
            emptyStreak: 2,
            fallbackReason: 'repeated-empty-series',
        });
    });

    it('holds fallback for the first valid real response and recovers on the second', () => {
        const fallback = transition(
            createInitialProdTrendDataModeState('automatic'),
            { type: 'real-error', reason: 'http' },
        );
        const withFirstSuccess = transition(fallback, { type: 'real-success', hasData: true });
        const recovered = transition(withFirstSuccess, { type: 'real-success', hasData: true });

        expect(withFirstSuccess).toMatchObject({
            effectiveMode: 'fallback',
            phase: 'fallback',
            successStreak: 1,
            fallbackReason: 'http',
        });
        expect(recovered).toMatchObject({
            effectiveMode: 'real',
            phase: 'active',
            successStreak: 2,
            committedSource: 'real',
            fallbackReason: null,
        });
    });

    it('commits one fallback source and does not mix it with the first recovery response', () => {
        const fallback = transition(
            createInitialProdTrendDataModeState('automatic'),
            { type: 'real-error', reason: 'invalid-contract' },
        );
        const selected = transition(fallback, {
            type: 'fallback-source-selected',
            source: 'last-known-good',
        });
        const firstRecovery = transition(selected, { type: 'real-success', hasData: true });

        expect(selected.committedSource).toBe('last-known-good');
        expect(firstRecovery).toMatchObject({
            effectiveMode: 'fallback',
            committedSource: 'last-known-good',
            successStreak: 1,
        });
    });

    it('resets opposing streaks and switches configured mode without carrying fallback state', () => {
        const fallback = transition(
            createInitialProdTrendDataModeState('automatic'),
            { type: 'real-success', hasData: false },
        );
        const simulated = transition(fallback, { type: 'configured-mode', mode: 'simulated' });

        expect(simulated).toEqual({
            configuredMode: 'simulated',
            effectiveMode: 'simulated',
            phase: 'active',
            emptyStreak: 0,
            successStreak: 0,
            committedSource: null,
            fallbackReason: null,
        });
    });
});
