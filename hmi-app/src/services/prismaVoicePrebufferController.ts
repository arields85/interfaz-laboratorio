/**
 * Thin facade combining the continuous prebuffer estimator
 * (`prismaVoicePrebufferEstimator.ts`) and the browser history storage
 * (`prismaVoicePrebufferHistoryStorage.ts`) behind the two operations the
 * playback path (T3) needs: read the prebuffer to use for the next answer,
 * and record the measurement of the answer that just finished.
 *
 * `createPrismaVoiceAutomaticPrebufferPolicy()` below adapts this
 * controller to the engine's `PrismaVoicePrebufferPolicy` dependency
 * (`prismaVoiceAudioEngine.ts`); `createBrowserPrismaVoiceAutomaticPrebufferPolicy()`
 * is the one-call production factory wired in `usePrismaOrbPresentation.ts`.
 */
import { estimateNextPrismaVoicePrebufferMs, appendPrismaVoicePrebufferMeasurement } from './prismaVoicePrebufferEstimator';
import {
    createBrowserPrismaVoicePrebufferHistoryStorage,
    type PrismaVoicePrebufferHistoryStorage,
} from './prismaVoicePrebufferHistoryStorage';
import type { PrismaVoicePrebufferPolicy } from './prismaVoiceAudioEngine';
import { PRISMA_VOICE_CONFIG_DEFAULTS, type PrismaVoicePlaybackBufferConfig } from '../domain/prismaVoiceConfig';

export class PrismaVoicePrebufferController {
    private readonly storage: PrismaVoicePrebufferHistoryStorage;
    private readonly now: () => number;

    public constructor(storage: PrismaVoicePrebufferHistoryStorage, now: () => number = () => Date.now()) {
        this.storage = storage;
        this.now = now;
    }

    /** The prebuffer (ms) the caller should use for the next answer. */
    public getNextPrebufferMs(): number {
        return estimateNextPrismaVoicePrebufferMs(this.storage.read(), this.now());
    }

    /** Records the needed-prebuffer measurement of an answer that just finished. */
    public recordMeasurement(neededPrebufferMs: number): void {
        const updated = appendPrismaVoicePrebufferMeasurement(this.storage.read(), {
            neededPrebufferMs,
            recordedAtMs: this.now(),
        });
        this.storage.write(updated);
    }
}

export function createBrowserPrismaVoicePrebufferController(): PrismaVoicePrebufferController {
    return new PrismaVoicePrebufferController(createBrowserPrismaVoicePrebufferHistoryStorage());
}

/**
 * T3: adapts a `PrismaVoicePrebufferController` to the engine's
 * `PrismaVoicePrebufferPolicy` dependency, always resolving/reporting mode
 * `'automatic'`. Mode selection between Automatic and Manual (T4) picks
 * which policy to build here -- the engine itself never sees the
 * distinction beyond the `mode` label.
 */
export function createPrismaVoiceAutomaticPrebufferPolicy(
    controller: PrismaVoicePrebufferController,
): PrismaVoicePrebufferPolicy {
    return {
        resolvePrebufferMs: () => ({ prebufferMs: controller.getNextPrebufferMs(), mode: 'automatic' }),
        recordNeededPrebufferMs: (neededPrebufferMs) => controller.recordMeasurement(neededPrebufferMs),
    };
}

/** One-call production factory: a browser-backed Automatic prebuffer policy. */
export function createBrowserPrismaVoiceAutomaticPrebufferPolicy(): PrismaVoicePrebufferPolicy {
    return createPrismaVoiceAutomaticPrebufferPolicy(createBrowserPrismaVoicePrebufferController());
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
export function createPrismaVoiceManualPrebufferPolicy(
    controller: PrismaVoicePrebufferController,
    getManualSeconds: () => number,
): PrismaVoicePrebufferPolicy {
    return {
        resolvePrebufferMs: () => ({ prebufferMs: getManualSeconds() * 1_000, mode: 'manual' }),
        recordNeededPrebufferMs: (neededPrebufferMs) => controller.recordMeasurement(neededPrebufferMs),
    };
}

/**
 * T4: picks Automatic or Manual per answer from the current Prisma voice
 * config, read through `getPlaybackBuffer()` at `resolvePrebufferMs()` call
 * time (not once at construction) -- the engine snapshots the resolved
 * value once per answer at `play()` (T3), so this composition is what makes
 * a config change picked up on the *next* answer without rebuilding the
 * long-lived engine/policy. `getPlaybackBuffer()` returning `null`/
 * `undefined` (config unavailable, still loading, or failed to load) falls
 * back to Automatic.
 */
export function createPrismaVoiceConfiguredPrebufferPolicy(
    controller: PrismaVoicePrebufferController,
    getPlaybackBuffer: () => PrismaVoicePlaybackBufferConfig | null | undefined,
): PrismaVoicePrebufferPolicy {
    const automatic = createPrismaVoiceAutomaticPrebufferPolicy(controller);
    const manual = createPrismaVoiceManualPrebufferPolicy(
        controller,
        () => getPlaybackBuffer()?.manualSeconds ?? PRISMA_VOICE_CONFIG_DEFAULTS.playbackBuffer.manualSeconds,
    );

    return {
        resolvePrebufferMs: () => (getPlaybackBuffer()?.mode === 'manual' ? manual : automatic).resolvePrebufferMs(),
        recordNeededPrebufferMs: (neededPrebufferMs) => controller.recordMeasurement(neededPrebufferMs),
    };
}

/**
 * One-call production factory: a browser-backed policy that switches
 * between Automatic and Manual per answer from `getPlaybackBuffer()`. Wired
 * in `usePrismaOrbPresentation.ts`, which supplies a getter reading a ref
 * kept current from the live `usePrismaVoiceConfig()` query.
 */
export function createBrowserPrismaVoiceConfiguredPrebufferPolicy(
    getPlaybackBuffer: () => PrismaVoicePlaybackBufferConfig | null | undefined,
): PrismaVoicePrebufferPolicy {
    return createPrismaVoiceConfiguredPrebufferPolicy(createBrowserPrismaVoicePrebufferController(), getPlaybackBuffer);
}
