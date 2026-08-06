import { buildTrendChartV2SimulatedHistory } from './trendChartV2Simulation';

export type ActivityAnalyticsSimulatedHistoryOptions = Parameters<typeof buildTrendChartV2SimulatedHistory>[0];

export function buildActivityAnalyticsSimulatedHistory(options: ActivityAnalyticsSimulatedHistoryOptions) {
    return buildTrendChartV2SimulatedHistory(options);
}
