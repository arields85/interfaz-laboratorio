import {
    isLedaAudioMetric,
    LEDA_AUDIO_METRIC_SCHEMA_VERSION,
} from '../domain/ledaAudioMetric.types';
import type { LedaAudioMetric } from '../domain/ledaAudioMetric.types';
import type { LedaAudioMetricTransport } from '../domain/ledaAudioMetric.types';

export const LEDA_BROWSER_METRIC_SCHEMA_VERSION = LEDA_AUDIO_METRIC_SCHEMA_VERSION;
export const LEDA_BROWSER_METRIC_EVENT = 'leda-browser-metric';

export type LedaVoicePlaybackMetricTransport = LedaAudioMetricTransport;

export type LedaBrowserMetric = LedaAudioMetric;

let fallbackRunSequence = 0;

export function createOpaqueBrowserRunId(): string {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (typeof randomUuid === 'function') {
        return `leda-${randomUuid.call(globalThis.crypto).replaceAll('-', '')}`;
    }

    fallbackRunSequence += 1;
    return `leda-${fallbackRunSequence.toString(16).padStart(16, '0')}`;
}

export type LedaBrowserMetricSink = (metric: LedaBrowserMetric) => void;

export function dispatchLedaBrowserMetric(metric: LedaBrowserMetric): void {
    if (!isLedaAudioMetric(metric)) {
        return;
    }

    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
        return;
    }

    window.dispatchEvent(new CustomEvent<LedaBrowserMetric>(LEDA_BROWSER_METRIC_EVENT, {
        detail: metric,
    }));
}
