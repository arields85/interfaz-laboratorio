import type {
    ActivityAnalyticsGroupBy,
    ActivityAnalyticsPoint,
    ActivityAnalyticsRange,
    ActivityAnalyticsResponse,
    ActivityAnalyticsWindow,
} from '../domain/activityAnalytics.types';
import {
    PROD_TREND_HISTORY_ENDPOINT,
    PROD_TREND_HISTORY_VARIABLE_KEY,
    type ProdTrendActivitySeriesIdentity,
    type ProdTrendCaptureProvenance,
} from '../domain/prodTrendDataMode.types';
import { computeActivityAnalytics } from '../utils/activityAnalyticsComputation';

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
export const PROD_TREND_CAPTURE_SCHEMA_VERSION = '2';

export interface ProdTrendCapture {
    schemaVersion: string;
    provenance: ProdTrendCaptureProvenance;
    identity: ProdTrendActivitySeriesIdentity;
    window: ActivityAnalyticsWindow;
    unit: string | null;
    points: Array<{ offsetMs: number; value: number | null }>;
    checksum: string;
}

export interface ProdTrendCaptureMetadata {
    schemaVersion: string;
    capturedAt: string;
}

export interface ProdTrendRehydrationOptions {
    window: Pick<ActivityAnalyticsWindow, 'start' | 'end' | 'bucket' | 'bucketMs'>;
    thresholds: { setupKw: number; prodKw: number };
    groupBy: ActivityAnalyticsGroupBy;
    shifts: Array<{ id: string; label: string; start: string; end: string }>;
    timezone: string;
    nowMs?: number;
}

export interface ProdTrendRehydratedSource {
    source: 'packaged-capture';
    response: Omit<ActivityAnalyticsResponse, 'variableKey'>;
    analytics: ReturnType<typeof computeActivityAnalytics>;
}

export async function createProdTrendCaptureChecksum(raw: unknown): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw new Error('Web Crypto SHA-256 is unavailable');
    }

    const payload = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : raw;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        delete (payload as Record<string, unknown>).checksum;
        delete (payload as Record<string, unknown>).variableKey;
    }

    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(payload)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function adaptProdTrendCapture(
    raw: unknown,
    expectedIdentity: ProdTrendActivitySeriesIdentity,
): Promise<ProdTrendCapture> {
    const input = asRecord(raw);
    const checksum = nonEmptyString(input.checksum);
    if (!checksum || checksum !== await createProdTrendCaptureChecksum(input)) {
        throw new Error('Capture checksum is invalid');
    }

    return {
        ...createCaptureCandidate(input, expectedIdentity),
        checksum,
    };
}

export function adaptRawProdTrendActivitySeriesResponse(
    raw: unknown,
    metadata: ProdTrendCaptureMetadata,
): Omit<ProdTrendCapture, 'checksum'> {
    const input = asRecord(raw);
    const window = validateWindow(input.window);
    const identity = deriveActivitySeriesIdentity(input, window);
    return createCaptureCandidate({
        schemaVersion: metadata.schemaVersion,
        provenance: {
            purpose: input.purpose,
            contractVersion: input.contractVersion,
            capturedAt: metadata.capturedAt,
        },
        identity,
        window,
        unit: input.unit,
        points: normalizeRawPoints(input.series, window),
    }, identity);
}

export function adaptRawProdTrendHistoryResponse(
    raw: unknown,
    metadata: ProdTrendCaptureMetadata,
): Omit<ProdTrendCapture, 'checksum'> {
    const input = asRecord(raw);
    if (input.purpose !== undefined || input.variableKey !== PROD_TREND_HISTORY_VARIABLE_KEY) {
        throw new Error('History response provenance is invalid');
    }

    const window = validateWindow(input.window);
    const identity = deriveActivitySeriesIdentity(input, window);
    return createCaptureCandidate({
        schemaVersion: metadata.schemaVersion,
        provenance: {
            purpose: 'history',
            endpoint: PROD_TREND_HISTORY_ENDPOINT,
            variableKey: PROD_TREND_HISTORY_VARIABLE_KEY,
            contractVersion: input.contractVersion,
            capturedAt: metadata.capturedAt,
        },
        identity,
        window,
        unit: input.unit,
        points: adaptRawHistoryPoints(input.series, window),
    }, identity);
}

