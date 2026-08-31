import {
    isPrismaAudioMetric,
    PRISMA_AUDIO_METRIC_SCHEMA_VERSION,
} from '../domain/prismaAudioMetric.types';
import type { PrismaAudioMetric } from '../domain/prismaAudioMetric.types';
import type { PrismaAudioMetricTransport } from '../domain/prismaAudioMetric.types';

export const PRISMA_BROWSER_METRIC_SCHEMA_VERSION = PRISMA_AUDIO_METRIC_SCHEMA_VERSION;
export const PRISMA_BROWSER_METRIC_EVENT = 'prisma-browser-metric';

export type PrismaVoicePlaybackMetricTransport = PrismaAudioMetricTransport;

export type PrismaBrowserMetric = PrismaAudioMetric;

let fallbackRunSequence = 0;

export function createOpaqueBrowserRunId(): string {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (typeof randomUuid === 'function') {
        return `prisma-${randomUuid.call(globalThis.crypto).replaceAll('-', '')}`;
    }

    fallbackRunSequence += 1;
    return `prisma-${fallbackRunSequence.toString(16).padStart(16, '0')}`;
}

export type PrismaBrowserMetricSink = (metric: PrismaBrowserMetric) => void;

export function dispatchPrismaBrowserMetric(metric: PrismaBrowserMetric): void {
    if (!isPrismaAudioMetric(metric)) {
        return;
    }

    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }

    window.dispatchEvent(new CustomEvent<PrismaBrowserMetric>(PRISMA_BROWSER_METRIC_EVENT, {
        detail: metric,
    }));
}
