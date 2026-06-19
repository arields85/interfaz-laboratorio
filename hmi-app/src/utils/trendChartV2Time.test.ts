import { describe, expect, it, vi } from 'vitest';
import type { HistoryDataPointV2, HistoryRangeV2, HistoryWindow } from '../domain/dataContract.types';
import {
    buildTrendChartV2VisibleTickValues,
    formatTrendChartV2Timestamp,
    resolveTrendChartV2Timezone,
    resolveTrendChartV2VisibleWindow,
    scaleTimestampToChartX,
} from './trendChartV2Time';

const ONE_MINUTE_MS = 60 * 1000;

function makeSeries(points: Array<[string, number | null]>): HistoryDataPointV2[] {
    return points.map(([timestamp, value]) => ({
        timestamp,
        timestampMs: Date.parse(timestamp),
        value,
    }));
}

describe('trendChartV2Time', () => {
    it('prefers backend window bounds over custom query and preset fallbacks', () => {
        const window: HistoryWindow = {
            start: '2026-06-18T10:00:00.000Z',
            end: '2026-06-18T12:00:00.000Z',
            timezone: 'UTC',
        };

        const result = resolveTrendChartV2VisibleWindow({
            responseWindow: window,
            customWindow: {
                start: '2026-06-18T09:00:00.000Z',
                end: '2026-06-18T13:00:00.000Z',
            },
            range: '24h',
            nowMs: Date.parse('2026-06-19T00:00:00.000Z'),
            series: makeSeries([
                ['2026-06-18T10:30:00.000Z', 10],
                ['2026-06-18T11:30:00.000Z', 12],
            ]),
        });

        expect(result.startMs).toBe(Date.parse(window.start));
        expect(result.endMs).toBe(Date.parse(window.end));
        expect(result.source).toBe('response-window');
    });

    it('falls back from custom window to preset and finally series extent', () => {
        const fixedNow = Date.parse('2026-06-19T00:00:00.000Z');

        const presetResult = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: '1h',
            nowMs: fixedNow,
            series: [],
        });

        expect(presetResult.startMs).toBe(fixedNow - (60 * 60 * 1000));
        expect(presetResult.endMs).toBe(fixedNow);
        expect(presetResult.source).toBe('preset');

        const extentResult = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: 'custom',
            nowMs: fixedNow,
            series: makeSeries([
                ['2026-06-18T08:00:00.000Z', 10],
                ['2026-06-18T10:00:00.000Z', 12],
            ]),
        });

        expect(extentResult.startMs).toBe(Date.parse('2026-06-18T08:00:00.000Z'));
        expect(extentResult.endMs).toBe(Date.parse('2026-06-18T10:00:00.000Z'));
        expect(extentResult.source).toBe('series-extent');
    });

    it('prefers deterministic series extent over client-now preset windows when backend window metadata is absent', () => {
        const fixedNow = Date.parse('2026-07-01T00:00:00.000Z');

        const result = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: '24h',
            nowMs: fixedNow,
            series: makeSeries([
                ['2026-06-18T08:00:00.000Z', 10],
                ['2026-06-18T10:00:00.000Z', 12],
            ]),
        });

        expect(result.startMs).toBe(Date.parse('2026-06-18T08:00:00.000Z'));
        expect(result.endMs).toBe(Date.parse('2026-06-18T10:00:00.000Z'));
        expect(result.source).toBe('series-extent');
    });

    it('resolves deterministic padded series extents for empty, single-point, and equal-timestamp custom series', () => {
        const fixedNow = Date.parse('2026-06-19T00:00:00.000Z');
        const singleTimestamp = Date.parse('2026-06-18T10:00:00.000Z');

        const emptyResult = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: 'custom',
            nowMs: fixedNow,
            series: [],
        });

        expect(emptyResult.source).toBe('preset');
        expect(emptyResult.startMs).toBe(fixedNow - (24 * 60 * 60 * 1000));
        expect(emptyResult.endMs).toBe(fixedNow);

        const singlePointResult = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: 'custom',
            nowMs: fixedNow,
            series: makeSeries([
                ['2026-06-18T10:00:00.000Z', 10],
            ]),
        });

        expect(singlePointResult.source).toBe('series-extent');
        expect(singlePointResult.startMs).toBe(singleTimestamp - ONE_MINUTE_MS);
        expect(singlePointResult.endMs).toBe(singleTimestamp + ONE_MINUTE_MS);

        const equalTimestampResult = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: 'custom',
            nowMs: fixedNow,
            series: makeSeries([
                ['2026-06-18T10:00:00.000Z', 10],
                ['2026-06-18T10:00:00.000Z', 12],
            ]),
        });

        expect(equalTimestampResult.source).toBe('series-extent');
        expect(equalTimestampResult.startMs).toBe(singleTimestamp - ONE_MINUTE_MS);
        expect(equalTimestampResult.endMs).toBe(singleTimestamp + ONE_MINUTE_MS);
    });

    it('uses resolved timezone formatting and real timestamp scaling', () => {
        vi.setSystemTime(new Date('2026-06-19T00:00:00.000Z'));

        expect(resolveTrendChartV2Timezone('UTC', 'America/Argentina/Buenos_Aires')).toBe('UTC');
        expect(resolveTrendChartV2Timezone(undefined, 'America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
        expect(resolveTrendChartV2Timezone('Invalid/Timezone', 'UTC')).toBe('UTC');

        expect(formatTrendChartV2Timestamp({
            timestampMs: Date.parse('2026-06-18T12:30:00.000Z'),
            range: '24h',
            timezone: 'UTC',
        })).toBe('12:30');

        const range: HistoryRangeV2 = '24h';
        const startMs = Date.parse('2026-06-18T10:00:00.000Z');
        const endMs = Date.parse('2026-06-18T12:00:00.000Z');
        const x0 = 10;
        const plotWidth = 120;

        expect(scaleTimestampToChartX({ timestampMs: startMs, startMs, endMs, x0, plotWidth })).toBe(10);
        expect(scaleTimestampToChartX({
            timestampMs: Date.parse('2026-06-18T10:30:00.000Z'),
            startMs,
            endMs,
            x0,
            plotWidth,
        })).toBe(40);
        expect(scaleTimestampToChartX({
            timestampMs: Date.parse('2026-06-18T11:30:00.000Z'),
            startMs,
            endMs,
            x0,
            plotWidth,
        })).toBe(100);

        expect(range).toBe('24h');
    });

    it('shows as many x-axis labels as fit without overlap based on available width', () => {
        const timestamps = [
            '2026-06-18T10:00:00.000Z',
            '2026-06-18T10:30:00.000Z',
            '2026-06-18T11:00:00.000Z',
            '2026-06-18T11:30:00.000Z',
            '2026-06-18T12:00:00.000Z',
            '2026-06-18T12:30:00.000Z',
            '2026-06-18T13:00:00.000Z',
            '2026-06-18T13:30:00.000Z',
            '2026-06-18T14:00:00.000Z',
        ];
        const points = makeSeries(timestamps.map((timestamp, index) => [timestamp, index]));

        const narrowTicks = buildTrendChartV2VisibleTickValues({
            points,
            startMs: Date.parse(timestamps[0]),
            endMs: Date.parse(timestamps[timestamps.length - 1]),
            plotLeft: 38,
            plotWidth: 120,
            range: '24h',
            timezone: 'UTC',
        });
        const wideTicks = buildTrendChartV2VisibleTickValues({
            points,
            startMs: Date.parse(timestamps[0]),
            endMs: Date.parse(timestamps[timestamps.length - 1]),
            plotLeft: 38,
            plotWidth: 360,
            range: '24h',
            timezone: 'UTC',
        });

        expect(narrowTicks.length).toBeGreaterThanOrEqual(2);
        expect(wideTicks.length).toBeGreaterThan(narrowTicks.length);
        expect(wideTicks[0]).toBe(Date.parse(timestamps[0]));
        expect(wideTicks.at(-1)).toBe(Date.parse(timestamps[timestamps.length - 1]));
    });

    it('keeps preset 12m charts using the full width when backend window is much wider than the visible series extent', () => {
        const result = resolveTrendChartV2VisibleWindow({
            responseWindow: {
                start: '2025-01-01T00:00:00.000Z',
                end: '2026-01-01T00:00:00.000Z',
            },
            customWindow: undefined,
            range: '12m',
            series: makeSeries([
                ['2026-06-01T00:00:00.000Z', 10],
                ['2026-06-15T00:00:00.000Z', 12],
                ['2026-06-30T00:00:00.000Z', 13],
            ]),
        });

        expect(result.source).toBe('series-extent');
        expect(result.startMs).toBe(Date.parse('2026-06-01T00:00:00.000Z'));
        expect(result.endMs).toBe(Date.parse('2026-06-30T00:00:00.000Z'));
    });

    it('also prefers series extent for 12m when backend preset windows add smaller edge padding that still leaves a visible leading gap', () => {
        const result = resolveTrendChartV2VisibleWindow({
            responseWindow: {
                start: '2026-05-15T00:00:00.000Z',
                end: '2026-07-15T00:00:00.000Z',
            },
            customWindow: undefined,
            range: '12m',
            series: makeSeries([
                ['2026-06-01T00:00:00.000Z', 10],
                ['2026-06-15T00:00:00.000Z', 12],
                ['2026-06-30T00:00:00.000Z', 13],
            ]),
        });

        expect(result.source).toBe('series-extent');
        expect(result.startMs).toBe(Date.parse('2026-06-01T00:00:00.000Z'));
        expect(result.endMs).toBe(Date.parse('2026-06-30T00:00:00.000Z'));
    });

    it('ignores leading and trailing null placeholders when resolving the visible series extent', () => {
        const result = resolveTrendChartV2VisibleWindow({
            responseWindow: undefined,
            customWindow: undefined,
            range: '12m',
            series: makeSeries([
                ['2026-06-01T00:00:00.000Z', null],
                ['2026-06-15T00:00:00.000Z', 10],
                ['2026-06-30T00:00:00.000Z', 12],
                ['2026-07-15T00:00:00.000Z', null],
            ]),
        });

        expect(result.source).toBe('series-extent');
        expect(result.startMs).toBe(Date.parse('2026-06-15T00:00:00.000Z'));
        expect(result.endMs).toBe(Date.parse('2026-06-30T00:00:00.000Z'));
    });

    it('distributes visible x-axis labels harmonically without a large final gap', () => {
        const timestamps = [
            '2026-01-01T00:00:00.000Z',
            '2026-02-01T00:00:00.000Z',
            '2026-03-01T00:00:00.000Z',
            '2026-04-01T00:00:00.000Z',
            '2026-05-01T00:00:00.000Z',
            '2026-06-01T00:00:00.000Z',
            '2026-07-01T00:00:00.000Z',
            '2026-08-01T00:00:00.000Z',
            '2026-09-01T00:00:00.000Z',
            '2026-10-01T00:00:00.000Z',
            '2026-11-01T00:00:00.000Z',
            '2026-12-01T00:00:00.000Z',
        ];
        const ticks = buildTrendChartV2VisibleTickValues({
            points: makeSeries(timestamps.map((timestamp, index) => [timestamp, index])),
            startMs: Date.parse(timestamps[0]),
            endMs: Date.parse(timestamps[timestamps.length - 1]),
            plotLeft: 38,
            plotWidth: 360,
            range: '12m',
            timezone: 'UTC',
        });
        const gaps = ticks.slice(1).map((tick, index) => tick - ticks[index]);
        const smallestGap = Math.min(...gaps);
        const largestGap = Math.max(...gaps);

        expect(ticks.length).toBeGreaterThanOrEqual(4);
        expect(ticks[0]).toBe(Date.parse(timestamps[0]));
        expect(ticks.at(-1)).toBe(Date.parse(timestamps[timestamps.length - 1]));
        expect(largestGap).toBeLessThanOrEqual(smallestGap * 2);
    });
});