export function adaptRawProdTrendCaptureResponse(
    raw: unknown,
    metadata: ProdTrendCaptureMetadata,
): Omit<ProdTrendCapture, 'checksum'> {
    const input = asRecord(raw);
    return input.purpose === undefined
        ? adaptRawProdTrendHistoryResponse(input, metadata)
        : adaptRawProdTrendActivitySeriesResponse(input, metadata);
}

function createCaptureCandidate(
    input: Record<string, unknown>,
    expectedIdentity: ProdTrendActivitySeriesIdentity,
): Omit<ProdTrendCapture, 'checksum'> {
    const provenance = asRecord(input.provenance);
    const contractVersion = nonEmptyString(provenance.contractVersion);
    const schemaVersion = nonEmptyString(input.schemaVersion);
    const capturedAt = nonEmptyString(provenance.capturedAt);
    if (!contractVersion || !schemaVersion || !capturedAt || !validTimestamp(capturedAt)) {
        throw new Error('Capture provenance is invalid');
    }
    const parsedProvenance = parseCaptureProvenance(provenance, contractVersion, capturedAt);

    const identity = parseCaptureIdentity(input.identity);
    const window = validateWindow(input.window);
    if (!sameIdentity(identity, expectedIdentity)) {
        throw new Error('Capture identity is invalid');
    }
    if (identity.range === 'custom' && (window.start !== identity.start || window.end !== identity.end)) {
        throw new Error('Capture identity is invalid');
    }

    const points = parsedProvenance.purpose === 'history'
        ? validateCanonicalHistoryPoints(input.points, window)
        : normalizeCanonicalPoints(input.points, window);
    if (parsedProvenance.purpose === 'activity-analytics') {
        const expectedOffsets = expectedBucketOffsets(window);
        if (points.length !== expectedOffsets.length || expectedOffsets.some((offset) => !points.some((point) => point.offsetMs === offset))) {
            throw new Error('Capture coverage is incomplete');
        }
    }

    return {
        schemaVersion,
        provenance: parsedProvenance,
        identity,
        window,
        unit: nonEmptyString(input.unit),
        points,
    };
}

function parseCaptureProvenance(
    provenance: Record<string, unknown>,
    contractVersion: string,
    capturedAt: string,
): ProdTrendCaptureProvenance {
    if (provenance.purpose === 'activity-analytics') {
        return { purpose: 'activity-analytics', contractVersion, capturedAt };
    }
    if (
        provenance.purpose === 'history'
        && provenance.endpoint === PROD_TREND_HISTORY_ENDPOINT
        && provenance.variableKey === PROD_TREND_HISTORY_VARIABLE_KEY
    ) {
        return {
            purpose: 'history',
            endpoint: PROD_TREND_HISTORY_ENDPOINT,
            variableKey: PROD_TREND_HISTORY_VARIABLE_KEY,
            contractVersion,
            capturedAt,
        };
    }
    throw new Error('Capture provenance is invalid');
}

function deriveActivitySeriesIdentity(
    input: Record<string, unknown>,
    window: ActivityAnalyticsWindow,
): ProdTrendActivitySeriesIdentity {
    const machineId = input.machineId;
    const range = input.range;
    if (typeof machineId !== 'number' || !Number.isInteger(machineId) || machineId <= 0 || !isActivityAnalyticsRange(range)) {
        throw new Error('Capture identity is invalid');
    }

    return range === 'custom'
        ? { machineId, range, start: window.start, end: window.end }
        : { machineId, range };
}

