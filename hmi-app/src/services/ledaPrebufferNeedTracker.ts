/**
 * Measures, for one progressive voice answer, the prebuffer that would have
 * avoided every scheduling gap -- independent of the prebuffer actually
 * used to play that answer back.
 *
 * For each PCM block `i` scheduled in the progressive path, record its
 * arrival time `a_i` (ms, from the engine's injectable clock) and let
 * `D_i` be the cumulative audio duration (ms) of every block scheduled
 * before it. With `t0` = the arrival of the first block, the deficit of
 * block `i` is `a_i - t0 - D_i`: how far behind the "ideal, gap-free"
 * playback timeline that block actually arrived. A positive deficit means
 * the block arrived after the point where gap-free playback would have
 * already needed it, so the prebuffer must absorb that much slack up
 * front. The needed prebuffer is the worst deficit across every block,
 * plus a fixed scheduling margin, clamped at 0.
 *
 * The first block's own deficit is always exactly 0 by construction
 * (`a_1 - t0 - 0 = 0`), so the running maximum this tracker keeps is
 * always >= 0 and a cached answer delivered as a single block measures
 * ~0 (just the scheduling margin).
 */

// Named after the historical LEDA_PCM_PLAYBACK_LEAD_SECONDS margin value
// (0.025 s = 25 ms, before c7efaf1 raised the lead itself to 0.2 s) -- this
// scheduling margin is the same fixed safety pad, kept as a named constant
// independent of whatever lead is actually in effect.
export const LEDA_PREBUFFER_SCHEDULING_MARGIN_MS = 25;

export class LedaPrebufferNeedTracker {
    private readonly schedulingMarginMs: number;
    private t0: number | null = null;
    private cumulativeDurationMs = 0;
    private maxDeficitMs = 0;

    public constructor(schedulingMarginMs: number = LEDA_PREBUFFER_SCHEDULING_MARGIN_MS) {
        this.schedulingMarginMs = schedulingMarginMs;
    }

    /**
     * Records one scheduled PCM block. `arrivalMs` is the engine clock
     * reading captured when the block became available (before it is
     * handed off for scheduling); `durationMs` is that block's own audio
     * duration, used as this block's contribution to `D_i` for every
     * block recorded after it.
     */
    public recordBlockArrival(arrivalMs: number, durationMs: number): void {
        if (this.t0 === null) {
            this.t0 = arrivalMs;
        }

        const deficit = arrivalMs - this.t0 - this.cumulativeDurationMs;
        if (deficit > this.maxDeficitMs) {
            this.maxDeficitMs = deficit;
        }

        this.cumulativeDurationMs += durationMs;
    }

    /** The measured prebuffer (ms) that would have avoided every gap. */
    public neededPrebufferMs(): number {
        if (this.t0 === null) {
            return 0;
        }

        return Math.max(0, Math.round(this.maxDeficitMs + this.schedulingMarginMs));
    }
}
