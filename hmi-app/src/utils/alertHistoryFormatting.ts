import type { AlertHistoryEntry, HistorySeverity } from '../domain/alertHistory.types';

function resolveAlertHistoryNow(now?: number | string | Date): number {
    if (typeof now === 'number') {
        return now;
    }

    if (typeof now === 'string' || now instanceof Date) {
        return new Date(now).getTime();
    }

    return Date.now();
}

export function formatAlertHistoryAge(iso: string, now?: number | string | Date): string {
    const resolvedNow = resolveAlertHistoryNow(now);
    const diffMs = resolvedNow - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);

    if (diffSec < 60) return 'hace un momento';
    if (diffSec < 3600) {
        const mins = Math.floor(diffSec / 60);
        return `hace ${mins} min`;
    }
    if (diffSec < 86400) {
        const hours = Math.floor(diffSec / 3600);
        return `hace ${hours}h`;
    }
    const days = Math.floor(diffSec / 86400);
    return `hace ${days}d`;
}

export function formatAlertHistoryValue(value: AlertHistoryEntry['value'], unit?: string): string | null {
    if (value === undefined || value === null) {
        return null;
    }

    const formattedValue = typeof value === 'number' && value % 1 !== 0
        ? value.toFixed(2)
        : String(value);

    return `${formattedValue}${unit ? ` ${unit}` : ''}`;
}

export function resolveAlertHistoryLevel(severity: HistorySeverity): 'advertencia' | 'critica' {
    return severity === 'critical' ? 'critica' : 'advertencia';
}
