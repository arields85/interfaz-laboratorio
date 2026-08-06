export type ProdTrendConfiguredMode = 'real' | 'simulated' | 'automatic';
export type ProdTrendEffectiveMode = 'real' | 'simulated' | 'fallback';
export type ProdTrendDataModePhase = 'active' | 'fallback';
export type ProdTrendDataSource = 'real' | 'last-known-good' | 'packaged-capture';

export const PROD_TREND_HISTORY_ENDPOINT = '/api/hmi-data/history' as const;
export const PROD_TREND_HISTORY_VARIABLE_KEY = 'Total kW' as const;

export type ProdTrendCaptureProvenance =
    | {
        purpose: 'activity-analytics';
        contractVersion: string;
        capturedAt: string;
    }
    | {
        purpose: 'history';
        endpoint: typeof PROD_TREND_HISTORY_ENDPOINT;
        variableKey: typeof PROD_TREND_HISTORY_VARIABLE_KEY;
        contractVersion: string;
        capturedAt: string;
    };

export type ProdTrendActivitySeriesIdentity =
    | { machineId: number; range: Exclude<ActivityAnalyticsRange, 'custom'> }
    | { machineId: number; range: 'custom'; start: string; end: string };

export interface ProdTrendCaptureManifestEntry {
    id: string;
    available: boolean;
    machineId?: number;
    range?: ActivityAnalyticsRange;
    start?: string;
    end?: string;
    file?: string;
    reason?: string;
}

export interface ProdTrendCaptureManifest {
    schemaVersion: number;
    captures: ProdTrendCaptureManifestEntry[];
    unavailable: Array<{ reason: string }>;
}

export type ProdTrendCaptureAvailability =
    | (ProdTrendCaptureManifestEntry & { available: true })
    | { available: false; reason: string };

export interface ProdTrendLastKnownGoodRecord {
    identityKey: string;
    capturedAt: number;
    response: ActivityAnalyticsResponse;
}

export type ProdTrendDataModeFailureReason =
    | 'network-error'
    | 'timeout'
    | 'http-error'
    | 'invalid-response'
    | 'invalid-contract'
    | 'repeated-empty-series';

export interface ProdTrendDataModeState {
    configuredMode: ProdTrendConfiguredMode;
    effectiveMode: ProdTrendEffectiveMode;
    phase: ProdTrendDataModePhase;
    emptyStreak: number;
    successStreak: number;
    committedSource: ProdTrendDataSource | null;
    fallbackReason: ProdTrendDataModeFailureReason | null;
}

export type ProdTrendDataModeEvent =
    | { type: 'configured-mode'; mode: unknown }
    | { type: 'real-error'; reason: ProdTrendDataModeFailureReason }
    | { type: 'real-success'; hasData: boolean }
    | { type: 'fallback-source-selected'; source: Exclude<ProdTrendDataSource, 'real'> };
import type { ActivityAnalyticsRange, ActivityAnalyticsResponse } from './activityAnalytics.types';
