import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DataContractResponse } from '../domain';
import * as dataConnectionConfig from '../config/dataConnection.config';
import { fetchDataOverview, DataServiceError } from './dataOverview.service';

describe('dataOverview.service', () => {
    beforeEach(() => {
        vi.spyOn(dataConnectionConfig, 'getDataFullUrl').mockImplementation(() => {
            const baseUrl = import.meta.env.VITE_NODE_RED_BASE_URL as string | undefined;

            if (!baseUrl || baseUrl.trim() === '') {
                return null;
            }

            return `${baseUrl.replace(/\/+$/, '')}/api/hmi-data`;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('throws a typed error when the base url is not configured', async () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', '');

        await expect(fetchDataOverview()).rejects.toMatchObject({
            name: 'DataServiceError',
            message: 'Data connection base URL is not configured',
        });
    });

    it('fetches the overview from the configured endpoint using GET only', async () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local/');

        const payload: DataContractResponse = {
            contractVersion: '1.0.0',
            connection: { globalStatus: 'online', lastSuccess: '2026-04-21T15:00:00Z', ageMs: 0 },
            machines: [
                {
                    unitId: 7,
                    name: 'Compresor 7',
                    status: 'online',
                    lastSuccess: '2026-04-21T15:00:00Z',
                    ageMs: 0,
                    values: {
                        pressure: { value: 12.4, unit: 'bar', timestamp: '2026-04-21T15:00:00Z' },
                    },
                },
            ],
            timestamp: '2026-04-21T15:00:00Z',
        };

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(payload),
        });

        vi.stubGlobal('fetch', fetchMock);

        await expect(fetchDataOverview()).resolves.toEqual(payload);
        expect(fetchMock).toHaveBeenCalledWith('https://node-red.local/api/hmi-data', {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
    });

    it('wraps network failures in a typed service error', async () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

        await expect(fetchDataOverview()).rejects.toMatchObject({
            name: 'DataServiceError',
            message: 'Network error fetching data overview: socket hang up',
        });
    });

    it('exposes the upstream status code when overview fetch fails', async () => {
        vi.stubEnv('VITE_NODE_RED_BASE_URL', 'https://node-red.local');
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
            })
        );

        await expect(fetchDataOverview()).rejects.toEqual(
            new DataServiceError('Data overview returned 503: Service Unavailable', 503)
        );
    });
});
