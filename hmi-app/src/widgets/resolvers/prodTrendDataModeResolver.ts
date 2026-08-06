import type {
    ProdTrendConfiguredMode,
    ProdTrendDataModeEvent,
    ProdTrendDataModeFailureReason,
    ProdTrendDataModeState,
    ProdTrendDataSource,
} from '../../domain/prodTrendDataMode.types';

const DEFAULT_CONFIGURED_MODE: ProdTrendConfiguredMode = 'real';

export function resolveProdTrendConfiguredMode(value: unknown): ProdTrendConfiguredMode {
    return value === 'simulated' || value === 'automatic' || value === 'real'
        ? value
        : DEFAULT_CONFIGURED_MODE;
}

export function createInitialProdTrendDataModeState(value?: unknown): ProdTrendDataModeState {
    const configuredMode = resolveProdTrendConfiguredMode(value);

    return {
        configuredMode,
        effectiveMode: configuredMode === 'automatic' ? 'real' : configuredMode,
        phase: 'active',
        emptyStreak: 0,
        successStreak: 0,
        committedSource: null,
        fallbackReason: null,
    };
}

export function transitionProdTrendDataMode(
    state: ProdTrendDataModeState,
    event: ProdTrendDataModeEvent,
): ProdTrendDataModeState {
    switch (event.type) {
        case 'configured-mode':
            return createInitialProdTrendDataModeState(event.mode);
        case 'fallback-source-selected':
            return state.phase === 'fallback'
                ? { ...state, committedSource: event.source }
                : state;
        case 'real-error':
            return state.configuredMode === 'automatic'
                ? activateFallback(state, event.reason)
                : state;
        case 'real-success':
            return resolveRealSuccess(state, event.hasData);
    }
}

function resolveRealSuccess(state: ProdTrendDataModeState, hasData: boolean): ProdTrendDataModeState {
    if (state.configuredMode === 'simulated') {
        return state;
    }

    if (state.configuredMode === 'real') {
        return hasData
            ? {
                  ...state,
                  emptyStreak: 0,
                  successStreak: 0,
                  committedSource: 'real',
              }
            : { ...state, emptyStreak: state.emptyStreak + 1, successStreak: 0 };
    }

    if (state.phase === 'fallback') {
        if (!hasData) {
            return { ...state, emptyStreak: 0, successStreak: 0 };
        }

        const successStreak = state.successStreak + 1;
        if (successStreak < 2) {
            return { ...state, emptyStreak: 0, successStreak };
        }

        return {
            ...state,
            effectiveMode: 'real',
            phase: 'active',
            emptyStreak: 0,
            successStreak,
            committedSource: 'real',
            fallbackReason: null,
        };
    }

    if (hasData) {
        return {
            ...state,
            effectiveMode: 'real',
            emptyStreak: 0,
            successStreak: 0,
            committedSource: 'real',
        };
    }

    const emptyStreak = state.emptyStreak + 1;
    return emptyStreak < 2
        ? { ...state, emptyStreak, successStreak: 0 }
        : activateFallback(state, 'repeated-empty-series', emptyStreak);
}

function activateFallback(
    state: ProdTrendDataModeState,
    fallbackReason: ProdTrendDataModeFailureReason,
    emptyStreak = 0,
): ProdTrendDataModeState {
    return {
        ...state,
        effectiveMode: 'fallback',
        phase: 'fallback',
        emptyStreak,
        successStreak: 0,
        committedSource: null,
        fallbackReason,
    };
}

export type { ProdTrendDataModeState, ProdTrendDataSource };
