import manifest from '../assets/prod-trend-captures/manifest.json';
import {
    adaptProdTrendCapture,
    rehydrateProdTrendCapture,
    type ProdTrendRehydratedSource,
    type ProdTrendRehydrationOptions,
} from '../adapters/prodTrendCapture.adapter';
import type {
    ProdTrendActivitySeriesIdentity,
    ProdTrendCaptureAvailability,
    ProdTrendCaptureManifest,
} from '../domain/prodTrendDataMode.types';
import { createActivitySeriesIdentityKey } from './ProdTrendLastKnownGoodStorageService';

const CAPTURE_ASSET_PREFIX = '../assets/prod-trend-captures/';
const packagedCaptureFiles = import.meta.glob<unknown>(
    '../assets/prod-trend-captures/*.json',
    { eager: true, import: 'default' },
);

export type ProdTrendPackagedSource = ProdTrendRehydratedSource & {
    identity: ProdTrendActivitySeriesIdentity;
};
export type ProdTrendCaptureLoader = (file: string) => unknown | Promise<unknown>;

function loadPackagedCaptureFile(file: string): unknown {
    return packagedCaptureFiles[`${CAPTURE_ASSET_PREFIX}${file}`];
}

export class ProdTrendCaptureRepository {
    private readonly manifest: ProdTrendCaptureManifest;
    private readonly loadFile: ProdTrendCaptureLoader;

    constructor(manifest: ProdTrendCaptureManifest, loadFile: ProdTrendCaptureLoader = loadPackagedCaptureFile) {
        this.manifest = manifest;
        this.loadFile = loadFile;
    }

    find(identity: ProdTrendActivitySeriesIdentity): ProdTrendCaptureAvailability {
        const key = createActivitySeriesIdentityKey(identity);
        const capture = this.manifest.captures.find((candidate) => {
            if (!candidate.available || candidate.machineId !== identity.machineId || candidate.range !== identity.range) {
                return false;
            }

            return createActivitySeriesIdentityKey({
                machineId: candidate.machineId,
                range: candidate.range,
                ...(identity.range === 'custom' ? { start: candidate.start ?? '', end: candidate.end ?? '' } : {}),
            } as ProdTrendActivitySeriesIdentity) === key;
        });

        return capture ? { ...capture, available: true } : {
            available: false,
            reason: this.manifest.unavailable[0]?.reason ?? 'capture-missing',
        };
    }

    async load(identity: ProdTrendActivitySeriesIdentity): Promise<ProdTrendPackagedSource | null> {
        const availability = this.find(identity);
        if (!availability.available || !availability.file) {
            return null;
        }

        const raw = await this.loadFile(availability.file);
        if (raw === undefined || raw === null) {
            return null;
        }

        const capture = await adaptProdTrendCapture(raw, identity);
        const options: ProdTrendRehydrationOptions = {
            window: capture.window,
            thresholds: { setupKw: 0, prodKw: 1 },
            groupBy: 'shift',
            shifts: [],
            timezone: capture.window.timezone ?? 'UTC',
        };

        return {
            ...rehydrateProdTrendCapture(capture, options),
            identity,
        };
    }
}

export const prodTrendCaptureRepository = new ProdTrendCaptureRepository(manifest as ProdTrendCaptureManifest);
