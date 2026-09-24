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
