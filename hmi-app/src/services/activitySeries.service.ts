import { getDataActivitySeriesUrl } from '../config/dataConnection.config';
import type { ActivityAnalyticsQueryDraft, ActivityAnalyticsPresetQueryParams } from '../domain/activityAnalytics.types';
import { validateAndNormalizeActivitySeriesQueryParams } from '../utils/activitySeriesQueryValidation';
import { DataServiceError } from './dataOverview.service';

const ACTIVITY_SERIES_CLIENT_ERROR_MESSAGE = 'Activity-series request could not be completed';
const ACTIVITY_SERIES_SERVER_ERROR_MESSAGE = 'Activity-series data is temporarily unavailable';
const ACTIVITY_SERIES_NETWORK_ERROR_MESSAGE = 'Network error fetching activity-series';

export async function fetchActivitySeries(params: ActivityAnalyticsQueryDraft): Promise<unknown> {
    const validation = validateAndNormalizeActivitySeriesQueryParams(params);

    if (!validation.ok) {
        throw createActivitySeriesQueryError(validation.error);
    }

    const baseUrl = getDataActivitySeriesUrl();

    if (!baseUrl) {
        throw new DataServiceError('Activity-series URL is not configured');
    }

    const url = buildActivitySeriesUrl(baseUrl, validation.params);

    let response: Response;

    try {
        response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });
    } catch {
        throw new DataServiceError(ACTIVITY_SERIES_NETWORK_ERROR_MESSAGE);
    }

    if (!response.ok) {
        throw await createActivitySeriesHttpError(response);
    }

    return response.json();
}

function buildActivitySeriesUrl(baseUrl: string, params: ActivityAnalyticsPresetQueryParams): URL {
    const url = new URL(baseUrl);
    url.searchParams.set('machineId', String(params.machineId));
    url.searchParams.set('range', params.range);
    return url;
}

async function createActivitySeriesHttpError(response: Response): Promise<DataServiceError> {
    const fallbackMessage = `Activity-series request failed with status ${response.status}`;

    try {
        await response.json() as Record<string, unknown>;

        return new DataServiceError(getSanitizedActivitySeriesHttpMessage(response.status), response.status);
    } catch {
        return new DataServiceError(fallbackMessage, response.status);
    }
}

function getSanitizedActivitySeriesHttpMessage(statusCode: number): string {
    if (statusCode >= 500) {
        return ACTIVITY_SERIES_SERVER_ERROR_MESSAGE;
    }

    if (statusCode >= 400) {
        return ACTIVITY_SERIES_CLIENT_ERROR_MESSAGE;
    }

    return `Activity-series request failed with status ${statusCode}`;
}

function createActivitySeriesQueryError(reason: 'invalid-machine-id' | 'invalid-range'): DataServiceError {
    switch (reason) {
    case 'invalid-machine-id':
        return new DataServiceError('Activity-series query must use a positive integer machineId');
    case 'invalid-range':
        return new DataServiceError('Activity-series query must use a supported preset range');
    }
}
