/**
 * Thin facade combining the continuous prebuffer estimator
 * (`ledaVoicePrebufferEstimator.ts`) and the browser history storage
 * (`ledaVoicePrebufferHistoryStorage.ts`) behind the two operations the
 * playback path (T3) needs: read the prebuffer to use for the next answer,
 * and record the measurement of the answer that just finished.
 *
 * `createLedaVoiceAutomaticPrebufferPolicy()` below adapts this
 * controller to the engine's `LedaVoicePrebufferPolicy` dependency
 * (`ledaVoiceAudioEngine.ts`); `createBrowserLedaVoiceAutomaticPrebufferPolicy()`
 * is the one-call production factory wired in `useLedaOrbPresentation.ts`.
 */
import { estimateNextLedaVoicePrebufferMs, appendLedaVoicePrebufferMeasurement } from './ledaVoicePrebufferEstimator';
import {
    createBrowserLedaVoicePrebufferHistoryStorage,
    type LedaVoicePrebufferHistoryStorage,
} from './ledaVoicePrebufferHistoryStorage';
import type { LedaVoicePrebufferPolicy } from './ledaVoiceAudioEngine';
import { LEDA_VOICE_CONFIG_DEFAULTS, type LedaVoicePlaybackBufferConfig } from '../domain/ledaVoiceConfig';

export class LedaVoicePrebufferController {
    private readonly storage: LedaVoicePrebufferHistoryStorage;
    private readonly now: () => number;

    public constructor(storage: LedaVoicePrebufferHistoryStorage, now: () => number = () => Date.now()) {
        this.storage = storage;
        this.now = now;
    }

    /** The prebuffer (ms) the caller should use for the next answer. */
    public getNextPrebufferMs(): number {
        return estimateNextLedaVoicePrebufferMs(this.storage.read(), this.now());
    }

    /** Records the needed-prebuffer measurement of an answer that just finished. */
    public recordMeasurement(neededPrebufferMs: number): void {
        const updated = appendLedaVoicePrebufferMeasurement(this.storage.read(), {
            neededPrebufferMs,
            recordedAtMs: this.now(),
        });
        this.storage.write(updated);
    }
}

export function createBrowserLedaVoicePrebufferController(): LedaVoicePrebufferController {
    return new LedaVoicePrebufferController(createBrowserLedaVoicePrebufferHistoryStorage());
}

/**
 * T3: adapts a `LedaVoicePrebufferController` to the engine's
 * `LedaVoicePrebufferPolicy` dependency, always resolving/reporting mode
 * `'automatic'`. Mode selection between Automatic and Manual (T4) picks
 * which policy to build here -- the engine itself never sees the
 * distinction beyond the `mode` label.
 */
export function createLedaVoiceAutomaticPrebufferPolicy(
    controller: LedaVoicePrebufferController,
): LedaVoicePrebufferPolicy {
    return {
        resolvePrebufferMs: () => ({ prebufferMs: controller.getNextPrebufferMs(), mode: 'automatic' }),
        recordNeededPrebufferMs: (neededPrebufferMs) => controller.recordMeasurement(neededPrebufferMs),
    };
}

/** One-call production factory: a browser-backed Automatic prebuffer policy. */
export function createBrowserLedaVoiceAutomaticPrebufferPolicy(): LedaVoicePrebufferPolicy {
    return createLedaVoiceAutomaticPrebufferPolicy(createBrowserLedaVoicePrebufferController());
}

/**
 * T4: the Manual counterpart to the Automatic policy above. Resolves the
 * lead the user configured (`getManualSeconds()`, seconds) instead of the
 * controller's estimate -- the estimate/history is never consulted to
 * *choose* the lead in Manual mode. Measurements are still forwarded to the
 * shared controller (Design item 4: "Manual answers are still measured and
 * logged, but do not change the manual value"), so the Automatic history
 * keeps learning in the background even while Manual is selected, ready the
 * moment the user switches back.
 */
export function createLedaVoiceManualPrebufferPolicy(
    controller: LedaVoicePrebufferController,
    getManualSeconds: () => number,
): LedaVoicePrebufferPolicy {
    return {
        resolvePrebufferMs: () => ({ prebufferMs: getManualSeconds() * 1_000, mode: 'manual' }),
        recordNeededPrebufferMs: (neededPrebufferMs) => controller.recordMeasurement(neededPrebufferMs),
    };
}

/**
 * T4: picks Automatic or Manual per answer from the current Leda voice
 * config, read through `getPlaybackBuffer()` at `resolvePrebufferMs()` call
 * time (not once at construction) -- the engine snapshots the resolved
 * value once per answer at `play()` (T3), so this composition is what makes
 * a config change picked up on the *next* answer without rebuilding the
 * long-lived engine/policy. `getPlaybackBuffer()` returning `null`/
 * `undefined` (config unavailable, still loading, or failed to load) falls
 * back to Automatic.
 */
export function createLedaVoiceConfiguredPrebufferPolicy(
    controller: LedaVoicePrebufferController,
    getPlaybackBuffer: () => LedaVoicePlaybackBufferConfig | null | undefined,
): LedaVoicePrebufferPolicy {
    const automatic = createLedaVoiceAutomaticPrebufferPolicy(controller);
    const manual = createLedaVoiceManualPrebufferPolicy(
        controller,
        () => getPlaybackBuffer()?.manualSeconds ?? LEDA_VOICE_CONFIG_DEFAULTS.playbackBuffer.manualSeconds,
    );

    return {
        resolvePrebufferMs: () => (getPlaybackBuffer()?.mode === 'manual' ? manual : automatic).resolvePrebufferMs(),
        recordNeededPrebufferMs: (neededPrebufferMs) => controller.recordMeasurement(neededPrebufferMs),
    };
}

/**
 * One-call production factory: a browser-backed policy that switches
 * between Automatic and Manual per answer from `getPlaybackBuffer()`. Wired
 * in `useLedaOrbPresentation.ts`, which supplies a getter reading a ref
 * kept current from the live `useLedaVoiceConfig()` query.
 */
export function createBrowserLedaVoiceConfiguredPrebufferPolicy(
    getPlaybackBuffer: () => LedaVoicePlaybackBufferConfig | null | undefined,
): LedaVoicePrebufferPolicy {
    return createLedaVoiceConfiguredPrebufferPolicy(createBrowserLedaVoicePrebufferController(), getPlaybackBuffer);
}
