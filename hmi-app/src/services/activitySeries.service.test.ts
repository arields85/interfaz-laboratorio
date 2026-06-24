import { afterEach, describe, expect, it, vi } from 'vitest';

import * as dataConnectionConfig from '../config/dataConnection.config';
import { DataServiceError } from './dataOverview.service';
import { fetchActivitySeries } from './activitySeries.service';

describe('activitySeries.service', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('serializes preset ranges as read-only GET requests', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        const payload = { ok: true };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });

        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi-data/activity-series?machineId=7&range=24h',
            {
                method: 'GET',
                headers: { Accept: 'application/json' },
            }
        );
    });

    it('serializes custom activity-series windows as read-only GET requests with explicit boundaries', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        const payload = { ok: true };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchActivitySeries({
                machineId: 7,
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
            })
        ).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi-data/activity-series?machineId=7&range=custom&start=2026-06-18T10%3A00%3A00.000Z&end=2026-06-18T12%3A00%3A00.000Z',
            {
                method: 'GET',
                headers: { Accept: 'application/json' },
            }
        );
    });

    it('never serializes runtime grouping or schedule metadata into Node-RED activity-series params', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        const payload = { ok: true };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchActivitySeries({
                machineId: 7,
                range: 'custom',
                start: '2026-06-18T10:00:00.000Z',
                end: '2026-06-18T12:00:00.000Z',
                groupBy: 'month',
                shifts: [{ label: 'Night' }],
            } as never)
        ).resolves.toEqual(payload);

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.local/api/hmi-data/activity-series?machineId=7&range=custom&start=2026-06-18T10%3A00%3A00.000Z&end=2026-06-18T12%3A00%3A00.000Z',
            {
                method: 'GET',
                headers: { Accept: 'application/json' },
            }
        );
    });

    it('rejects oversized custom activity-series windows before sending a request', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(
            fetchActivitySeries({
                machineId: 7,
                range: 'custom',
                start: '2026-06-01T00:00:00.000Z',
                end: '2026-07-02T00:00:00.001Z',
            })
        ).rejects.toEqual(new DataServiceError('Custom activity-series window must be 30 days or less'));

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws a typed error when the activity-series url is not configured', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(null);

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).rejects.toEqual(
            new DataServiceError('Activity-series URL is not configured')
        );
    });

    it('sanitizes upstream 400 json errors while preserving the status code', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                json: vi.fn().mockResolvedValue({
                    message: 'Influx query failed near bucket size details',
                }),
            })
        );

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).rejects.toEqual(
            new DataServiceError('Activity-series request could not be completed', 400)
        );
    });

    it('sanitizes upstream 500 json errors while preserving the status code', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
                json: vi.fn().mockResolvedValue({
                    error: 'Node-RED flow crashed while querying InfluxDB',
                }),
            })
        );

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).rejects.toEqual(
            new DataServiceError('Activity-series data is temporarily unavailable', 500)
        );
    });

    it('sanitizes non-json http failures without leaking upstream status text', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 502,
                statusText: 'Bad Gateway via edge proxy cluster-us-east-1',
                json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token < in JSON at position 0')),
            })
        );

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).rejects.toEqual(
            new DataServiceError('Activity-series request failed with status 502', 502)
        );
    });

    it('wraps network failures in a typed activity-series error', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).rejects.toEqual(
            new DataServiceError('Network error fetching activity-series')
        );
    });

    it('sanitizes non-error network failures without leaking infrastructure details', async () => {
        vi.spyOn(dataConnectionConfig, 'getDataActivitySeriesUrl').mockReturnValue(
            'https://api.local/api/hmi-data/activity-series'
        );

        vi.stubGlobal('fetch', vi.fn().mockRejectedValue('ECONNRESET upstream proxy'));

        await expect(fetchActivitySeries({ machineId: 7, range: '24h' })).rejects.toEqual(
            new DataServiceError('Network error fetching activity-series')
        );
    });
});
