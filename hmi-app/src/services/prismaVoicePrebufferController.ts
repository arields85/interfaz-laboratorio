/**
 * Thin facade combining the continuous prebuffer estimator
 * (`prismaVoicePrebufferEstimator.ts`) and the browser history storage
 * (`prismaVoicePrebufferHistoryStorage.ts`) behind the two operations the
 * playback path (T3) needs: read the prebuffer to use for the next answer,
 * and record the measurement of the answer that just finished.
 *
 * Not wired into playback yet -- that wiring is T3
 * (`prismaVoiceAudioEngine.ts` / `usePrismaOrbPresentation.ts`).
 */
import { estimateNextPrismaVoicePrebufferMs, appendPrismaVoicePrebufferMeasurement } from './prismaVoicePrebufferEstimator';
import {
    createBrowserPrismaVoicePrebufferHistoryStorage,
    type PrismaVoicePrebufferHistoryStorage,
} from './prismaVoicePrebufferHistoryStorage';

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