function parseCaptureIdentity(raw: unknown): ProdTrendActivitySeriesIdentity {
    const identity = asRecord(raw);
    const machineId = identity.machineId;
    const range = identity.range;
    if (typeof machineId !== 'number' || !Number.isInteger(machineId) || machineId <= 0 || !isActivityAnalyticsRange(range)) {
        throw new Error('Capture identity is invalid');
    }

    if (range === 'custom') {
        const start = nonEmptyString(identity.start);
        const end = nonEmptyString(identity.end);
        if (!start || !end || !validTimestamp(start) || !validTimestamp(end) || Date.parse(start) >= Date.parse(end)) {
            throw new Error('Capture identity is invalid');
        }
        return { machineId, range, start, end };
    }

    return { machineId, range };
}

function sameIdentity(left: ProdTrendActivitySeriesIdentity, right: ProdTrendActivitySeriesIdentity): boolean {
    if (left.machineId !== right.machineId || left.range !== right.range) return false;
    return left.range !== 'custom'
        || (right.range === 'custom' && left.start === right.start && left.end === right.end);
}

export function rehydrateProdTrendCapture(
    capture: ProdTrendCapture,
    options: ProdTrendRehydrationOptions,
): ProdTrendRehydratedSource {
    const captureDurationMs = Date.parse(capture.window.end) - Date.parse(capture.window.start);
    const requestedEndMs = Date.parse(options.window.end);
    const requestedStart = new Date(requestedEndMs - captureDurationMs).toISOString();
    const series: ActivityAnalyticsPoint[] = capture.points.map((point) => {
        const timestampMs = requestedEndMs - captureDurationMs + point.offsetMs;
        return { timestamp: new Date(timestampMs).toISOString(), timestampMs, value: point.value };
    });
    const window = { ...options.window, start: requestedStart, end: options.window.end };
    const analytics = computeActivityAnalytics({
        series,
        thresholds: options.thresholds,
        range: capture.identity.range,
        groupBy: options.groupBy,
        shifts: options.shifts,
        timezone: options.timezone,
        window,
        nowMs: options.nowMs,
    });

    return {
        source: 'packaged-capture',
        response: {
            contractVersion: capture.provenance.contractVersion,
            machineId: capture.identity.machineId,
            range: capture.identity.range,
            unit: capture.unit,
            purpose: 'activity-analytics',
            window,
            series,
            summary: {
                ...analytics.analytics,
                intervals: undefined,
            },
        },
        analytics,
    };
}

function normalizeRawPoints(raw: unknown, window: ActivityAnalyticsWindow): Array<{ offsetMs: number; value: number | null }> {
    if (!Array.isArray(raw)) return [];
    const startMs = Date.parse(window.start);
    const endMs = Date.parse(window.end);
    return raw
        .map((candidate) => {
            if (!candidate || typeof candidate !== 'object') return null;
            const point = candidate as Record<string, unknown>;
            const timestamp = nonEmptyString(point.timestamp);
            const value = point.value === null ? null : point.value;
            if (!timestamp || !validTimestamp(timestamp) || (typeof value !== 'number' && value !== null) || (typeof value === 'number' && !Number.isFinite(value))) return null;
            const timestampMs = Date.parse(timestamp);
            const offsetMs = timestampMs - startMs;
            return timestampMs >= startMs && timestampMs < endMs && offsetMs % window.bucketMs === 0
                ? { offsetMs, value }
                : null;
        })
        .filter((point): point is { offsetMs: number; value: number | null } => point !== null)
        .sort((left, right) => left.offsetMs - right.offsetMs);
}

