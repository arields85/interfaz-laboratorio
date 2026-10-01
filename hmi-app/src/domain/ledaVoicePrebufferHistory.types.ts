/**
 * One measurement of the prebuffer a progressive Leda voice answer would
 * have needed to play back without gaps, produced by
 * `LedaPrebufferNeedTracker.neededPrebufferMs()` (see
 * `services/ledaPrebufferNeedTracker.ts`) and timestamped with the moment
 * it was recorded. `recordedAtMs` uses the same wall-clock unit as the
 * engine's injectable `now()`.
 *
 * Shared across layers: the browser history storage persists a list of
 * these, the continuous estimator reads them to compute the next prebuffer,
 * and the playback engine (T3) both produces and consumes them.
 */
export interface LedaVoicePrebufferMeasurement {
    readonly neededPrebufferMs: number;
    readonly recordedAtMs: number;
}

/** Oldest-first list of measurements, as kept in browser history. */
export type LedaVoicePrebufferHistory = readonly LedaVoicePrebufferMeasurement[];

function isFiniteNonNegativeNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Strict shape guard for one persisted or in-memory measurement. Used by the
 * browser history storage to drop invalid entries instead of failing an
 * entire read on partial corruption.
 */
export function isLedaVoicePrebufferMeasurement(value: unknown): value is LedaVoicePrebufferMeasurement {
    if (typeof value !== 'object' || value === null) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return isFiniteNonNegativeNumber(candidate.neededPrebufferMs)
        && isFiniteNonNegativeNumber(candidate.recordedAtMs);
}
