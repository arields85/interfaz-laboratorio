import type { ProdTrendConfiguredMode } from '../domain/prodTrendDataMode.types';
import { resolveAnalyticsDataMode } from './analyticsDataMode';

export function resolveProdTrendConfiguredMode(value: unknown): ProdTrendConfiguredMode {
    return resolveAnalyticsDataMode(value);
}