function adaptRawHistoryPoints(raw: unknown, window: ActivityAnalyticsWindow): Array<{ offsetMs: number; value: number | null }> {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('History response series is invalid');
    const startMs = Date.parse(window.start);
    const endMs = Date.parse(window.end);
    let previousTimestampMs = Number.NEGATIVE_INFINITY;

    return raw.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') throw new Error('History response series is invalid');
        const point = candidate as Record<string, unknown>;
        const timestamp = nonEmptyString(point.timestamp);
        const value = point.value === null ? null : point.value;
        if (!timestamp || !validTimestamp(timestamp) || (typeof value !== 'number' && value !== null) || (typeof value === 'number' && !Number.isFinite(value))) {
            throw new Error('History response series is invalid');
        }
        const timestampMs = Date.parse(timestamp);
        if (timestampMs < startMs || timestampMs > endMs || timestampMs <= previousTimestampMs) {
            throw new Error('History response series is invalid');
        }
        previousTimestampMs = timestampMs;
        return { offsetMs: timestampMs - startMs, value };
    });
}

function normalizeCanonicalPoints(raw: unknown, window: ActivityAnalyticsWindow): Array<{ offsetMs: number; value: number | null }> {
    if (!Array.isArray(raw)) return [];
    const durationMs = Date.parse(window.end) - Date.parse(window.start);
    return raw
        .map((candidate) => {
            if (!candidate || typeof candidate !== 'object') return null;
            const point = candidate as Record<string, unknown>;
            const offsetMs = point.offsetMs;
            const value = point.value === null ? null : point.value;
            if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs) || (typeof value !== 'number' && value !== null) || (typeof value === 'number' && !Number.isFinite(value))) return null;
            return offsetMs >= 0 && offsetMs < durationMs && offsetMs % window.bucketMs === 0
                ? { offsetMs, value }
                : null;
        })
        .filter((point): point is { offsetMs: number; value: number | null } => point !== null)
        .sort((left, right) => left.offsetMs - right.offsetMs);
}

function validateCanonicalHistoryPoints(raw: unknown, window: ActivityAnalyticsWindow): Array<{ offsetMs: number; value: number | null }> {
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('Capture history points are invalid');
    const durationMs = Date.parse(window.end) - Date.parse(window.start);
    let previousOffsetMs = Number.NEGATIVE_INFINITY;

    return raw.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') throw new Error('Capture history points are invalid');
        const point = candidate as Record<string, unknown>;
        const offsetMs = point.offsetMs;
        const value = point.value === null ? null : point.value;
        if (
            typeof offsetMs !== 'number'
            || !Number.isFinite(offsetMs)
            || !Number.isInteger(offsetMs)
            || offsetMs < 0
            || offsetMs > durationMs
            || offsetMs <= previousOffsetMs
            || (typeof value !== 'number' && value !== null)
            || (typeof value === 'number' && !Number.isFinite(value))
        ) {
            throw new Error('Capture history points are invalid');
        }
        previousOffsetMs = offsetMs;
        return { offsetMs, value };
    });
}

function expectedBucketOffsets(window: ActivityAnalyticsWindow): number[] {
    const durationMs = Date.parse(window.end) - Date.parse(window.start);
    return Array.from({ length: Math.ceil(durationMs / window.bucketMs) }, (_, index) => index * window.bucketMs);
}

function validateWindow(raw: unknown): ActivityAnalyticsWindow {
    const window = asRecord(raw);
    const start = nonEmptyString(window.start);
    const end = nonEmptyString(window.end);
    const bucket = nonEmptyString(window.bucket);
    const bucketMs = window.bucketMs;
    if (!start || !end || !bucket || !validTimestamp(start) || !validTimestamp(end) || typeof bucketMs !== 'number' || bucketMs <= 0 || Date.parse(start) >= Date.parse(end)) {
        throw new Error('Capture window is invalid');
    }
    const timezone = nonEmptyString(window.timezone);
    return timezone ? { start, end, bucket, bucketMs, timezone } : { start, end, bucket, bucketMs };
}

function validTimestamp(value: string): boolean {
    return ISO_WITH_OFFSET.test(value) && Number.isFinite(Date.parse(value));
}

function isActivityAnalyticsRange(value: unknown): value is ActivityAnalyticsRange {
    return value === '1h' || value === '24h' || value === '7d' || value === '30d' || value === '12m' || value === 'custom';
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Capture payload is invalid');
    return value as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
