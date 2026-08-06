import type { AnalyticsDataMode } from '../domain/analyticsDataMode.types';

export function resolveAnalyticsDataMode(value: unknown): AnalyticsDataMode {
    return value === 'simulated' ? 'simulated' : 'real';
}
